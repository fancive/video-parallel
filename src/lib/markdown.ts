import { formatTimecode } from "./transcript";
import type { TranscriptSegment } from "./types";

interface MarkdownVideo {
  title: string;
  channel: string;
  url: string;
  sourceLanguage: string;
  targetLanguage: string;
}

export function buildParallelMarkdown(video: MarkdownVideo, segments: TranscriptSegment[]): string {
  const lines = [
    `# ${video.title}`,
    "",
    `- Channel: ${video.channel}`,
    `- Source: ${video.url}`,
    `- Languages: ${video.sourceLanguage} → ${video.targetLanguage}`,
    "- Exported by video-parallel",
    "",
  ];

  for (const segment of segments) {
    lines.push(
      `## ${formatTimecode(segment.startMs)}`,
      "",
      segment.text,
      "",
      segment.translatedText || "_Not translated_",
      "",
    );
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
