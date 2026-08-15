import { TARGET_LANGUAGE_LABELS } from "./settings";
import type { TranscriptSegment } from "./types";

export const MAX_BATCH_SEGMENTS = 8;
export const MAX_BATCH_CHARACTERS = 4000;

export interface ParsedTranslationResponse {
  translations: Record<string, string>;
  missingIds: string[];
}

export function makeTranslationBatches(segments: TranscriptSegment[]): TranscriptSegment[][] {
  const batches: TranscriptSegment[][] = [];
  let current: TranscriptSegment[] = [];
  let currentCharacters = 0;

  for (const segment of segments) {
    const nextCharacters = currentCharacters + segment.text.length;
    if (
      current.length > 0 &&
      (current.length >= MAX_BATCH_SEGMENTS || nextCharacters > MAX_BATCH_CHARACTERS)
    ) {
      batches.push(current);
      current = [];
      currentCharacters = 0;
    }
    current.push(segment);
    currentCharacters += segment.text.length;
  }

  if (current.length > 0) batches.push(current);
  return batches;
}

export function buildTranslationMessages(
  segments: TranscriptSegment[],
  targetLanguage: string,
  videoTitle: string,
): Array<{ role: "system" | "user"; content: string }> {
  const language = TARGET_LANGUAGE_LABELS[targetLanguage] ?? targetLanguage;
  return [
    {
      role: "system",
      content: [
        `Translate YouTube transcript segments into ${language}.`,
        "Preserve meaning, tone, names, technical terms, and spoken emphasis.",
        "Translate complete thoughts naturally; do not summarize or add commentary.",
        'Return only JSON with this shape: {"translations":[{"id":"unchanged-id","text":"translation"}]}.',
        "Keep every id exactly once and in the original order.",
      ].join("\n"),
    },
    {
      role: "user",
      content: JSON.stringify({
        videoTitle,
        segments: segments.map(({ id, text }) => ({ id, text })),
      }),
    },
  ];
}

export function parseTranslationResponse(
  responseText: string,
  expectedIds: string[],
): ParsedTranslationResponse {
  const parsed = parseLooseJson(responseText) as {
    translations?: Array<{ id?: unknown; text?: unknown }> | Record<string, unknown>;
  };
  const expected = new Set(expectedIds);
  const result: Record<string, string> = {};

  const candidates = Array.isArray(parsed.translations)
    ? parsed.translations
    : Object.entries(parsed.translations ?? {}).map(([id, text]) => ({ id, text }));
  for (const item of candidates) {
    if (typeof item.id !== "string" || typeof item.text !== "string") continue;
    const text = item.text.trim();
    if (!expected.has(item.id) || !text || result[item.id]) continue;
    result[item.id] = text;
  }

  return {
    translations: result,
    missingIds: expectedIds.filter((id) => !result[id]),
  };
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
