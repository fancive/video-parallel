import { buildSummaryMarkdown, sanitizeFilename } from "./lib/markdown";
import {
  DEFAULT_PANEL_PREFERENCES,
  normalizePanelPreferences,
  PANEL_PREFERENCES_KEY,
  type PanelFontSize,
  type PanelPreferences,
} from "./lib/panel-preferences";
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  providerFingerprint,
  providerRequiresApiKey,
  SETTINGS_KEY,
  TARGET_LANGUAGE_LABELS,
} from "./lib/settings";
import { tabIdFromSidePanelSearch } from "./lib/side-panel";
import { makeChapterBlocks, SUMMARY_PROMPT_VERSION } from "./lib/summary";
import { formatTimecode } from "./lib/transcript";
import type {
  AppSettings,
  ChapterOutline,
  SummaryBlock,
  SummaryCache,
  SummaryContent,
  TokenUsage,
  VideoContext,
  VideoOverview,
} from "./lib/types";

interface RuntimeResponse {
  ok: boolean;
  error?: string;
  video?: VideoContext;
  seconds?: number;
  overview?: VideoOverview;
  chapters?: ChapterOutline[];
  usage?: TokenUsage;
  start?: boolean;
}

const loadingState = element<HTMLElement>("loadingState");
const emptyState = element<HTMLElement>("emptyState");
const emptyTitle = element<HTMLElement>("emptyTitle");
const emptyMessage = element<HTMLElement>("emptyMessage");
const workspace = element<HTMLElement>("workspace");
const commandBar = element<HTMLElement>("commandBar");
const summaryList = element<HTMLElement>("summaryList");
const chapterCount = element<HTMLElement>("chapterCount");
const statusDot = element<HTMLElement>("statusDot");
const statusText = element<HTMLElement>("statusText");
const tokenUsage = element<HTMLElement>("tokenUsage");
const processButton = element<HTMLButtonElement>("processButton");
const processButtonLabel = element<HTMLElement>("processButtonLabel");
const followButton = element<HTMLButtonElement>("followButton");
const followButtonLabel = element<HTMLElement>("followButtonLabel");
const fontSizeButton = element<HTMLButtonElement>("fontSizeButton");
const fontSizeMenu = element<HTMLElement>("fontSizeMenu");
const fontSizeOptions = Array.from(
  fontSizeMenu.querySelectorAll<HTMLButtonElement>("[data-font-size]"),
);
const toast = element<HTMLElement>("toast");

let currentVideo: VideoContext | null = null;
let currentOverview: VideoOverview | null = null;
let currentChapters: SummaryBlock[] = [];
let currentTokenUsage: TokenUsage | null = null;
let settings: AppSettings = DEFAULT_SETTINGS;
let panelPreferences: PanelPreferences = DEFAULT_PANEL_PREFERENCES;
let activeChapterId = "";
let playbackTimer: number | undefined;
let toastTimer: number | undefined;
let loadingGeneration = 0;
let processing = false;
const hasExtensionRuntime = typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);

element<HTMLButtonElement>("settingsButton").addEventListener("click", openSettings);
fontSizeButton.addEventListener("click", (event) => {
  event.stopPropagation();
  setFontSizeMenuOpen(fontSizeMenu.hasAttribute("hidden"));
});
fontSizeMenu.addEventListener("click", (event) => event.stopPropagation());
for (const option of fontSizeOptions) {
  option.addEventListener("click", () => {
    const fontSize = option.dataset.fontSize as PanelFontSize;
    void setPanelFontSize(fontSize);
  });
}
document.addEventListener("click", () => setFontSizeMenuOpen(false));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setFontSizeMenuOpen(false);
});
element<HTMLButtonElement>("retryButton").addEventListener("click", () => void loadVideo());
processButton.addEventListener("click", () => void processVideo());
followButton.addEventListener("click", toggleFollow);
element<HTMLButtonElement>("copyButton").addEventListener("click", () => void copyMarkdown());
element<HTMLButtonElement>("exportButton").addEventListener("click", exportMarkdown);

