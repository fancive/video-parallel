import { buildParallelMarkdown, sanitizeFilename } from "./lib/markdown";
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  providerFingerprint,
  SETTINGS_KEY,
  TARGET_LANGUAGE_LABELS,
} from "./lib/settings";
import { formatTimecode } from "./lib/transcript";
import { makeTranslationBatches } from "./lib/translation";
import type { AppSettings, TranscriptSegment, TranslationCache, VideoContext } from "./lib/types";

interface RuntimeResponse {
  ok: boolean;
  error?: string;
  video?: VideoContext;
  seconds?: number;
  translations?: Record<string, string>;
  missingIds?: string[];
}

const loadingState = element<HTMLElement>("loadingState");
const emptyState = element<HTMLElement>("emptyState");
const emptyTitle = element<HTMLElement>("emptyTitle");
const emptyMessage = element<HTMLElement>("emptyMessage");
const workspace = element<HTMLElement>("workspace");
const commandBar = element<HTMLElement>("commandBar");
const videoTitle = element<HTMLElement>("videoTitle");
const channelName = element<HTMLElement>("channelName");
const languageChip = element<HTMLElement>("languageChip");
const targetLaneLabel = element<HTMLElement>("targetLaneLabel");
const transcript = element<HTMLElement>("transcript");
const statusDot = element<HTMLElement>("statusDot");
const statusText = element<HTMLElement>("statusText");
const translateButton = element<HTMLButtonElement>("translateButton");
const followButton = element<HTMLButtonElement>("followButton");
const progressTrack = element<HTMLElement>("progressTrack");
const progressBar = element<HTMLElement>("progressBar");
const toast = element<HTMLElement>("toast");

let currentVideo: VideoContext | null = null;
let settings: AppSettings = DEFAULT_SETTINGS;
let activeSegmentId = "";
let playbackTimer: number | undefined;
let toastTimer: number | undefined;
let loadingGeneration = 0;
let translationRunning = false;
const hasExtensionRuntime = typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);

element<HTMLButtonElement>("settingsButton").addEventListener("click", openSettings);
element<HTMLButtonElement>("retryButton").addEventListener("click", () => void loadVideo());
translateButton.addEventListener("click", () => void translateAll());
followButton.addEventListener("click", toggleFollow);
element<HTMLButtonElement>("copyButton").addEventListener("click", () => void copyMarkdown());
element<HTMLButtonElement>("exportButton").addEventListener("click", exportMarkdown);

if (hasExtensionRuntime) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[SETTINGS_KEY]) return;
    settings = normalizeSettings(changes[SETTINGS_KEY].newValue);
    updateLanguageLabels();
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (tabId !== currentVideo?.tabId || !changeInfo.url) return;
    void loadVideo();
  });

  void boot();
} else {
  renderLocalPreview();
}

async function boot(): Promise<void> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  settings = normalizeSettings(stored[SETTINGS_KEY] ?? DEFAULT_SETTINGS);
  updateLanguageLabels();
  await loadVideo();
}

async function loadVideo(): Promise<void> {
  const generation = ++loadingGeneration;
  stopPlaybackTracking();
  showState("loading");
  try {
    const response = await sendMessage({ type: "LOAD_VIDEO" });
    if (generation !== loadingGeneration) return;
    if (!response.ok || !response.video) throw new Error(response.error || "无法读取视频。");

    currentVideo = response.video;
    await restoreTranslationCache();
    renderVideo();
    showState("workspace");
    startPlaybackTracking();
  } catch (error) {
    if (generation !== loadingGeneration) return;
    currentVideo = null;
    emptyTitle.textContent = "还不能建立对照轨道";
    emptyMessage.textContent = error instanceof Error ? error.message : String(error);
    showState("empty");
  }
}

function renderVideo(): void {
  if (!currentVideo) return;
  videoTitle.textContent = currentVideo.title;
  channelName.textContent = currentVideo.channel;
  updateLanguageLabels();
  transcript.replaceChildren();

  for (const segment of currentVideo.segments) {
    const row = document.createElement("article");
    row.className = "pair-row";
    row.dataset.segmentId = segment.id;
    row.dataset.startMs = String(segment.startMs);
    row.tabIndex = 0;
    row.setAttribute("aria-label", `${formatTimecode(segment.startMs)}，跳转到此处`);

    const source = document.createElement("p");
    source.className = "lane-copy source";
    source.textContent = segment.text;

    const time = document.createElement("div");
    time.className = "time-node";
    const timeLabel = document.createElement("span");
    timeLabel.textContent = formatTimecode(segment.startMs);
    time.appendChild(timeLabel);

    const target = document.createElement("p");
    target.className = "lane-copy target";
    updateTargetNode(target, segment);

    row.append(source, time, target);
    row.addEventListener("click", () => void seekTo(segment.startMs / 1000));
    row.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      void seekTo(segment.startMs / 1000);
    });
    transcript.appendChild(row);
  }

  updateTranslationButton();
  setStatus("字幕已就绪", false);
}

