import { createOutlinePreview } from "./outline-preview";
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
  videoTitle: string,
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
  view.append(lead);
  const contributions = text("section", "", "contributions");
  contributions.append(text("h2", "主要贡献"));
  if (!overview.contributions) {
    contributions.append(
      text("p", "这份历史摘要尚未提炼主要贡献，点击顶部“重新处理”即可生成。", "contribution-empty"),
    );
  } else if (overview.contributions.items.length === 0) {
    contributions.append(text("p", overview.contributions.emptyReason, "contribution-empty"));
  } else {
    const list = text("ol", "", "contribution-list");
    for (const item of overview.contributions.items) {
      const entry = text("li", "", "contribution-item");
      entry.append(
        text("h3", item.title),
        text("p", item.problem, "contribution-problem"),
        text("p", item.value, "contribution-value"),
      );
      if (item.boundary) {
        const boundary = text("details", "", "contribution-boundary");
        boundary.append(text("summary", "适用边界"), text("p", item.boundary));
        entry.append(boundary);
      }
      const sources = text("div", "", "contribution-sources");
      for (const evidence of item.evidence) {
        const source = text(
          "button",
          `回看 ${formatTimecode(evidence.startMs)}`,
          "contribution-source",
        );
        source.type = "button";
        source.addEventListener("click", () => seek(evidence.startMs / 1000));
        sources.append(source);
      }
      entry.append(sources);
      list.append(entry);
    }
    contributions.append(list);
  }
  view.append(contributions);
  const optionalOutline = text("details", "", "optional-outline");
  optionalOutline.append(
    text("summary", "章节大纲图（可选）"),
    createOutlinePreview(videoTitle, chapters),
  );
  const outline = text("button", "在独立页面打开 / 导出", "outline-button");
  outline.type = "button";
  outline.addEventListener("click", openOutline);
  optionalOutline.append(outline);
  view.append(optionalOutline);

  const full = text("details", "", "full-summary");
  full.open = true;
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
