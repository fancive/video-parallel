import { formatTimecode } from "./transcript";
import type { SummaryBlock, VideoOverview, VisualSummary } from "./types";

function text<K extends keyof HTMLElementTagNameMap>(tag: K, value: string, className = "") {
  const node = document.createElement(tag);
  node.textContent = value;
  node.className = className;
  return node;
}

export function createSummaryView(
  overview: VideoOverview,
  chapters: SummaryBlock[],
  visual: VisualSummary | null,
  chapterIds: string[],
  seek: (seconds: number) => void,
): HTMLElement {
  const view = text("section", "", "reading-view");
  const byId = new Map(chapterIds.map((id, index) => [id, chapters[index]]));
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

  if (visual) {
    const graphic = text("section", "", `visual-summary visual-${visual.kind}`);
    graphic.setAttribute("aria-label", "视频结构图");
    graphic.append(text("h2", visual.conclusion, "visual-conclusion"));
    graphic.append(text("p", visual.focus, "visual-focus"));
    const nodes = text(visual.kind === "flow" ? "ol" : "ul", "", "visual-nodes");
    const detail = text("section", "", "node-detail");
    detail.id = "visualNodeDetail";
    detail.hidden = true;
    detail.setAttribute("aria-label", "节点详情");
    const buttons: HTMLButtonElement[] = [];
    let selected = -1;
    const close = () => {
      detail.hidden = true;
      for (const button of buttons) button.setAttribute("aria-expanded", "false");
      selected = -1;
    };
    visual.nodes.forEach((node, index) => {
      const item = text("li", "", "visual-node");
      const button = text("button", "", "node-button");
      button.type = "button";
      button.setAttribute("aria-expanded", "false");
      button.setAttribute("aria-controls", detail.id);
      button.append(text("span", node.relation, "node-relation"), text("strong", node.label));
      buttons.push(button);
      button.addEventListener("click", () => {
        const wasSelected = selected === index;
        close();
        if (wasSelected) return;
        selected = index;
        button.setAttribute("aria-expanded", "true");
        const dismiss = text("button", "收起详情", "detail-dismiss");
        dismiss.type = "button";
        dismiss.addEventListener("click", () => {
          close();
          button.focus();
        });
        detail.replaceChildren(text("h3", node.label), text("p", node.detail));
        const sources = text("div", "", "node-sources");
        sources.append(text("span", "回到相关章节", "detail-caption"));
        for (const id of node.chapterStartIds) {
          const chapter = byId.get(id);
          if (chapter) sources.append(seekButton(chapter));
        }
        detail.append(sources, dismiss);
        detail.hidden = false;
      });
      item.append(button);
      nodes.append(item);
    });
    graphic.append(nodes, text("p", "点击节点，查看解释与相关片段", "visual-hint"), detail);
    view.append(graphic);
  } else {
    view.append(
      text("p", "这是旧版摘要。重新处理可生成结构图；原内容仍可展开和导出。", "legacy-notice"),
    );
  }

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
