export type ProviderId =
  | "deepseek"
  | "openai"
  | "openrouter"
  | "anthropic"
  | "google"
  | "groq"
  | "mistral"
  | "xai"
  | "together"
  | "cerebras"
  | "local"
  | "custom";

export type ProviderProtocol = "openai-compatible" | "anthropic" | "google";

export type ProviderCategory = "direct" | "gateway" | "local";

export type VideoPlatform = "youtube" | "bilibili";

export interface VideoPage {
  platform: VideoPlatform;
  videoId: string;
  pageNumber: number;
  sourceKey: string;
  sourceUrl: string;
}

export interface AppSettings {
  provider: ProviderId;
  protocol: ProviderProtocol;
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
  platform: VideoPlatform;
  videoId: string;
  sourceKey: string;
  sourceUrl: string;
  title: string;
  channel: string;
  durationSeconds: number;
  sourceLanguage: string;
  segments: TranscriptSegment[];
}

export interface ProviderPreset {
  id: ProviderId;
  label: string;
  category: ProviderCategory;
  protocol: ProviderProtocol;
  baseUrl: string;
  model: string;
  models: readonly string[];
  apiKeyLabel: string;
  jsonMode: boolean;
}

export interface SummaryContent {
  title: string;
  summary: string;
  keyPoints: string[];
}

export interface VideoOverview {
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

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface SummaryCache {
  version: 4;
  promptVersion: number;
  sourceKey: string;
  targetLanguage: string;
  providerFingerprint: string;
  sourceFingerprint: string;
  overview: VideoOverview;
  chapters: Array<{ startMs: number; content: SummaryContent }>;
  usage?: TokenUsage;
  updatedAt: number;
}

export interface PlayerSnapshot {
  videoId: string;
  title: string;
  channel: string;
  durationSeconds: number;
  tracks: CaptionTrack[];
}
