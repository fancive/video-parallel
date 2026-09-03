import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSummaryMessages,
  makeChapterBlocks,
  parseSummaryResponse,
  SUMMARY_PROMPT_VERSION,
} from "../src/lib/summary";
import type { TranscriptSegment } from "../src/lib/types";

const segments: TranscriptSegment[] = [
  { id: "s0", startMs: 0, durationMs: 30_000, text: "Opening premise." },
  { id: "s1", startMs: 30_000, durationMs: 40_000, text: "The premise continues." },
  { id: "s2", startMs: 70_000, durationMs: 35_000, text: "A new argument begins." },
  { id: "s3", startMs: 105_000, durationMs: 25_000, text: "The argument concludes." },
];

test("chapter prompt is platform-neutral and rejects interval splitting", () => {
  const messages = buildSummaryMessages(segments, "zh-CN", "A useful video");
  assert.equal(SUMMARY_PROMPT_VERSION, 5);
  assert.match(messages[0]?.content ?? "", /complete video transcript/);
  assert.doesNotMatch(messages[0]?.content ?? "", /YouTube|Bilibili/i);
  assert.match(messages[0]?.content ?? "", /Do not split at equal time intervals/);
  assert.match(messages[0]?.content ?? "", /3-5 key takeaways/);
  assert.match(messages[0]?.content ?? "", /所有面向用户的文本都必须使用简体中文/);
  assert.match(messages[0]?.content ?? "", /Every user-facing JSON string value/);
  assert.match(messages[0]?.content ?? "", /overview\.summary/);
  assert.match(messages[0]?.content ?? "", /first chapter must start at segment id s0/i);
  assert.match(messages[1]?.content ?? "", /"outputLanguage":"简体中文"/);
  assert.match(messages[1]?.content ?? "", /A new argument begins/);
});

test("summary prompt repeats the selected language in its native wording", () => {
  const messages = buildSummaryMessages(segments, "fr", "A useful video");

  assert.match(messages[0]?.content ?? "", /required output language is Français/);
  assert.match(messages[0]?.content ?? "", /tout le texte destiné à l’utilisateur en français/);
  assert.match(messages[1]?.content ?? "", /"outputLanguage":"Français"/);
});

test("parseSummaryResponse accepts a full overview and restores chapter chronology", () => {
  const result = parseSummaryResponse(
    `Result:\n\`\`\`json
    {"overview":{"summary":"全文结论。","keyPoints":["总重点一","总重点二"]},"chapters":[
      {"startSegmentId":"s2","title":"第二章","summary":"新论点。","keyPoints":["证据二"]},
      {"startSegmentId":"s0","title":"第一章","summary":"开场论点。","keyPoints":["证据一"]},
    ],}
    \`\`\``,
    segments,
  );
  assert.deepEqual(
    result.chapters.map((chapter) => chapter.startSegmentId),
    ["s0", "s2"],
  );
  assert.deepEqual(result.overview.keyPoints, ["总重点一", "总重点二"]);
});

test("parseSummaryResponse requires coverage from the first transcript segment", () => {
  assert.throws(
    () =>
      parseSummaryResponse(
        '{"overview":{"summary":"全文摘要","keyPoints":["重点"]},"chapters":[{"startSegmentId":"s2","title":"第二章","summary":"摘要","keyPoints":[]}]}',
        segments,
      ),
    /没有覆盖视频开头/,
  );
});

test("parseSummaryResponse rejects chapter-only responses", () => {
  assert.throws(
    () =>
      parseSummaryResponse(
        '{"chapters":[{"startSegmentId":"s0","title":"第一章","summary":"摘要","keyPoints":[]}]}',
        segments,
      ),
    /未返回全文要点/,
  );
});

test("makeChapterBlocks turns model boundaries into contiguous, complete time ranges", () => {
  const blocks = makeChapterBlocks(segments, [
    { startSegmentId: "s0", title: "第一章", summary: "开场。", keyPoints: [] },
    { startSegmentId: "s2", title: "第二章", summary: "论证。", keyPoints: [] },
  ]);
  assert.deepEqual(
    blocks.map(({ startMs, endMs }) => ({ startMs, endMs })),
    [
      { startMs: 0, endMs: 70_000 },
      { startMs: 70_000, endMs: 130_000 },
    ],
  );
});