if (hasExtensionRuntime) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (changes[SETTINGS_KEY]) {
      settings = normalizeSettings(changes[SETTINGS_KEY].newValue);
      updateToolbarState();
      if (currentVideo && !processing) void reloadSummaryCache();
    }
    if (changes[PANEL_PREFERENCES_KEY]) {
      panelPreferences = normalizePanelPreferences(changes[PANEL_PREFERENCES_KEY].newValue);
      applyPanelPreferences();
    }
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (tabId !== currentVideo?.tabId || !changeInfo.url) return;
    void loadVideo();
  });

  chrome.runtime.onMessage.addListener((message: unknown) => {
    if (!message || typeof message !== "object") return false;
    const request = message as Record<string, unknown>;
    const tabId = Number(request.tabId);
    if (request.type === "START_PROCESSING" && tabId === currentVideo?.tabId) {
      void consumeProcessRequestAndStart(tabId);
    }
    if (request.type === "CLOSE_PANEL" && tabId === currentVideo?.tabId) window.close();
    return false;
  });

  void boot();
} else {
  applyPanelPreferences();
  renderLocalPreview();
}

async function boot(): Promise<void> {
  const stored = await chrome.storage.local.get([SETTINGS_KEY, PANEL_PREFERENCES_KEY]);
  settings = normalizeSettings(stored[SETTINGS_KEY] ?? DEFAULT_SETTINGS);
  panelPreferences = normalizePanelPreferences(
    stored[PANEL_PREFERENCES_KEY] ?? DEFAULT_PANEL_PREFERENCES,
  );
  applyPanelPreferences();
  updateToolbarState();
  await loadVideo();
}

async function consumeProcessRequestAndStart(tabId: number): Promise<void> {
  await sendMessage({ type: "CONSUME_PROCESS_REQUEST", tabId });
  await processVideo();
}

async function loadVideo(): Promise<void> {
  const generation = ++loadingGeneration;
  stopPlaybackTracking();
  processButton.disabled = true;
  showState("loading");
  try {
    const response = await sendMessage({
      type: "LOAD_VIDEO",
      tabId: tabIdFromSidePanelSearch(window.location.search),
    });
    if (generation !== loadingGeneration) return;
    if (!response.ok || !response.video) throw new Error(response.error || "无法读取视频。");

    currentVideo = response.video;
    currentOverview = null;
    currentChapters = [];
    currentTokenUsage = null;
    await restoreSummaryCache();
    renderVideo();
    showState("workspace");
    startPlaybackTracking();

    const pending = await sendMessage({
      type: "CONSUME_PROCESS_REQUEST",
      tabId: currentVideo.tabId,
    });
    if (pending.ok && pending.start) void processVideo();
  } catch (error) {
    if (generation !== loadingGeneration) return;
    currentVideo = null;
    currentOverview = null;
    currentChapters = [];
    currentTokenUsage = null;
    emptyTitle.textContent = "还不能生成视频概要";
    emptyMessage.textContent = error instanceof Error ? error.message : String(error);
    showState("empty");
  }
}

function renderVideo(): void {
  if (!currentVideo) return;
  processButton.disabled = false;
  updateToolbarState();
  renderSummary();
  setStatus(currentChapters.length > 0 ? "概要已从本地缓存恢复" : "字幕已就绪", false);
}

async function processVideo(): Promise<void> {
  if (!currentVideo || processing) return;
  if (!ensureProviderConfigured()) return;

  const video = currentVideo;
  processing = true;
  processButton.disabled = true;
  statusDot.classList.add("is-working");
  setStatus("模型正在生成全文要点并识别章节", true);

  try {
    const response = await sendMessage({
      type: "GENERATE_SUMMARY",
      segments: video.segments,
      targetLanguage: settings.targetLanguage,
      videoTitle: video.title,
    });
    if (!response.ok || !response.overview || !response.chapters) {
      throw new Error(response.error || "章节概要生成失败。");
    }
    if (currentVideo?.videoId !== video.videoId) return;

    const chapters = makeChapterBlocks(video.segments, response.chapters);
    if (chapters.length === 0) throw new Error("模型没有返回可显示的章节。");
    currentOverview = response.overview;
    currentChapters = chapters;
    currentTokenUsage = isTokenUsage(response.usage) ? response.usage : null;
    await saveSummaryCache();
    renderSummary();
    setStatus(`已生成全文要点和 ${chapters.length} 个章节`, false);
    showToast("全文及章节概要已生成并保存在本地");
  } catch (error) {
    setStatus(
      currentChapters.length ? "处理已暂停，上次概要仍保留" : "处理未完成，请检查模型设置",
      false,
    );
    showToast(error instanceof Error ? error.message : String(error));
  } finally {
    processing = false;
    statusDot.classList.remove("is-working");
    processButton.disabled = false;
    updateProcessButton();
  }
}

