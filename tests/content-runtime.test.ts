import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";

class Element {
  id = "";
  textContent = "";
  title = "";
  dataset: Record<string, string> = {};
  children: Element[] = [];
  parentElement: Element | null = null;
  attributes = new Map<string, string>();
  listeners = new Map<string, () => void>();
  append(...nodes: Element[]) {
    for (const node of nodes) this.appendChild(node);
  }
  appendChild(node: Element) {
    node.parentElement = this;
    this.children.push(node);
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  addEventListener(name: string, listener: () => void) {
    this.listeners.set(name, listener);
  }
  remove() {
    if (this.parentElement)
      this.parentElement.children = this.parentElement.children.filter((node) => node !== this);
  }
  click() {
    this.listeners.get("click")?.();
  }
}

const bundle = build({
  entryPoints: ["src/content.ts"],
  bundle: true,
  write: false,
  format: "iife",
});
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
async function content(initialFailure = false) {
  const toolbar = new Element();
  const head = new Element();
  let failure: "none" | "sync" | "async" | "provider" = initialFailure ? "sync" : "none";
  let reloads = 0;
  const calls: string[] = [];
  let reconcile = () => {};
  runInNewContext((await bundle).outputFiles[0]?.text ?? "", {
    URL,
    Error,
    location: { href: "https://www.youtube.com/watch?v=yw_QhowlZ2g", reload: () => reloads++ },
    document: {
      head,
      documentElement: new Element(),
      createElement: () => new Element(),
      querySelector: () => toolbar,
      getElementById: (id: string) =>
        [...toolbar.children, ...head.children].find((node) => node.id === id) ?? null,
      addEventListener: (_name: string, listener: () => void) => {
        reconcile = listener;
      },
    },
    window: {
      clearTimeout() {},
      setTimeout(callback: () => void) {
        queueMicrotask(callback);
        return 1;
      },
      setInterval() {},
    },
    MutationObserver: class {
      observe() {}
    },
    chrome: {
      runtime: {
        sendMessage(message: { type: string }) {
          calls.push(message.type);
          if (failure === "sync") throw new Error("Extension context invalidated.");
          if (failure === "async")
            return Promise.reject(new Error("Extension context invalidated."));
          if (failure === "provider")
            return Promise.resolve({ ok: false, error: "Could not open panel" });
          return Promise.resolve({ ok: true });
        },
      },
    },
  });
  await flush();
  return {
    toolbar,
    calls,
    reconcile,
    reloads: () => reloads,
    fail: (value: typeof failure) => {
      failure = value;
    },
  };
}

for (const mode of ["sync", "async"] as const) {
  test(`a ${mode} invalidated extension context offers explicit refresh without an uncaught error`, async () => {
    const app = await content();
    const button = app.toolbar.children[0];
    assert.ok(button);
    app.fail(mode);
    button.click();
    assert.equal(app.calls.at(-1), "OPEN_PANEL");
    await flush();
    assert.equal(button.attributes.get("aria-label"), "扩展已更新，点击刷新页面");
    assert.equal(app.reloads(), 0);
    const calls = app.calls.length;
    button.click();
    assert.equal(app.reloads(), 1);
    assert.equal(app.calls.length, calls);
  });
}

test("a normal open failure remains retryable without refreshing the video", async () => {
  const app = await content();
  const button = app.toolbar.children[0];
  assert.ok(button);
  app.fail("provider");
  button.click();
  await flush();
  assert.equal(button.title, "Could not open panel");
  app.fail("none");
  button.click();
  await flush();
  assert.equal(button.attributes.get("aria-label"), "在 video-parallel 中查看章节概要");
  assert.equal(app.reloads(), 0);
});

test("synchronous preparation failures are caught and later reconciliation can recover", async () => {
  const app = await content(true);
  assert.equal(app.toolbar.children.length, 0);
  app.fail("none");
  app.reconcile();
  await flush();
  assert.equal(app.toolbar.children.length, 1);
});
