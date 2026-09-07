import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import type { ProcessingFailure } from "../src/lib/processing-error";
import { DEFAULT_SETTINGS, SETTINGS_KEY } from "../src/lib/settings";

const bundled = build({
  entryPoints: ["src/background.ts"],
  bundle: true,
  write: false,
  format: "iife",
});
const segments = [{ id: "s0", startMs: 0, durationMs: 10_000, text: "Opening premise." }];
type Reply = { ok: boolean; error?: string; failure?: ProcessingFailure };

async function background(fetchResponse: typeof fetch) {
  let receive: (request: unknown, sender: unknown, respond: (reply: Reply) => void) => void =
    () => {};
  const timers = new Map<number, () => void>();
  const delays = new Map<number, number>();
  let timerId = 0;
  const listener = { addListener: () => {} };
  runInNewContext((await bundled).outputFiles[0]?.text ?? "", {
    URL,
    AbortController,
    DOMException,
    TextEncoder,
    TextDecoder,
    Error,
    console: { warn: () => {} },
    fetch: fetchResponse,
    setTimeout: (callback: () => void, delay: number) => {
      timers.set(++timerId, callback);
      delays.set(timerId, delay);
      return timerId;
    },
    clearTimeout: (id: number) => timers.delete(id),
    chrome: {
      runtime: {
        onInstalled: listener,
        onMessage: {
          addListener: (callback: typeof receive) => {
            receive = callback;
          },
        },
      },
      tabs: { onUpdated: listener },
      commands: { onCommand: listener },
      sidePanel: { setPanelBehavior: async () => {} },
      permissions: { contains: async () => true },
      storage: {
        local: {
          setAccessLevel: async () => {},
          get: async () => ({ [SETTINGS_KEY]: { ...DEFAULT_SETTINGS, apiKey: "secret-test-key" } }),
        },
      },
    },
  });
  return {
    generate: (input = segments) =>
      new Promise<Reply>((resolve) => {
        receive(
          {
            type: "GENERATE_SUMMARY",
            segments: input,
            targetLanguage: "zh-CN",
            videoTitle: "Fixture",
          },
          {},
          resolve,
        );
      }),
    expire: () => {
      for (const [id, callback] of timers) if (delays.get(id) === 120_000) callback();
    },
  };
}

test("background sends the provider status and redacted message across the runtime boundary", async () => {
  const app = await background(
    async () => new Response('{"error":{"message":"Limit for secret-test-key"}}', { status: 429 }),
  );
  const result = await app.generate();
  assert.equal(result.ok, false);
  assert.equal(result.failure?.stage, "provider");
  assert.equal(result.failure?.status, 429);
  assert.match(result.error ?? "", /HTTP 429/);
  assert.doesNotMatch(JSON.stringify(result), /secret-test-key/);
});

test("a stalled request still fails after 120 seconds without data", async () => {
  const app = await background(
    async (_request, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      }),
  );
  const result = app.generate();
  await new Promise<void>((resolve) => setImmediate(resolve));
  app.expire();
  const reply = await result;
  assert.equal(reply.failure?.stage, "provider");
  assert.match(reply.error ?? "", /连续 120 秒没有返回数据/);
});

test("oversized input is classified before any provider request", async () => {
  let called = false;
  const app = await background(async () => {
    called = true;
    return new Response();
  });
  const firstSegment = segments[0];
  assert.ok(firstSegment);
  const result = await app.generate(
    Array.from({ length: 2001 }, (_, index) => ({ ...firstSegment, id: `s${index}` })),
  );
  assert.equal(result.failure?.stage, "input");
  assert.equal(called, false);
});

test("invalid summaries remain response failures after the existing retry", async () => {
  let requests = 0;
  const app = await background(async () => {
    requests++;
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"chapters":[]}' } }] }));
  });
  const result = await app.generate();
  assert.equal(requests, 2);
  assert.equal(result.failure?.stage, "response");
  assert.match(result.error ?? "", /未返回全文要点/);
});