function renderSummary(): void {
  summaryList.replaceChildren();
  renderTokenUsage();
  chapterCount.textContent =
    currentChapters.length > 0 ? `${currentChapters.length} 章` : "等待处理";

  if (currentChapters.length === 0) {
    const empty = document.createElement("div");
    empty.className = "summary-empty";
    const title = document.createElement("strong");
    title.textContent = "从完整内容中找出真正的章节";
    const copy = document.createElement("span");
    copy.textContent = "开始处理后，模型会同时完成目标语言转换、切章和概要。";
    empty.append(title, copy);
    summaryList.appendChild(empty);
    updateProcessButton();
    return;
  }

  if (currentOverview) summaryList.appendChild(createOverviewCard(currentOverview));

  for (const chapter of currentChapters) {
    const card = document.createElement("article");
    card.className = "summary-card";
    card.dataset.chapterId = chapter.id;
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `${formatTimecode(chapter.startMs)}，跳到本章`);

    const time = document.createElement("div");
    time.className = "summary-time";
    const start = document.createElement("strong");
    start.textContent = formatTimecode(chapter.startMs);
    const end = document.createElement("span");
    end.textContent = formatTimecode(chapter.endMs);
    time.append(start, end);

    const body = document.createElement("div");
    body.className = "summary-copy";
    const title = document.createElement("h3");
    title.textContent = chapter.content.title;
    const copy = document.createElement("p");
    copy.textContent = chapter.content.summary;
    body.append(title, copy);

    if (chapter.content.keyPoints.length > 0) {
      const points = document.createElement("ul");
      for (const point of chapter.content.keyPoints) {
        const item = document.createElement("li");
        item.textContent = point;
        points.appendChild(item);
      }
      body.appendChild(points);
    }

    card.append(time, body);
    card.addEventListener("click", () => void seekTo(chapter.startMs / 1000));
    card.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      void seekTo(chapter.startMs / 1000);
    });
    summaryList.appendChild(card);
  }
  updateProcessButton();
}

function createOverviewCard(overview: VideoOverview): HTMLElement {
  const card = document.createElement("article");
  card.className = "video-overview";

  const rail = document.createElement("div");
  rail.className = "overview-rail";
  rail.setAttribute("aria-hidden", "true");
  const scope = document.createElement("span");
  scope.textContent = "全片";
  const start = document.createElement("strong");
  start.textContent = "00:00";
  const end = document.createElement("span");
  end.textContent = "END";
  rail.append(scope, start, end);

  const body = document.createElement("div");
  body.className = "overview-copy";
  const eyebrow = document.createElement("p");
  eyebrow.className = "overview-eyebrow";
  eyebrow.textContent = "WHOLE VIDEO";
  const title = document.createElement("h2");
  title.textContent = "全文要点";
  const summary = document.createElement("p");
  summary.className = "overview-summary";
  summary.textContent = overview.summary;
  const points = document.createElement("ol");
  for (const point of overview.keyPoints) {
    const item = document.createElement("li");
    item.textContent = point;
    points.appendChild(item);
  }
  body.append(eyebrow, title, summary, points);

  card.append(rail, body);
  return card;
}

async function reloadSummaryCache(): Promise<void> {
  currentOverview = null;
  currentChapters = [];
  currentTokenUsage = null;
  await restoreSummaryCache();
  renderSummary();
  setStatus(currentChapters.length ? "已载入当前设置的概要缓存" : "字幕已就绪", false);
}

