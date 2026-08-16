import {
  chatCompletionsUrl,
  normalizeSettings,
  providerOriginPattern,
  SETTINGS_KEY,
} from "./lib/settings";
import { notifySidePanelIfReady, openTabSidePanel, sidePanelPath } from "./lib/side-panel";
import {
  buildChapterMessages,
  MAX_CHAPTER_TRANSCRIPT_CHARACTERS,
  MAX_CHAPTER_TRANSCRIPT_SEGMENTS,
  parseChapterResponse,
} from "./lib/summary";
import {
  extractVideoId,
  json3CaptionUrl,
  parseJson3Text,
  parseJson3Transcript,
  selectCaptionTrack,
} from "./lib/transcript";
import type {
  AppSettings,
  ChapterOutline,
  PlayerSnapshot,
  TranscriptSegment,
  VideoContext,
} from "./lib/types";

const AI_TIMEOUT_MS = 120_000;
const MAX_AI_RESPONSE_BYTES = 2 * 1024 * 1024;
const YOUTUBE_CAPTION_FALLBACK_CLIENT = {
  clientName: "ANDROID",
  clientHeaderName: "3",
  clientVersion: "21.02.35",
  androidSdkVersion: 30,
  osName: "Android",
  osVersion: "11",
} as const;

interface CaptionFetchResult {
  ok: boolean;
  status: number;
  text: string;
  error: string;
}

const pendingProcessTabs = new Set<number>();

void chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => {});
void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url || !isWebUrl(changeInfo.url)) return;
  void configureSidePanelForTab(tabId, changeInfo.url).catch(() => {});
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== "process-video") return;
  const tabId = tab?.id;
  if (!tabId || !extractVideoId(tab.url ?? "")) return;

  pendingProcessTabs.add(tabId);
  void openTabSidePanel(chrome.sidePanel, tabId)
    .then(() => notifySidePanelIfReady(chrome.runtime, { type: "START_PROCESSING", tabId }))
    .catch(() => {
      pendingProcessTabs.delete(tabId);
    });
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  const request = isRecord(message) ? message : {};
  const type = typeof request.type === "string" ? request.type : "";

  if (type === "OPEN_PANEL") {
    const tabId = sender.tab?.id;
    if (!tabId || !extractVideoId(sender.tab?.url ?? "")) {
      sendResponse({ ok: false, error: "找不到当前 YouTube 标签页。" });
      return false;
    }
    openTabSidePanel(chrome.sidePanel, tabId)
      .then(() => sendResponse({ ok: true }))
      .catch((error: unknown) => sendResponse({ ok: false, error: errorMessage(error) }));
    return true;
  }

  if (type === "PREPARE_PANEL") {
    const tabId = sender.tab?.id;
    const url = sender.tab?.url ?? "";
    if (!tabId || !extractVideoId(url)) {
      sendResponse({ ok: false, error: "找不到当前 YouTube 标签页。" });
      return false;
    }
    configureSidePanelForTab(tabId, url)
      .then(() => sendResponse({ ok: true }))
      .catch((error: unknown) => sendResponse({ ok: false, error: errorMessage(error) }));
    return true;
  }

  if (type === "LOAD_VIDEO") {
    loadVideoForTab(Number(request.tabId))
      .then((video) => sendResponse({ ok: true, video }))
      .catch((error: unknown) => sendResponse({ ok: false, error: errorMessage(error) }));
    return true;
  }

  if (type === "GET_PLAYBACK_TIME") {
    playbackTime(Number(request.tabId))
      .then((seconds) => sendResponse({ ok: true, seconds }))
      .catch((error: unknown) => sendResponse({ ok: false, error: errorMessage(error) }));
    return true;
  }

  if (type === "SEEK") {
    seekVideo(Number(request.tabId), Number(request.seconds))
      .then(() => sendResponse({ ok: true }))
      .catch((error: unknown) => sendResponse({ ok: false, error: errorMessage(error) }));
    return true;
  }

  if (type === "GENERATE_CHAPTERS") {
    generateChapters(
      Array.isArray(request.segments) ? (request.segments as TranscriptSegment[]) : [],
      String(request.targetLanguage ?? ""),
      String(request.videoTitle ?? ""),
    )
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error: unknown) => sendResponse({ ok: false, error: errorMessage(error) }));
    return true;
  }

  if (type === "CONSUME_PROCESS_REQUEST") {
    const tabId = Number(request.tabId);
    const start = pendingProcessTabs.delete(tabId);
    sendResponse({ ok: true, start });
    return false;
  }

  if (type === "OPEN_OPTIONS") {
    void chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

async function configureSidePanelForTab(tabId: number, url: string): Promise<void> {
  const enabled = extractVideoId(url) !== null;
  await chrome.sidePanel.setOptions(
    enabled ? { tabId, path: sidePanelPath(tabId), enabled: true } : { tabId, enabled: false },
  );
}

function isWebUrl(url: string): boolean {
  return url.startsWith("https://") || url.startsWith("http://");
}

async function loadVideoForTab(tabId: number): Promise<VideoContext> {
  await assertYouTubeTab(tabId);

  const snapshot = await readPlayerSnapshot(tabId);
  if (!snapshot) throw new Error("无法读取 YouTube 播放器信息，请刷新页面后重试。");
  const track = selectCaptionTrack(snapshot.tracks, "en");
  if (!track) throw new Error("这个视频没有可读取的原生字幕轨道。");

  const payload = await fetchCaptionPayload(
    tabId,
    track.baseUrl,
    snapshot.videoId,
    track.languageCode,
  );
  const segments = parseJson3Transcript(payload);
  if (segments.length === 0) throw new Error("字幕轨道存在，但没有返回可显示的内容。");

  return {
    tabId,
    videoId: snapshot.videoId,
    title: snapshot.title,
    channel: snapshot.channel,
    durationSeconds: snapshot.durationSeconds,
    sourceLanguage: track.languageCode,
    segments,
  };
}

async function fetchCaptionPayload(
  tabId: number,
  baseUrl: string,
  videoId: string,
  preferredLanguage: string,
): Promise<unknown> {
  const captionUrl = json3CaptionUrl(baseUrl);
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [captionUrl],
    func: async (url: string) => {
      try {
        const response = await fetch(url, {
          cache: "no-store",
          credentials: "include",
        });
        return {
          ok: response.ok,
          status: response.status,
          text: await response.text(),
          error: "",
        };
      } catch (error) {
        return {
          ok: false,
          status: 0,
          text: "",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });
  const pageResult = results[0]?.result as CaptionFetchResult | null | undefined;

  if (pageResult?.ok && pageResult.text.trim()) {
    return parseJson3Text(pageResult.text);
  }

  // Public videos usually also work from the extension service worker. Keep
  // this fallback for browsers that block a page-world request unexpectedly.
  let serviceWorkerResult: CaptionFetchResult;
  try {
    const fallback = await fetch(captionUrl, { cache: "no-store" });
    serviceWorkerResult = {
      ok: fallback.ok,
      status: fallback.status,
      text: await fallback.text(),
      error: fallback.ok ? "" : `HTTP ${fallback.status}`,
    };
  } catch (error) {
    serviceWorkerResult = {
      ok: false,
      status: 0,
      text: "",
      error: errorMessage(error),
    };
  }
  if (serviceWorkerResult.ok && serviceWorkerResult.text.trim()) {
    return parseJson3Text(serviceWorkerResult.text);
  }

  // YouTube can return HTTP 200 with an empty body for the caption URL embedded
  // in the web player. Ask the same-origin player API for a fresh caption URL
  // using a current public client identity before giving up.
  const innertubeResult = await fetchCaptionFromInnertube(tabId, videoId, preferredLanguage);
  if (innertubeResult?.ok && innertubeResult.text.trim()) {
    return parseJson3Text(innertubeResult.text);
  }

  const detail = [pageResult?.error, serviceWorkerResult.error, innertubeResult?.error]
    .filter(Boolean)
    .join("；");
  throw new Error(
    detail
      ? `YouTube 字幕请求失败：${detail}`
      : "YouTube 字幕接口连续返回空响应，请刷新视频页面后重试。",
  );
}

async function fetchCaptionFromInnertube(
  tabId: number,
  videoId: string,
  preferredLanguage: string,
): Promise<CaptionFetchResult | null> {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [videoId, preferredLanguage, YOUTUBE_CAPTION_FALLBACK_CLIENT],
    func: async (
      currentVideoId: string,
      languageCode: string,
      client: {
        clientName: string;
        clientHeaderName: string;
        clientVersion: string;
        androidSdkVersion: number;
        osName: string;
        osVersion: string;
      },
    ) => {
      try {
        const pageWindow = window as typeof window & {
          ytcfg?: { get?: (key: string) => unknown };
        };
        const getConfig = (key: string): unknown => {
          try {
            return pageWindow.ytcfg?.get?.(key);
          } catch {
            return undefined;
          }
        };
        const apiKey = String(getConfig("INNERTUBE_API_KEY") ?? "");
        const innertubeContext = getConfig("INNERTUBE_CONTEXT") as
          | { client?: { visitorData?: unknown } }
          | undefined;
        const visitorData = String(
          getConfig("VISITOR_DATA") ?? innertubeContext?.client?.visitorData ?? "",
        );
        if (!apiKey) {
          return {
            ok: false,
            status: 0,
            text: "",
            error: "无法读取 YouTube 播放器 API 配置",
          };
        }

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "X-YouTube-Client-Name": client.clientHeaderName,
          "X-YouTube-Client-Version": client.clientVersion,
        };
        if (visitorData) headers["X-Goog-Visitor-Id"] = visitorData;

        const playerResponse = await fetch(
          `/youtubei/v1/player?key=${encodeURIComponent(apiKey)}&prettyPrint=false`,
          {
            method: "POST",
            cache: "no-store",
            credentials: "include",
            headers,
            body: JSON.stringify({
              context: {
                client: {
                  hl: "en",
                  gl: "US",
                  utcOffsetMinutes: 0,
                  visitorData,
                  clientName: client.clientName,
                  clientVersion: client.clientVersion,
                  androidSdkVersion: client.androidSdkVersion,
                  osName: client.osName,
                  osVersion: client.osVersion,
                },
                request: { useSsl: true },
              },
              videoId: currentVideoId,
            }),
          },
        );
        const playerText = await playerResponse.text();
        if (!playerResponse.ok) {
          return {
            ok: false,
            status: playerResponse.status,
            text: "",
            error: `替代播放器接口返回 HTTP ${playerResponse.status}`,
          };
        }
        if (!playerText.trim()) {
          return {
            ok: false,
            status: playerResponse.status,
            text: "",
            error: "替代播放器接口返回空响应",
          };
        }

        let playerData: Record<string, unknown>;
        try {
          playerData = JSON.parse(playerText) as Record<string, unknown>;
        } catch {
          return {
            ok: false,
            status: playerResponse.status,
            text: "",
            error: "替代播放器响应格式无法解析",
          };
        }
        const captions = (playerData.captions ?? {}) as Record<string, unknown>;
        const renderer = (captions.playerCaptionsTracklistRenderer ?? {}) as Record<
          string,
          unknown
        >;
        const tracks = Array.isArray(renderer.captionTracks)
          ? (renderer.captionTracks as Array<Record<string, unknown>>)
          : [];
        const rankedTracks = tracks
          .filter((track) => typeof track.baseUrl === "string" && track.baseUrl)
          .sort((left, right) => {
            const score = (track: Record<string, unknown>) => {
              const code = String(track.languageCode ?? "");
              let value = track.kind === "asr" ? 0 : 15;
              if (code === languageCode) value += 100;
              else if (code.startsWith(`${languageCode}-`)) value += 80;
              return value;
            };
            return score(right) - score(left);
          });
        const track = rankedTracks[0];
        if (!track) {
          return {
            ok: false,
            status: playerResponse.status,
            text: "",
            error: "替代播放器接口没有返回字幕轨道",
          };
        }

        const captionUrl = new URL(String(track.baseUrl));
        if (captionUrl.protocol !== "https:" || captionUrl.hostname !== "www.youtube.com") {
          return {
            ok: false,
            status: 0,
            text: "",
            error: "替代字幕地址不是受支持的 YouTube 接口",
          };
        }
        captionUrl.searchParams.set("fmt", "json3");
        captionUrl.searchParams.delete("xosf");
        const captionResponse = await fetch(captionUrl, {
          cache: "no-store",
          credentials: "include",
        });
        const captionText = await captionResponse.text();
        if (!captionResponse.ok) {
          return {
            ok: false,
            status: captionResponse.status,
            text: "",
            error: `替代字幕接口返回 HTTP ${captionResponse.status}`,
          };
        }
        if (!captionText.trim()) {
          return {
            ok: false,
            status: captionResponse.status,
            text: "",
            error: "替代字幕接口返回空响应",
          };
        }
        return {
          ok: true,
          status: captionResponse.status,
          text: captionText,
          error: "",
        };
      } catch (error) {
        return {
          ok: false,
          status: 0,
          text: "",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });
  return (results[0]?.result as CaptionFetchResult | null | undefined) ?? null;
}

async function readPlayerSnapshot(tabId: number): Promise<PlayerSnapshot | null> {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () => {
      try {
        const pageWindow = window as typeof window & {
          ytInitialPlayerResponse?: {
            videoDetails?: Record<string, unknown>;
            captions?: Record<string, unknown>;
          };
        };
        const player = document.getElementById("movie_player") as
          | (HTMLElement & { getPlayerResponse?: () => Record<string, unknown> })
          | null;
        const playerResponse =
          player?.getPlayerResponse?.() ?? pageWindow.ytInitialPlayerResponse ?? null;
        if (!playerResponse) return null;

        const details = (playerResponse.videoDetails ?? {}) as Record<string, unknown>;
        const captions = (playerResponse.captions ?? {}) as Record<string, unknown>;
        const renderer = (captions.playerCaptionsTracklistRenderer ?? {}) as Record<
          string,
          unknown
        >;
        const captionTracks = Array.isArray(renderer.captionTracks)
          ? (renderer.captionTracks as Array<Record<string, unknown>>)
          : [];

        const tracks = captionTracks
          .map((track) => {
            const name = (track.name ?? {}) as Record<string, unknown>;
            const runs = Array.isArray(name.runs)
              ? (name.runs as Array<Record<string, unknown>>)
              : [];
            return {
              baseUrl: String(track.baseUrl ?? ""),
              languageCode: String(track.languageCode ?? ""),
              name: String(name.simpleText ?? runs.map((run) => run.text ?? "").join("")),
              kind: typeof track.kind === "string" ? track.kind : undefined,
              isTranslatable: track.isTranslatable === true,
            };
          })
          .filter((track) => track.baseUrl && track.languageCode);

        return {
          videoId: String(details.videoId ?? ""),
          title: String(details.title ?? document.title.replace(/\s+-\s+YouTube$/, "")),
          channel: String(details.author ?? "YouTube"),
          durationSeconds: Number(details.lengthSeconds ?? 0),
          tracks,
        };
      } catch {
        return null;
      }
    },
  });
  return (results[0]?.result as PlayerSnapshot | null | undefined) ?? null;
}

