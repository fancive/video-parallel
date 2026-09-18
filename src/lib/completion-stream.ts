import { ProcessingError, providerErrorMessage } from "./processing-error";
import { type CompletionResult, parseCompletionResult } from "./provider-client";

const MAX_EVENT_BYTES = 2 * 1024 * 1024;
const MAX_CONTENT_BYTES = 2 * 1024 * 1024;
const encoder = new TextEncoder();

export interface CompletionProgress {
  phase: "connecting" | "waiting" | "thinking" | "writing";
  contentCharacters: number;
  reasoningCharacters: number;
  context?: string;
}

export function formatCompletionProgress(progress: CompletionProgress): string {
  const detail = formatCompletionPhase(progress);
  return progress.context ? `${progress.context} · ${detail}` : detail;
}

function formatCompletionPhase(progress: CompletionProgress): string {
  if (progress.phase === "writing")
    return `正在生成概要 · 已接收 ${progress.contentCharacters} 字符`;
  if (progress.phase === "thinking")
    return `模型正在思考 · 已接收 ${progress.reasoningCharacters} 字符`;
  if (progress.phase === "waiting") return "接口已连接，等待模型输出";
  return "正在连接模型接口";
}

// SSE frames can be split anywhere, including inside JSON and UTF-8 characters.
// Reasoning is counted for progress only; it is neither displayed nor cached.
export class CompletionStream {
  private buffer = "";
  private bufferBytes = 0;
  private eventBytes = 0;
  private data: string[] = [];
  private content = "";
  private contentBytes = 0;
  private reasoningCharacters = 0;
  private finishReason = "";
  private done = false;
  private usage: unknown;

  constructor(private readonly onProgress?: (progress: CompletionProgress) => void) {}

  get isDone(): boolean {
    return this.done;
  }

  push(text: string): void {
    if (this.done) return;
    this.buffer += text;
    this.bufferBytes += encoder.encode(text).byteLength;
    for (;;) {
      const newline = /\r\n|\n|\r(?!$)/.exec(this.buffer);
      if (!newline) break;
      const line = this.buffer.slice(0, newline.index);
      this.buffer = this.buffer.slice(newline.index + newline[0].length);
      const bytes = encoder.encode(line).byteLength + newline[0].length;
      this.bufferBytes -= bytes;
      this.line(line, bytes);
      if (this.done) {
        this.buffer = "";
        this.bufferBytes = 0;
        return;
      }
    }
    // Bound only the unfinished event, not all bytes ever received. Thousands of
    // small deltas repeat metadata but do not increase retained parser memory.
    this.checkEventSize(this.eventBytes + this.bufferBytes);
  }

  finish(): CompletionResult {
    if (this.buffer) this.line(this.buffer.replace(/\r$/, ""), this.bufferBytes);
    this.buffer = "";
    this.bufferBytes = 0;
    this.line("", 0);
    if (!this.done || !this.finishReason) {
      throw new ProcessingError("AI 响应流在完成前中断，请重试。", "response");
    }
    if (this.finishReason !== "stop") {
      throw new ProcessingError(
        `AI 未完整生成概要（finish_reason=${this.finishReason}），请重试或更换模型。`,
        "response",
      );
    }
    return parseCompletionResult(
      "openai-compatible",
      JSON.stringify({
        choices: [{ message: { content: this.content } }],
        usage: this.usage,
      }),
    );
  }

  private checkEventSize(bytes: number): void {
    if (bytes > MAX_EVENT_BYTES) {
      throw new ProcessingError("AI 单条流式事件超过 2 MiB，已停止读取。", "receive");
    }
  }

  private line(line: string, bytes: number): void {
    this.eventBytes += bytes;
    this.checkEventSize(this.eventBytes);
    if (line === "") {
      if (this.data.length) this.event(this.data.join("\n"));
      this.data = [];
      this.eventBytes = 0;
    } else if (line.startsWith("data:")) {
      this.data.push(line.slice(5).replace(/^ /, ""));
    }
    // Ignore comments, event names and other SSE fields, including keep-alives.
  }

  private event(data: string): void {
    if (this.done) return;
    if (data.trim() === "[DONE]") {
      this.done = true;
      return;
    }
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(data);
      if (!event || typeof event !== "object") throw new Error();
    } catch {
      throw new ProcessingError("AI 响应流包含无法解析的 JSON。", "response");
    }
    if (event.error) throw new ProcessingError(providerErrorMessage(data, 200), "provider");
    if (event.usage) this.usage = event.usage;
    const choices = Array.isArray(event.choices) ? event.choices : [];
    const choice = choices.find((value) => value?.index === 0) ?? choices[0];
    if (!choice || typeof choice !== "object") return;
    if (choice.finish_reason) this.finishReason = String(choice.finish_reason);
    const delta = choice.delta;
    if (!delta || typeof delta !== "object") return;
    if (typeof delta.content === "string") {
      this.contentBytes += encoder.encode(delta.content).byteLength;
      if (this.contentBytes > MAX_CONTENT_BYTES) {
        throw new ProcessingError("AI 概要正文超过 2 MiB，已停止读取。", "receive");
      }
      this.content += delta.content;
    }
    if (typeof delta.reasoning_content === "string")
      this.reasoningCharacters += delta.reasoning_content.length;
    if (this.content || this.reasoningCharacters)
      this.onProgress?.({
        phase: this.content ? "writing" : "thinking",
        contentCharacters: this.content.length,
        reasoningCharacters: this.reasoningCharacters,
      });
  }
}
