# video-parallel

> Turn YouTube captions into AI-generated chapter summaries that stay in sync with playback.

`video-parallel` is a local-first Chrome Side Panel extension. It reads the caption tracks already
available on YouTube without uploading audio or relying on a transcript proxy. The complete
transcript is sent to your configured OpenAI-compatible provider only when you explicitly click
**Process video**.

## Features

- Reads native YouTube caption tracks directly, preferring English and manually created captions.
- Divides videos into chapters based on topic, argument, and narrative transitions instead of fixed
  time intervals.
- Generates a title, a two-to-three-sentence summary, key points, and clickable start and end times
  for every chapter.
- Highlights and scrolls to the active chapter during playback; clicking a chapter seeks the video.
- Supports small, standard, and large reading sizes stored locally and independent of YouTube page
  zoom.
- Supports DeepSeek, OpenAI, OpenRouter, Ollama, and custom OpenAI-compatible endpoints.
- Generates summaries in Simplified Chinese, Traditional Chinese, Japanese, Korean, English, French,
  German, and Spanish.
- Caches chapter structure and summaries independently by video, language, endpoint, model, and
  prompt version.
- Copies or exports summaries with timestamps as Markdown.
- Has no developer-operated backend, analytics, advertising, or telemetry.

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

The extension verifies that every chapter boundary returned by the model corresponds to a real
caption segment. It then produces continuous, non-overlapping chapters that cover the complete
video. A single processing request is currently limited to 2,000 caption segments or 100,000
characters. Videos above either limit fail with an explicit error instead of silently falling back
to mechanical chunking.

## Keyboard shortcuts

- macOS `Option+Shift+9`: open or close the summary side panel for the current YouTube video. The
  default on other platforms is `Alt+Shift+P`.
- `Alt+Shift+S`: open the side panel and process the current video.

You can customize these shortcuts at `chrome://extensions/shortcuts`. If Chrome keeps an old
binding after an extension update, reassign the shortcut for **Open or close the summary side
panel for the current video** on that page.

## Installation

```bash
npm install
npm run build
```

Then:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the generated `dist/` directory.
5. Open the extension settings and configure a Provider, Base URL, Model, and API Key.
6. Open a standard YouTube `watch` page with captions and click **Summary** in the video action bar.

For a local Ollama server, use `http://localhost:11434/v1` and leave the API Key empty.

## Privacy and permissions

- YouTube host permission: reads the current video's metadata, caption track, and playback time.
- `sidePanel`: displays the chapter-summary workspace.
- `storage`: stores settings, API Keys, and summary caches locally in Chrome.
- `tabs` / `scripting`: reads player state and seeks playback only in the target YouTube tab.
- AI endpoints use optional host permissions; saving settings requests access only to the origin of
  the current Base URL.

API Keys are stored in `chrome.storage.local` and restricted to trusted extension contexts, but
Chrome local storage is not an encrypted password vault. Use a dedicated Key with a spending limit,
and do not process private or regulated material.

See [PRIVACY.md](PRIVACY.md) for the complete data-flow and retention disclosure.

## Current limitations

- Requires Chrome 116 or later.
- Supports standard `youtube.com/watch` pages only.
- Requires a native or automatically generated caption track readable from YouTube; the extension
  does not perform local ASR or upload audio for transcription.
- The Provider must support `/chat/completions` and the common OpenAI JSON response format.
- Installation currently uses Developer mode; a Chrome Web Store release with automatic updates is
  not available yet.

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

- Add hierarchical model-driven chaptering for long videos instead of mechanical chunking.
- Reuse native video chapters and allow manual adjustment of model-selected boundaries.
- Add real YouTube end-to-end coverage with Playwright and Chrome extension mode.
- Publish a Chrome Web Store release with automatic updates.

## License

MIT
