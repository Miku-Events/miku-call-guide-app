# Miku Call Guide App

Responsive call-guide web app for practicing lyrics and fan calls with YouTube playback.

## Commands

```bash
npm install
npm start
npm run dev
npm run test
npm run test:e2e
npm run build
```

## Runtime Data

Set `VITE_DATA_MANIFEST_URL` to the validated root data manifest URL.

```bash
VITE_DATA_MANIFEST_URL=https://cdn.jsdelivr.net/gh/YOUR_ORG/miku-call-guide-data@release/manifest.json
```

For local development, build and serve the data repo `dist/` on port `4174`; the app defaults to `http://localhost:4174/manifest.json` in dev.

The root manifest points to `call-guide-manifest.json` for songs and `event-calendar/index.json` for the month-sharded event calendar.

## Event Submissions

The `/events` page can show "일정 추가" and "수정 요청" forms. The browser never receives GitHub write credentials. Configure `VITE_SUBMISSION_API_URL` for the client and keep these serverless-only values unprefixed:

```bash
SESSION_SECRET=...
GITHUB_OAUTH_CLIENT_ID=...
GITHUB_OAUTH_CLIENT_SECRET=...
GITHUB_APP_ID=...
GITHUB_APP_PRIVATE_KEY=...
GITHUB_APP_INSTALLATION_ID=...
GITHUB_DATA_OWNER=YOUR_ORG
GITHUB_DATA_REPO=miku-call-guide-data
```

Event additions create pull requests. Event edit requests create GitHub issues.

## Features

- Catalog view with song search and event calendar entry point.
- Event calendar view with monthly shards, type filters, day details, SNS links, add-event requests, and edit requests.
- Runtime manifest/song loading with local cache fallback.
- YouTube IFrame Player API integration.
- Test-only mock player via `?mockPlayer=1`.
- Grapheme-based call anchors rendered above or below the target lyric line.
