import { type CompletionProgress, CompletionStream } from "./completion-stream";
import { ProcessingError, processingFailure, providerErrorMessage } from "./processing-error";
import {
  buildCompletionRequest,
  parseCompletionResult,
  shouldRetryWithoutJsonMode,
} from "./provider-client";
import {
  buildSummaryMessages,
  type GeneratedSummary,
  MAX_CHAPTER_TRANSCRIPT_CHARACTERS,
  MAX_CHAPTER_TRANSCRIPT_SEGMENTS,
  parseSummaryResponse,
} from "./summary";
import type { AppSettings, TokenUsage, TranscriptSegment } from "./types";

export const SUMMARY_IDLE_TIMEOUT_MS = 120_000;
export const SUMMARY_TOTAL_TIMEOUT_MS = 600_000;
const MAX_NON_STREAM_RESPONSE_BYTES = 2 * 1024 * 1024;

interface SummaryOptions {
  signal?: AbortSignal;
  onProgress?: (progress: CompletionProgress) => void;
}

export async function generateVideoSummary(
  settings: AppSettings,
  segments: TranscriptSegment[],
  videoTitle: string,
  options: SummaryOptions = {},
): Promise<GeneratedSummary & { usage?: TokenUsage }> {
  validateSegments(segments);
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  const totalTimer = setTimeout(
    () =>
      controller.abort(new ProcessingError("概要生成达到 10 分钟总时限，已停止请求。", "provider")),
    SUMMARY_TOTAL_TIMEOUT_MS,
  );
  let usage: TokenUsage | undefined;
  let completeUsage = true;
  try {
    const summarize = async (
      input: TranscriptSegment[],
      context?: string,
      synthesis = false,
    ): Promise<GeneratedSummary> => {
      const messages = buildSummaryMessages(input, settings.targetLanguage, videoTitle);
      if (context && !synthesis && messages[0])
        messages[0].content +=
          "\nThis is one chronological portion of a longer video. Cover all supplied captions, but describe only this portion; do not infer what happens in missing portions. Preserve evidence and caveats for later whole-video synthesis.";
      if (synthesis && messages[0])
        messages[0].content +=
          "\nThe input contains chronological summaries of transcript portions, not verbatim captions. Synthesize a whole-video overview and coherent chapters from ALL portions. Merge related topics across portion boundaries; do not treat a processing boundary as a topic change. Preserve the supplied start ids and supported caveats.";
      for (let attempt = 0; attempt < 2; attempt++) {
        controller.signal.throwIfAborted();
        const completion = await requestCompletion(
          settings,
          messages,
          controller.signal,
          (progress) => options.onProgress?.({ ...progress, context }),
        );
        if (!completion.usage) completeUsage = false;
        else
          usage = {
            inputTokens: (usage?.inputTokens ?? 0) + completion.usage.inputTokens,
            outputTokens: (usage?.outputTokens ?? 0) + completion.usage.outputTokens,
          };
        try {
          return parseSummaryResponse(completion.content, input);
        } catch (error) {
          if (attempt === 1)
            throw new ProcessingError(
              error instanceof Error ? error.message : String(error),
              "response",
            );
        }
      }
      throw new ProcessingError("AI 返回的概要无法解析。", "response");
    };
    let input = segments;
    let round = 0;
    const originals = new Map(segments.map((segment) => [segment.id, segment]));
    for (;;) {
      const batches = splitSummaryInput(input);
      if (batches.length === 1) {
        const summary = await summarize(input, round ? "正在汇总全文" : undefined, round > 0);
        return { ...summary, ...(completeUsage && usage ? { usage } : {}) };
      }
      const reduced: TranscriptSegment[] = [];
      for (const [index, batch] of batches.entries()) {
        const result = await summarize(
          batch,
          `第 ${round + 1} 轮 · 分批处理 ${index + 1}/${batches.length}`,
          round > 0,
        );
        for (const [chapterIndex, chapter] of result.chapters.entries()) {
          const original = originals.get(chapter.startSegmentId);
          if (!original) throw new ProcessingError("AI 返回的章节定位无效。", "response");
          reduced.push({
            ...original,
            text: JSON.stringify({
              ...(chapterIndex === 0 ? { portionOverview: result.overview } : {}),
              title: chapter.title,
              summary: chapter.summary,
              keyPoints: chapter.keyPoints,
            }),
          });
        }
      }
      // Stop pathological expanding model output instead of looping or dropping evidence.
      const size = (items: TranscriptSegment[]) =>
        items.reduce((sum, item) => sum + item.text.length + 1, 0);
      if (splitSummaryInput(reduced).length > 1 && size(reduced) >= size(input))
        throw new ProcessingError("AI 分批概要未能压缩字幕，请重试或更换模型。", "response");
      input = reduced;
      round++;
    }
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason;
    const failure = processingFailure(
      controller.signal.aborted ? controller.signal.reason : error,
      "provider",
      settings.apiKey,
    );
    throw new ProcessingError(failure.message, failure.stage, failure.status);
  } finally {
    clearTimeout(totalTimer);
    options.signal?.removeEventListener("abort", abort);
  }
}

