import { makeContentOutline } from "./content-outline";
import type { SummaryBlock } from "./types";

export const OUTLINE_SESSION_PREFIX = "video_parallel_outline_";

export async function openOutlinePage(title: string, chapters: SummaryBlock[]): Promise<void> {
  const id = crypto.randomUUID();
  const key = `${OUTLINE_SESSION_PREFIX}${id}`;
  // Store only the rendered document's content, never captions, credentials or settings.
  await chrome.storage.session.set({ [key]: makeContentOutline(title, chapters) });
  try {
    await chrome.tabs.create({ url: chrome.runtime.getURL(`outline.html?id=${id}`) });
  } catch (error) {
    await chrome.storage.session.remove(key);
    throw error;
  }
}
