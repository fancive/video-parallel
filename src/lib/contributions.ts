import type { TranscriptSegment, VideoContribution, VideoContributions } from "./types";

const nonempty = (value: unknown): value is string =>
  typeof value === "string" && Boolean(value.trim());

export function parseContributions(
  value: unknown,
  segments: TranscriptSegment[],
): VideoContributions {
  const fail = () => {
    throw new Error(
      "AI 返回的主要贡献不完整或依据无效，请返回 1–3 项有依据的贡献；没有明确贡献时返回空列表并说明原因。",
    );
  };
  if (!value || typeof value !== "object") return fail();
  const data = value as Record<string, unknown>;
  if (!Array.isArray(data.items) || data.items.length > 3 || typeof data.emptyReason !== "string")
    return fail();
  if (data.items.length === 0 && !nonempty(data.emptyReason)) return fail();
  const sources = new Map(segments.map((segment) => [segment.id, segment]));
  const items: VideoContribution[] = data.items.map((value) => {
    if (!value || typeof value !== "object") return fail();
    const item = value as Record<string, unknown>;
    if (
      !nonempty(item.title) ||
      !nonempty(item.problem) ||
      !nonempty(item.value) ||
      typeof item.boundary !== "string" ||
      !Array.isArray(item.evidenceSegmentIds) ||
      item.evidenceSegmentIds.length < 1 ||
      item.evidenceSegmentIds.length > 3
    )
      return fail();
    const evidence = item.evidenceSegmentIds.map((id) => {
      const source = typeof id === "string" ? sources.get(id) : undefined;
      if (!source) return fail();
      return { segmentId: source.id, startMs: source.startMs };
    });
    if (new Set(evidence.map((source) => source.segmentId)).size !== evidence.length) return fail();
    return {
      title: item.title.trim(),
      problem: item.problem.trim(),
      value: item.value.trim(),
      boundary: item.boundary.trim(),
      evidence,
    };
  });
  return { items, emptyReason: items.length ? "" : data.emptyReason.trim() };
}

export function readCachedContributions(
  value: unknown,
  segments: TranscriptSegment[],
): VideoContributions | undefined {
  try {
    if (!value || typeof value !== "object") return undefined;
    const data = value as VideoContributions;
    if (!Array.isArray(data.items)) return undefined;
    const byId = new Map(segments.map((segment) => [segment.id, segment.startMs]));
    const items = data.items.map((item) => {
      if (
        !item ||
        !Array.isArray(item.evidence) ||
        item.evidence.some((source) => !source || byId.get(source.segmentId) !== source.startMs)
      )
        throw new Error("Invalid cached evidence");
      return { ...item, evidenceSegmentIds: item.evidence.map((source) => source.segmentId) };
    });
    return parseContributions({ items, emptyReason: data.emptyReason }, segments);
  } catch {
    return undefined;
  }
}
