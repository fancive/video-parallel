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
test("contributions and chapters remain visible without a chapter outline", (t) => {
  installDocument(t);
  const seeks: number[] = [];
  const view = createSummaryView(
    {
      summary: "完整概览",
      keyPoints: ["要点"],
      contributions: {
        items: [
          {
            title: "工程分工方法",
            problem: "重复维护信息",
            value: "统一信息供给",
            boundary: "依赖来源质量",
            evidence: [{ segmentId: "s1", startMs: 42000 }],
          },
        ],
        emptyReason: "",
      },
    },
    chapters,
    (time) => seeks.push(time),
  ) as unknown as Element;
  assert.ok(
    view
      .all()
      .filter((node) => node.tag === "details" && node.className !== "full-summary")
      .every((node) => !node.open),
  );
  assert.equal(view.all().find((node) => node.className === "full-summary")?.open, true);
  assert.equal(
    view.all().some((node) => node.className.includes("outline")),
    false,
  );
  const section = view.all().find((node) => node.className === "contributions");
  assert.ok(section);
  assert.equal(
    section.all().some((node) => node.tag === "details" || node.hidden),
    false,
  );
  assert.ok(section.all().some((node) => node.textContent === "依赖来源质量"));
  assert.ok(section.all().some((node) => node.textContent === "工程分工方法"));
  assert.equal(
    section.all().some((node) => node.textContent === "章节 0"),
    false,
  );

  assert.equal(view.all().filter((node) => node.className === "node-button").length, 0);
  assert.equal(
    view.all().some((node) => node.tag === "img" || node.tag === "dialog"),
    false,
  );
  const links = view.all().filter((node) => node.className === "chapter-seek");
  assert.equal(links.length, 16);
  links[15]?.click();
  assert.deepEqual(seeks, [900]);
  section
    .all()
    .find((node) => node.className === "contribution-source")
    ?.click();
  assert.deepEqual(seeks, [900, 42]);
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
