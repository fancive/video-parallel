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

export function extractVideoId(urlValue: string): string | null {
  try {
    const url = new URL(urlValue);
    if (url.hostname !== "www.youtube.com" || url.pathname !== "/watch") return null;
    const videoId = url.searchParams.get("v")?.trim() ?? "";
    return /^[A-Za-z0-9_-]{6,20}$/.test(videoId) ? videoId : null;
  } catch {
    return null;
  }
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
