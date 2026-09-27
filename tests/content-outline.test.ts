import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  isContentOutline,
  makeContentOutline,
  renderContentOutline,
  wrapOutlineText,
} from "../src/lib/content-outline";
import { OUTLINE_SESSION_PREFIX, openOutlinePage } from "../src/lib/outline-session";
import type { SummaryBlock } from "../src/lib/types";

const chapters: SummaryBlock[] = Array.from({ length: 16 }, (_, index) => ({
  id: `c${index}`,
  startMs: index * 60000,
  endMs: (index + 1) * 60000,
  content: {
    title: `章节${index + 1}`,
    summary: "完整摘要",
    keyPoints: [`子主题${index + 1}甲`, `条件${index + 1}乙`],
  },
}));

test("one document diagram retains all sixteen chapters and all subtopics", () => {
  const outline = makeContentOutline("全文中心主题", chapters);
  assert.ok(isContentOutline(outline));
  assert.equal(outline.chapters.length, 16);
  const graph = renderContentOutline(outline);
  assert.equal((graph.svg.match(/<svg /g) ?? []).length, 1);
  assert.ok(graph.width > 1000);
  assert.ok(graph.height > 0);
  assert.match(graph.svg, /全文中心主题/);
  for (const chapter of outline.chapters) {
    assert.ok(graph.svg.includes(chapter.title));
    for (const topic of chapter.topics) assert.ok(graph.svg.includes(topic));
  }
  assert.match(graph.svg, /所属关系，不表示因果/);
  assert.equal(outline.chapters[15]?.startMs, 900000);
});

test("long text wraps without truncation; empty topics do not invent content", () => {
  const long = "保留影响结论成立的重要条件".repeat(30);
  assert.equal(wrapOutlineText(long, 12).join(""), long);
  const first = chapters[0];
  assert.ok(first);
  const outline = makeContentOutline("标题", [
    { ...first, content: { title: "无子主题", summary: "不伪造", keyPoints: [] } },
  ]);
  const graph = renderContentOutline(outline);
  assert.match(graph.svg, /无子主题/);
  assert.doesNotMatch(graph.svg, /不伪造/);
  assert.equal(outline.chapters[0]?.topics.length, 0);
});

test("standalone SVG safely escapes every model-controlled string", () => {
  const value = '<script>alert("x")</script>&';
  const outline = {
    version: 1 as const,
    title: value,
    chapters: [{ title: value, startMs: 0, topics: [value] }],
  };
  const graph = renderContentOutline(outline);
  assert.doesNotMatch(graph.svg, /<script|<foreignObject|href=/);
  assert.match(graph.svg, /&lt;script&gt;/);
  assert.match(graph.svg, /xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  assert.doesNotMatch(graph.svg, /<image/);
});

test("outline data rejects incomplete session snapshots", () => {
  for (const value of [
    undefined,
    {},
    { version: 1, title: "T", chapters: [] },
    { version: 1, title: "T", chapters: [{ title: "C", startMs: -1, topics: [] }] },
    { version: 1, title: "T", chapters: [{ title: "C", startMs: 0, topics: [null] }] },
  ])
    assert.equal(isContentOutline(value), false);
});

test("opening the outline transfers only document content and uses an isolated extension tab", async (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "chrome");
  const stored: Record<string, unknown> = {};
  const opened: string[] = [];
  let failTab = false;
  Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    value: {
      runtime: { getURL: (path: string) => `chrome-extension://test/${path}` },
      storage: {
        session: {
          set: async (value: Record<string, unknown>) => Object.assign(stored, value),
          remove: async (key: string) => {
            delete stored[key];
          },
        },
      },
      tabs: {
        create: async ({ url }: { url: string }) => {
          if (failTab) throw new Error("tab failed");
          opened.push(url);
        },
      },
    },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "chrome", original);
    else Reflect.deleteProperty(globalThis, "chrome");
  });
  await openOutlinePage("Video", chapters);
  await openOutlinePage("Another video", chapters.slice(0, 1));
  assert.equal(Object.keys(stored).length, 2);
  const firstId = new URL(opened[0] ?? "").searchParams.get("id");
  const data = stored[`${OUTLINE_SESSION_PREFIX}${firstId}`];
  assert.deepEqual(data, makeContentOutline("Video", chapters));
  assert.doesNotMatch(JSON.stringify(data), /apiKey|transcript|完整摘要/);
  assert.notEqual(opened[0], opened[1]);
  failTab = true;
  await assert.rejects(openOutlinePage("Failed", chapters), /tab failed/);
  assert.equal(Object.keys(stored).length, 2);
});

test("the built standalone viewer has its own entry point and no remote renderer", async () => {
  const build = await readFile("scripts/build.mjs", "utf8");
  const html = await readFile("public/outline.html", "utf8");
  assert.match(build, /src\/outline\.ts/);
  assert.match(html, /src="outline\.js"/);
  for (const id of ["canvas", "fit", "actualSize", "zoomIn", "zoomOut", "exportSvg", "outlineText"])
    assert.match(html, new RegExp(`id="${id}"`));
  assert.doesNotMatch(html, /https?:\/\//);
});
