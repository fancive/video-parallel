import type { VideoPlatform } from "./lib/types";
import { detectVideoPage } from "./lib/video-source";

const BUTTON_ID = "video-parallel-trigger";
const STYLE_ID = "video-parallel-trigger-style";
let lastUrl = location.href;
let reconcileTimer: number | undefined;
let preparedSourceKey = "";
let preparation: Promise<boolean> | null = null;

function installStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #${BUTTON_ID} {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      height: 36px;
      margin-left: 8px;
      padding: 0 13px;
      border: 1px solid rgba(15, 15, 15, .22);
      border-radius: 18px;
      color: var(--yt-spec-text-primary, #0f0f0f);
      background: var(--yt-spec-badge-chip-background, rgba(0, 0, 0, .05));
      cursor: pointer;
      font: 600 13px/1 Roboto, Arial, sans-serif;
      white-space: nowrap;
    }
    #${BUTTON_ID}:hover { background: var(--yt-spec-button-chip-background-hover, rgba(0, 0, 0, .1)); }
    #${BUTTON_ID}:focus-visible { outline: 2px solid #2f59ff; outline-offset: 2px; }
    #${BUTTON_ID}[data-platform="bilibili"] {
      height: 30px;
      margin-left: 18px;
      border-color: rgba(24, 25, 28, .16);
      color: #61666d;
      background: transparent;
      font-family: Arial, "Microsoft YaHei", sans-serif;
    }
    #${BUTTON_ID}[data-platform="bilibili"]:hover {
      color: #00aeec;
      background: rgba(0, 174, 236, .08);
    }
    #${BUTTON_ID} .vp-mark {
      position: relative;
      display: inline-grid;
      grid-template-columns: 1fr 1fr;
      gap: 2px;
      width: 17px;
      height: 13px;
    }
    #${BUTTON_ID} .vp-mark::after {
      position: absolute;
      top: 5px;
      right: -2px;
      left: -2px;
      height: 2px;
      border-radius: 9px;
      background: #f05b43;
      content: "";
      transform: rotate(-8deg);
    }
    #${BUTTON_ID} .vp-mark i { border: 1.5px solid currentColor; border-radius: 1px; }
  `;
  document.head.appendChild(style);
}

function createButton(platform: VideoPlatform): HTMLButtonElement {
  const button = document.createElement("button");
  button.id = BUTTON_ID;
  button.type = "button";
  button.dataset.platform = platform;
  button.setAttribute("aria-label", "在 video-parallel 中查看章节概要");

  const mark = document.createElement("span");
  mark.className = "vp-mark";
  mark.setAttribute("aria-hidden", "true");
  mark.append(document.createElement("i"), document.createElement("i"));

  const label = document.createElement("span");
  label.textContent = "概要";
  button.append(mark, label);
  let needsRefresh = false;
  button.addEventListener("click", () => {
    if (needsRefresh) {
      location.reload();
      return;
    }
    void sendPanelMessage("OPEN_PANEL").then((response) => {
      if (response.ok) {
        label.textContent = "概要";
        button.setAttribute("aria-label", "在 video-parallel 中查看章节概要");
        button.title = "";
        return;
      }
      needsRefresh = response.invalidated === true;
      const message = needsRefresh ? "扩展已更新，点击刷新页面" : "打开失败，点击重试";
      label.textContent = message;
      button.setAttribute("aria-label", message);
      button.title = needsRefresh
        ? "刷新当前视频页后即可重新连接扩展。"
        : (response.error ?? message);
    });
  });
  return button;
}

function findToolbar(platform: VideoPlatform): Element | null {
  const candidates =
    platform === "youtube"
      ? [
          "ytd-watch-metadata #actions-inner",
          "ytd-watch-metadata #menu-container",
          "#above-the-fold #actions-inner",
        ]
      : [".video-toolbar-left-main", ".video-toolbar-left", ".video-toolbar-container"];
  return candidates.map((selector) => document.querySelector(selector)).find(Boolean) ?? null;
}

interface PanelReply {
  ok: boolean;
  error?: string;
  invalidated?: boolean;
}

async function sendPanelMessage(type: "OPEN_PANEL" | "PREPARE_PANEL"): Promise<PanelReply> {
  try {
    // Invoke immediately so OPEN_PANEL keeps the click's user activation.
    return (await chrome.runtime.sendMessage({ type })) ?? { ok: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: message,
      invalidated: /extension context invalidated/i.test(message),
    };
  }
}

async function preparePanel(): Promise<boolean> {
  const page = detectVideoPage(location.href);
  if (!page) return false;
  const sourceKey = page.sourceKey;
  if (preparedSourceKey === sourceKey) return true;
  if (preparation) return preparation;

  preparation = sendPanelMessage("PREPARE_PANEL")
    .then((response: { ok?: boolean }) => {
      if (response?.ok && detectVideoPage(location.href)?.sourceKey === sourceKey) {
        preparedSourceKey = sourceKey;
      }
      return Boolean(response?.ok);
    })
    .catch(() => false)
    .finally(() => {
      preparation = null;
    });
  return preparation;
}

async function reconcileButton(): Promise<void> {
  window.clearTimeout(reconcileTimer);
  reconcileTimer = undefined;

  const page = detectVideoPage(location.href);
  if (!page) {
    preparedSourceKey = "";
    document.getElementById(BUTTON_ID)?.remove();
    return;
  }
  if (!(await preparePanel()) || detectVideoPage(location.href)?.sourceKey !== page.sourceKey)
    return;
  installStyle();
  const toolbar = findToolbar(page.platform);
  if (!toolbar) return;

  const current = document.getElementById(BUTTON_ID);
  if (current?.parentElement === toolbar) return;
  current?.remove();
  toolbar.appendChild(createButton(page.platform));
}

function scheduleReconcile(): void {
  if (reconcileTimer !== undefined) return;
  reconcileTimer = window.setTimeout(() => void reconcileButton(), 120);
}

const observer = new MutationObserver(scheduleReconcile);
observer.observe(document.documentElement, { childList: true, subtree: true });

window.setInterval(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    scheduleReconcile();
  }
}, 500);

document.addEventListener("yt-navigate-finish", scheduleReconcile);
void reconcileButton();
