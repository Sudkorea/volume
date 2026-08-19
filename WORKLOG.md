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
- Performed a security hardening pass before enabling Funnel: bounded global
  HTTP/SSE load and slow-client buffers, rate-limited reconnects, upstream
  response validation, private rotating logs/state, Discord destination and
  mention validation, mock-mode production rejection, and exact CORS handling.
- Added immutable GitHub Actions pins, a mandatory verify job, tracked/deploy
  tree secret scanning, browser CSP/referrer policy, fetch timeouts, and
  exponential retry jitter. Enabled GitHub Dependabot alerts and automated
  security fixes; secret scanning and push protection were already enabled.
- Updated Cheerio to `1.2.0`; `npm audit --omit=dev` reports zero known
  vulnerabilities. Updated local repository author email for future commits to
  `butterserverrobot@gmail.com`.
- Added deletion-blind-spot coverage for an outer guard alone on an adjacent
  page. Fixed bounded recovery so repeated cooldown windows advance beyond the
  first five pages without increasing the per-poll request ceiling.
- `npm run verify` now passes 43 tests locally and on `snb-macbook-pro`, plus
  syntax/build and mock `86 -> 87` smoke checks. A real-browser desktop/mobile
  smoke observed `187 -> 188` and `86 -> 87` over SSE with no console errors;
  an offline/online cycle also recovered to the latest value without errors.
- Updated remote Node from `22.22.3` to checksum-verified `22.23.2`, deployed
  the hardened service, and verified live DC state for posts `8` through `11`.
  The launchd service is healthy on `127.0.0.1:3000` only, uses a 256MB heap,
  file limits `1024/2048`, empty service `SSH_AUTH_SOCK`, private runtime files,
  and bounded application logs.
- Kept Funnel disabled. Remote TCP 3000 and Funnel HTTPS are both closed.
  Tailscale `1.102.2` is verified and staged at
  `/Users/snb/Downloads/Tailscale-1.102.2-macos.pkg`, but installation requires
  an interactive administrator password. macOS `14.8.9` also remains pending
  because it requires a 13.3GB download and restart.
- Rewrote the two existing public commits and the security commit so author and
  committer metadata use `butterserverrobot@gmail.com`. Preserved the old
  history in the local-only `backup/pre-security-email-rewrite-20260816` ref,
  verified an identical final tree, and updated `main` with an exact-lease
  `force-with-lease` push.
- GitHub Pages run `31953196869` passed verification and deployment after the
  history update. Refreshed every GitHub-owned Action to its current release,
  pinned each `uses` entry to a full commit SHA, restricted Actions to
  GitHub-owned actions with mandatory SHA pins, and kept the workflow token
  read-only with pull-request approvals disabled.
- Real Discord delivery remains pending a webhook credential.
- Final review confirmed one residual availability limit: the default Funnel
  HTTP proxy does not give this backend a trustworthy original client IP. The
  global caps protect the Mac, but one source can still occupy all 200 SSE
  slots. Tailscale PROXY protocol or an external edge/WAF is required for
  enforceable per-source limits; neither is enabled in the closed deployment.

## 2026-08-19

- Replaced the generated tone and local-file chooser with a responsive visible
  YouTube IFrame API player. Initial fetches, SSE updates, fallback fetches, and
  mode changes continue through the existing `audio.setVolume(volume)` point,
  which now calls `YT.Player.setVolume()`.
- Added visibility-gated playback, looped inline playback, pause/resume,
  `onAutoplayBlocked` fallback, bounded API/frame load errors, and simple
  messages for YouTube errors `100`, `101/150`, and `153`.
- Limited CSP to the exact YouTube API script and privacy-enhanced frame origins
  and changed Referrer Policy to YouTube's required
  `strict-origin-when-cross-origin`. The player stays at least `200px` wide and
  high and is not clipped or covered by custom UI.
- `npm run verify` passes 44 tests, syntax/build checks, and the mock `86 -> 87`
  smoke flow. A real Chromium run proved the player engine autoplays and reports
  `재생 중` with YouTube's official embeddable sample video.
- The requested video `Oeda7KVkFog` returns YouTube error `150` in both standard
  and privacy-enhanced embeds. Its normal watch page still works, but browser
  same-origin rules prevent controlling that page's volume. The feature is not
  publishable until an embeddable replacement is supplied or the owner enables
  embedding.
- A final Chromium pass reproduced error `150`, then verified that
  `설정 변경 -> 계속` creates a fresh player and reports the same error instead
  of becoming stuck. Player generations and bounded loader cleanup isolate late
  callbacks and make both YouTube API loading stages retryable.
- Replaced the blocked video with the user-provided `XsStb0xbF9Q`. A real
  Chromium run confirmed embedded playback and an uninterrupted mock oracle
  update from volume `86` to `87`.
- Pre-publication checks found the existing Pages document cached for up to ten
  minutes, so CSS and JavaScript URLs now carry a release version. The Pages
  workflow now verifies pull requests and deploys only a `main` push, matching
  the repository's required `verify` check and main-only deployment policy.
- The existing Pages site is healthy but still serves the prior release. The
  configured snb Funnel API is currently unreachable, and the snb Mac answers
  Tailscale ping while refusing LAN SSH and timing out tailnet SSH. Publication
  remains gated on restoring remote access, verifying the service, and bringing
  Funnel online before the new frontend reaches `main`.
- LAN SSH recovered after the snb Mac changed addresses. The application release
  was transferred with a matching SHA-256 and the pre-release source was archived
  before extraction. The first launchd bootstrap raced the preceding bootout and
  returned I/O error 5; a second bootstrap restored the healthy service, and the
  installer now retries that bounded transition automatically.
