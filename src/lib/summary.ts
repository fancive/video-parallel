import { TARGET_LANGUAGE_LABELS } from "./settings";
import type { ChapterOutline, SummaryBlock, TranscriptSegment } from "./types";

export const SUMMARY_PROMPT_VERSION = 2;
export const MAX_CHAPTER_TRANSCRIPT_SEGMENTS = 2000;
export const MAX_CHAPTER_TRANSCRIPT_CHARACTERS = 100_000;
export const MAX_CHAPTERS = 16;

export function buildChapterMessages(
  segments: TranscriptSegment[],
  targetLanguage: string,
  videoTitle: string,
): Array<{ role: "system" | "user"; content: string }> {
  const language = TARGET_LANGUAGE_LABELS[targetLanguage] ?? targetLanguage;
  const firstId = segments[0]?.id ?? "";
  return [
    {
      role: "system",
      content: [
        `Analyze the complete YouTube transcript and write the result in ${language}.`,
        "Choose chapter boundaries from real topic, argument, speaker-intent, or narrative transitions.",
        "Do not split at equal time intervals and do not create a new chapter merely because time has passed.",
        "Use fewer, broader chapters when one idea continues; use a boundary only when the viewer benefits from a new heading.",
        `The first chapter must start at segment id ${firstId}. Every startSegmentId must exactly match an input id.`,
        `Return no more than ${MAX_CHAPTERS} chapters in chronological order. Cover the complete transcript without gaps.`,
        "For each chapter, write a specific title, a concise 2-3 sentence summary, and 2-4 evidence-based key points.",
        "Use only claims supported by the transcript. Preserve names, numbers, caveats, and uncertainty.",
        'Return only JSON with this shape: {"chapters":[{"startSegmentId":"unchanged-id","title":"title","summary":"summary","keyPoints":["point"]}]}.',
      ].join("\n"),
    },
    {
      role: "user",
      content: JSON.stringify({
        videoTitle,
        transcript: segments.map(({ id, startMs, text }) => ({ id, startMs, text })),
      }),
    },
  ];
}

export function parseChapterResponse(
  responseText: string,
  segments: TranscriptSegment[],
): ChapterOutline[] {
  const parsed = parseLooseJson(responseText) as { chapters?: unknown };
  if (!Array.isArray(parsed.chapters)) throw new Error("AI 未返回章节列表。");

  const order = new Map(segments.map((segment, index) => [segment.id, index]));
  const seen = new Set<string>();
  const chapters: ChapterOutline[] = [];
  for (const value of parsed.chapters) {
    if (!value || typeof value !== "object") continue;
    const item = value as Record<string, unknown>;
    if (
      typeof item.startSegmentId !== "string" ||
      typeof item.title !== "string" ||
      typeof item.summary !== "string" ||
      !order.has(item.startSegmentId) ||
      seen.has(item.startSegmentId)
    ) {
      continue;
    }
    const title = item.title.trim();
    const summary = item.summary.trim();
    const keyPoints = Array.isArray(item.keyPoints)
      ? item.keyPoints
          .filter((point): point is string => typeof point === "string")
          .map((point) => point.trim())
          .filter(Boolean)
          .slice(0, 4)
      : [];
    if (!title || !summary) continue;
    seen.add(item.startSegmentId);
    chapters.push({ startSegmentId: item.startSegmentId, title, summary, keyPoints });
  }

  chapters.sort(
    (left, right) =>
      (order.get(left.startSegmentId) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(right.startSegmentId) ?? Number.MAX_SAFE_INTEGER),
  );
  if (chapters.length === 0) throw new Error("AI 返回的章节内容无法解析。");
  if (chapters[0]?.startSegmentId !== segments[0]?.id) {
    throw new Error("AI 返回的章节没有覆盖视频开头。");
  }
  return chapters.slice(0, MAX_CHAPTERS);
}

export function makeChapterBlocks(
  segments: TranscriptSegment[],
  outline: ChapterOutline[],
): SummaryBlock[] {
  const segmentIndex = new Map(segments.map((segment, index) => [segment.id, index]));
  return outline.flatMap((chapter, index) => {
    const startIndex = segmentIndex.get(chapter.startSegmentId);
    if (startIndex === undefined) return [];
    const next = outline[index + 1];
    const nextIndex = next ? segmentIndex.get(next.startSegmentId) : undefined;
    const endIndex = nextIndex === undefined ? segments.length : nextIndex;
    const first = segments[startIndex];
    const last = segments[endIndex - 1];
    if (!first || !last || endIndex <= startIndex) return [];
    return [
      {
        id: `c${index}-${Math.floor(first.startMs)}`,
        startMs: first.startMs,
        endMs: last.startMs + last.durationMs,
        content: {
          title: chapter.title,
          summary: chapter.summary,
          keyPoints: chapter.keyPoints,
        },
      },
    ];
  });
}

function parseLooseJson(responseText: string): unknown {
  let cleaned = responseText
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "");
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }
  try {
    return JSON.parse(cleaned);
  } catch {
    return JSON.parse(cleaned.replace(/,(\s*[}\]])/g, "$1"));
  }
}