async function playbackTime(tabId: number): Promise<number> {
  await assertYouTubeTab(tabId);
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () => {
      const player = document.getElementById("movie_player") as
        | (HTMLElement & { getCurrentTime?: () => number })
        | null;
      return Number(player?.getCurrentTime?.() ?? 0);
    },
  });
  return Number(results[0]?.result ?? 0);
}

async function seekVideo(tabId: number, seconds: number): Promise<void> {
  await assertYouTubeTab(tabId);
  const safeSeconds = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [safeSeconds],
    func: (time: number) => {
      const player = document.getElementById("movie_player") as
        | (HTMLElement & { seekTo?: (value: number, allowSeekAhead: boolean) => void })
        | null;
      player?.seekTo?.(time, true);
    },
  });
}

async function assertYouTubeTab(tabId: number): Promise<void> {
  if (!Number.isInteger(tabId) || tabId <= 0) throw new Error("无效的标签页。");
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url?.startsWith("https://www.youtube.com/watch")) {
    throw new Error("目标标签页不是 YouTube 视频。");
  }
}

async function generateChapters(
  segments: TranscriptSegment[],
  targetLanguage: string,
  videoTitle: string,
): Promise<{ chapters: ChapterOutline[] }> {
  validateChapterSegments(segments);
  const settings = await getSettings();
  await assertProviderReady(settings);

  let parseError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const content = await requestAiCompletion(
      settings,
      buildChapterMessages(segments, targetLanguage, videoTitle),
    );
    try {
      return { chapters: parseChapterResponse(content, segments) };
    } catch (error) {
      parseError = error;
      if (attempt === 0) {
        console.warn("[video-parallel] Retrying invalid chapter response:", errorMessage(error));
      }
    }
  }
  throw parseError instanceof Error ? parseError : new Error("AI 返回的章节无法解析。");
}

