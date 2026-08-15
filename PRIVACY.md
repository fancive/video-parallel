# Privacy

Effective: August 12, 2026

`video-parallel` is a local-first, bring-your-own-key Chrome extension. It has no
developer-operated backend, account system, analytics, advertising, or telemetry.

## Data flow

- The extension reads the active YouTube video's ID, title, channel, duration, caption track,
  and playback time directly from the YouTube tab.
- Caption files are requested directly from YouTube. Audio and video files are not uploaded.
- Chapter-summary generation starts only when the user requests it. The complete transcript and
  video title are then sent directly to the configured AI Provider so it can translate, identify
  semantic chapter boundaries, and write the summary in the selected language.
- The configured Base URL receives the API Key supplied by the user, using the Provider's normal
  `Authorization` header.

## Local storage

Provider settings, API Keys, and chapter-summary caches are stored in `chrome.storage.local` and
restricted to trusted extension contexts. Chrome extension storage is not an encrypted password
vault. Use a dedicated Key, set spending limits, and revoke the Key if the browser profile or
device is compromised.

Removing the extension or clearing its extension data removes local settings and caches. It does
not delete data already processed or retained by YouTube or the configured AI Provider.

## Permissions

- `sidePanel`: show the parallel reading workspace.
- `storage`: save settings, Keys, and chapter-summary caches locally.
- `tabs` and `scripting`: read and control the active YouTube player.
- YouTube host access: read player metadata and caption files.
- Optional AI host access: requested for only the configured Provider origin when settings are
  saved.

Review the configured Provider's privacy, retention, and data-processing terms before summarizing
private, personal, confidential, or regulated content.
