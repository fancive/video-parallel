import { chatCompletionsUrl, normalizeBaseUrl, providerSupportsJsonMode } from "./settings";
import type { AppSettings, ProviderProtocol } from "./types";

export interface AiMessage {
  role: "system" | "user";
  content: string;
}

export interface ProviderRequest {
  url: string;
  init: RequestInit;
}

interface CompletionOptions {
  jsonMode?: boolean;
  maxOutputTokens?: number;
}

export function buildCompletionRequest(
  settings: AppSettings,
  messages: AiMessage[],
  options: CompletionOptions = {},
): ProviderRequest {
  const jsonMode = options.jsonMode !== false;
  if (settings.protocol === "anthropic") {
    return buildAnthropicCompletionRequest(settings, messages, options.maxOutputTokens);
  }
  if (settings.protocol === "google") {
    return buildGoogleCompletionRequest(settings, messages, jsonMode, options.maxOutputTokens);
  }
  return buildOpenAiCompletionRequest(settings, messages, jsonMode, options.maxOutputTokens);
}

export function parseCompletionResponse(protocol: ProviderProtocol, responseText: string): string {
  const parsed = JSON.parse(responseText) as Record<string, unknown>;
  let content = "";

  if (protocol === "anthropic") {
    content = textParts(parsed.content);
  } else if (protocol === "google") {
    const candidates = Array.isArray(parsed.candidates) ? parsed.candidates : [];
    const candidate = asRecord(candidates[0]);
    content = textParts(asRecord(candidate?.content)?.parts);
  } else {
    const choices = Array.isArray(parsed.choices) ? parsed.choices : [];
    const message = asRecord(asRecord(choices[0])?.message);
    const value = message?.content;
    content = typeof value === "string" ? value : textParts(value);
  }

  if (!content.trim()) throw new Error("AI 服务返回了空内容。");
  return content.trim();
}

export function buildModelListRequest(settings: AppSettings): ProviderRequest {
  const baseUrl = providerApiRoot(settings.baseUrl);
  const headers = providerHeaders(settings);
  let url = `${baseUrl}/models`;
  if (settings.protocol === "anthropic") url = `${url}?limit=1000`;
  if (settings.protocol === "google") url = `${url}?pageSize=1000`;
  return { url, init: { method: "GET", headers } };
}

export function parseModelListResponse(protocol: ProviderProtocol, responseText: string): string[] {
  const parsed = JSON.parse(responseText) as Record<string, unknown>;
  const values = protocol === "google" ? parsed.models : parsed.data;
  if (!Array.isArray(values)) throw new Error("Provider 未返回可识别的模型列表。");

  const ids = values.flatMap((value) => {
    const model = asRecord(value);
    if (!model) return [];
    if (protocol === "google" && !supportsGoogleGenerateContent(model)) return [];
    const rawId = protocol === "google" ? model.name : model.id;
    if (typeof rawId !== "string" || !rawId.trim()) return [];
    return [rawId.trim().replace(/^models\//, "")];
  });
  return [...new Set(ids)].slice(0, 1000);
}

export function shouldRetryWithoutJsonMode(status: number, responseText: string): boolean {
  if (status !== 400 && status !== 422) return false;
  return /response[_ ]?format|json[_ ]?mode|responsemime|structured output/i.test(responseText);
}

function buildOpenAiCompletionRequest(
  settings: AppSettings,
  messages: AiMessage[],
  jsonMode: boolean,
  maxOutputTokens?: number,
): ProviderRequest {
  const body: Record<string, unknown> = { model: settings.model, messages };
  if (jsonMode && providerSupportsJsonMode(settings)) {
    body.response_format = { type: "json_object" };
  }
  if (maxOutputTokens) body.max_tokens = maxOutputTokens;
  return {
    url: chatCompletionsUrl(settings.baseUrl),
    init: {
      method: "POST",
      headers: providerHeaders(settings),
      body: JSON.stringify(body),
    },
  };
}

function buildAnthropicCompletionRequest(
  settings: AppSettings,
  messages: AiMessage[],
  maxOutputTokens?: number,
): ProviderRequest {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const userMessages = messages
    .filter((message) => message.role === "user")
    .map((message) => ({ role: "user", content: message.content }));
  return {
    url: appendEndpoint(settings.baseUrl, "messages"),
    init: {
      method: "POST",
      headers: providerHeaders(settings),
      body: JSON.stringify({
        model: settings.model,
        max_tokens: maxOutputTokens ?? 8192,
        system,
        messages: userMessages,
      }),
    },
  };
}

function buildGoogleCompletionRequest(
  settings: AppSettings,
  messages: AiMessage[],
  jsonMode: boolean,
  maxOutputTokens?: number,
): ProviderRequest {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const contents = messages
    .filter((message) => message.role === "user")
    .map((message) => ({ role: "user", parts: [{ text: message.content }] }));
  const generationConfig: Record<string, unknown> = {};
  if (jsonMode) generationConfig.responseMimeType = "application/json";
  if (maxOutputTokens) generationConfig.maxOutputTokens = maxOutputTokens;
  const model = settings.model.replace(/^models\//, "");
  return {
    url: `${providerApiRoot(settings.baseUrl)}/models/${encodeURIComponent(model)}:generateContent`,
    init: {
      method: "POST",
      headers: providerHeaders(settings),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents,
        generationConfig,
      }),
    },
  };
}

function providerHeaders(settings: AppSettings): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (!settings.apiKey) return headers;
  if (settings.protocol === "anthropic") {
    headers["x-api-key"] = settings.apiKey;
    headers["anthropic-version"] = "2023-06-01";
    headers["anthropic-dangerous-direct-browser-access"] = "true";
  } else if (settings.protocol === "google") {
    headers["x-goog-api-key"] = settings.apiKey;
  } else {
    headers.Authorization = `Bearer ${settings.apiKey}`;
  }
  return headers;
}

function providerApiRoot(baseUrl: string): string {
  return normalizeBaseUrl(baseUrl).replace(/\/(?:chat\/completions|responses|messages)$/, "");
}

function appendEndpoint(baseUrl: string, endpoint: string): string {
  const root = providerApiRoot(baseUrl);
  return root.endsWith(`/${endpoint}`) ? root : `${root}/${endpoint}`;
}

function supportsGoogleGenerateContent(model: Record<string, unknown>): boolean {
  const methods = model.supportedGenerationMethods ?? model.supportedActions;
  return !Array.isArray(methods) || methods.includes("generateContent");
}

function textParts(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .flatMap((part) => {
      const record = asRecord(part);
      return typeof record?.text === "string" ? [record.text] : [];
    })
    .join("\n");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}