function updateTargetNode(node: HTMLElement, segment: TranscriptSegment): void {
  node.classList.remove("is-pending", "is-error");
  if (segment.translatedText) {
    node.textContent = segment.translatedText;
    return;
  }
  if (segment.translationError) {
    node.classList.add("is-error");
    node.textContent = segment.translationError;
    return;
  }
  node.classList.add("is-pending");
  node.textContent = "等待翻译";
}

async function translateAll(): Promise<void> {
  if (!currentVideo || translationRunning) return;
  if (!settings.model || (!settings.apiKey && settings.provider !== "local")) {
    showToast("先配置 AI Provider 和 API Key");
    openSettings();
    return;
  }

  const untranslated = currentVideo.segments.filter((segment) => !segment.translatedText);
  if (untranslated.length === 0) {
    showToast("当前字幕已经全部翻译");
    return;
  }

  const batches = makeTranslationBatches(untranslated);
  for (const segment of untranslated) {
    segment.translationError = undefined;
    refreshSegment(segment);
  }
  translationRunning = true;
  translateButton.disabled = true;
  progressTrack.hidden = false;
  statusDot.classList.add("is-working");

  let incompleteCount = 0;
  try {
    for (let index = 0; index < batches.length; index += 1) {
      const batch = batches[index];
      if (!batch) continue;
      setStatus(`翻译轨道 ${index + 1} / ${batches.length}`, true);
      progressBar.style.width = `${Math.round((index / batches.length) * 100)}%`;

      const response = await sendMessage({
        type: "TRANSLATE_BATCH",
        segments: batch.map(({ id, startMs, durationMs, text }) => ({
          id,
          startMs,
          durationMs,
          text,
        })),
        targetLanguage: settings.targetLanguage,
        videoTitle: currentVideo.title,
      });
      if (!response.ok || !response.translations) {
        throw new Error(response.error || "翻译失败。");
      }

      const missingIds = new Set(response.missingIds ?? []);
      for (const segment of batch) {
        const translatedText = response.translations[segment.id];
        if (translatedText) {
          segment.translatedText = translatedText;
          segment.translationError = undefined;
        } else {
          segment.translationError = "本段未返回，点击继续翻译重试";
          if (!missingIds.has(segment.id)) missingIds.add(segment.id);
        }
        refreshSegment(segment);
      }
      incompleteCount += missingIds.size;
      await saveTranslationCache();
      progressBar.style.width = `${Math.round(((index + 1) / batches.length) * 100)}%`;
    }
    if (incompleteCount > 0) {
      setStatus(`已保留成功结果，${incompleteCount} 段待重试`, false);
      showToast(`${incompleteCount} 个字幕段未返回，可点击继续翻译`);
    } else {
      setStatus("双语轨道已完成", false);
      showToast("翻译完成，缓存已保存在本地");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus("翻译已暂停", false);
    showToast(message);
  } finally {
    translationRunning = false;
    statusDot.classList.remove("is-working");
    progressTrack.hidden = true;
    translateButton.disabled = false;
    updateTranslationButton();
  }
}

function refreshSegment(segment: TranscriptSegment): void {
  const row = transcript.querySelector<HTMLElement>(
    `[data-segment-id="${CSS.escape(segment.id)}"]`,
  );
  const target = row?.querySelector<HTMLElement>(".lane-copy.target");
  if (target) updateTargetNode(target, segment);
}

async function restoreTranslationCache(): Promise<void> {
  if (!currentVideo) return;
  const key = translationCacheKey();
  const stored = await chrome.storage.local.get(key);
  const cache = stored[key] as TranslationCache | undefined;
  if (
    cache?.version !== 1 ||
    cache.videoId !== currentVideo.videoId ||
    cache.targetLanguage !== settings.targetLanguage ||
    cache.providerFingerprint !== providerFingerprint(settings)
  ) {
    return;
  }
  for (const segment of currentVideo.segments) {
    segment.translatedText = cache.translations[segment.id] || undefined;
  }
}

async function saveTranslationCache(): Promise<void> {
  if (!currentVideo) return;
  const translations: Record<string, string> = {};
  for (const segment of currentVideo.segments) {
    if (segment.translatedText) translations[segment.id] = segment.translatedText;
  }
  const cache: TranslationCache = {
    version: 1,
    videoId: currentVideo.videoId,
    targetLanguage: settings.targetLanguage,
    providerFingerprint: providerFingerprint(settings),
    translations,
    updatedAt: Date.now(),
  };
  await chrome.storage.local.set({ [translationCacheKey()]: cache });
}

function translationCacheKey(): string {
  if (!currentVideo) return "video_parallel_cache_empty";
  const fingerprint = `${currentVideo.videoId}|${settings.targetLanguage}|${providerFingerprint(settings)}`;
  return `video_parallel_cache_${currentVideo.videoId}_${hashString(fingerprint)}`;
}

function updateTranslationButton(): void {
  const total = currentVideo?.segments.length ?? 0;
  const translated = currentVideo?.segments.filter((segment) => segment.translatedText).length ?? 0;
  translateButton.textContent =
    total > 0 && translated === total ? "翻译完成" : translated > 0 ? "继续翻译" : "开始翻译";
}

function startPlaybackTracking(): void {
  stopPlaybackTracking();
  playbackTimer = window.setInterval(() => void syncPlayback(), 750);
  void syncPlayback();
}

function stopPlaybackTracking(): void {
  if (playbackTimer !== undefined) window.clearInterval(playbackTimer);
  playbackTimer = undefined;
  activeSegmentId = "";
}

async function syncPlayback(): Promise<void> {
  if (!currentVideo || document.hidden) return;
  const response = await sendMessage({ type: "GET_PLAYBACK_TIME", tabId: currentVideo.tabId });
  if (!response.ok || typeof response.seconds !== "number") return;
  const segment = activeSegmentAt(response.seconds * 1000);
  if (!segment || segment.id === activeSegmentId) return;

  transcript.querySelector(".pair-row.is-active")?.classList.remove("is-active");
  const row = transcript.querySelector<HTMLElement>(
    `[data-segment-id="${CSS.escape(segment.id)}"]`,
  );
  row?.classList.add("is-active");
  activeSegmentId = segment.id;
  if (settings.autoFollow) row?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function activeSegmentAt(timeMs: number): TranscriptSegment | null {
  const segments = currentVideo?.segments ?? [];
  let low = 0;
  let high = segments.length - 1;
  let match: TranscriptSegment | null = null;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const segment = segments[middle];
    if (!segment) break;
    if (segment.startMs <= timeMs) {
      match = segment;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
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
  followButton.setAttribute("aria-pressed", String(settings.autoFollow));
  followButton.textContent = settings.autoFollow ? "跟随播放" : "自由滚动";
  void chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

async function copyMarkdown(): Promise<void> {
  const markdown = currentMarkdown();
  if (!markdown) return;
  await navigator.clipboard.writeText(markdown);
  showToast("对照稿已复制");
}

function exportMarkdown(): void {
  const markdown = currentMarkdown();
  if (!markdown || !currentVideo) return;
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${sanitizeFilename(currentVideo.title)}-parallel.md`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("Markdown 已导出");
}

function currentMarkdown(): string | null {
  if (!currentVideo) return null;
  return buildParallelMarkdown(
    {
      title: currentVideo.title,
      channel: currentVideo.channel,
      url: `https://www.youtube.com/watch?v=${currentVideo.videoId}`,
      sourceLanguage: currentVideo.sourceLanguage,
      targetLanguage: TARGET_LANGUAGE_LABELS[settings.targetLanguage] ?? settings.targetLanguage,
    },
    currentVideo.segments,
  );
}

function updateLanguageLabels(): void {
  const target = TARGET_LANGUAGE_LABELS[settings.targetLanguage] ?? settings.targetLanguage;
  const source = currentVideo?.sourceLanguage?.toUpperCase() ?? "AUTO";
  languageChip.textContent = `${source} → ${target}`;
  targetLaneLabel.textContent = target;
  followButton.setAttribute("aria-pressed", String(settings.autoFollow));
  followButton.textContent = settings.autoFollow ? "跟随播放" : "自由滚动";
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
    showToast("扩展安装后可打开 Provider 设置");
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
  }, 3000);
}