async function restoreSummaryCache(): Promise<void> {
  if (!currentVideo) return;
  const key = summaryCacheKey();
  const stored = await chrome.storage.local.get(key);
  const cache = stored[key] as SummaryCache | undefined;
  if (
    cache?.version !== 3 ||
    cache.promptVersion !== SUMMARY_PROMPT_VERSION ||
    cache.videoId !== currentVideo.videoId ||
    cache.targetLanguage !== settings.targetLanguage ||
    cache.providerFingerprint !== providerFingerprint(settings) ||
    cache.sourceFingerprint !== summarySourceFingerprint() ||
    !isVideoOverview(cache.overview) ||
    !Array.isArray(cache.chapters)
  ) {
    return;
  }

  const outline: ChapterOutline[] = [];
  for (const cached of cache.chapters) {
    const segment = currentVideo.segments.find((item) => item.startMs === cached.startMs);
    if (!segment || !isSummaryContent(cached.content)) continue;
    outline.push({ startSegmentId: segment.id, ...cached.content });
  }
  if (outline[0]?.startSegmentId !== currentVideo.segments[0]?.id) return;
  currentOverview = cache.overview;
  currentChapters = makeChapterBlocks(currentVideo.segments, outline);
  currentTokenUsage = isTokenUsage(cache.usage) ? cache.usage : null;
}

async function saveSummaryCache(): Promise<void> {
  if (!currentVideo || !currentOverview) return;
  const cache: SummaryCache = {
    version: 3,
    promptVersion: SUMMARY_PROMPT_VERSION,
    videoId: currentVideo.videoId,
    targetLanguage: settings.targetLanguage,
    providerFingerprint: providerFingerprint(settings),
    sourceFingerprint: summarySourceFingerprint(),
    overview: currentOverview,
    chapters: currentChapters.map(({ startMs, content }) => ({ startMs, content })),
    ...(currentTokenUsage ? { usage: currentTokenUsage } : {}),
    updatedAt: Date.now(),
  };
  await chrome.storage.local.set({ [summaryCacheKey()]: cache });
}

function summaryCacheKey(): string {
  if (!currentVideo) return "video_parallel_summary_empty";
  const fingerprint = `${currentVideo.videoId}|${settings.targetLanguage}|${providerFingerprint(settings)}|${SUMMARY_PROMPT_VERSION}`;
  return `video_parallel_summary_${currentVideo.videoId}_${hashString(fingerprint)}`;
}

function summarySourceFingerprint(): string {
  return hashString(
    (currentVideo?.segments ?? [])
      .map((segment) => `${segment.id}|${segment.startMs}|${segment.text}`)
      .join("\n"),
  );
}

function updateProcessButton(): void {
  processButtonLabel.textContent = currentChapters.length ? "重新处理" : "开始处理";
}

function renderTokenUsage(): void {
  if (!currentTokenUsage) {
    tokenUsage.hidden = true;
    tokenUsage.textContent = "";
    return;
  }
  tokenUsage.textContent = `输入 ${formatTokenCount(currentTokenUsage.inputTokens)} · 输出 ${formatTokenCount(currentTokenUsage.outputTokens)} tokens`;
  tokenUsage.hidden = false;
}

function formatTokenCount(value: number): string {
  return value.toLocaleString("zh-CN");
}

function ensureProviderConfigured(): boolean {
  if (settings.model && (settings.apiKey || !providerRequiresApiKey(settings))) return true;
  showToast("先配置 AI Provider 和 API Key");
  openSettings();
  return false;
}

function startPlaybackTracking(): void {
  stopPlaybackTracking();
  playbackTimer = window.setInterval(() => void syncPlayback(), 750);
  void syncPlayback();
}

function stopPlaybackTracking(): void {
  if (playbackTimer !== undefined) window.clearInterval(playbackTimer);
  playbackTimer = undefined;
  activeChapterId = "";
}

