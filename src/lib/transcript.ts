import type { CaptionTrack, TranscriptSegment } from "./types";

interface Json3Segment {
  utf8?: string;
}

interface Json3Event {
  tStartMs?: number;
  dDurationMs?: number;
  segs?: Json3Segment[];
}

interface Json3Payload {
  events?: Json3Event[];
}

interface RawCaption {
  startMs: number;
  durationMs: number;
  text: string;
}

interface BilibiliCaption {
  from?: number;
  to?: number;
  content?: string;
}

interface BilibiliSubtitlePayload {
  body?: unknown[];
}

const SENTENCE_END = /[.!?。！？…]["'”’）)]?$/u;
const CLAUSE_END = /[,;:，；：]["'”’）)]?$/u;

export function selectCaptionTrack(
  tracks: CaptionTrack[],
  preferredLanguage = "en",
): CaptionTrack | null {
  if (tracks.length === 0) return null;

  const ranked = [...tracks].sort((left, right) => {
    return trackScore(right, preferredLanguage) - trackScore(left, preferredLanguage);
  });
  return ranked[0] ?? null;
}

function trackScore(track: CaptionTrack, preferredLanguage: string): number {
  let score = 0;
  if (track.languageCode === preferredLanguage) score += 100;
  else if (track.languageCode.startsWith(`${preferredLanguage}-`)) score += 80;
  if (track.kind !== "asr") score += 15;
  if (track.isTranslatable) score += 2;
  return score;
}

export function json3CaptionUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  if (url.protocol !== "https:" || url.hostname !== "www.youtube.com") {
    throw new Error("字幕地址不是受支持的 YouTube 接口。");
  }
  url.searchParams.set("fmt", "json3");
  url.searchParams.delete("xosf");
  return url.toString();
}

export function parseJson3Text(responseText: string): unknown {
  const text = responseText.trim();
  if (!text) {
    throw new Error("YouTube 字幕接口返回了空响应，请刷新视频页面后重试。");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("YouTube 字幕响应格式无法解析，请刷新视频页面后重试。");
  }
}

export function parseJson3Transcript(payload: unknown): TranscriptSegment[] {
  const data = payload as Json3Payload;
  if (!Array.isArray(data?.events)) return [];

  const raw: RawCaption[] = data.events
    .map((event) => ({
      startMs: finiteNumber(event.tStartMs),
      durationMs: Math.max(0, finiteNumber(event.dDurationMs)),
      text: cleanCaptionText(
        Array.isArray(event.segs) ? event.segs.map((segment) => segment.utf8 ?? "").join("") : "",
      ),
    }))
    .filter((caption) => caption.text.length > 0);

  return groupCaptions(raw);
}

export function bilibiliSubtitleUrl(baseUrl: string): string {
  const absoluteUrl = baseUrl.startsWith("//") ? `https:${baseUrl}` : baseUrl;
  const url = new URL(absoluteUrl);
  if (url.protocol === "http:") url.protocol = "https:";
  if (
    url.protocol !== "https:" ||
    (url.hostname !== "i0.hdslb.com" && url.hostname !== "aisubtitle.hdslb.com") ||
    url.username ||
    url.password ||
    url.port ||
    !/^\/bfs\/(?:ai_)?subtitle\//.test(url.pathname)
  ) {
    throw new Error("字幕地址不是受支持的 Bilibili 接口。");
  }
  return url.toString();
}

export function parseBilibiliText(responseText: string): unknown {
  const text = responseText.trim();
  if (!text) {
    throw new Error("Bilibili 字幕接口返回了空响应，请刷新视频页面后重试。");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Bilibili 字幕响应格式无法解析，请刷新视频页面后重试。");
  }
}

export function parseBilibiliTranscript(payload: unknown): TranscriptSegment[] {
  const data = payload as BilibiliSubtitlePayload;
  if (!Array.isArray(data?.body)) return [];

  return data.body
    .flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const caption = value as BilibiliCaption;
      const from = Number(caption.from);
      const to = Number(caption.to);
      const text = cleanCaptionText(typeof caption.content === "string" ? caption.content : "");
      if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to < from || !text) {
        return [];
      }
      return [
        {
          startMs: Math.round(from * 1000),
          durationMs: Math.max(0, Math.round((to - from) * 1000)),
          text,
        },
      ];
    })
    .sort((left, right) => left.startMs - right.startMs)
    .map((caption, index) => ({
      id: `s${index}-${Math.floor(caption.startMs)}`,
      ...caption,
    }));
}

export function groupCaptions(raw: RawCaption[]): TranscriptSegment[] {
  const result: TranscriptSegment[] = [];
  let buffer: RawCaption[] = [];

  const flush = () => {
    if (buffer.length === 0) return;
    const first = buffer[0];
    const last = buffer.at(-1);
    if (!first || !last) return;
    const endMs = last.startMs + last.durationMs;
    const text = joinCaptionParts(buffer.map((item) => item.text));
    result.push({
      id: `s${result.length}-${Math.floor(first.startMs)}`,
      startMs: first.startMs,
      durationMs: Math.max(0, endMs - first.startMs),
      text,
    });
    buffer = [];
  };

  for (const caption of raw) {
    const previous = buffer.at(-1);
    const currentText = joinCaptionParts([...buffer.map((item) => item.text), caption.text]);
    const gapMs = previous ? caption.startMs - (previous.startMs + previous.durationMs) : 0;
    const shouldBreakBefore = buffer.length > 0 && gapMs > 1800;

    if (shouldBreakBefore) flush();
    buffer.push(caption);

    const shouldBreakAfter =
      SENTENCE_END.test(caption.text) ||
      currentText.length >= 220 ||
      (currentText.length >= 130 && CLAUSE_END.test(caption.text));
    if (shouldBreakAfter) flush();
  }

  flush();
  return result;
}

export function formatTimecode(startMs: number): string {
  const seconds = Math.max(0, Math.floor(startMs / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

function finiteNumber(input: unknown): number {
  const value = Number(input);
  return Number.isFinite(value) ? value : 0;
}

function cleanCaptionText(input: string): string {
  return input
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^>>\s*/, "")
    .trim();
}

function joinCaptionParts(parts: string[]): string {
  return parts
    .join(" ")
    .replace(/\s+([,.;:!?，。；：！？])/gu, "$1")
    .replace(/\s+/g, " ")
    .trim();
}
