# Security Policy

## Supported version

Security fixes are applied to the latest code on `main`. The current `0.1.x` line is an MVP and
has not completed a third-party security audit.

## Reporting

Do not publish API Keys, private video URLs, transcripts, or proof-of-concept content in a public
issue. Use GitHub private vulnerability reporting when it is available, or contact the repository
owner through their GitHub profile to request a private channel.

## User guidance

- Install only a revision you trust and review permission changes before updating.
- Use dedicated Provider Keys with spending limits; never reuse production credentials.
- Do not put Keys in source files, prompts, screenshots, logs, commits, or issue reports.
- Prefer HTTPS Provider endpoints. Plain HTTP is accepted only for localhost loopback services.
- Remember that `chrome.storage.local` is local but not encrypted.
