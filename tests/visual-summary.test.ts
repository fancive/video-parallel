import assert from "node:assert/strict";
import test from "node:test";
import { buildSummaryMessages, parseSummaryResponse } from "../src/lib/summary";
import { parseVisualSummary } from "../src/lib/visual-summary";

const visual = () => ({
  kind: "argument",
  conclusion: "结论只有在明确条件下成立。",
  focus: "依据与条件",
  nodes: [
    {
      label: "有直接证据",
      relation: "依据",
      detail: "保留原始证据。",
      chapterStartIds: ["s0", "s2"],
    },
    { label: "条件仍须满足", relation: "条件", detail: "限制不能省略。", chapterStartIds: ["s2"] },
  ],
});

test("visual summaries preserve caveats and multiple chapter references", () => {
  for (const kind of ["argument", "flow", "comparison", "topics"]) {
    const value = { ...visual(), kind };
    assert.deepEqual(parseVisualSummary(value, ["s0", "s2"], "zh-CN"), value);
  }
});

test("invalid diagrams are rejected instead of truncating claims or inventing links", () => {
  for (const value of [
    undefined,
    { ...visual(), kind: "pie" },
    { ...visual(), nodes: [] },
    { ...visual(), nodes: Array(4).fill(visual().nodes[0]) },
    { ...visual(), nodes: [visual().nodes[0], visual().nodes[0]] },
    { ...visual(), conclusion: "字".repeat(61) },
    { ...visual(), nodes: [{ ...visual().nodes[0], label: "字".repeat(29) }] },
    { ...visual(), nodes: [{ ...visual().nodes[0], chapterStartIds: ["unknown"] }] },
    { ...visual(), nodes: [{ ...visual().nodes[0], chapterStartIds: [] }] },
    { ...visual(), nodes: [{ ...visual().nodes[0], detail: " " }] },
  ])
    assert.throws(() => parseVisualSummary(value, ["s0", "s2"], "zh-CN"), /结构图无效/);
});

test("the aggregate visible budget includes relations and focus, with language-aware limits", () => {
  const value = {
    ...visual(),
    conclusion: "字".repeat(60),
    focus: "字".repeat(20),
    nodes: [
      { ...visual().nodes[0], label: "字".repeat(28), relation: "字".repeat(8) },
      { ...visual().nodes[1], label: "文".repeat(28), relation: "字".repeat(8) },
    ],
  };
  assert.throws(() => parseVisualSummary(value, ["s0", "s2"], "zh-CN"));
  assert.doesNotThrow(() => parseVisualSummary(value, ["s0", "s2"], "en"));
});

test("only the final summary requests a diagram and validates references against returned chapters", () => {
  const input = [
    { id: "s0", startMs: 0, durationMs: 1, text: "Example" },
    { id: "s2", startMs: 1, durationMs: 1, text: "Condition" },
  ];
  assert.match(buildSummaryMessages(input, "zh-CN", "Video")[0]?.content ?? "", /chapterStartIds/);
  assert.doesNotMatch(
    buildSummaryMessages(input, "zh-CN", "Video", false)[0]?.content ?? "",
    /chapterStartIds/,
  );
  const response = {
    overview: { summary: "Full", keyPoints: ["Point"] },
    chapters: [{ startSegmentId: "s0", title: "Chapter", summary: "Full", keyPoints: [] }],
  };
  assert.throws(() => parseSummaryResponse(JSON.stringify(response), input, "zh-CN"), /结构图无效/);
  // s2 exists in captions, but is not one of the returned chapter boundaries.
  assert.throws(
    () => parseSummaryResponse(JSON.stringify({ ...response, visual: visual() }), input, "zh-CN"),
    /结构图无效/,
  );
  assert.doesNotThrow(() => parseSummaryResponse(JSON.stringify(response), input));
});
