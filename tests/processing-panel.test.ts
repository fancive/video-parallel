import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import { DEFAULT_SETTINGS, SETTINGS_KEY } from "../src/lib/settings";

// Execute the actual panel bundle with controlled Chrome messages and a minimal DOM.
// Live browser checks cover layout; these tests cover asynchronous failure/retry state.
class Element {
  textContent = "";
  hidden = false;
  disabled = false;
  open = false;
  className = "";
  dataset: Record<string, string> = {};
  children: Element[] = [];
  attributes = new Map<string, string>();
  listeners = new Map<string, () => void>();
  classes = new Set<string>();
  classList = {
    add: (name: string) => this.classes.add(name),
    remove: (name: string) => this.classes.delete(name),
    toggle: (name: string, enabled: boolean) =>
      enabled ? this.classes.add(name) : this.classes.delete(name),
  };
  addEventListener(name: string, listener: () => void) {
    this.listeners.set(name, listener);
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  hasAttribute(name: string) {
    return this.attributes.has(name);
  }
  querySelectorAll() {
    return [];
  }
  replaceChildren(...children: Element[]) {
    this.children = children;
  }
  append(...children: Element[]) {
    this.children.push(...children);
  }
  appendChild(child: Element) {
    this.children.push(child);
  }
  scrollIntoView() {}
  click() {
    this.listeners.get("click")?.();
  }
}

const bundled = build({
  entryPoints: ["src/sidepanel.ts"],
  bundle: true,
  write: false,
  format: "iife",
});
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const success = {
  ok: true,
  overview: { summary: "全文结论", keyPoints: ["全文重点"] },
  chapters: [{ startSegmentId: "s0", title: "第一章", summary: "章节内容", keyPoints: [] }],
};

async function panel() {
  const manifest = JSON.parse(await readFile("public/manifest.json", "utf8"));
  const elements = new Map<string, Element>();
  const html = await readFile("public/sidepanel.html", "utf8");
  for (const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
    const node = new Element();
    node.hidden = /\bhidden\b/.test(match[0]);
    elements.set(match[1] ?? "", node);
  }
  const node = (id: string) => {
    const element = elements.get(id);
    assert.ok(element, `Missing #${id}`);
    return element;
  };
  let reply: unknown = success;
  let providerSignal: AbortSignal | undefined;
  let loadReply: unknown;
  let loads = 0;
  let copied = "";
  let cacheFails = false;
  let stored: Record<string, unknown> = {
    [SETTINGS_KEY]: { ...DEFAULT_SETTINGS, apiKey: "private-test-key" },
  };
  let video = {
    tabId: 42,
    platform: "youtube",
    videoId: "Qr15lGAGKpo",
    sourceKey: "youtube:Qr15lGAGKpo",
    sourceUrl: "https://www.youtube.com/watch?v=Qr15lGAGKpo",
    title: "Test video",
    channel: "Test channel",
    sourceLanguage: "en",
    durationSeconds: 10,
    segments: [{ id: "s0", startMs: 0, durationMs: 10_000, text: "Private transcript text" }],
  };
  let tabUpdated: (id: number, info: { url: string }) => void = () => {};
  let storageChanged: (changes: Record<string, unknown>, area: string) => void = () => {};
  const timers = new Map<number, () => void>();
  let timerId = 0;
  const timer = (callback: () => void) => {
    timers.set(++timerId, callback);
    return timerId;
  };
  runInNewContext((await bundled).outputFiles[0]?.text ?? "", {
    URL,
    URLSearchParams,
    console,
    Date,
    Error,
    AbortController,
    DOMException,
    TextDecoder,
    TextEncoder,
    setTimeout,
    clearTimeout,
    fetch: async (_url: string, init: RequestInit) => {
      providerSignal = init.signal ?? undefined;
      const response = await new Promise<Record<string, unknown>>((resolve, reject) => {
        const abort = () => reject(init.signal?.reason);
        init.signal?.addEventListener("abort", abort, { once: true });
        if (init.signal?.aborted) abort();
        Promise.resolve(reply).then((value) => {
          init.signal?.removeEventListener("abort", abort);
          resolve(value as Record<string, unknown>);
        }, reject);
      });
      if (response.ok === false) {
        const failure = response.failure as { stage?: string; message?: string } | undefined;
        if (failure?.stage === "response")
          return new Response(
            JSON.stringify({ choices: [{ message: { content: '{"chapters":[]}' } }] }),
          );
        throw new Error(String(failure?.message ?? response.error));
      }
      return new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(response) } }] }),
      );
    },
    document: {
      getElementById: (id: string) => node(id),
      createElement: () => new Element(),
      addEventListener: () => {},
      documentElement: new Element(),
      hidden: true,
    },
    navigator: {
      clipboard: {
        writeText: async (text: string) => {
          copied = text;
        },
      },
    },
    window: {
      addEventListener: () => {},
      location: { search: "?tabId=42" },
      setInterval: timer,
      setTimeout: timer,
      clearInterval: (id: number) => timers.delete(id),
      clearTimeout: (id: number) => timers.delete(id),
    },
    chrome: {
      runtime: {
        id: "test-extension",
        getManifest: () => manifest,
        onMessage: { addListener: () => {} },
        sendMessage: async (message: { type: string }) => {
          if (message.type === "LOAD_VIDEO") {
            loads++;
            return await (loadReply ?? { ok: true, video });
          }
          if (message.type === "GENERATE_SUMMARY")
            throw new Error("Long requests must not use the background worker");
          return { ok: true, start: false };
        },
      },
      permissions: { contains: async () => true },
      tabs: {
        onUpdated: {
          addListener: (listener: typeof tabUpdated) => {
            tabUpdated = listener;
          },
        },
      },
      storage: {
        onChanged: {
          addListener: (listener: typeof storageChanged) => {
            storageChanged = listener;
          },
        },
        local: {
          get: async () => stored,
          set: async (value: Record<string, unknown>) => {
            if (cacheFails) throw new Error("QUOTA_BYTES exceeded");
            stored = { ...stored, ...value };
          },
        },
      },
    },
  });
  await flush();
  assert.equal(node("workspace").hidden, false, node("emptyMessage").textContent);
  return {
    node,
    providerSignal: () => providerSignal,
    copied: () => copied,
    timers: () => {
      for (const callback of [...timers.values()]) callback();
    },
    reply: (value: unknown) => {
      reply = value;
    },
    loadReply: (value: unknown) => {
      loadReply = value;
    },
    loads: () => loads,
    failCache: () => {
      cacheFails = true;
    },
    changeVideo: () => {
      video = { ...video, videoId: "different", sourceKey: "youtube:different" };
      tabUpdated(42, { url: "https://www.youtube.com/watch?v=different" });
    },
    changeModel: () => {
      const settings = {
        ...DEFAULT_SETTINGS,
        model: "different-model",
        apiKey: "private-test-key",
      };
      stored[SETTINGS_KEY] = settings;
      storageChanged({ [SETTINGS_KEY]: { newValue: settings } }, "local");
    },
    cacheCount: () => Object.keys(stored).filter((key) => key !== SETTINGS_KEY).length,
  };
}

