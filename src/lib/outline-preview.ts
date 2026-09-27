import { makeContentOutline, renderContentOutline } from "./content-outline";
import type { SummaryBlock } from "./types";

export function createOutlinePreview(title: string, chapters: SummaryBlock[]): HTMLElement {
  const graph = renderContentOutline(makeContentOutline(title, chapters));
  const source = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(graph.svg)}`;
  const section = document.createElement("section");
  section.className = "outline-preview";
  const heading = document.createElement("h2");
  heading.textContent = "全文架构图";
  const preview = document.createElement("button");
  preview.type = "button";
  preview.className = "outline-preview-button";
  preview.setAttribute("aria-label", "放大全文架构图");
  preview.setAttribute("aria-haspopup", "dialog");
  const image = document.createElement("img");
  image.src = source;
  image.alt = `${title}：中心主题 → ${chapters.length} 个章节 → 各章子主题`;
  image.width = graph.width;
  image.height = graph.height;
  preview.append(image);
  const caption = document.createElement("p");
  caption.className = "outline-caption";
  caption.textContent = `${chapters.length} 个章节 · 点击图片放大，查看完整结构`;

  const dialog = document.createElement("dialog");
  dialog.className = "outline-dialog";
  dialog.setAttribute("aria-label", "放大的全文架构图");
  const toolbar = document.createElement("div");
  toolbar.className = "outline-toolbar";
  const canvas = document.createElement("div");
  canvas.className = "outline-zoom-canvas";
  canvas.tabIndex = 0;
  canvas.setAttribute("aria-label", "架构图，可滚动查看");
  const enlarged = document.createElement("img");
  enlarged.src = source;
  enlarged.alt = image.alt;
  const level = document.createElement("output");
  level.setAttribute("aria-label", "缩放比例");
  let scale = 1;
  const setScale = (value: number) => {
    scale = Math.max(0.05, Math.min(3, value));
    enlarged.width = Math.round(graph.width * scale);
    enlarged.height = Math.round(graph.height * scale);
    level.textContent = `${Math.round(scale * 100)}%`;
    smaller.disabled = scale <= 0.05;
    larger.disabled = scale >= 3;
  };
  const button = (label: string, action: () => void) => {
    const node = document.createElement("button");
    node.type = "button";
    node.textContent = label;
    node.addEventListener("click", action);
    toolbar.append(node);
    return node;
  };
  const smaller = button("缩小", () => setScale(scale / 1.25));
  toolbar.append(level);
  const larger = button("放大", () => setScale(scale * 1.25));
  button("全图", () => {
    setScale(Math.min(canvas.clientWidth / graph.width, canvas.clientHeight / graph.height, 1));
    canvas.scrollLeft = 0;
    canvas.scrollTop = 0;
  });
  button("原始大小", () => setScale(1));
  button("关闭", () => dialog.close());
  canvas.append(enlarged);
  dialog.append(toolbar, canvas);
  preview.addEventListener("click", () => {
    dialog.showModal();
    setScale(1);
    canvas.scrollLeft = Math.max(0, (graph.width - canvas.clientWidth) / 2);
    canvas.scrollTop = Math.max(0, (graph.height - canvas.clientHeight) / 2);
  });
  dialog.addEventListener("close", () => preview.focus());
  section.append(heading, preview, caption, dialog);
  return section;
}
