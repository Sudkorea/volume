# Execution Plan

## Goal

Build and verify a self-hosted browser volume controller whose volume follows
the public view counts of DCInside gallery posts 9 and 10, with pagination
tracking through guard posts 8 and 11 and a Discord alert when a target post is
confirmed missing.

## Delivery slices

1. Implement a single-process Node.js server that serves the UI, polls one
   shared DCInside list cursor, and broadcasts changes with Server-Sent Events.
2. Track the consecutive block `11, 10, 9, 8` across at most two adjacent list
   pages during normal pagination movement.
3. Confirm deletion only after repeated observations find both guard posts but
   not the target; freeze the last good value and send one deduplicated Discord
   webhook alert.
4. Provide a browser UI with an initial title-bait boost choice, browser audio
   activation, a local audio-file option, live source/view/volume status, and
   automatic SSE reconnection.
5. Verify parsers, page-boundary transitions, deletion alerts, persistence,
   SSE updates, and the primary browser flow. Prepare the service for the
   `snb-macbook-pro` host without exposing secrets.

## Verification commands

1. `npm test`
2. `npm run build`
3. `npm run smoke`
4. Browser smoke test through the Playwright CLI

## Visual revision — 2026-08-16

1. Remove self-conscious protocol, oracle, global-consensus, and warning copy
   from the user-facing interface.
2. Present the product as an ordinary browser audio settings page.
3. Use neutral off-white surfaces and restrained typography; reserve pale mint
   and yellow for the optional boost state.
4. Keep the absurd mechanism visible only through factual source, view-count,
   and modulo rows.
5. Preserve all tracker, SSE, deletion, persistence, and Discord behavior.

## Public deployment — 2026-08-16

1. Publish the static browser UI from the public `Sudkorea/volume` repository
   through GitHub Pages at `https://sudkorea.github.io/volume/`.
2. Keep polling, shared state, SSE, deletion detection, and Discord delivery on
   `snb-macbook-pro`.
3. Expose the Mac service over HTTPS at
   `https://snb-macbook-pro.tail643f01.ts.net` with Tailscale Funnel.
4. Allow cross-origin API and SSE access only from the GitHub Pages origin.
5. Verify the published page receives live state and SSE from the Mac service.

## Security hardening — 2026-08-16

1. Keep Funnel disabled until the vulnerable Tailscale 1.96.5 client is
   replaced with a fixed stable release.
2. Bound HTTP and SSE resources, handle slow clients, and ensure browser
   reconnects cannot accelerate the shared DCInside poller.
3. Validate upstream host, content type, response size, and parsed list shape;
   surface missing guards and stale data as degraded health.
4. Bound local logs and runtime state, remove inherited SSH-agent access, and
   run the service with explicit memory and file-descriptor limits.
5. Add browser retry backoff, fetch timeouts, a Pages CSP, complete tracked-file
   secret scanning, immutable Actions pins, and a mandatory CI verification
   gate before deployment.
6. Update the supported Node runtime, dependency lock, GitHub security
   settings, and repository commit email; verify locally and remotely before
   requesting Funnel approval.
