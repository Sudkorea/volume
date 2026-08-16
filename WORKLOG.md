# Worklog

## 2026-08-16

- Confirmed the public list HTML exposes target post numbers and view counts.
- Confirmed the list response is smaller than a detail-page response and does
  not require opening either target post.
- Confirmed `snb-macbook-pro` is reachable and has Node.js 22.
- Started implementation. No Discord webhook credential is currently stored in
  this repository.
- Replaced the generic site starter with a single-process Node.js service suited
  to the requested self-hosted Mac deployment. The starter initializer itself
  was unusable because its bundled shell files had CRLF line endings.
- Implemented the DC list parser, two-page cursor tracker, adaptive shared
  poller, SSE fan-out, JSON state persistence, and Discord deletion notifier.
- Implemented the submission UI, initial boost choice, generated browser test
  audio, local audio-file playback, live telemetry, and deletion state.
- `npm run verify` passed locally: 6 tests, syntax/build validation, and HTTP
  smoke update from boost volume 86 to 87.
- Browser smoke passed: boost 187 to 188 updated volume 86 to 87 over SSE;
  normal mode displayed 42 modulo 100 as volume 42. Fixed CSP and favicon errors
  found during the first browser pass.
- Deployed to `/Users/snb/Services/volume-oracle`, installed the
  `com.volume-oracle` launchd service, and reran the full verification remotely.
- Remote live state reported normal post 9 at volume 3 and boost post 10 at
  volume 10 with page cursor 1 and no upstream error.
- Public Tailscale Funnel remains blocked on the required tailnet approval.
  Real Discord delivery remains blocked on the missing webhook credential.
- Began a user-requested visual revision: replace the neon protocol dashboard
  and over-explained jokes with a quiet, conventional audio-settings surface.
- Replaced the setup and dashboard copy with short, factual labels and removed
  the protocol/oracle/global-consensus framing from the interface.
- Reworked the visual system around neutral off-white surfaces, thin borders,
  system typography, and a single pale mint/yellow accent for boost mode.
- Re-ran the browser flow against the mock tracker: boost updated from 87% to
  88% over SSE at 189 views, and normal mode switched to 42% at 42 views.
- Captured and inspected setup, boost, and normal-mode screenshots. The normal
  layout remains visually neutral and the boost state is identified only by a
  small badge and the pastel volume accent.
- Updated the HTTP smoke assertion to check stable setup/dashboard element IDs
  after it correctly caught a stale dependency on the removed `VOLU-MOD` copy.
- `npm run verify` passed after the revision: 6 tests, build/syntax checks, and
  the mock HTTP update from boost volume 86 to 87.
- Synced the revised UI to `/Users/snb/Services/volume-oracle`, reinstalled the
  launchd service, and ran `npm run verify` successfully on `snb-macbook-pro`.
- Verified the restarted service serves the new copy and reports a healthy live
  DC source on page 1. Discord remains unconfigured pending a real webhook.
- Hid the boost mechanism on the setup screen by changing its helper text from
  a view-count explanation to the deadpan result, `볼륨이 더 잘 커집니다.`
- Started the public deployment split: GitHub Pages will serve the static UI,
  while `snb-macbook-pro` continues to own polling, SSE, deletion detection,
  persistence, and Discord delivery.
- Confirmed GitHub CLI authentication for `Sudkorea`, confirmed that the
  `Sudkorea/volume` repository name is available, and identified the stable
  Funnel hostname as `snb-macbook-pro.tail643f01.ts.net`.
- Tailscale requires an account-level Funnel approval. Opened the approval flow
  for the user while continuing the local implementation.
- Added project-relative asset URLs and a Pages-only API base so the same
  frontend works from `/volume/` while local development keeps same-origin API
  calls.
- Added exact-origin CORS support for JSON and SSE, plus automated tests for the
  allowed Pages origin and an unrelated denied origin.
- `npm run verify` passed locally and on `snb-macbook-pro`: 8 tests, build
  checks, and the 86-to-87 mock volume smoke flow.
- Reinstalled the remote launchd service and verified that only
  `https://sudkorea.github.io` receives `Access-Control-Allow-Origin`.
- Created the public `Sudkorea/volume` repository, enabled GitHub Pages with the
  Actions workflow, and published `https://sudkorea.github.io/volume/`.
- Verified the published HTML, `app.js`, and `styles.css` all return HTTP 200
  from the `/volume/` project path and contain the expected Funnel API base.
- End-to-end live state remains pending only on the account-level Tailscale
  Funnel approval currently open in the browser.
