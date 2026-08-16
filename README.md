<div align="center">

# video-parallel

### Watch the video. Read the structure.

Turn native YouTube captions into semantic AI chapter summaries that stay in sync with playback.

[![Chrome 116+](https://img.shields.io/badge/Chrome-116%2B-2f59ff?style=flat-square&logo=googlechrome&logoColor=white)](#requirements) [![Manifest V3](https://img.shields.io/badge/Manifest-V3-15212b?style=flat-square)](public/manifest.json) [![Local-first](https://img.shields.io/badge/data-local--first-008f7c?style=flat-square)](PRIVACY.md) [![MIT License](https://img.shields.io/github/license/fancive/video-parallel?style=flat-square)](LICENSE)

[Install from source](#install-from-source) · [How it works](#how-it-works) · [Privacy](PRIVACY.md)

</div>

<p align="center">
  <img src="docs/assets/side-panel.jpg" width="720" alt="video-parallel Side Panel showing semantic chapter summaries with timestamps and key points">
</p>

<p align="center"><sub>The real Side Panel UI, rendered with the bundled preview data.</sub></p>

## Why video-parallel?

| Semantic chapters | Playback-aware reading | Bring your own provider |
| --- | --- | --- |
| The model follows topic, argument, and narrative transitions instead of cutting at fixed intervals. | The active chapter follows playback, and every timestamp is a seek target. | Use DeepSeek, OpenAI, OpenRouter, Ollama, or any compatible endpoint without a developer-operated backend. |

The extension reads caption tracks already available on YouTube. It does not upload audio or depend
on a transcript proxy. The complete transcript is sent to your configured provider only when you
explicitly click **Process video**.

## Install from source

```bash
git clone https://github.com/fancive/video-parallel.git
cd video-parallel
npm install
npm run build
```

Then:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the generated `dist/` directory.
4. Open the extension settings and configure a Provider, Base URL, Model, and API Key.
5. Visit a standard YouTube `watch` page with captions and click **Summary** in the video action bar.

For a local Ollama server, use `http://localhost:11434/v1` and leave the API Key empty.

## What you get

- A title, concise summary, key points, and clickable time range for every chapter.
- Automatic active-chapter highlighting and scrolling during playback.
- Small, standard, and large Side Panel reading sizes independent of YouTube page zoom.
- Summaries in Simplified Chinese, Traditional Chinese, Japanese, Korean, English, French, German,
  and Spanish.
- Separate caches by video, language, endpoint, model, and prompt version.
- One-click copy and Markdown export with timestamps.
- No developer-operated backend, analytics, advertising, or telemetry.

## How it works

```text
YouTube caption track
        ↓
Complete transcript + stable segment IDs + timestamps
        ↓
Target-language conversion + semantic chaptering + summarization
        ↓
Seekable chapter cards + local cache + Markdown
```

The extension accepts only model-selected chapter boundaries that correspond to real caption
segments. It then produces continuous, non-overlapping chapters covering the complete video.

> [!NOTE]
> A single processing request is currently limited to 2,000 caption segments or 100,000 characters.
> Videos above either limit fail explicitly instead of silently falling back to mechanical chunking.

## Providers and languages

| Provider | Default endpoint | API Key |
| --- | --- | --- |
| DeepSeek | `https://api.deepseek.com` | Required |
| OpenAI | `https://api.openai.com/v1` | Required |
| OpenRouter | `https://openrouter.ai/api/v1` | Required |
| Ollama | `http://localhost:11434/v1` | Optional |
| Custom | Any OpenAI-compatible HTTPS endpoint | Provider-dependent |

Non-local endpoints must use HTTPS. Saving settings requests optional host access only for the
configured origin.

## Privacy by design

> [!IMPORTANT]
> The complete transcript and video title are sent directly to the AI Provider you configure.
> Provider settings, API Keys, and summary caches stay in `chrome.storage.local`, but Chrome local
> storage is not an encrypted password vault. Use a dedicated Key with a spending limit.

Permissions are deliberately scoped:

- YouTube host access reads video metadata, caption tracks, and playback time.
- `sidePanel` displays the chapter-summary workspace.
- `storage` keeps settings, Keys, and summary caches locally.
- `tabs` and `scripting` read player state and seek playback in the target YouTube tab.
- AI endpoint access is optional and requested for the configured origin when settings are saved.

Read the complete [Privacy Policy](PRIVACY.md) and [Security Policy](SECURITY.md) before processing
private, confidential, or regulated material.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| macOS `Option+Shift+9` | Open or close the summary Side Panel |
| Other platforms `Alt+Shift+P` | Open or close the summary Side Panel |
| `Alt+Shift+S` | Open the Side Panel and process the current video |

Shortcuts can be customized at `chrome://extensions/shortcuts`.

## Requirements

- Chrome 116 or later.
- A standard `youtube.com/watch` page with a readable native or automatically generated caption
  track.
- An OpenAI-compatible Provider supporting `/chat/completions` and the common OpenAI JSON response
  format.

Shorts, live streams, local ASR, and audio-upload transcription are not currently supported. Chrome
Web Store installation and automatic updates are not available yet.

## Development

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run check
npm run package
```

`npm run package` creates `release/video-parallel-v0.1.14.zip`.

## Roadmap

- Add hierarchical model-driven chaptering for long videos.
- Reuse native video chapters and allow manual adjustment of model-selected boundaries.
- Add real YouTube end-to-end coverage with Playwright and Chrome extension mode.
- Publish a Chrome Web Store release with automatic updates.

## License

[MIT](LICENSE)
