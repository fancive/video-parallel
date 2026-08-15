const BUTTON_ID = "video-parallel-trigger";
const STYLE_ID = "video-parallel-trigger-style";
let lastUrl = location.href;
let reconcileTimer: number | undefined;

function isWatchPage(): boolean {
  return location.hostname === "www.youtube.com" && location.pathname === "/watch";
}

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

function createButton(): HTMLButtonElement {
  const button = document.createElement("button");
  button.id = BUTTON_ID;
  button.type = "button";
  button.setAttribute("aria-label", "在 video-parallel 中对照阅读字幕");

  const mark = document.createElement("span");
  mark.className = "vp-mark";
  mark.setAttribute("aria-hidden", "true");
  mark.append(document.createElement("i"), document.createElement("i"));

  const label = document.createElement("span");
  label.textContent = "Parallel";
  button.append(mark, label);
  button.addEventListener("click", () => {
    void chrome.runtime.sendMessage({ type: "OPEN_PANEL" });
  });
  return button;
}

function findToolbar(): Element | null {
  const candidates = [
    "ytd-watch-metadata #actions-inner",
    "ytd-watch-metadata #menu-container",
    "#above-the-fold #actions-inner",
  ];
  return candidates.map((selector) => document.querySelector(selector)).find(Boolean) ?? null;
}

function reconcileButton(): void {
  window.clearTimeout(reconcileTimer);
  reconcileTimer = undefined;

  if (!isWatchPage()) {
    document.getElementById(BUTTON_ID)?.remove();
    return;
  }
  installStyle();
  const toolbar = findToolbar();
  if (!toolbar) return;

  const current = document.getElementById(BUTTON_ID);
  if (current?.parentElement === toolbar) return;
  current?.remove();
  toolbar.appendChild(createButton());
}

function scheduleReconcile(): void {
  if (reconcileTimer !== undefined) return;
  reconcileTimer = window.setTimeout(reconcileButton, 120);
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
scheduleReconcile();
