interface SidePanelShortcutApi {
  open(options: { tabId: number }): Promise<void>;
}

interface RuntimeMessageApi {
  sendMessage(message: unknown): Promise<unknown>;
}

const MISSING_BOUND_TAB_ERROR = "无法识别侧面板所属的视频标签页，请刷新视频页面后重试。";

export function openTabSidePanel(api: SidePanelShortcutApi, tabId: number): Promise<void> {
  // Keep the user-gesture path focused exclusively on open(). Tab-specific
  // options must be configured before the shortcut or page button is enabled.
  return api.open({ tabId });
}

export async function notifySidePanelIfReady(
  api: RuntimeMessageApi,
  message: unknown,
): Promise<void> {
  try {
    await api.sendMessage(message);
  } catch {
    // A newly opened panel may not have registered its listener yet. It will
    // consume the pending request during boot, so a missing receiver is normal.
  }
}

export function sidePanelPath(tabId: number): string {
  if (!Number.isInteger(tabId) || tabId <= 0) throw new Error(MISSING_BOUND_TAB_ERROR);
  return `sidepanel.html?tabId=${tabId}`;
}

export function tabIdFromSidePanelSearch(search: string): number {
  const value = new URLSearchParams(search).get("tabId");
  const tabId = value ? Number(value) : Number.NaN;
  if (!Number.isInteger(tabId) || tabId <= 0) throw new Error(MISSING_BOUND_TAB_ERROR);
  return tabId;
}
