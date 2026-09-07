import assert from "node:assert/strict";
import test from "node:test";
import { type CompletionProgress, CompletionStream } from "../src/lib/completion-stream";
import { DEFAULT_SETTINGS } from "../src/lib/settings";
import { generateVideoSummary } from "../src/lib/summary-service";

const summary = {
  overview: { summary: "完整概要", keyPoints: ["全片重点"] },
  chapters: [{ startSegmentId: "s0", title: "第一章", summary: "章节概要", keyPoints: [] }],
};
const segments = [{ id: "s0", startMs: 0, durationMs: 10000, text: "Transcript." }];
const encoder = new TextEncoder();
const delta = (value: Record<string, unknown>, finish: string | null = null) =>
  `data: ${JSON.stringify({ choices: [{ index: 0, delta: value, finish_reason: finish }] })}\r\n\r\n`;
const done =
  delta({}, "stop") +
  'data: {"choices":[],"usage":{"prompt_tokens":25000,"completion_tokens":7000}}\n\ndata: [DONE]\n\n';
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test("SSE parsing handles byte-split frames, comments, reasoning and actual usage", () => {
  const progress: CompletionProgress[] = [];
  const parser = new CompletionStream((value) => progress.push(value));
  const data = encoder.encode(
    ": keep-alive\r\n\r\n" +
      delta({ reasoning_content: "不显示的思考内容" }) +
      delta({ content: JSON.stringify(summary) }) +
      done,
  );
  const decoder = new TextDecoder();
  for (const byte of data) parser.push(decoder.decode(Uint8Array.of(byte), { stream: true }));
  parser.push(decoder.decode());
  const result = parser.finish();
  assert.deepEqual(JSON.parse(result.content), summary);
  assert.deepEqual(result.usage, { inputTokens: 25000, outputTokens: 7000 });
  assert.equal(progress[0]?.phase, "thinking");
  assert.equal(progress.at(-1)?.phase, "writing");
  assert.doesNotMatch(JSON.stringify(result), /不显示的思考内容/);
});

test("truncated and incomplete streams cannot become a valid cached summary", () => {
  const incomplete = new CompletionStream();
  incomplete.push(delta({ content: JSON.stringify(summary) }));
  assert.throws(() => incomplete.finish(), /完成前中断/);
  const truncated = new CompletionStream();
  truncated.push(`${delta({ content: JSON.stringify(summary) }, "length")}data: [DONE]\n\n`);
  assert.throws(() => truncated.finish(), /finish_reason=length/);
});

test("the reported 656-segment / 91353-character size completes beyond 120 seconds while receiving data", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
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
  let source: ReadableStreamDefaultController<Uint8Array> | undefined;
  let cancelled = false;
  const progress: CompletionProgress[] = [];
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    assert.equal(body.stream, true);
    assert.deepEqual(body.stream_options, { include_usage: true });
    assert.equal(body.max_tokens, undefined);
    assert.equal(JSON.parse(body.messages[1].content).transcript.length, 656);
    assert.equal(
      JSON.parse(body.messages[1].content).transcript.reduce(
        (sum: number, segment: { text: string }) => sum + segment.text.length,
        0,
      ),
      91353,
    );
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          source = controller;
        },
        cancel() {
          cancelled = true;
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    );
  });
  const promise = generateVideoSummary(DEFAULT_SETTINGS, input, "LdIyXiq2DTY size fixture", {
    onProgress: (value) => progress.push(value),
  });
  await flush();
  assert.ok(source);
  // These times are virtual; only documented keep-alive bytes arrive before inference.
  t.mock.timers.tick(90_000);
  source.enqueue(encoder.encode(": keep-alive\n\n"));
  await flush();
  t.mock.timers.tick(90_000);
  source.enqueue(encoder.encode(delta({ reasoning_content: "thinking" })));
  await flush();
  t.mock.timers.tick(90_000);
  source.enqueue(encoder.encode(delta({ content: JSON.stringify(summary) }) + done));
  // A final [DONE] must finish even if the HTTP connection stays open.
  const result = await promise;
  assert.deepEqual(result.overview, summary.overview);
  assert.deepEqual(result.usage, { inputTokens: 25000, outputTokens: 7000 });
  assert.equal(cancelled, true);
  assert.ok(progress.some((value) => value.phase === "thinking"));
});

test("120 seconds without response bytes still aborts the request", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal: AbortSignal | undefined;
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    signal = init.signal ?? undefined;
    return new Response(new ReadableStream(), { headers: { "content-type": "text/event-stream" } });
  });
  const result = generateVideoSummary(DEFAULT_SETTINGS, segments, "Fixture");
  const rejected = assert.rejects(result, /连续 120 秒没有返回数据/);
  await flush();
  t.mock.timers.tick(120_000);
  await rejected;
  assert.equal(signal?.aborted, true);
});

test("keep-alives cannot prolong the task past the 10-minute total deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let source: ReadableStreamDefaultController<Uint8Array> | undefined;
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            source = controller;
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      ),
  );
  const result = generateVideoSummary(DEFAULT_SETTINGS, segments, "Fixture");
  const rejected = assert.rejects(result, /10 分钟总时限/);
  await flush();
  assert.ok(source);
  for (let index = 0; index < 6; index++) {
    t.mock.timers.tick(90_000);
    source.enqueue(encoder.encode(": keep-alive\n\n"));
    await flush();
  }
  t.mock.timers.tick(60_000);
  await rejected;
});

test("other providers retain their non-streaming request compatibility", async (t) => {
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    assert.equal(JSON.parse(String(init.body)).stream, undefined);
    return new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify(summary) } }] }),
    );
  });
  const result = await generateVideoSummary(
    { ...DEFAULT_SETTINGS, provider: "custom" },
    segments,
    "Fixture",
  );
  assert.deepEqual(result.overview, summary.overview);
});
