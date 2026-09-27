import { formatTimecode } from "./transcript";
import type { SummaryBlock, VideoOverview } from "./types";

interface MarkdownVideo {
  title: string;
  channel: string;
  url: string;
  sourceLanguage: string;
  summaryLanguage: string;
}

export function buildSummaryMarkdown(
  video: MarkdownVideo,
  overview: VideoOverview,
  chapters: SummaryBlock[],
): string {
  const lines = [
    `# ${video.title}`,
    "",
    `- Channel: ${video.channel}`,
    `- Source: ${video.url}`,
    `- Caption language: ${video.sourceLanguage}`,
    `- Summary language: ${video.summaryLanguage}`,
    "- Exported by video-parallel",
    "",
    "## 全文要点",
    "",
    overview.summary,
    "",
  ];

  for (const point of overview.keyPoints) lines.push(`- ${point}`);
  lines.push("", "## 主要贡献", "");
  if (!overview.contributions) lines.push("历史摘要尚未提炼主要贡献，请重新处理。", "");
  else if (overview.contributions.items.length === 0)
    lines.push(overview.contributions.emptyReason, "");
  else
    for (const item of overview.contributions.items) {
      lines.push(
        `### ${item.title}`,
        "",
        `解决的问题：${item.problem}`,
        "",
        `价值：${item.value}`,
        "",
      );
      if (item.boundary) lines.push(`适用边界：${item.boundary}`, "");
      lines.push(
        `原文依据：${item.evidence.map((source) => formatTimecode(source.startMs)).join("、")}`,
        "",
      );
    }
  lines.push("## 章节概要", "");

  for (const chapter of chapters) {
    lines.push(
      `### ${formatTimecode(chapter.startMs)} · ${chapter.content.title}`,
      "",
      chapter.content.summary,
      "",
    );
    for (const point of chapter.content.keyPoints) lines.push(`- ${point}`);
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function sanitizeFilename(input: string): string {
  const cleaned = input
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  return cleaned || "video-parallel";
}
