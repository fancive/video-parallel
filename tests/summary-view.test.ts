import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createSummaryView, followVisibleChapter } from "../src/lib/summary-view";
import type { SummaryBlock, VisualSummary } from "../src/lib/types";

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
const visual: VisualSummary = {
  kind: "argument",
  conclusion: "简短结论",
  focus: "观点关系",
  nodes: [
    {
      label: "<img src=x onerror=alert(1)>",
      relation: "依据",
      detail: "详细解释",
      chapterStartIds: ["s0", "s15"],
    },
    { label: "不要遗漏条件", relation: "条件", detail: "限制说明", chapterStartIds: ["s2"] },
  ],
};

test("sixteen chapters stay collapsed; nodes expand without seeking and link to multiple chapters", (t) => {
  installDocument(t);
  const seeks: number[] = [];
  const view = createSummaryView(
    { summary: "完整概览", keyPoints: ["要点"] },
    chapters,
    visual,
    chapters.map((_, index) => `s${index}`),
    (time) => seeks.push(time),
  ) as unknown as Element;
  assert.ok(
    view
      .all()
      .filter((node) => node.tag === "details")
      .every((node) => !node.open),
  );
  const buttons = view.all().filter((node) => node.className === "node-button");
  const detail = view.all().find((node) => node.className === "node-detail");
  assert.ok(detail?.hidden);
  buttons[0]?.click();
  assert.equal(detail.hidden, false);
  assert.deepEqual(seeks, []);
  assert.ok(buttons[0]?.all().some((node) => node.textContent === visual.nodes[0]?.label));
  const links = detail.all().filter((node) => node.className === "chapter-seek");
  assert.equal(links.length, 2);
  links[1]?.click();
  assert.deepEqual(seeks, [900]);
  buttons[1]?.click();
  assert.equal(buttons[0]?.attributes.get("aria-expanded"), "false");
  assert.ok(detail.all().some((node) => node.textContent === "限制说明"));
  detail
    .all()
    .find((node) => node.className === "detail-dismiss")
    ?.click();
  assert.ok(detail.hidden);
  assert.ok(buttons[1]?.focused);
});

test("legacy content is explicitly labeled and remains collapsed", (t) => {
  installDocument(t);
  const view = createSummaryView(
    { summary: "Old", keyPoints: ["Point"] },
    chapters,
    null,
    [],
    () => {},
  ) as unknown as Element;
  assert.ok(view.all().some((node) => /旧版摘要/.test(node.textContent)));
  assert.equal(view.all().filter((node) => node.className === "node-button").length, 0);
  assert.ok(
    view
      .all()
      .filter((node) => node.tag === "details")
      .every((node) => !node.open),
  );
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
