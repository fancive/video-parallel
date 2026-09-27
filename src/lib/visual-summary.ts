import type { VisualSummary } from "./types";

export function visualSummaryInstruction(language: string): string {
  const budget = /^(zh|ja|ko)/.test(language)
    ? "Aim for about 100 characters TOTAL across conclusion, focus, node labels and relations; hard maximum 140 Unicode characters. Each label <= 28 characters, relation <= 8, focus <= 20, conclusion <= 60."
    : "Aim for about 60 words TOTAL across conclusion, focus, node labels and relations; hard maximum 90 words and 650 Unicode characters. Each label <= 110 characters, relation <= 30, focus <= 70, conclusion <= 240.";
  return [
    "Also return visual: {kind, conclusion, focus, nodes:[{label, relation, detail, chapterStartIds}]}. All its text must use the required output language, except kind and chapterStartIds.",
    'kind is one of "argument" (evidence/conditions supporting a conclusion), "flow" (explicit steps in order), "comparison" (alternatives on ONE shared dimension), or "topics" (independent ideas without implied relationships).',
    "Use 1-3 nodes. Pick the most useful form, not one node per chapter. Fewer nodes are better than invented information. conclusion is ONE sentence conveying the main claim or theme, preserving decisive caveats.",
    "focus briefly names the relationship or shared comparison dimension. relation names each node's role, step or alternative. label states a concrete short insight; do not repeat the conclusion. detail explains the insight and its caveats in at most 600 characters.",
    "Every node must cite 1 or more startSegmentId values from the chapters YOU RETURN via chapterStartIds. These link to chapter starts, not precise evidence timestamps. Cite all relevant chapters, including nonadjacent ones.",
    "Only draw relationships supported by the input. Time order does not prove causality. Use topics if no meaningful relationship is supported. Never invent quantities or certainty for a diagram.",
    budget,
    "Keep detailed background in overview and chapters, not visual labels. Never truncate a sentence to meet the budget.",
  ].join("\n");
}

export function parseVisualSummary(
  value: unknown,
  chapterStartIds: string[],
  language: string,
): VisualSummary {
  const fail = (): never => {
    throw new Error("AI 返回的结构图无效：请检查阅读长度、节点关系和章节引用。");
  };
  if (!value || typeof value !== "object") return fail();
  const map = value as Record<string, unknown>;
  if (!["argument", "flow", "comparison", "topics"].includes(String(map.kind))) return fail();
  const compact = /^(zh|ja|ko)/.test(language);
  const read = (input: unknown, max: number): string => {
    if (typeof input !== "string" || !input.trim() || [...input.trim()].length > max) return fail();
    return input.trim();
  };
  const conclusion = read(map.conclusion, compact ? 60 : 240);
  const focus = read(map.focus, compact ? 20 : 70);
  if (!Array.isArray(map.nodes) || map.nodes.length < 1 || map.nodes.length > 3) return fail();
  const chapters = new Set(chapterStartIds);
  const labels = new Set<string>();
  const nodes = map.nodes.map((item: unknown) => {
    if (!item || typeof item !== "object") return fail();
    const node = item as Record<string, unknown>;
    const label = read(node.label, compact ? 28 : 110);
    if (labels.has(label)) return fail();
    labels.add(label);
    if (
      !Array.isArray(node.chapterStartIds) ||
      node.chapterStartIds.length === 0 ||
      node.chapterStartIds.some((id: unknown) => typeof id !== "string" || !chapters.has(id))
    )
      return fail();
    return {
      label,
      relation: read(node.relation, compact ? 8 : 30),
      detail: read(node.detail, 600),
      chapterStartIds: [...new Set(node.chapterStartIds as string[])],
    };
  });
  const text = [conclusion, focus, ...nodes.flatMap((node) => [node.label, node.relation])];
  if (text.reduce((sum, part) => sum + [...part].length, 0) > (compact ? 140 : 650)) return fail();
  if (!compact && text.join(" ").split(/\s+/).length > 90) return fail();
  return { kind: map.kind as VisualSummary["kind"], conclusion, focus, nodes };
}
