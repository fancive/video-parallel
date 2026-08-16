import {
  PROVIDER_CATALOG_UPDATED_AT,
  PROVIDER_CATEGORY_LABELS,
  PROVIDER_CATEGORY_ORDER,
  PROVIDER_PRESETS,
  providerPreset,
} from "./lib/provider-catalog";
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  providerOriginPattern,
  providerRequiresApiKey,
  SETTINGS_KEY,
} from "./lib/settings";
import type { AppSettings, ProviderId, ProviderProtocol } from "./lib/types";

interface RuntimeResponse {
  ok: boolean;
  error?: string;
  message?: string;
  models?: string[];
}

const form = element<HTMLFormElement>("settingsForm");
const providerInput = element<HTMLSelectElement>("provider");
const protocolInput = element<HTMLSelectElement>("protocol");
const modelSelect = element<HTMLSelectElement>("modelSelect");
const modelInput = element<HTMLInputElement>("model");
const baseUrlInput = element<HTMLInputElement>("baseUrl");
const apiKeyInput = element<HTMLInputElement>("apiKey");
const apiKeyLabel = element<HTMLElement>("apiKeyLabel");
const targetLanguageInput = element<HTMLSelectElement>("targetLanguage");
const autoFollowInput = element<HTMLInputElement>("autoFollow");
const providerRouteKind = element<HTMLElement>("providerRouteKind");
const providerRouteProtocol = element<HTMLElement>("providerRouteProtocol");
const providerRouteCatalog = element<HTMLElement>("providerRouteCatalog");
const providerStatus = element<HTMLElement>("providerStatus");
const discoverModelsButton = element<HTMLButtonElement>("discoverModelsButton");
const testProviderButton = element<HTMLButtonElement>("testProviderButton");
const saveStatus = element<HTMLElement>("saveStatus");
const saveButton = form.querySelector<HTMLButtonElement>("button[type=submit]");
const hasExtensionRuntime = typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);

const PROTOCOL_LABELS: Record<ProviderProtocol, string> = {
  "openai-compatible": "OpenAI-compatible",
  anthropic: "Anthropic Messages",
  google: "Gemini GenerateContent",
};

populateProviderChoices();

if (hasExtensionRuntime) {
  void restoreSettings();
} else {
  populateSettings(DEFAULT_SETTINGS);
  saveStatus.textContent = "本地预览模式";
  setProviderStatus("安装扩展后可读取模型并测试连接。", "idle");
}

providerInput.addEventListener("change", () => {
  applyProviderSelection(providerInput.value as ProviderId, true);
  markDirty();
});

protocolInput.addEventListener("change", () => {
  updateProviderPresentation();
  markDirty();
});

modelSelect.addEventListener("change", () => {
  if (!modelSelect.value) return;
  modelInput.value = modelSelect.value;
  markDirty();
});

modelInput.addEventListener("input", syncModelSelection);

discoverModelsButton.addEventListener(
  "click",
  () => void runProviderAction("LIST_PROVIDER_MODELS"),
);
testProviderButton.addEventListener("click", () => void runProviderAction("TEST_PROVIDER"));

form.addEventListener("input", markDirty);
form.addEventListener("submit", (event) => {
  event.preventDefault();
  void saveSettings();
});

async function restoreSettings(): Promise<void> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  const settings = normalizeSettings(stored[SETTINGS_KEY] ?? DEFAULT_SETTINGS);
  populateSettings(settings);
  saveStatus.textContent = "设置已载入";
}

function populateProviderChoices(): void {
  providerInput.replaceChildren();
  for (const category of PROVIDER_CATEGORY_ORDER) {
    const group = document.createElement("optgroup");
    group.label = PROVIDER_CATEGORY_LABELS[category];
    for (const preset of Object.values(PROVIDER_PRESETS)) {
      if (preset.category !== category) continue;
      const option = document.createElement("option");
      option.value = preset.id;
      option.textContent = preset.label;
      group.appendChild(option);
    }
    providerInput.appendChild(group);
  }
  const custom = document.createElement("option");
  custom.value = "custom";
  custom.textContent = "Custom endpoint";
  providerInput.appendChild(custom);
}

function populateSettings(settings: AppSettings): void {
  providerInput.value = settings.provider;
  protocolInput.value = settings.protocol;
  modelInput.value = settings.model;
  baseUrlInput.value = settings.baseUrl;
  apiKeyInput.value = settings.apiKey;
  targetLanguageInput.value = settings.targetLanguage;
  autoFollowInput.checked = settings.autoFollow;
  applyProviderSelection(settings.provider, false);
}

function applyProviderSelection(provider: ProviderId, replaceValues: boolean): void {
  const preset = providerPreset(provider);
  protocolInput.disabled = Boolean(preset);
  if (preset && replaceValues) {
    protocolInput.value = preset.protocol;
    baseUrlInput.value = preset.baseUrl;
    modelInput.value = preset.model;
  }
  populateModelOptions(preset?.models ?? [], modelInput.value);
  apiKeyLabel.textContent = preset?.apiKeyLabel ?? "API Key";
  setProviderStatus(
    preset
      ? `${preset.models.length} 个内置建议；也可以读取账号模型。测试会发送极小生成请求。`
      : "可手填模型或尝试标准模型列表接口；测试会发送极小生成请求。",
    "idle",
  );
  updateProviderPresentation();
}

