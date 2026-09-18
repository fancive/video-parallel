import assert from "node:assert/strict";
import test from "node:test";
import { type CompletionProgress, formatCompletionProgress } from "../src/lib/completion-stream";
import { DEFAULT_SETTINGS } from "../src/lib/settings";
import { makeChapterBlocks } from "../src/lib/summary";
import { generateVideoSummary } from "../src/lib/summary-service";
import type { TranscriptSegment } from "../src/lib/types";

const reported = () =>
  Array.from({ length: 583 }, (_, index) => ({
    id: `s${index}`,
    startMs: index * 1000,
    durationMs: 1000,
    text: "文".repeat(index === 582 ? 304 : 181),
  }));
const response = (input: TranscriptSegment[], usage = true) =>
  new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              overview: { summary: "概要", keyPoints: ["重要限制"] },
              chapters: input.map((segment) => ({
                startSegmentId: segment.id,
                title: `主题 ${segment.id}`,
                summary: "有依据的概要",
                keyPoints: ["重要限制"],
              })),
            }),
          },
        },
      ],
      ...(usage ? { usage: { prompt_tokens: 10, completion_tokens: 5 } } : {}),
    }),
  );
const requestInput = (init: RequestInit): TranscriptSegment[] =>
  JSON.parse(JSON.parse(String(init.body)).messages[1].content).transcript;

test("583 segments / 105646 characters reach bounded requests without losing captions or timestamps", async (t) => {
  const input = reported();
  assert.equal(
    input.reduce((sum, segment) => sum + segment.text.length, 0),
    105646,
  );
  const requests: TranscriptSegment[][] = [];
  const progress: CompletionProgress[] = [];
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    const batch = requestInput(init);
    requests.push(batch);
    assert.ok(batch.length <= 2000);
    assert.ok(batch.reduce((sum, segment) => sum + segment.text.length, 0) <= 100000);
    if (requests.length === 3) {
      assert.match(JSON.parse(String(init.body)).messages[0].content, /ALL portions/);
      assert.ok(batch.every((segment) => segment.text.includes("重要限制")));
      return response(batch);
    }
    return response([batch[0] as TranscriptSegment]);
  });
  const result = await generateVideoSummary(DEFAULT_SETTINGS, input, "4DhcSPkEbwI size fixture", {
    onProgress: (value) => progress.push(value),
  });
  assert.equal(requests.length, 3);
  assert.deepEqual(
    requests.slice(0, 2).flat(),
    input.map(({ id, startMs, text }) => ({ id, startMs, text })),
  );
  assert.deepEqual(result.usage, { inputTokens: 30, outputTokens: 15 });
  const blocks = makeChapterBlocks(input, result.chapters);
  assert.equal(blocks[0]?.startMs, 0);
  assert.equal(blocks[1]?.startMs, requests[1]?.[0]?.startMs);
  assert.equal(blocks.at(-1)?.endMs, 583000);
  assert.ok(progress.some((value) => formatCompletionProgress(value).includes("分批处理 2/2")));
  assert.ok(progress.some((value) => formatCompletionProgress(value).includes("汇总全文")));
});

test("exact character limit keeps a single request; segment overflow uses synthesis", async (t) => {
  const requests: TranscriptSegment[][] = [];
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    const batch = requestInput(init);
    requests.push(batch);
    return response([batch[0] as TranscriptSegment]);
  });
  await generateVideoSummary(
    DEFAULT_SETTINGS,
    reported()
      .slice(0, 100)
      .map((s) => ({ ...s, text: "x".repeat(1000) })),
    "Exact limit",
  );
  assert.equal(requests.length, 1);
  requests.length = 0;
  const many = Array.from({ length: 2001 }, (_, index) => ({
    id: `s${index}`,
    startMs: index,
    durationMs: 1,
    text: "x",
  }));
  await generateVideoSummary(DEFAULT_SETTINGS, many, "Many captions");
  assert.deepEqual(
    requests.map((batch) => batch.length),
    [2000, 1, 2],
  );
});

test("missing usage in any batch hides incomplete totals", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) =>
    response([requestInput(init)[0] as TranscriptSegment], ++calls !== 2),
  );
  const result = await generateVideoSummary(DEFAULT_SETTINGS, reported(), "Fixture");
  assert.equal(calls, 3);
  assert.equal(result.usage, undefined);
});

test("invalid synthesis retries only synthesis and counts retry usage", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    if (++calls === 3) return response([{ id: "unknown", startMs: 0, durationMs: 1, text: "bad" }]);
    return response([requestInput(init)[0] as TranscriptSegment]);
  });
  const result = await generateVideoSummary(DEFAULT_SETTINGS, reported(), "Fixture");
  assert.equal(calls, 4);
  assert.deepEqual(result.usage, { inputTokens: 40, outputTokens: 20 });
});

test("the total deadline is shared across batches and synthesis", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    calls++;
    return response([requestInput(init)[0] as TranscriptSegment]);
  });
  await assert.rejects(
    generateVideoSummary(DEFAULT_SETTINGS, reported(), "Fixture", {
      onProgress: (progress) => {
        // Each request makes progress within the idle timeout, but all three
        // together reach the shared deadline.
        if (progress.phase === "connecting" || progress.phase === "waiting")
          t.mock.timers.tick(100000);
      },
    }),
    /10 分钟总时限/,
  );
  assert.equal(calls, 3);
});

test("a failed later batch never returns a partial video summary", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    if (++calls === 2) return new Response("{}", { status: 503 });
    return response([requestInput(init)[0] as TranscriptSegment]);
  });
  await assert.rejects(generateVideoSummary(DEFAULT_SETTINGS, reported(), "Fixture"), /503/);
  assert.equal(calls, 2);
});

test("cancellation between batches stops further model requests", async (t) => {
  const controller = new AbortController();
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    calls++;
    return response([requestInput(init)[0] as TranscriptSegment]);
  });
  await assert.rejects(
    generateVideoSummary(DEFAULT_SETTINGS, reported(), "Fixture", {
      signal: controller.signal,
      onProgress: (progress) => {
        if (progress.phase === "waiting") controller.abort(new Error("User cancelled"));
      },
    }),
    /User cancelled/,
  );
  assert.equal(calls, 1);
});

test("invalid input remains rejected before any provider call", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => response([]));
  for (const input of [
    [],
    [{ ...reported()[0], text: "x".repeat(3001) }],
    [reported()[0], reported()[0]],
  ]) {
    await assert.rejects(
      generateVideoSummary(DEFAULT_SETTINGS, input as TranscriptSegment[], "Invalid"),
    );
  }
  assert.equal(fetch.mock.callCount(), 0);
});
