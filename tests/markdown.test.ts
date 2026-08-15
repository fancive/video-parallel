import assert from "node:assert/strict";
import test from "node:test";
import { buildParallelMarkdown, sanitizeFilename } from "../src/lib/markdown";

test("buildParallelMarkdown preserves source, translation, and timecodes", () => {
  const output = buildParallelMarkdown(
    {
      title: "A useful video",
      channel: "Example",
      url: "https://www.youtube.com/watch?v=abcdef",
      sourceLanguage: "en",
      targetLanguage: "简体中文",
    },
    [
      {
        id: "s0",
        startMs: 42_000,
        durationMs: 1000,
        text: "The source line.",
        translatedText: "译文。",
      },
    ],
  );
  assert.match(output, /^# A useful video/m);
  assert.match(output, /## 00:42/);
  assert.match(output, /The source line\.\n\n译文。/);
});

test("sanitizeFilename removes reserved filesystem characters", () => {
  assert.equal(sanitizeFilename('A/B: "video"?'), "A B video");
});
