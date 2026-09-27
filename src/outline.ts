import { type ContentOutline, isContentOutline, renderContentOutline } from "./lib/content-outline";
import { sanitizeFilename } from "./lib/markdown";
import { OUTLINE_SESSION_PREFIX } from "./lib/outline-session";

const canvas = element<HTMLElement>("canvas");
const drawing = element<HTMLElement>("drawing");
const hasRuntime = typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);
let documentData: ContentOutline | null = null;
let graph: ReturnType<typeof renderContentOutline> | null = null;
let scale = 1;

function setScale(next: number, center = true): void {
  if (!graph) return;
  const previous = scale;
  scale = Math.max(0.05, Math.min(3, next));
  const image = drawing.querySelector("svg");
  if (!image) return;
  const x = (canvas.scrollLeft + canvas.clientWidth / 2) / previous;
  const y = (canvas.scrollTop + canvas.clientHeight / 2) / previous;
  const width = graph.width * scale;
  const height = graph.height * scale;
  drawing.style.width = `${width}px`;
  drawing.style.height = `${height}px`;
  image.setAttribute("width", String(width));
  image.setAttribute("height", String(height));
  element<HTMLOutputElement>("zoomLevel").textContent = `${Math.round(scale * 100)}%`;
  element<HTMLButtonElement>("zoomIn").disabled = scale >= 3;
  element<HTMLButtonElement>("zoomOut").disabled = scale <= 0.05;
  if (center) {
    canvas.scrollLeft = x * scale - canvas.clientWidth / 2;
    canvas.scrollTop = y * scale - canvas.clientHeight / 2;
  }
}

function fit(): void {
  if (!graph) return;
  setScale(
    Math.min((canvas.clientWidth - 48) / graph.width, (canvas.clientHeight - 48) / graph.height, 1),
    false,
  );
  canvas.scrollLeft = 0;
  canvas.scrollTop = 0;
}

element<HTMLButtonElement>("zoomIn").addEventListener("click", () => setScale(scale * 1.25));
element<HTMLButtonElement>("zoomOut").addEventListener("click", () => setScale(scale / 1.25));
element<HTMLButtonElement>("fit").addEventListener("click", fit);
element<HTMLButtonElement>("actualSize").addEventListener("click", () => setScale(1));
element<HTMLButtonElement>("exportSvg").addEventListener("click", () => {
  if (!graph || !documentData) return;
  const blob = new Blob([graph.svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${sanitizeFilename(documentData.title)}-outline.svg`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

async function boot(): Promise<void> {
  try {
    const query = new URLSearchParams(window.location.search);
    let data: unknown;
    if (!hasRuntime && query.get("preview") === "panel") {
      data = JSON.parse(window.localStorage.getItem("video_parallel_outline_preview") ?? "null");
    } else if (!hasRuntime && query.get("preview") === "1") data = previewOutline();
    else if (hasRuntime) {
      const id = query.get("id") ?? "";
      if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("缺少全文架构图，请从视频侧栏重新打开。");
      const key = `${OUTLINE_SESSION_PREFIX}${id}`;
      data = (await chrome.storage.session.get(key))[key];
    }
    if (!isContentOutline(data))
      throw new Error("这张图已不可用，请回到视频侧栏重新打开；已有摘要无需重新生成。");
    documentData = data;
    graph = renderContentOutline(data);
    element<HTMLElement>("documentTitle").textContent = data.title;
    document.title = `${data.title} · 全文架构图`;
    element<HTMLElement>("documentInfo").textContent =
      `${data.chapters.length} 个章节 · ${data.chapters.reduce((sum, chapter) => sum + chapter.topics.length, 0)} 个子主题 · 按编号先左后右阅读 · 连线表示层级 · 放大后可滚动查看${hasRuntime ? "" : " · 示例预览"}`;
    // Only our renderer creates markup; every content string is XML-escaped.
    const parsed = new DOMParser().parseFromString(graph.svg, "image/svg+xml");
    if (parsed.querySelector("parsererror")) throw new Error("图形无法显示，可展开下方文字大纲。");
    drawing.replaceChildren(document.importNode(parsed.documentElement, true));
    renderText(data);
    fit();
  } catch (error) {
    if (documentData) {
      renderText(documentData);
      element<HTMLDetailsElement>("textOutline").open = true;
    }
    const message = element<HTMLElement>("error");
    message.textContent = error instanceof Error ? error.message : String(error);
    message.hidden = false;
    element<HTMLElement>("documentTitle").textContent = "全文架构图暂不可用";
    for (const button of document.querySelectorAll<HTMLButtonElement>("nav button"))
      button.disabled = true;
  }
}

function renderText(data: ContentOutline): void {
  const list = document.createElement("ol");
  for (const chapter of data.chapters) {
    const item = document.createElement("li");
    const title = document.createElement("strong");
    title.textContent = chapter.title;
    const topics = document.createElement("ul");
    for (const topic of chapter.topics) {
      const entry = document.createElement("li");
      entry.textContent = topic;
      topics.append(entry);
    }
    item.append(title, topics);
    list.append(item);
  }
  element<HTMLElement>("outlineText").replaceChildren(list);
}

function previewOutline(): ContentOutline {
  const many = new URLSearchParams(window.location.search).get("chapters") === "16";
  const chapters = [
    {
      title: "为什么只升级模型还不够",
      topics: [
        "任务状态不断变化，静态知识不能覆盖当前现场",
        "缺失关键上下文时，模型能力难以转化为可靠行动",
      ],
    },
    {
      title: "上下文来自哪里",
      topics: ["历史文档提供稳定背景，实时数据描述当前状态", "组合多个来源时保留出处与更新时间"],
    },
    {
      title: "从检索走向持续供给",
      topics: ["单次检索解决一次问题，持续供给跟随任务变化", "按任务选择信息，避免堆入无关材料"],
    },
    {
      title: "建立独立的上下文层",
      topics: ["获取、清洗与交付信息形成清晰分工", "应用团队专注任务逻辑，基础层维护信息质量"],
    },
    {
      title: "权限和来源不能丢",
      topics: ["信息可用不代表当前任务有权访问", "保留引用和限制条件，方便核对与纠错"],
    },
    {
      title: "如何判断是否有效",
      topics: [
        "用真实任务检查新鲜度、可追溯性与权限",
        "失败案例用于调整供给流程，而非只修改提示词",
      ],
    },
  ];
  return {
    version: 1,
    title: "可靠的 AI 智能体：从模型能力到上下文体系",
    chapters: Array.from({ length: many ? 16 : chapters.length }, (_, index) => ({
      ...(chapters[index % chapters.length] ?? { title: "示例章节", topics: [] }),
      startMs: index * 300000,
    })),
  };
}

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

void boot();
