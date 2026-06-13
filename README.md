# Migaku RSVP

A local EPUB RSVP reader for Japanese books. It imports DRM-free EPUB files in the browser, stores them locally with IndexedDB, and renders the active sentence in the page DOM so the Migaku browser extension can parse, classify, and mine from the full sentence context.

## Run

```bash
npm install
npm run dev -- --host 127.0.0.1 --port 5173
```

Open `http://127.0.0.1:5173`, import an EPUB, and enable Migaku for that local site.

## Home Server EPUB Library

The app still works as a static GitHub Pages build by default. To run it with a shared EPUB
folder and cross-device reading progress, build the app and start the optional Node server:

```bash
npm run build
EPUB_LIBRARY_PATH=/path/to/epubs npm run serve:library
```

Open `http://localhost:4173`. EPUB files under `EPUB_LIBRARY_PATH` are listed in the
library and progress for those server books is saved in `.migaku-rsvp-progress.json`.

Optional environment variables:

- `PORT`: server port, defaults to `4173`.
- `HOST`: bind host, defaults to `0.0.0.0`.
- `MIGAKU_RSVP_PROGRESS_PATH`: custom JSON progress file path.

## Migaku Behavior

- Default pause mode stops on Migaku-marked unknown words.
- `Never` keeps the RSVP reader moving.
- `i+1` stops when the active word is the only unknown word in the current sentence.
- A faint buffered `lang="ja"` text tray keeps surrounding sentences rendered in the DOM so Migaku can parse ahead and preserve full-sentence context while RSVP stays focused on the configured word count.

Migaku does not expose a stable public web-app API, so all DOM/status detection is isolated in `src/lib/migakuAdapter.ts`.

## Test

```bash
npm test
npm run build
npm run test:e2e
```

The tests use a generated synthetic EPUB fixture. Downloaded books are only for local manual testing and should not be committed.

## Deploy

Pushing to `main` deploys the Vite build to GitHub Pages through `.github/workflows/pages.yml`.
