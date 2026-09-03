import assert from "node:assert/strict";
import test from "node:test";
import { buildSummaryMarkdown, sanitizeFilename } from "../src/lib/markdown";

test("buildSummaryMarkdown exports chapter summaries without sentence translations", () => {
  const output = buildSummaryMarkdown(
    {
      title: "A useful video",
      channel: "Example",
      url: "https://www.bilibili.com/video/BV16e4y1s7GS/?p=2",
      sourceLanguage: "en",
      summaryLanguage: "简体中文",
    },
    {
      summary: "这是整段视频的总结。",
      keyPoints: ["总重点一", "总重点二"],
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
  assert.match(output, /- Source: https:\/\/www\.bilibili\.com\/video\/BV16e4y1s7GS\/\?p=2/);
  assert.match(output, /## 全文要点\n\n这是整段视频的总结。\n\n- 总重点一\n- 总重点二/);
  assert.match(output, /## 章节概要\n\n### 00:42 · 核心观点/);
  assert.match(output, /这是章节摘要。\n\n- 重点一\n- 重点二/);
  assert.doesNotMatch(output, /逐句对照|Not translated/);
});

test("sanitizeFilename removes reserved filesystem characters", () => {
  assert.equal(sanitizeFilename('A/B: "video"?'), "A B video");
});
