import type { ProviderCategory, ProviderId, ProviderPreset } from "./types";

export const PROVIDER_CATALOG_UPDATED_AT = "2026-08-16";

export const PROVIDER_PRESETS = {
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    category: "direct",
    protocol: "openai-compatible",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
    models: ["deepseek-v4-flash", "deepseek-v4-pro"],
    apiKeyLabel: "DeepSeek API Key",
    jsonMode: true,
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    category: "direct",
    protocol: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-5-mini",
    models: ["gpt-5-mini", "gpt-5-nano", "gpt-5.6-luna", "gpt-4o-mini"],
    apiKeyLabel: "OpenAI API Key",
    jsonMode: true,
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    category: "direct",
    protocol: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-sonnet-4-6",
    models: ["claude-sonnet-4-6", "claude-sonnet-5", "claude-fable-5", "claude-opus-4-6"],
    apiKeyLabel: "Anthropic API Key",
    jsonMode: false,
  },
  google: {
    id: "google",
    label: "Google Gemini",
    category: "direct",
    protocol: "google",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    model: "gemini-3.6-flash",
    models: ["gemini-3.6-flash", "gemini-3.7-flash", "gemini-3.5-flash-lite"],
    apiKeyLabel: "Gemini API Key",
    jsonMode: true,
  },
  xai: {
    id: "xai",
    label: "xAI",
    category: "direct",
    protocol: "openai-compatible",
    baseUrl: "https://api.x.ai/v1",
    model: "grok-4.5",
    models: ["grok-4.5", "grok-4.6", "grok-4.20-0309-non-reasoning"],
    apiKeyLabel: "xAI API Key",
    jsonMode: true,
  },
  mistral: {
    id: "mistral",
    label: "Mistral",
    category: "direct",
    protocol: "openai-compatible",
    baseUrl: "https://api.mistral.ai/v1",
    model: "mistral-small-latest",
    models: ["mistral-small-latest", "mistral-medium-latest", "mistral-large-latest"],
    apiKeyLabel: "Mistral API Key",
    jsonMode: true,
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    category: "gateway",
    protocol: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openai/gpt-5-mini",
    models: [
      "openai/gpt-5-mini",
      "anthropic/claude-sonnet-4.6",
      "google/gemini-3.6-flash",
      "deepseek/deepseek-chat",
    ],
    apiKeyLabel: "OpenRouter API Key",
    jsonMode: true,
  },
  groq: {
    id: "groq",
    label: "Groq",
    category: "gateway",
    protocol: "openai-compatible",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "openai/gpt-oss-20b",
    models: ["openai/gpt-oss-20b", "openai/gpt-oss-120b", "qwen/qwen3.6-27b"],
    apiKeyLabel: "Groq API Key",
    jsonMode: true,
  },
  together: {
    id: "together",
    label: "Together AI",
    category: "gateway",
    protocol: "openai-compatible",
    baseUrl: "https://api.together.xyz/v1",
    model: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    models: [
      "meta-llama/Llama-3.3-70B-Instruct-Turbo",
      "deepseek-ai/DeepSeek-V4-Flash-0731",
      "moonshotai/Kimi-K3",
    ],
    apiKeyLabel: "Together API Key",
    jsonMode: true,
  },
  cerebras: {
    id: "cerebras",
    label: "Cerebras",
    category: "gateway",
    protocol: "openai-compatible",
    baseUrl: "https://api.cerebras.ai/v1",
    model: "gpt-oss-120b",
    models: ["gpt-oss-120b", "zai-glm-4.7", "gemma-4-31b"],
    apiKeyLabel: "Cerebras API Key",
    jsonMode: true,
  },
  local: {
    id: "local",
    label: "Local / Ollama",
    category: "local",
    protocol: "openai-compatible",
    baseUrl: "http://localhost:11434/v1",
    model: "qwen3:8b",
    models: ["qwen3:8b", "llama3.2:3b", "deepseek-r1:8b"],
    apiKeyLabel: "API Key",
    jsonMode: false,
  },
} as const satisfies Record<Exclude<ProviderId, "custom">, ProviderPreset>;

export const PROVIDER_CATEGORY_LABELS: Record<ProviderCategory, string> = {
  direct: "直接连接",
  gateway: "兼容服务",
  local: "本地模型",
};

export const PROVIDER_CATEGORY_ORDER: ProviderCategory[] = ["direct", "gateway", "local"];

export function providerPreset(provider: ProviderId): ProviderPreset | undefined {
  if (provider === "custom") return undefined;
  return PROVIDER_PRESETS[provider];
}