test("timeout stays visible after toast expiry, copies safe details, and clears on successful retry", async () => {
  const app = await panel();
  app.reply({ ok: false, error: "AI 请求超过 120 秒，请重试。" });
  app.node("processButton").click();
  await flush();
  app.timers();
  assert.equal(app.node("processingError").hidden, false);
  assert.match(app.node("processingErrorMessage").textContent, /120 秒/);
  assert.match(app.node("processingErrorTitle").textContent, /请求模型/);
  assert.equal(app.node("processButtonLabel").textContent, "重试处理");
  app.node("copyErrorButton").click();
  await flush();
  app.timers();
  assert.equal(app.node("toast").hidden, true);
  assert.equal(app.node("processingError").hidden, false);
  assert.match(app.copied(), /Qr15lGAGKpo/);
  assert.match(app.copied(), /总耗时：/);
  assert.doesNotMatch(app.copied(), /private-test-key|Private transcript text/);

  app.reply(success);
  app.node("processButton").click();
  assert.equal(app.node("processingError").hidden, true);
  await flush();
  assert.equal(app.node("chapterCount").textContent, "1 章");
  assert.equal(app.cacheCount(), 1);
  assert.equal(app.node("processingError").hidden, true);

  app.reply({ ok: false, failure: { stage: "response", message: "AI 未返回全文要点。" } });
  app.node("processButton").click();
  await flush();
  assert.match(app.node("processingErrorTitle").textContent, /解析概要/);
  assert.equal(app.node("chapterCount").textContent, "1 章");
  assert.match(app.node("statusText").textContent, /上次概要仍保留/);
});

test("newly generated summary stays readable when cache storage fails", async () => {
  const app = await panel();
  app.failCache();
  app.node("processButton").click();
  await flush();
  assert.equal(app.node("chapterCount").textContent, "1 章");
  assert.match(app.node("processingErrorTitle").textContent, /保存概要/);
  assert.match(app.node("processingErrorHint").textContent, /复制或导出/);
});

test("a late failure cannot overwrite a newly loaded video", async () => {
  const app = await panel();
  let finish: (value: unknown) => void = () => {};
  app.reply(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  app.node("processButton").click();
  await flush();
  app.changeVideo();
  await flush();
  assert.equal(app.providerSignal()?.aborted, true);
  finish({ ok: false, error: "AI 请求超过 120 秒，请重试。" });
  await flush();
  assert.equal(app.node("processingError").hidden, true);
  assert.equal(app.node("statusText").textContent, "字幕已就绪");
});

test("cancel stops the provider request without displaying a processing failure", async () => {
  const app = await panel();
  app.reply(new Promise(() => {}));
  app.node("processButton").click();
  await flush();
  assert.equal(app.node("cancelButton").hidden, false);
  app.node("cancelButton").click();
  await flush();
  assert.equal(app.providerSignal()?.aborted, true);
  assert.equal(app.node("statusText").textContent, "已取消处理");
  assert.equal(app.node("processingError").hidden, true);
  assert.equal(app.node("cancelButton").hidden, true);
  assert.equal(app.node("processButton").disabled, false);
  assert.equal(app.cacheCount(), 0);
});

test("changing models during a request cannot save its result under the new model", async () => {
  const app = await panel();
  let finish: (value: unknown) => void = () => {};
  app.reply(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  app.node("processButton").click();
  await flush();
  app.changeModel();
  finish(success);
  await flush();
  assert.equal(app.cacheCount(), 0);
  assert.equal(app.node("statusText").textContent, "字幕已就绪");
  assert.equal(app.node("statusDot").classes.has("is-working"), false);
});

test("navigation during caption loading starts a fresh load and discards the earlier result", async () => {
  const app = await panel();
  let finish: (value: unknown) => void = () => {};
  app.loadReply(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  app.changeVideo();
  app.loadReply(undefined);
  app.changeVideo();
  await flush();
  assert.equal(app.loads(), 3);
  finish({ ok: false, error: "Earlier video caption failure" });
  await flush();
  assert.equal(app.node("workspace").hidden, false);
  assert.equal(app.node("statusText").textContent, "字幕已就绪");
});
