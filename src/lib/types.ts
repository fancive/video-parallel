export type ProviderId = "deepseek" | "openai" | "openrouter" | "local" | "custom";

export interface AppSettings {
  provider: ProviderId;
  baseUrl: string;
  model: string;
  apiKey: string;
  targetLanguage: string;
  autoFollow: boolean;
}

export interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  name: string;
  kind?: string;
  isTranslatable?: boolean;
}

export interface TranscriptSegment {
  id: string;
  startMs: number;
  durationMs: number;
  text: string;
}

export interface VideoContext {
  tabId: number;
  videoId: string;
  title: string;
  channel: string;
  durationSeconds: number;
  sourceLanguage: string;
  segments: TranscriptSegment[];
}

export interface ProviderPreset {
  id: ProviderId;
  label: string;
  baseUrl: string;
  model: string;
}

export interface SummaryContent {
  title: string;
  summary: string;
  keyPoints: string[];
}

export interface ChapterOutline extends SummaryContent {
  startSegmentId: string;
}

export interface SummaryBlock {
  id: string;
  startMs: number;
  endMs: number;
  content: SummaryContent;
}

export interface SummaryCache {
  version: 2;
  promptVersion: number;
  videoId: string;
  targetLanguage: string;
  providerFingerprint: string;
  sourceFingerprint: string;
  chapters: Array<{ startMs: number; content: SummaryContent }>;
  updatedAt: number;
}

export interface PlayerSnapshot {
  videoId: string;
  title: string;
  channel: string;
  durationSeconds: number;
  tracks: CaptionTrack[];
}
