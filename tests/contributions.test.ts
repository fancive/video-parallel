import assert from "node:assert/strict";
import test from "node:test";
import { parseContributions, readCachedContributions } from "../src/lib/contributions";
import { buildSummaryMessages, parseSummaryResponse } from "../src/lib/summary";

const segments = [
  { id: "s0", startMs: 0, durationMs: 1000, text: "Problem" },
  { id: "s1", startMs: 42000, durationMs: 1000, text: "Supported method and limitations" },
];
const item = {
  title: "一个有依据的方法",
  problem: "人工操作重复",
  value: "明确工作分工",
  boundary: "只验证了示例场景",
  evidenceSegmentIds: ["s1"],
};
const contribution = { items: [item], emptyReason: "" };

test("contributions keep their value, boundary and exact source timestamps", () => {
  const parsed = parseContributions(contribution, segments);
  assert.deepEqual(parsed.items[0]?.evidence, [{ segmentId: "s1", startMs: 42000 }]);
  assert.equal(parsed.items[0]?.value, item.value);
  assert.equal(parsed.items[0]?.boundary, item.boundary);
  assert.deepEqual(readCachedContributions(parsed, segments), parsed);
  const moved = segments.map((s) => ({ ...s, startMs: s.startMs + 1 }));
  assert.equal(readCachedContributions(parsed, moved), undefined);
});

test("a clear absence of contributions is valid but missing or fabricated evidence is not", () => {
  assert.deepEqual(
    parseContributions(
      { items: [], emptyReason: "只是介绍日程，没有展开具体观点或方法。" },
      segments,
    ),
    { items: [], emptyReason: "只是介绍日程，没有展开具体观点或方法。" },
  );
  for (const invalid of [
    undefined,
    { items: [], emptyReason: "" },
    { items: Array(4).fill(item), emptyReason: "" },
    ...[[], ["missing"], ["s1", "s1"]].map((evidenceSegmentIds) => ({
      items: [{ ...item, evidenceSegmentIds }],
      emptyReason: "",
    })),
    { items: [{ ...item, value: "" }], emptyReason: "" },
  ]) {
    assert.throws(() => parseContributions(invalid, segments), /主要贡献/);
  }
});

test("new summaries require real contributions or an explicit absence rather than rebranding takeaways", () => {
  const response = {
    overview: { summary: "摘要", keyPoints: ["要点"] },
    chapters: [{ startSegmentId: "s0", title: "主题", summary: "内容", keyPoints: [] }],
  };
  assert.throws(() => parseSummaryResponse(JSON.stringify(response), segments), /主要贡献/);
  const parsed = parseSummaryResponse(
    JSON.stringify({
      ...response,
      overview: { ...response.overview, contributions: contribution },
    }),
    segments,
  );
  assert.equal(parsed.overview.contributions?.items[0]?.title, item.title);
  const prompt = buildSummaryMessages(segments, "zh-CN", "Video")[0]?.content ?? "";
  assert.match(prompt, /not one item per chapter/);
  assert.match(prompt, /Do not claim first-ever novelty/);
  assert.match(prompt, /Do not add external knowledge/);
  assert.match(prompt, /1-3 substantive contributions/);
});
