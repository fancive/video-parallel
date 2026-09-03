import assert from "node:assert/strict";
import test from "node:test";
import {
  bilibiliSubtitleUrl,
  formatTimecode,
  json3CaptionUrl,
  parseBilibiliText,
  parseBilibiliTranscript,
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
  assert.throws(() => json3CaptionUrl("https://example.com/timedtext?v=abc"), /不是受支持/);
});

test("parseJson3Text reports an empty YouTube caption body clearly", () => {
  assert.throws(() => parseJson3Text("  \n"), /返回了空响应/);
  assert.deepEqual(parseJson3Text('{"events":[]}'), { events: [] });
});

test("Bilibili subtitle helpers validate CDN URLs and convert seconds to milliseconds", () => {
  assert.equal(
    bilibiliSubtitleUrl("//aisubtitle.hdslb.com/bfs/subtitle/example.json?auth_key=test"),
    "https://aisubtitle.hdslb.com/bfs/subtitle/example.json?auth_key=test",
  );
  assert.throws(
    () => bilibiliSubtitleUrl("https://hdslb.com.example.org/subtitle.json"),
    /Bilibili/,
  );
  assert.equal(
    bilibiliSubtitleUrl("http://i0.hdslb.com/bfs/subtitle/example.json"),
    "https://i0.hdslb.com/bfs/subtitle/example.json",
  );
  assert.throws(() => bilibiliSubtitleUrl("https://s1.hdslb.com/subtitle.json"), /Bilibili/);

  const segments = parseBilibiliTranscript({
    body: [
      { from: 5.6, to: 6.733, content: " 手机版\n" },
      { from: 0.566, to: 5.366, content: "观看 b站视频时，如何打开 CC 字幕" },
      { from: 7, to: 6, content: "invalid" },
      { from: 8, to: 9, content: "  " },
      null,
    ],
  });
  assert.deepEqual(segments, [
    {
      id: "s0-566",
      startMs: 566,
      durationMs: 4800,
      text: "观看 b站视频时，如何打开 CC 字幕",
    },
    { id: "s1-5600", startMs: 5600, durationMs: 1133, text: "手机版" },
  ]);
});

test("Bilibili captions prefer a manual track in the source language", () => {
  const selected = selectCaptionTrack(
    [
      {
        baseUrl: "ai-zh",
        languageCode: "zh-Hans",
        name: "中文 AI 字幕",
        kind: "asr",
      },
      { baseUrl: "manual-zh", languageCode: "zh-Hans", name: "中文（简体）" },
      { baseUrl: "manual-en", languageCode: "en-US", name: "English" },
    ],
    "zh",
  );
  assert.equal(selected?.baseUrl, "manual-zh");
});

test("parseBilibiliText reports empty and malformed responses clearly", () => {
  assert.throws(() => parseBilibiliText(" \n"), /空响应/);
  assert.throws(() => parseBilibiliText("not json"), /无法解析/);
  assert.deepEqual(parseBilibiliText('{"body":[]}'), { body: [] });
});

test("formatTimecode supports videos longer than one hour", () => {
  assert.equal(formatTimecode(62_000), "01:02");
  assert.equal(formatTimecode(3_661_000), "1:01:01");
});
