import assert from "node:assert/strict";
import test from "node:test";
import {
  BILIBILI_CAPTION_SOURCE_VERSION,
  BILIBILI_PLAYER_API_URL,
  bilibiliCaptionSourceKey,
  detectVideoPage,
  summaryCacheStorageKey,
} from "../src/lib/video-source";

test("detectVideoPage recognizes canonical YouTube and Bilibili video pages", () => {
  assert.deepEqual(detectVideoPage("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42"), {
    platform: "youtube",
    videoId: "dQw4w9WgXcQ",
    pageNumber: 1,
    sourceKey: "youtube:dQw4w9WgXcQ",
    sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  });
  assert.deepEqual(
    detectVideoPage("https://www.bilibili.com/video/BV16e4y1s7GS/?p=2&vd_source=ignored"),
    {
      platform: "bilibili",
      videoId: "BV16e4y1s7GS",
      pageNumber: 2,
      sourceKey: "bilibili:BV16e4y1s7GS:p2",
      sourceUrl: "https://www.bilibili.com/video/BV16e4y1s7GS/?p=2",
    },
  );
});

test("detectVideoPage rejects unsupported page shapes and lookalike hosts", () => {
  const rejected = [
    "http://www.bilibili.com/video/BV16e4y1s7GS/",
    "https://www.bilibili.com/bangumi/play/ep123",
    "https://live.bilibili.com/123",
    "https://www.bilibili.com/video/av647750991/",
    "https://www.bilibili.com/video/BV16e4y1s7GS/not-a-video-page",
    "https://www.bilibili.com.example.org/video/BV16e4y1s7GS/",
    "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    "https://youtube.com/watch?v=dQw4w9WgXcQ",
  ];
  for (const url of rejected) assert.equal(detectVideoPage(url), null, url);
});

test("summary cache keys isolate platforms and Bilibili parts", () => {
  const key = (sourceKey: string) =>
    summaryCacheStorageKey({ videoId: "same-id", sourceKey }, "zh-CN", "provider:model", 5);
  assert.notEqual(key("youtube:same-id"), key("bilibili:same-id:cid101"));
  assert.notEqual(key("bilibili:same-id:cid101"), key("bilibili:same-id:cid202"));
  assert.equal(key("bilibili:same-id:cid202"), key("bilibili:same-id:cid202"));
});

test("Bilibili caption identity binds the WBI pipeline, CID, and subtitle track", () => {
  assert.equal(BILIBILI_PLAYER_API_URL, "https://api.bilibili.com/x/player/wbi/v2");
  assert.equal(BILIBILI_CAPTION_SOURCE_VERSION, 2);
  assert.equal(
    bilibiliCaptionSourceKey("BV1t1t36JE7c", "41491499454", "2098035209181748480"),
    "bilibili:v2:BV1t1t36JE7c:cid41491499454:track2098035209181748480",
  );
  assert.notEqual(
    bilibiliCaptionSourceKey("BV1t1t36JE7c", "41491499454", "2098035209181748480"),
    "bilibili:BV1t1t36JE7c:cid41491499454",
  );
  assert.notEqual(
    bilibiliCaptionSourceKey("BV1t1t36JE7c", "41491499454", "2098035209181748480"),
    bilibiliCaptionSourceKey("BV1t1t36JE7c", "41491499454", "1594993089838253056"),
  );
  assert.match(bilibiliCaptionSourceKey("BV1t1t36JE7c", "41491499454", ""), /trackunknown$/);
  assert.throws(() => bilibiliCaptionSourceKey("not-a-bvid", "41491499454", "1"), /身份无效/);
  assert.throws(() => bilibiliCaptionSourceKey("BV1t1t36JE7c", "not-a-cid", "1"), /身份无效/);

  const pollutedCacheKey = summaryCacheStorageKey(
    {
      videoId: "BV1t1t36JE7c",
      sourceKey: "bilibili:BV1t1t36JE7c:cid41491499454",
    },
    "zh-CN",
    "provider:model",
    5,
  );
  const fixedCacheKey = summaryCacheStorageKey(
    {
      videoId: "BV1t1t36JE7c",
      sourceKey: bilibiliCaptionSourceKey("BV1t1t36JE7c", "41491499454", "2098035209181748480"),
    },
    "zh-CN",
    "provider:model",
    5,
  );
  assert.notEqual(fixedCacheKey, pollutedCacheKey);
});
