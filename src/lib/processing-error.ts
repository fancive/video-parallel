export type ProcessingStage = "captions" | "input" | "provider" | "receive" | "response" | "cache";

export interface ProcessingFailure {
  stage: ProcessingStage;
  message: string;
  hint: string;
  status?: number;
}

export const PROCESSING_STAGE_LABELS: Record<ProcessingStage, string> = {
  captions: "读取字幕",
  input: "检查字幕",
  provider: "请求模型",
  receive: "接收响应",
  response: "解析概要",
  cache: "保存概要",
};

export interface ProcessingDiagnostics {
  version: string;
  videoUrl: string;
  model: string;
  protocol: string;
  segmentCount: number;
  characterCount: number;
  elapsedSeconds: number;
  occurredAt: string;
  activity?: string;
}

export function formatProcessingDiagnostics(
  failure: ProcessingFailure,
  context: ProcessingDiagnostics,
): string {
  return [
    `video-parallel ${context.version}`,
    `时间：${context.occurredAt}`,
    `视频：${context.videoUrl}`,
    `模型：${context.model} (${context.protocol})`,
    `字幕：${context.segmentCount} 段 / ${context.characterCount} 字符`,
    `总耗时：${context.elapsedSeconds} 秒`,
    ...(context.activity ? [`接口进展：${context.activity}`] : []),
    `失败阶段：${PROCESSING_STAGE_LABELS[failure.stage]}`,
    ...(failure.status ? [`HTTP：${failure.status}`] : []),
    `原因：${failure.message}`,
    `建议：${failure.hint}`,
  ].join("\n");
}

export class ProcessingError extends Error {
  constructor(
    message: string,
    readonly stage: ProcessingStage,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ProcessingError";
  }
}

export function processingFailure(
  error: unknown,
  stage: ProcessingStage,
  apiKey = "",
): ProcessingFailure {
  const message = redactError(error instanceof Error ? error.message : String(error), apiKey);
  const failureStage = error instanceof ProcessingError ? error.stage : stage;
  const status = error instanceof ProcessingError ? error.status : undefined;
  let hint: string;
  if (failureStage === "captions") {
    hint = "刷新视频页面后重新读取，并确认视频有可用字幕。";
  } else if (failureStage === "input") {
    hint = "当前字幕无法提交给模型；请根据上述限制检查字幕或尝试较短的视频。";
  } else if (failureStage === "cache") {
    hint = "概要已生成，但未能保存到本地；可以先复制或导出概要。";
  } else if (failureStage === "receive") {
    hint = "响应触及扩展的接收上限。请复制错误详情，以便检查单条事件或概要正文的体积。";
  } else if (failureStage === "response") {
    hint = "模型返回的内容不符合概要格式。可以重试；若持续失败，请更换模型。";
  } else if (status === 401 || status === 403) {
    hint = "检查 API Key、模型访问权限和账户状态，然后重试。";
  } else if (status === 429) {
    hint = "接口触发限流或额度限制，请检查账户额度并稍后重试。";
  } else if (status && status >= 500) {
    hint = "模型服务暂时不可用，请稍后重试。";
  } else if (/超时|时限|超过 \d+ 秒|连续 \d+ 秒|timeout|timed out/i.test(message)) {
    hint = "接口长时间无数据或已达到总时限。请检查网络、稍后重试，或选择响应更快的模型。";
  } else if (/message (?:port|channel)|receiving end|context invalidated/i.test(message)) {
    hint = "扩展与后台的连接已中断。请重新打开侧面板后重试。";
  } else if (/fetch|network|网络/i.test(message)) {
    hint = "检查网络及模型接口地址，并在设置中测试连接后重试。";
  } else {
    hint = "可以重试；若持续失败，请复制错误详情以便排查。";
  }
  return { stage: failureStage, message, hint, ...(status ? { status } : {}) };
}

export function redactError(message: string, apiKey = ""): string {
  let text = apiKey ? message.split(apiKey).join("[REDACTED]") : message;
  text = text.replace(/Bearer\s+[^\s"',;]+/gi, "Bearer [REDACTED]");
  return text.slice(0, 2000);
}

export function providerErrorMessage(text: string, status: number): string {
  let detail = "";
  try {
    const parsed = JSON.parse(text) as { error?: { message?: unknown }; message?: unknown } | null;
    const message = parsed?.error?.message ?? parsed?.message;
    if (typeof message === "string") detail = message.trim();
  } catch {
    // Non-JSON error pages are not useful diagnostics.
  }
  return `AI 请求失败：HTTP ${status}${detail ? ` · ${detail}` : ""}`;
}
