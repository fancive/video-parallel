export type PanelFontSize = "small" | "standard" | "large";

export interface PanelPreferences {
  fontSize: PanelFontSize;
}

export const PANEL_PREFERENCES_KEY = "video_parallel_panel_preferences";

export const DEFAULT_PANEL_PREFERENCES: PanelPreferences = Object.freeze({
  fontSize: "standard",
});

const PANEL_FONT_SIZES = new Set<PanelFontSize>(["small", "standard", "large"]);

export function normalizePanelPreferences(input: unknown): PanelPreferences {
  const value = input && typeof input === "object" ? (input as Partial<PanelPreferences>) : {};
  const fontSize = PANEL_FONT_SIZES.has(value.fontSize as PanelFontSize)
    ? (value.fontSize as PanelFontSize)
    : DEFAULT_PANEL_PREFERENCES.fontSize;

  return { fontSize };
}
