import assert from "node:assert/strict";
import test from "node:test";
import {
  extractVideoId,
  formatTimecode,
  json3CaptionUrl,
  parseJson3Text,
  parseJson3Transcript,
  selectCaptionTrack,
} from "../src/lib/transcript";

test("selectCaptionTrack prefers manual exact-language captions", () => {
  const selected = selectCaptionTrack(
    [
      { baseUrl: "auto", languageCode: "en", name: "English auto", kind: "asr" },
      { baseUrl: "manual", languageCode: "en", name: "English" },
      { baseUrl: "fr", languageCode: "fr", name: "French" },
    ],
    "en",
  );
  assert.equal(selected?.baseUrl, "manual");
});

test("parseJson3Transcript turns caption fragments into semantic segments", () => {
  const segments = parseJson3Transcript({
    events: [
      { tStartMs: 0, dDurationMs: 1200, segs: [{ utf8: "Hello" }] },
      { tStartMs: 1200, dDurationMs: 1400, segs: [{ utf8: "world." }] },
      { tStartMs: 2800, dDurationMs: 1000, segs: [{ utf8: ">> Next idea" }] },
      { tStartMs: 3800, dDurationMs: 1000, segs: [{ utf8: "starts here!" }] },
    ],
  });
  assert.deepEqual(
    segments.map((segment) => ({ startMs: segment.startMs, text: segment.text })),
    [
      { startMs: 0, text: "Hello world." },
      { startMs: 2800, text: "Next idea starts here!" },
    ],
  );
});

test("caption and YouTube URL helpers preserve only intended data", () => {
  const captionUrl = json3CaptionUrl("https://www.youtube.com/api/timedtext?v=abc&fmt=srv3&xosf=1");
  assert.equal(new URL(captionUrl).searchParams.get("fmt"), "json3");
  assert.equal(new URL(captionUrl).searchParams.get("xosf"), null);
  assert.equal(extractVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42"), "dQw4w9WgXcQ");
  assert.equal(extractVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ"), null);
  assert.throws(() => json3CaptionUrl("https://example.com/timedtext?v=abc"), /不是受支持/);
});

test("parseJson3Text reports an empty YouTube caption body clearly", () => {
  assert.throws(() => parseJson3Text("  \n"), /返回了空响应/);
  assert.deepEqual(parseJson3Text('{"events":[]}'), { events: [] });
});

test("formatTimecode supports videos longer than one hour", () => {
  assert.equal(formatTimecode(62_000), "01:02");
  assert.equal(formatTimecode(3_661_000), "1:01:01");
});