async function requestAiCompletion(
  settings: AppSettings,
  messages: Array<{ role: "system" | "user"; content: string }>,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;

    const response = await fetch(chatCompletionsUrl(settings.baseUrl), {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: settings.model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages,
      }),
    });
    const text = await readBoundedText(response);
    if (!response.ok) {
      throw new Error(providerError(text, response.status));
    }
    const parsed = JSON.parse(text) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = parsed.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("AI 服务返回了空内容。");
    }
    return content;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("AI 请求超过 120 秒，请重试。");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function getSettings(): Promise<AppSettings> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return normalizeSettings(stored[SETTINGS_KEY]);
}

async function assertProviderReady(settings: AppSettings): Promise<void> {
  if (!settings.model) throw new Error("请先在设置中填写模型名称。");
  if (!settings.apiKey && settings.provider !== "local") {
    throw new Error("请先在设置中填写 API Key。");
  }
  const permission = providerOriginPattern(settings.baseUrl);
  const hasPermission = await chrome.permissions.contains({ origins: [permission] });
  if (!hasPermission) throw new Error("当前接口还没有网络权限，请重新保存设置。");
}

function validateChapterSegments(segments: TranscriptSegment[]): void {
  if (segments.length === 0) throw new Error("没有可用于生成概要的字幕。");
  if (segments.length > MAX_CHAPTER_TRANSCRIPT_SEGMENTS) {
    throw new Error(`字幕超过单次智能切章上限（${MAX_CHAPTER_TRANSCRIPT_SEGMENTS} 段）。`);
  }
  let characters = 0;
  const ids = new Set<string>();
  for (const segment of segments) {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(segment.id) || ids.has(segment.id)) {
      throw new Error("字幕段 ID 无效。");
    }
    if (
      !segment.text ||
      segment.text.length > 3000 ||
      !Number.isFinite(segment.startMs) ||
      segment.startMs < 0
    ) {
      throw new Error("字幕文本或时间戳无效。");
    }
    ids.add(segment.id);
    characters += segment.text.length;
  }
  if (characters > MAX_CHAPTER_TRANSCRIPT_CHARACTERS) {
    throw new Error(`字幕超过单次智能切章上限（${MAX_CHAPTER_TRANSCRIPT_CHARACTERS} 字符）。`);
  }
}

async function readBoundedText(response: Response): Promise<string> {
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_AI_RESPONSE_BYTES) {
    throw new Error("AI 响应超过 2 MiB，已停止读取。");
  }
  return text;
}

function providerError(text: string, status: number): string {
  try {
    const parsed = JSON.parse(text) as { error?: { message?: unknown }; message?: unknown };
    const message = parsed.error?.message ?? parsed.message;
    if (typeof message === "string" && message.trim()) return message;
  } catch {
    // Fall back to a bounded generic message below.
  }
  return `AI 请求失败：HTTP ${status}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
