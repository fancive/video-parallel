import type { TranscriptSegment, VideoContribution, VideoContributions } from "./types";

const nonempty = (value: unknown): value is string =>
  typeof value === "string" && Boolean(value.trim());

export function parseContributions(
  value: unknown,
  segments: TranscriptSegment[],
): VideoContributions {
  const fail = (field: string, requirement: string): never => {
    throw new Error(`AI 返回的主要贡献不符合格式：${field} ${requirement}。`);
  };
  const root = "overview.contributions";
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fail(root, "必须是包含 items 和 emptyReason 的对象");
  const data = value as Record<string, unknown>;
  if (!Array.isArray(data.items)) return fail(`${root}.items`, "必须是数组");
  if (data.items.length > 3) return fail(`${root}.items`, "最多 3 项，不要逐章凑数");
  if (typeof data.emptyReason !== "string")
    return fail(`${root}.emptyReason`, '必须是字符串；有贡献时使用空字符串 ""');
  if (data.items.length === 0 && !nonempty(data.emptyReason))
    return fail(`${root}.emptyReason`, "必须说明没有明确贡献的原因");
  const sources = new Map(segments.map((segment) => [segment.id, segment]));
  const items: VideoContribution[] = data.items.map((value, index) => {
    const field = `${root}.items[${index}]`;
    if (!value || typeof value !== "object" || Array.isArray(value))
      return fail(field, "必须是贡献对象");
    const item = value as Record<string, unknown>;
    if (!nonempty(item.title)) return fail(`${field}.title`, "必须是非空字符串");
    if (!nonempty(item.problem)) return fail(`${field}.problem`, "必须是非空字符串");
    if (!nonempty(item.value)) return fail(`${field}.value`, "必须是非空字符串");
    if (typeof item.boundary !== "string")
      return fail(`${field}.boundary`, '必须是字符串；没有明确边界时使用空字符串 ""');
    if (!Array.isArray(item.evidenceSegmentIds))
      return fail(`${field}.evidenceSegmentIds`, "必须是包含 1–3 个不同字幕 ID 的数组");
    if (item.evidenceSegmentIds.length < 1 || item.evidenceSegmentIds.length > 3)
      return fail(`${field}.evidenceSegmentIds`, "必须包含 1–3 个不同字幕 ID");
    const seen = new Set<string>();
    const evidence = item.evidenceSegmentIds.map((id, evidenceIndex) => {
      const evidenceField = `${field}.evidenceSegmentIds[${evidenceIndex}]`;
      const source = typeof id === "string" ? sources.get(id) : undefined;
      if (!source)
        return fail(evidenceField, "必须逐字匹配输入中的字幕 ID 字符串，不能使用序号或时间戳");
      if (seen.has(source.id)) return fail(evidenceField, "与本项的其他引用重复，请选择不同依据");
      seen.add(source.id);
      return { segmentId: source.id, startMs: source.startMs };
    });
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
