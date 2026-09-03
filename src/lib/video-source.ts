import type { VideoPage } from "./types";

const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{6,20}$/;
const BILIBILI_VIDEO_PATH = /^\/video\/(BV[A-Za-z0-9]{10})\/?$/;

export function detectVideoPage(urlValue: string): VideoPage | null {
  try {
    const url = new URL(urlValue);
    if (url.protocol !== "https:") return null;

    if (url.hostname === "www.youtube.com" && url.pathname === "/watch") {
      const videoId = url.searchParams.get("v")?.trim() ?? "";
      if (!YOUTUBE_VIDEO_ID.test(videoId)) return null;
      return {
        platform: "youtube",
        videoId,
        pageNumber: 1,
        sourceKey: `youtube:${videoId}`,
        sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
      };
    }

    if (url.hostname === "www.bilibili.com") {
      const match = url.pathname.match(BILIBILI_VIDEO_PATH);
      const videoId = match?.[1] ?? "";
      if (!videoId) return null;
      const requestedPage = Number(url.searchParams.get("p") ?? "1");
      const pageNumber =
        Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
      return {
        platform: "bilibili",
        videoId,
        pageNumber,
        sourceKey: `bilibili:${videoId}:p${pageNumber}`,
        sourceUrl: `https://www.bilibili.com/video/${videoId}/${
          pageNumber > 1 ? `?p=${pageNumber}` : ""
        }`,
      };
    }
  } catch {
    return null;
  }
  return null;
}

export function summaryCacheStorageKey(
  video: Pick<VideoPage, "videoId" | "sourceKey">,
  targetLanguage: string,
  providerFingerprint: string,
  promptVersion: number,
): string {
  const fingerprint = `${video.sourceKey}|${targetLanguage}|${providerFingerprint}|${promptVersion}`;
  return `video_parallel_summary_${video.videoId}_${hashString(fingerprint)}`;
}

function hashString(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
