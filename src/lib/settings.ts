import type { AppSettings, ProviderId, ProviderPreset } from "./types";

export const SETTINGS_KEY = "video_parallel_settings";

export const PROVIDER_PRESETS: Record<Exclude<ProviderId, "custom">, ProviderPreset> = {
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-chat",
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-5-mini",
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openai/gpt-5-mini",
  },
  local: {
    id: "local",
    label: "Local / Ollama",
    baseUrl: "http://localhost:11434/v1",
    model: "qwen3:8b",
  },
};

export const DEFAULT_SETTINGS: AppSettings = Object.freeze({
  provider: "deepseek",
  baseUrl: PROVIDER_PRESETS.deepseek.baseUrl,
  model: PROVIDER_PRESETS.deepseek.model,
  apiKey: "",
  targetLanguage: "zh-CN",
  autoFollow: true,
});

const PROVIDER_IDS = new Set<ProviderId>(["deepseek", "openai", "openrouter", "local", "custom"]);

export function normalizeSettings(input: unknown): AppSettings {
  const value = input && typeof input === "object" ? (input as Partial<AppSettings>) : {};
  const provider = PROVIDER_IDS.has(value.provider as ProviderId)
    ? (value.provider as ProviderId)
    : DEFAULT_SETTINGS.provider;

  return {
    provider,
    baseUrl: normalizeBaseUrl(value.baseUrl ?? DEFAULT_SETTINGS.baseUrl),
    model: String(value.model ?? DEFAULT_SETTINGS.model).trim(),
    apiKey: String(value.apiKey ?? "").trim(),
    targetLanguage: String(value.targetLanguage ?? DEFAULT_SETTINGS.targetLanguage).trim(),
    autoFollow: value.autoFollow !== false,
  };
}

export function normalizeBaseUrl(input: string): string {
  const trimmed = String(input).trim().replace(/\/+$/, "");
  const url = new URL(trimmed);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Base URL 必须使用 http 或 https。");
  }
  if (url.protocol === "http:" && !isLocalHostname(url.hostname)) {
    throw new Error("非本地接口必须使用 https。");
  }
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/$/, "");
}

export function chatCompletionsUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl);
  return normalized.endsWith("/chat/completions") ? normalized : `${normalized}/chat/completions`;
}

export function providerOriginPattern(baseUrl: string): string {
  const url = new URL(normalizeBaseUrl(baseUrl));
  return `${url.protocol}//${url.host}/*`;
}

export function providerFingerprint(settings: AppSettings): string {
  return [settings.provider, normalizeBaseUrl(settings.baseUrl), settings.model].join("|");
}

export function isLocalHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export const TARGET_LANGUAGE_LABELS: Record<string, string> = {
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文",
  ja: "日本語",
  ko: "한국어",
  en: "English",
  fr: "Français",
  de: "Deutsch",
  es: "Español",
};
