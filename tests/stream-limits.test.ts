import assert from "node:assert/strict";
import test from "node:test";
import { type CompletionProgress, CompletionStream } from "../src/lib/completion-stream";
import { processingFailure } from "../src/lib/processing-error";
import { DEFAULT_SETTINGS } from "../src/lib/settings";
import { generateVideoSummary } from "../src/lib/summary-service";

const twoMiB = 2 * 1024 * 1024;
const encoder = new TextEncoder();
const summary = {
  overview: { summary: "概要正文", keyPoints: ["重点"] },
  chapters: [{ startSegmentId: "s0", title: "开场", summary: "章节正文", keyPoints: [] }],
};
const segments = [{ id: "s0", startMs: 0, durationMs: 10000, text: "Transcript fixture." }];
const frame = (value: Record<string, unknown>, finish: string | null = null) =>
  `data: ${JSON.stringify({
    id: "016a53bf-55a2-4373-80c0-66e21ad08f37",
    object: "chat.completion.chunk",
    created: 1788757984,
    model: "deepseek-v4-flash",
    system_fingerprint: "stream-limits-fixture",
    choices: [{ index: 0, delta: value, logprobs: null, finish_reason: finish }],
    usage: null,
  })}\n\n`;
const end = `${frame({}, "stop")}data: [DONE]\n\n`;

for (const chunkSize of [65536, Number.MAX_SAFE_INTEGER]) {
  test(`26686 reasoning characters in many small events survive over 2 MiB of transport (chunk size ${chunkSize})`, async (t) => {
    const events: string[] = [];
    for (let index = 0; index < 26686; index += 3) {
      events.push(frame({ reasoning_content: "r".repeat(Math.min(3, 26686 - index)) }));
    }
    events.push(frame({ content: JSON.stringify(summary) }), end);
    const wire = encoder.encode(events.join(""));
    assert.ok(wire.byteLength > twoMiB);
    let offset = 0;
    let latest: CompletionProgress | undefined;
    t.mock.method(
      globalThis,
      "fetch",
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              if (offset === wire.byteLength) {
                controller.close();
                return;
              }
              const next = Math.min(wire.byteLength, offset + chunkSize);
              controller.enqueue(wire.subarray(offset, next));
              offset = next;
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        ),
    );
    const input = Array.from({ length: 656 }, (_, index) => ({
      id: `s${index}`,
      startMs: index * 10000,
      durationMs: 10000,
      text: "x".repeat(index === 655 ? 308 : 139),
    }));
    assert.equal(
      input.reduce((sum, segment) => sum + segment.text.length, 0),
      91353,
    );
    const result = await generateVideoSummary(DEFAULT_SETTINGS, input, "LdIyXiq2DTY size fixture", {
      onProgress(value) {
        latest = value;
      },
    });
    assert.deepEqual(result.overview, summary.overview);
    assert.equal(latest?.reasoningCharacters, 26686);
    assert.doesNotMatch(JSON.stringify(result), /reasoning_content|rrrr/);
  });
}

test("an oversized unfinished event is bounded and cancels the reader", async (t) => {
  let cancelled = false;
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(`data: ${"x".repeat(twoMiB)}`));
          },
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      ),
  );
  await assert.rejects(
    generateVideoSummary(DEFAULT_SETTINGS, segments, "Fixture"),
    (error: unknown) => {
      const failure = processingFailure(error, "provider");
      assert.match(failure.message, /单条流式事件.*2 MiB/);
      assert.equal(failure.stage, "receive");
      assert.doesNotMatch(failure.hint, /不符合概要格式/);
      return true;
    },
  );
  assert.equal(cancelled, true);
});

test("multi-line events cannot accumulate unbounded pending data", () => {
  const parser = new CompletionStream();
  assert.throws(() => {
    for (let index = 0; index < 33; index++) parser.push(`data: ${"x".repeat(65536)}\n`);
  }, /单条流式事件.*2 MiB/);
});

test("the retained summary limit uses UTF-8 bytes across separate events", () => {
  const parser = new CompletionStream();
  const text = "中".repeat(32768);
  assert.throws(() => {
    for (let index = 0; index < 22; index++) parser.push(frame({ content: text }));
  }, /概要正文.*2 MiB/);
});

test("discarded reasoning does not consume the retained summary budget", () => {
  const parser = new CompletionStream();
  for (let index = 0; index < 40; index++)
    parser.push(frame({ reasoning_content: "x".repeat(65536) }));
  parser.push(frame({ content: JSON.stringify(summary) }) + end);
  assert.deepEqual(JSON.parse(parser.finish().content), summary);
});

test("non-streaming responses retain the bounded body check with a receiving-stage error", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("x".repeat(twoMiB + 1)));
  await assert.rejects(
    generateVideoSummary(DEFAULT_SETTINGS, segments, "Fixture"),
    (error: unknown) => {
      const failure = processingFailure(error, "provider");
      assert.equal(failure.stage, "receive");
      assert.match(failure.message, /非流式响应.*2 MiB/);
      return true;
    },
  );
});
