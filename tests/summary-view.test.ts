import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createSummaryView, followVisibleChapter } from "../src/lib/summary-view";
import type { SummaryBlock } from "../src/lib/types";

// Exercise rendering and handlers without a browser; layout is checked separately.
class Element {
  className = "";
  textContent = "";
  hidden = false;
  open = false;
  id = "";
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  children: Element[] = [];
  listeners = new Map<string, () => void>();
  focused = false;
  constructor(public tag: string) {}
  append(...children: Element[]) {
    this.children.push(...children);
  }
  replaceChildren(...children: Element[]) {
    this.children = children;
  }
  setAttribute(key: string, value: string) {
    this.attributes.set(key, value);
  }
  addEventListener(key: string, value: () => void) {
    this.listeners.set(key, value);
  }
  click() {
    this.listeners.get("click")?.();
  }
  showModal() {
    this.open = true;
  }
  close() {
    this.open = false;
    this.listeners.get("close")?.();
  }
  focus() {
    this.focused = true;
  }
  all(): Element[] {
    return [this, ...this.children.flatMap((child) => child.all())];
  }
}

function installDocument(t: TestContext) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { createElement: (tag: string) => new Element(tag) },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "document", original);
    else Reflect.deleteProperty(globalThis, "document");
  });
}

const chapters: SummaryBlock[] = Array.from({ length: 16 }, (_, index) => ({
  id: `c${index}`,
  startMs: index * 60000,
  endMs: (index + 1) * 60000,
  content: { title: `章节 ${index}`, summary: "完整细节", keyPoints: ["关键条件"] },
}));
test("the panel displays the full outline and enlarges it without seeking or opening a tab", (t) => {
  installDocument(t);
  const seeks: number[] = [];
  let opens = 0;
  const view = createSummaryView(
    { summary: "完整概览", keyPoints: ["要点"] },
    chapters,
    () => opens++,
    (time) => seeks.push(time),
    "视频主题",
  ) as unknown as Element;
  assert.ok(
    view
      .all()
      .filter((node) => node.tag === "details")
      .every((node) => !node.open),
  );
  assert.equal(view.all().filter((node) => node.className === "node-button").length, 0);
  const image = view.all().find((node) => node.tag === "img") as Element & { src: string };
  assert.ok(image);
  const svg = decodeURIComponent(image.src.split(",")[1] ?? "");
  assert.match(svg, /视频主题/);
  assert.match(svg, /章节 15/);
  assert.match(svg, /关键条件/);
  const preview = view.all().find((node) => node.className === "outline-preview-button");
  const dialog = view.all().find((node) => node.tag === "dialog");
  assert.ok(preview && dialog);
  assert.equal(dialog.open, false);
  preview.click();
  assert.equal(dialog.open, true);
  assert.equal(opens, 0);
  assert.deepEqual(seeks, []);
  const zoom = dialog.all().find((node) => node.tag === "output");
  assert.equal(zoom?.textContent, "100%");
  dialog
    .all()
    .find((node) => node.textContent === "放大")
    ?.click();
  assert.equal(zoom?.textContent, "125%");
  dialog
    .all()
    .find((node) => node.textContent === "关闭")
    ?.click();
  assert.equal(dialog.open, false);
  assert.equal(preview.focused, true);

  view
    .all()
    .find((node) => node.className === "outline-button")
    ?.click();
  assert.equal(opens, 1);
  assert.deepEqual(seeks, []);
  const links = view.all().filter((node) => node.className === "chapter-seek");
  assert.equal(links.length, 16);
  links[15]?.click();
  assert.deepEqual(seeks, [900]);
});

test("playback may scroll only when the complete chapter list is open", () => {
  let scrolls = 0;
  const container = { open: false };
  const card = {
    closest: () => container,
    scrollIntoView: () => scrolls++,
  } as unknown as HTMLElement;
  followVisibleChapter(card, true);
  assert.equal(scrolls, 0);
  container.open = true;
  followVisibleChapter(card, false);
  assert.equal(scrolls, 0);
  followVisibleChapter(card, true);
  assert.equal(scrolls, 1);
});
