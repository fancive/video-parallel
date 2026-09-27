import { formatTimecode } from "./transcript";
import type { SummaryBlock } from "./types";

export interface ContentOutline {
  version: 1;
  title: string;
  chapters: Array<{ title: string; startMs: number; topics: string[] }>;
}

export function makeContentOutline(title: string, chapters: SummaryBlock[]): ContentOutline {
  return {
    version: 1,
    title,
    chapters: chapters.map((chapter) => ({
      title: chapter.content.title,
      startMs: chapter.startMs,
      topics: [...chapter.content.keyPoints],
    })),
  };
}

export function isContentOutline(value: unknown): value is ContentOutline {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<ContentOutline>;
  return (
    data.version === 1 &&
    typeof data.title === "string" &&
    Boolean(data.title.trim()) &&
    Array.isArray(data.chapters) &&
    data.chapters.length > 0 &&
    data.chapters.every(
      (chapter) =>
        chapter &&
        typeof chapter.title === "string" &&
        Boolean(chapter.title.trim()) &&
        Number.isFinite(chapter.startMs) &&
        chapter.startMs >= 0 &&
        Array.isArray(chapter.topics) &&
        chapter.topics.every((topic) => typeof topic === "string"),
    )
  );
}

export function wrapOutlineText(value: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  let units = 0;
  for (const character of value.replace(/\s+/g, " ").trim()) {
    const weight = character.charCodeAt(0) <= 0x7f ? 0.58 : 1;
    if (units + weight > width && line) {
      const space = line.lastIndexOf(" ");
      if (space > line.length / 2) {
        lines.push(line.slice(0, space));
        line = line.slice(space + 1);
        units = [...line].reduce((sum, char) => sum + (char.charCodeAt(0) <= 0x7f ? 0.58 : 1), 0);
      } else {
        lines.push(line);
        line = "";
        units = 0;
      }
    }
    line += character;
    units += weight;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

export function escapeOutlineText(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char] ?? char,
  );
}

const COLORS = ["#2e5aac", "#087b72", "#8553a0", "#b26724"];
const WIDTH = 1620;
interface PlacedChapter {
  chapter: ContentOutline["chapters"][number];
  index: number;
  lines: string[];
  topics: Array<{ lines: string[]; height: number }>;
  height: number;
  boxHeight: number;
}

/** Deterministic two-sided tree; all chapters and every supplied topic are retained. */
export function renderContentOutline(data: ContentOutline): {
  svg: string;
  width: number;
  height: number;
} {
  const placed: PlacedChapter[] = data.chapters.map((chapter, index) => {
    const lines = wrapOutlineText(chapter.title, 13);
    const topics = chapter.topics.map((topic) => {
      const lines = wrapOutlineText(topic, 18);
      return { lines, height: Math.max(48, lines.length * 23 + 22) };
    });
    const boxHeight = lines.length * 25 + 45;
    return {
      chapter,
      index,
      lines,
      topics,
      boxHeight,
      height:
        Math.max(
          boxHeight,
          topics.reduce((sum, topic) => sum + topic.height, 0),
        ) + 38,
    };
  });
  // Chronological order runs down the left branch, then down the right branch.
  const split = Math.ceil(placed.length / 2);
  const sides = [placed.slice(0, split), placed.slice(split)];
  const rootLines = wrapOutlineText(data.title, 11);
  const rootHeight = rootLines.length * 29 + 44;
  const height = Math.max(
    460,
    rootHeight + 80,
    ...sides.map((side) => side.reduce((sum, item) => sum + item.height, 0) + 80),
  );
  const rootY = height / 2;
  const paths: string[] = [];
  const nodes: string[] = [];
  const label = (
    lines: string[],
    x: number,
    y: number,
    size: number,
    color: string,
    weight = 400,
  ) =>
    `<text x="${x}" y="${y}" fill="${color}" font-size="${size}" font-weight="${weight}">${lines.map((line, index) => `<tspan x="${x}" dy="${index ? size + 7 : 0}">${escapeOutlineText(line)}</tspan>`).join("")}</text>`;
  const connector = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: string,
    weight: number,
  ) => {
    const mid = (x1 + x2) / 2;
    paths.push(
      `<path d="M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}" fill="none" stroke="${color}" stroke-width="${weight}"/>`,
    );
  };
  sides.forEach((side, sideIndex) => {
    const left = sideIndex === 0;
    const chapterX = left ? 330 : 970;
    const leafX = left ? 20 : 1290;
    const total = side.reduce((sum, item) => sum + item.height, 0);
    let top = (height - total) / 2;
    for (const item of side) {
      const color = COLORS[item.index % COLORS.length] ?? COLORS[0] ?? "#2e5aac";
      const center = top + (item.height - 38) / 2;
      const boxTop = center - item.boxHeight / 2;
      connector(left ? 650 : 910, rootY, left ? chapterX + 260 : chapterX, center, color, 2.5);
      nodes.push(
        `<g><title>${escapeOutlineText(item.chapter.title)}</title><rect x="${chapterX}" y="${boxTop}" width="260" height="${item.boxHeight}" rx="8" fill="white" stroke="${color}" stroke-width="2"/>`,
      );
      nodes.push(
        label(
          [`${item.index + 1} · ${formatTimecode(item.chapter.startMs)}`],
          chapterX + 16,
          boxTop + 24,
          12,
          color,
          650,
        ),
      );
      nodes.push(label(item.lines, chapterX + 16, boxTop + 49, 18, "#203040", 600), "</g>");
      let leafTop = center - item.topics.reduce((sum, topic) => sum + topic.height, 0) / 2;
      for (const topic of item.topics) {
        const baseline = leafTop + topic.height - 10;
        connector(
          left ? chapterX : chapterX + 260,
          center,
          left ? leafX + 300 : leafX,
          baseline,
          color,
          1.4,
        );
        paths.push(
          `<path d="M${leafX},${baseline} H${leafX + 300}" stroke="${color}" stroke-width="1.2" opacity="0.55"/>`,
        );
        nodes.push(label(topic.lines, leafX + 8, leafTop + 20, 16, "#354b60"));
        leafTop += topic.height;
      }
      top += item.height;
    }
  });
  nodes.push(
    `<rect x="650" y="${rootY - rootHeight / 2}" width="260" height="${rootHeight}" rx="16" fill="#203f74"/>`,
  );
  nodes.push(label(rootLines, 670, rootY - rootHeight / 2 + 38, 22, "#ffffff", 650));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" role="img" aria-labelledby="outlineTitle outlineDescription"><title id="outlineTitle">${escapeOutlineText(data.title)} — 全文架构图</title><desc id="outlineDescription">中心主题连接全部 ${data.chapters.length} 个章节，每章连接其子主题。章节按编号阅读，先左后右。连线表示所属关系，不表示因果。</desc><rect width="100%" height="100%" fill="#ffffff"/><g font-family="system-ui, -apple-system, 'Segoe UI', sans-serif">${paths.join("")}${nodes.join("")}</g></svg>`;
  return { svg, width: WIDTH, height };
}