function hashString(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

async function sendMessage(message: Record<string, unknown>): Promise<RuntimeResponse> {
  return chrome.runtime.sendMessage(message) as Promise<RuntimeResponse>;
}

function renderLocalPreview(): void {
  currentVideo = {
    tabId: 1,
    videoId: "preview",
    title: "How parallel reading changes the way we learn",
    channel: "video-parallel preview",
    durationSeconds: 188,
    sourceLanguage: "en",
    segments: [
      {
        id: "s0-0",
        startMs: 0,
        durationMs: 11_000,
        text: "Most video tools ask you to leave the context before you can understand it.",
        translatedText: "多数视频工具会让你先离开原本的语境，才能进一步理解内容。",
      },
      {
        id: "s1-12000",
        startMs: 12_000,
        durationMs: 15_000,
        text: "A parallel view keeps the speaker, the source language, and your notes on one timeline.",
        translatedText: "对照视图把讲述者、源语言与个人笔记保留在同一条时间线上。",
      },
      {
        id: "s2-29000",
        startMs: 29_000,
        durationMs: 17_000,
        text: "You can glance across for meaning, then return to the exact words without losing your place.",
        translatedText: "你可以横向扫一眼译文，再回到准确原句，同时不会丢失播放位置。",
      },
      {
        id: "s3-48000",
        startMs: 48_000,
        durationMs: 18_000,
        text: "The timecode is not metadata here. It is the spine that keeps both reading lanes aligned.",
        translatedText: "时间码在这里不是附属信息，而是让两条阅读轨保持对齐的脊柱。",
      },
    ],
  };
  renderVideo();
  transcript.querySelector(".pair-row")?.classList.add("is-active");
  showState("workspace");
}

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}