async function requestCompletion(
  settings: AppSettings,
  messages: Array<{ role: "system" | "user"; content: string }>,
  signal: AbortSignal,
  onProgress?: (progress: CompletionProgress) => void,
) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const activity = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(
      () =>
        controller.abort(
          new ProcessingError("AI 接口连续 120 秒没有返回数据，已停止请求。", "provider"),
        ),
      SUMMARY_IDLE_TIMEOUT_MS,
    );
  };
  activity();
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      controller.signal.throwIfAborted();
      onProgress?.({ phase: "connecting", contentCharacters: 0, reasoningCharacters: 0 });
      const request = buildCompletionRequest(settings, messages, {
        jsonMode: attempt === 0,
        // DeepSeek's documented stream carries reasoning, keep-alives and real usage.
        stream: settings.provider === "deepseek" && settings.protocol === "openai-compatible",
      });
      const response = await fetch(request.url, { ...request.init, signal: controller.signal });
      activity();
      onProgress?.({ phase: "waiting", contentCharacters: 0, reasoningCharacters: 0 });
      const streaming =
        response.ok &&
        settings.protocol === "openai-compatible" &&
        Boolean(response.headers.get("content-type")?.includes("text/event-stream"));
      const parser = streaming ? new CompletionStream(onProgress) : null;
      let text = "";
      let bytes = 0;
      const decoder = new TextDecoder();
      const reader = response.body?.getReader();
      if (!reader) throw new ProcessingError("AI 服务返回了空响应。", "response");
      const cancelReader = () => {
        void reader.cancel(controller.signal.reason).catch(() => {});
      };
      controller.signal.addEventListener("abort", cancelReader, { once: true });
      try {
        for (;;) {
          controller.signal.throwIfAborted();
          const chunk = await reader.read();
          controller.signal.throwIfAborted();
          if (chunk.done) break;
          if (chunk.value.byteLength === 0) continue;
          activity();
          if (!parser) {
            bytes += chunk.value.byteLength;
            if (bytes > MAX_NON_STREAM_RESPONSE_BYTES)
              throw new ProcessingError("AI 非流式响应超过 2 MiB，已停止读取。", "receive");
          }
          const decoded = decoder.decode(chunk.value, { stream: true });
          if (parser) parser.push(decoded);
          else text += decoded;
          if (parser?.isDone) break;
        }
        const final = decoder.decode();
        if (parser) parser.push(final);
        else text += final;
      } finally {
        controller.signal.removeEventListener("abort", cancelReader);
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      if (!response.ok) {
        if (attempt === 0 && shouldRetryWithoutJsonMode(response.status, text)) continue;
        throw new ProcessingError(
          providerErrorMessage(text, response.status),
          "provider",
          response.status,
        );
      }
      try {
        return parser ? parser.finish() : parseCompletionResult(settings.protocol, text);
      } catch (error) {
        if (error instanceof ProcessingError) throw error;
        throw new ProcessingError(
          error instanceof Error ? error.message : String(error),
          "response",
        );
      }
    }
    throw new ProcessingError("AI 服务不支持当前 JSON 输出模式。", "provider");
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    throw error;
  } finally {
    clearTimeout(idleTimer);
    signal.removeEventListener("abort", abort);
  }
}

function splitSummaryInput(segments: TranscriptSegment[]): TranscriptSegment[][] {
  const batches: TranscriptSegment[][] = [];
  let batch: TranscriptSegment[] = [];
  let characters = 0;
  for (const segment of segments) {
    if (segment.text.length > MAX_CHAPTER_TRANSCRIPT_CHARACTERS)
      throw new ProcessingError("AI 分批概要过长，无法继续汇总，请重试或更换模型。", "response");
    if (
      batch.length &&
      (batch.length >= MAX_CHAPTER_TRANSCRIPT_SEGMENTS ||
        characters + segment.text.length > MAX_CHAPTER_TRANSCRIPT_CHARACTERS)
    ) {
      batches.push(batch);
      batch = [];
      characters = 0;
    }
    batch.push(segment);
    characters += segment.text.length;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

function validateSegments(segments: TranscriptSegment[]): void {
  const fail = (message: string): never => {
    throw new ProcessingError(message, "input");
  };
  if (segments.length === 0) fail("没有可用于生成概要的字幕。");
  const ids = new Set<string>();
  for (const segment of segments) {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(segment.id) || ids.has(segment.id)) fail("字幕段 ID 无效。");
    if (
      !segment.text ||
      segment.text.length > 3000 ||
      !Number.isFinite(segment.startMs) ||
      segment.startMs < 0
    )
      fail("字幕文本或时间戳无效。");
    ids.add(segment.id);
  }
}
