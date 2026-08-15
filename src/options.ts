import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  PROVIDER_PRESETS,
  providerOriginPattern,
  SETTINGS_KEY,
} from "./lib/settings";
import type { AppSettings, ProviderId } from "./lib/types";

const form = element<HTMLFormElement>("settingsForm");
const providerInput = element<HTMLSelectElement>("provider");
const modelInput = element<HTMLInputElement>("model");
const baseUrlInput = element<HTMLInputElement>("baseUrl");
const apiKeyInput = element<HTMLInputElement>("apiKey");
const targetLanguageInput = element<HTMLSelectElement>("targetLanguage");
const autoFollowInput = element<HTMLInputElement>("autoFollow");
const saveStatus = element<HTMLElement>("saveStatus");
const saveButton = form.querySelector<HTMLButtonElement>("button[type=submit]");
const hasExtensionRuntime = typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);

if (hasExtensionRuntime) {
  void restoreSettings();
} else {
  populateSettings(DEFAULT_SETTINGS);
  saveStatus.textContent = "本地预览模式";
}

providerInput.addEventListener("change", () => {
  const provider = providerInput.value as ProviderId;
  if (provider !== "custom") {
    const preset = PROVIDER_PRESETS[provider];
    baseUrlInput.value = preset.baseUrl;
    modelInput.value = preset.model;
  }
  markDirty();
});

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

function populateSettings(settings: AppSettings): void {
  providerInput.value = settings.provider;
  modelInput.value = settings.model;
  baseUrlInput.value = settings.baseUrl;
  apiKeyInput.value = settings.apiKey;
  targetLanguageInput.value = settings.targetLanguage;
  autoFollowInput.checked = settings.autoFollow;
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
    const origin = providerOriginPattern(settings.baseUrl);
    const granted = await chrome.permissions.request({ origins: [origin] });
    if (!granted) throw new Error(`未获得 ${origin} 的访问权限。`);

    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    saveStatus.textContent = "设置已保存";
  } catch (error) {
    saveStatus.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    saveButton?.removeAttribute("disabled");
  }
}

function readFormSettings(): AppSettings {
  const settings = normalizeSettings({
    provider: providerInput.value,
    model: modelInput.value,
    baseUrl: baseUrlInput.value,
    apiKey: apiKeyInput.value,
    targetLanguage: targetLanguageInput.value,
    autoFollow: autoFollowInput.checked,
  });
  if (!settings.model) throw new Error("请填写模型名称。");
  if (!settings.apiKey && settings.provider !== "local") {
    throw new Error("当前 Provider 需要 API Key。");
  }
  return settings;
}

function markDirty(): void {
  saveStatus.textContent = "有未保存的修改";
}

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}
