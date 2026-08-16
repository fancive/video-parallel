import { PROVIDER_PRESETS, providerPreset } from "./provider-catalog";
import type { AppSettings, ProviderId, ProviderProtocol } from "./types";

export { PROVIDER_PRESETS } from "./provider-catalog";

export const SETTINGS_KEY = "video_parallel_settings";

export const DEFAULT_SETTINGS: AppSettings = Object.freeze({
  provider: "deepseek",
  protocol: PROVIDER_PRESETS.deepseek.protocol,
  baseUrl: PROVIDER_PRESETS.deepseek.baseUrl,
  model: PROVIDER_PRESETS.deepseek.model,
  apiKey: "",
  targetLanguage: "zh-CN",
  autoFollow: true,
});

const PROVIDER_IDS = new Set<ProviderId>([
  ...(Object.keys(PROVIDER_PRESETS) as Array<Exclude<ProviderId, "custom">>),
  "custom",
]);
const PROVIDER_PROTOCOLS = new Set<ProviderProtocol>(["openai-compatible", "anthropic", "google"]);

export function normalizeSettings(input: unknown): AppSettings {
  const value = input && typeof input === "object" ? (input as Partial<AppSettings>) : {};
  const provider = PROVIDER_IDS.has(value.provider as ProviderId)
    ? (value.provider as ProviderId)
    : DEFAULT_SETTINGS.provider;
  const preset = providerPreset(provider);
  const protocol = preset
    ? preset.protocol
    : PROVIDER_PROTOCOLS.has(value.protocol as ProviderProtocol)
      ? (value.protocol as ProviderProtocol)
      : DEFAULT_SETTINGS.protocol;

  const model = migrateRetiredModel(
    provider,
    String(value.model ?? preset?.model ?? DEFAULT_SETTINGS.model).trim(),
  );

  return {
    provider,
    protocol,
    baseUrl: normalizeBaseUrl(value.baseUrl ?? preset?.baseUrl ?? DEFAULT_SETTINGS.baseUrl),
    model,
    apiKey: String(value.apiKey ?? "").trim(),
    targetLanguage: String(value.targetLanguage ?? DEFAULT_SETTINGS.targetLanguage).trim(),
    autoFollow: value.autoFollow !== false,
  };
}

function migrateRetiredModel(provider: ProviderId, model: string): string {
  if (provider === "deepseek" && (model === "deepseek-chat" || model === "deepseek-reasoner")) {
    return "deepseek-v4-flash";
  }
  return model;
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
  return [
    settings.provider,
    settings.protocol,
    normalizeBaseUrl(settings.baseUrl),
    settings.model,
  ].join("|");
}

export function providerRequiresApiKey(settings: AppSettings): boolean {
  return settings.provider !== "local" && !isLocalHostname(new URL(settings.baseUrl).hostname);
}

export function providerSupportsJsonMode(settings: AppSettings): boolean {
  return providerPreset(settings.provider)?.jsonMode ?? false;
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