function updateProviderPresentation(modelCount?: number): void {
  const provider = providerInput.value as ProviderId;
  const preset = providerPreset(provider);
  const protocol = protocolInput.value as ProviderProtocol;
  providerRouteKind.textContent = preset ? PROVIDER_CATEGORY_LABELS[preset.category] : "自定义连接";
  providerRouteProtocol.textContent = PROTOCOL_LABELS[protocol];
  providerRouteCatalog.textContent = modelCount
    ? `${modelCount} 个账号模型`
    : `目录 ${PROVIDER_CATALOG_UPDATED_AT}`;
}

async function saveSettings(): Promise<void> {
  saveButton?.setAttribute("disabled", "true");
  try {
    const settings = readFormSettings();
    if (!hasExtensionRuntime) {
      populateSettings(settings);
      saveStatus.textContent = "预览模式不会保存设置";
      return;
    }
    await ensureOriginPermission(settings);
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    saveStatus.textContent = "设置已保存";
  } catch (error) {
    saveStatus.textContent = errorMessage(error);
  } finally {
    saveButton?.removeAttribute("disabled");
  }
}

async function runProviderAction(type: "LIST_PROVIDER_MODELS" | "TEST_PROVIDER"): Promise<void> {
  if (!hasExtensionRuntime) {
    setProviderStatus("安装扩展后可执行该操作。", "error");
    return;
  }
  setProviderToolsDisabled(true);
  setProviderStatus(
    type === "LIST_PROVIDER_MODELS" ? "正在读取模型列表…" : "正在发送测试请求…",
    "idle",
  );
  try {
    const settings = readFormSettings(type === "TEST_PROVIDER");
    await ensureOriginPermission(settings);
    const response = await sendMessage({ type, settings });
    if (!response.ok) throw new Error(response.error || "Provider 请求失败。");

    if (type === "LIST_PROVIDER_MODELS") {
      const models = response.models ?? [];
      if (models.length === 0) throw new Error("Provider 没有返回模型。");
      populateModelOptions(models, modelInput.value);
      if (!modelInput.value.trim()) {
        modelInput.value = models[0] ?? "";
        syncModelSelection();
      }
      updateProviderPresentation(models.length);
      setProviderStatus(
        `已读取 ${models.length} 个模型；请从 Model 下拉框选择，或继续手动输入。`,
        "success",
      );
    } else {
      setProviderStatus(response.message || "连接测试通过。", "success");
    }
  } catch (error) {
    setProviderStatus(errorMessage(error), "error");
  } finally {
    setProviderToolsDisabled(false);
  }
}

function readFormSettings(requireModel = true): AppSettings {
  const settings = normalizeSettings({
    provider: providerInput.value,
    protocol: protocolInput.value,
    model: modelInput.value,
    baseUrl: baseUrlInput.value,
    apiKey: apiKeyInput.value,
    targetLanguage: targetLanguageInput.value,
    autoFollow: autoFollowInput.checked,
  });
  if (requireModel && !settings.model) throw new Error("请填写或选择模型名称。");
  if (!settings.apiKey && providerRequiresApiKey(settings)) {
    throw new Error("当前 Provider 需要 API Key。");
  }
  return settings;
}

async function ensureOriginPermission(settings: AppSettings): Promise<void> {
  const origin = providerOriginPattern(settings.baseUrl);
  const granted = await chrome.permissions.request({ origins: [origin] });
  if (!granted) throw new Error(`未获得 ${origin} 的访问权限。`);
}

function populateModelOptions(models: readonly string[], selectedModel: string): void {
  modelSelect.replaceChildren();
  const values = [...new Set(models.map((model) => model.trim()).filter(Boolean))];
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = values.length
    ? `选择模型（${values.length} 个）`
    : "暂无模型建议，请手动输入";
  modelSelect.appendChild(placeholder);
  for (const model of values) {
    const option = document.createElement("option");
    option.value = model;
    option.textContent = model;
    modelSelect.appendChild(option);
  }
  modelSelect.disabled = values.length === 0;
  modelSelect.value = values.includes(selectedModel.trim()) ? selectedModel.trim() : "";
}

function syncModelSelection(): void {
  const model = modelInput.value.trim();
  modelSelect.value = Array.from(modelSelect.options).some((option) => option.value === model)
    ? model
    : "";
}

function setProviderToolsDisabled(disabled: boolean): void {
  discoverModelsButton.disabled = disabled;
  testProviderButton.disabled = disabled;
}

function setProviderStatus(message: string, state: "idle" | "success" | "error"): void {
  providerStatus.textContent = message;
  providerStatus.dataset.state = state;
}

function markDirty(): void {
  saveStatus.textContent = "有未保存的修改";
}

function sendMessage(message: Record<string, unknown>): Promise<RuntimeResponse> {
  return chrome.runtime.sendMessage(message) as Promise<RuntimeResponse>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}
