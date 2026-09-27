import { formatTimecode } from "./transcript";
import type { SummaryBlock, VideoOverview } from "./types";

function text<K extends keyof HTMLElementTagNameMap>(tag: K, value: string, className = "") {
  const node = document.createElement(tag);
  node.textContent = value;
  node.className = className;
  return node;
}

export function createSummaryView(
  overview: VideoOverview,
  chapters: SummaryBlock[],
  openOutline: () => void,
  seek: (seconds: number) => void,
): HTMLElement {
  const view = text("section", "", "reading-view");
  const seekButton = (chapter: SummaryBlock) => {
    const button = text(
      "button",
      `${formatTimecode(chapter.startMs)} · ${chapter.content.title}`,
      "chapter-seek",
    );
    button.type = "button";
    button.setAttribute(
      "aria-label",
      `播放 ${formatTimecode(chapter.startMs)} ${chapter.content.title}`,
    );
    button.addEventListener("click", () => seek(chapter.startMs / 1000));
    return button;
  };

  const lead = text("section", "", "summary-lead");
  lead.append(text("h2", "全片结论"), text("p", overview.summary));
  const outline = text("button", "查看全文架构图", "outline-button");
  outline.type = "button";
  outline.addEventListener("click", openOutline);
  lead.append(
    outline,
    text("p", `${chapters.length} 个章节 · 中心主题 → 章节 → 子主题`, "outline-caption"),
  );
  view.append(lead);

  const full = text("details", "", "full-summary");
  full.append(text("summary", `查看完整摘要与 ${chapters.length} 个章节`));
  const whole = text("details", "", "whole-summary");
  whole.append(text("summary", "全文要点"), text("p", overview.summary));
  const points = text("ul", "");
  for (const point of overview.keyPoints) points.append(text("li", point));
  whole.append(points);
  full.append(whole);
  for (const chapter of chapters) {
    const card = text("details", "", "chapter-detail");
    card.dataset.chapterId = chapter.id;
    const heading = text("summary", "");
    heading.append(
      text("span", formatTimecode(chapter.startMs), "chapter-time"),
      text("span", chapter.content.title),
    );
    const body = text("div", "", "chapter-body");
    body.append(text("p", chapter.content.summary));
    const list = text("ul", "");
    for (const point of chapter.content.keyPoints) list.append(text("li", point));
    body.append(list, seekButton(chapter));
    card.append(heading, body);
    full.append(card);
  }
  view.append(full);
  return view;
}

export function followVisibleChapter(card: HTMLElement | null, enabled: boolean): void {
  if (enabled && card?.closest<HTMLDetailsElement>(".full-summary")?.open)
    card.scrollIntoView({ behavior: "smooth", block: "center" });
}
