import assert from "node:assert/strict";
import test from "node:test";
import { buildSummaryMarkdown, sanitizeFilename } from "../src/lib/markdown";

test("buildSummaryMarkdown exports chapter summaries without sentence translations", () => {
  const output = buildSummaryMarkdown(
    {
      title: "A useful video",
      channel: "Example",
      url: "https://www.youtube.com/watch?v=abcdef",
      sourceLanguage: "en",
      summaryLanguage: "简体中文",
    },
    [
      {
        id: "c0",
        startMs: 42_000,
        endMs: 120_000,
        content: {
          title: "核心观点",
          summary: "这是章节摘要。",
          keyPoints: ["重点一", "重点二"],
        },
      },
    ],
  );
  assert.match(output, /^# A useful video/m);
  assert.match(output, /## 内容概要\n\n### 00:42 · 核心观点/);
  assert.match(output, /这是章节摘要。\n\n- 重点一\n- 重点二/);
  assert.doesNotMatch(output, /逐句对照|Not translated/);
});

test("sanitizeFilename removes reserved filesystem characters", () => {
  assert.equal(sanitizeFilename('A/B: "video"?'), "A B video");
});