async function syncPlayback(): Promise<void> {
  if (!currentVideo || currentChapters.length === 0 || document.hidden) return;
  const response = await sendMessage({ type: "GET_PLAYBACK_TIME", tabId: currentVideo.tabId });
  if (!response.ok || typeof response.seconds !== "number") return;
  const chapter = activeChapterAt(response.seconds * 1000);
  if (!chapter || chapter.id === activeChapterId) return;

  summaryList.querySelector(".summary-card.is-active")?.classList.remove("is-active");
  const card = summaryList.querySelector<HTMLElement>(
    `[data-chapter-id="${CSS.escape(chapter.id)}"]`,
  );
  card?.classList.add("is-active");
  activeChapterId = chapter.id;
  if (settings.autoFollow) card?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function activeChapterAt(timeMs: number): SummaryBlock | null {
  let match: SummaryBlock | null = null;
  for (const chapter of currentChapters) {
    if (chapter.startMs > timeMs) break;
    match = chapter;
  }
  return match;
}

async function seekTo(seconds: number): Promise<void> {
  if (!currentVideo) return;
  const response = await sendMessage({ type: "SEEK", tabId: currentVideo.tabId, seconds });
  if (!response.ok) showToast(response.error || "跳转失败");
}

function toggleFollow(): void {
  settings = { ...settings, autoFollow: !settings.autoFollow };
  updateToolbarState();
  void chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

async function setPanelFontSize(fontSize: PanelFontSize): Promise<void> {
  panelPreferences = normalizePanelPreferences({ fontSize });
  applyPanelPreferences();
  setFontSizeMenuOpen(false);
  if (hasExtensionRuntime) {
    await chrome.storage.local.set({ [PANEL_PREFERENCES_KEY]: panelPreferences });
  }
}

function applyPanelPreferences(): void {
  document.documentElement.dataset.summaryFontSize = panelPreferences.fontSize;
  for (const option of fontSizeOptions) {
    option.setAttribute(
      "aria-pressed",
      String(option.dataset.fontSize === panelPreferences.fontSize),
    );
  }
  const labels: Record<PanelFontSize, string> = {
    small: "小",
    standard: "标准",
    large: "大",
  };
  fontSizeButton.setAttribute("aria-label", `内容字号：${labels[panelPreferences.fontSize]}`);
}

function setFontSizeMenuOpen(open: boolean): void {
  fontSizeMenu.hidden = !open;
  fontSizeButton.setAttribute("aria-expanded", String(open));
}

async function copyMarkdown(): Promise<void> {
  const markdown = currentMarkdown();
  if (!markdown) {
    showToast("请先生成章节概要");
    return;
  }
  await navigator.clipboard.writeText(markdown);
  showToast("内容概要已复制");
}

function exportMarkdown(): void {
  const markdown = currentMarkdown();
  if (!markdown || !currentVideo) {
    showToast("请先生成章节概要");
    return;
  }
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${sanitizeFilename(currentVideo.title)}-summary.md`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("Markdown 已导出");
}

function currentMarkdown(): string | null {
  if (!currentVideo || !currentOverview || currentChapters.length === 0) return null;
  return buildSummaryMarkdown(
    {
      title: currentVideo.title,
      channel: currentVideo.channel,
      url: `https://www.youtube.com/watch?v=${currentVideo.videoId}`,
      sourceLanguage: currentVideo.sourceLanguage,
      summaryLanguage: TARGET_LANGUAGE_LABELS[settings.targetLanguage] ?? settings.targetLanguage,
    },
    currentOverview,
    currentChapters,
  );
}

function updateToolbarState(): void {
  followButton.setAttribute("aria-pressed", String(settings.autoFollow));
  followButton.setAttribute("aria-label", `跟随播放：${settings.autoFollow ? "已开启" : "已关闭"}`);
  followButton.title = settings.autoFollow ? "跟随播放已开启" : "自由滚动";
  followButtonLabel.textContent = settings.autoFollow ? "跟随" : "自由";
}

function setStatus(message: string, working: boolean): void {
  statusText.textContent = message;
  statusDot.classList.toggle("is-working", working);
}

