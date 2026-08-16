# Acceptance Checklist

- [x] Public UI files exist and are served by the application.
- [x] Normal mode maps post 9 view count with modulo 100.
- [x] Boost mode maps post 10 view count with modulo 101.
- [x] Posts 8 and 11 anchor pagination tracking across adjacent pages.
- [x] A single server poller is shared by all connected clients.
- [x] Active clients receive changes through SSE.
- [x] Polling slows down with no clients and backs off after upstream errors.
- [x] Missing targets retain their last known volume.
- [x] Confirmed target deletion sends one deduplicated Discord webhook alert.
- [x] Runtime state survives a process restart.
- [x] Target post numbers can be replaced without changing source code.
- [x] Automated tests pass locally and on `snb-macbook-pro`.
- [x] Browser smoke test passes.
- [x] Application is installed as a persistent service on `snb-macbook-pro`.
- [ ] A real Discord webhook credential is configured and delivery is verified.
- [ ] Tailscale Funnel is approved and the public HTTPS URL is verified.
- [x] User-facing copy is factual and does not explain or oversell the joke.
- [x] Default styling is neutral and boost styling uses only pale mint/yellow.
- [x] The page still exposes source post, view count, modulo, freshness, and
  deletion status without protocol-themed chrome.
- [x] The static UI is published at `https://sudkorea.github.io/volume/`.
- [x] GitHub Pages loads assets correctly from the `/volume/` project path.
- [ ] The Pages origin can fetch state and receive SSE from the Funnel origin.
- [x] Other browser origins do not receive CORS permission from the API.
- [ ] Tailscale is upgraded to a release fixed for TS-2026-008 before Funnel is
  enabled.
- [x] HTTP/SSE connection limits, backpressure, polling throttles, and malformed
  request handling pass automated tests.
- [x] DC response size, host, content type, parser sanity, guard loss, and stale
  health behavior pass automated tests.
- [x] Remote launchd runs the hardened service with bounded logs, Node heap,
  file descriptors, and no inherited SSH agent socket.
- [ ] GitHub Pages deploys only after verification with immutable Action pins.
- [x] Dependabot alerts and automated security updates are enabled.
- [ ] Existing public commit metadata uses `butterserverrobot@gmail.com`.
- [ ] A PROXY-aware local edge or external WAF enforces per-source limits before
  high-traffic public exposure.