function showState(state: "loading" | "empty" | "workspace"): void {
  loadingState.hidden = state !== "loading";
  emptyState.hidden = state !== "empty";
  workspace.hidden = state !== "workspace";
  commandBar.hidden = state !== "workspace";
}

function openSettings(): void {
  if (!hasExtensionRuntime) {
    showToast("扩展安装后可打开模型设置");
    return;
  }
  void sendMessage({ type: "OPEN_OPTIONS" });
}

function showToast(message: string): void {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 3200);
}

function hashString(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function isSummaryContent(value: unknown): value is SummaryContent {
  if (!value || typeof value !== "object") return false;
  const content = value as Partial<SummaryContent>;
  return (
    typeof content.title === "string" &&
    Boolean(content.title.trim()) &&
    typeof content.summary === "string" &&
    Boolean(content.summary.trim()) &&
    Array.isArray(content.keyPoints) &&
    content.keyPoints.every((point) => typeof point === "string")
  );
}

function isVideoOverview(value: unknown): value is VideoOverview {
  if (!value || typeof value !== "object") return false;
  const overview = value as Partial<VideoOverview>;
  return (
    typeof overview.summary === "string" &&
    Boolean(overview.summary.trim()) &&
    Array.isArray(overview.keyPoints) &&
    overview.keyPoints.length > 0 &&
    overview.keyPoints.every((point) => typeof point === "string" && Boolean(point.trim()))
  );
}

function isTokenUsage(value: unknown): value is TokenUsage {
  if (!value || typeof value !== "object") return false;
  const usage = value as Partial<TokenUsage>;
  return (
    Number.isSafeInteger(usage.inputTokens) &&
    Number(usage.inputTokens) >= 0 &&
    Number.isSafeInteger(usage.outputTokens) &&
    Number(usage.outputTokens) >= 0
  );
}

async function sendMessage(message: Record<string, unknown>): Promise<RuntimeResponse> {
  return chrome.runtime.sendMessage(message) as Promise<RuntimeResponse>;
}

function renderLocalPreview(): void {
  currentVideo = {
    tabId: 1,
    videoId: "preview",
    title: "How context becomes infrastructure for AI agents",
    channel: "video-parallel preview",
    durationSeconds: 302,
    sourceLanguage: "en",
    segments: [
      { id: "s0", startMs: 0, durationMs: 65_000, text: "Agents need live context." },
      { id: "s1", startMs: 65_000, durationMs: 88_000, text: "Retrieval alone is not enough." },
      { id: "s2", startMs: 153_000, durationMs: 81_000, text: "Context becomes a service." },
      { id: "s3", startMs: 234_000, durationMs: 68_000, text: "Teams need clear boundaries." },
    ],
  };
  currentOverview = {
    summary:
      "这段视频主张，智能体的能力上限不仅由模型决定，更取决于能否持续获得新鲜、可信且权限清晰的上下文。把上下文获取与治理独立成基础服务，可以让产品团队专注任务逻辑，同时保留来源和安全边界。",
    keyPoints: [
      "实时上下文是智能体可靠行动的前提，而不是附加能力",
      "单次检索无法覆盖持续变化的任务状态",
      "独立上下文层应统一负责新鲜度、来源和访问控制",
    ],
  };
  currentChapters = makeChapterBlocks(currentVideo.segments, [
    {
      startSegmentId: "s0",
      title: "智能体真正缺少的是实时上下文",
      summary:
        "开场把问题从模型能力转向上下文供给。智能体需要持续获得最新、可验证且与任务相关的信息，单次检索无法覆盖这个过程。",
      keyPoints: ["上下文质量直接限制智能体的行动质量", "静态检索难以跟上持续变化的任务状态"],
    },
    {
      startSegmentId: "s2",
      title: "把上下文作为一项基础服务",
      summary:
        "后半段提出 Context-as-a-Service：由独立层负责获取、清洗和交付上下文。这样应用团队可以专注于任务逻辑，同时保留权限与来源边界。",
      keyPoints: ["上下文层负责新鲜度、来源和访问控制", "产品逻辑与数据获取职责由此解耦"],
    },
  ]);
  renderVideo();
  showState("workspace");
}

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}
