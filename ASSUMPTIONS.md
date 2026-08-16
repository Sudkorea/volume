# Assumptions

1. The public gallery ID remains `volume`.
2. The initial ordered post block is guard 11, boost target 10, normal target 9,
   guard 8.
3. Normal volume is `views mod 100`; boosted volume is `views mod 101`.
4. The application controls audio in its own browser tab, not the operating
   system master volume.
5. The Discord webhook URL will be supplied through the
   `DISCORD_WEBHOOK_URL` environment variable and will never be committed.
6. Until that credential is supplied, webhook behavior will be verified against
   a local mock receiver rather than the real Discord channel.
7. A confirmed deletion freezes the affected mode. The application will not
   create or select a replacement post automatically; the operator changes the
   post number in `config/oracles.json` over SSH.
8. The production process binds only to localhost and is exposed publicly by a
   separately approved HTTPS tunnel.
- The public GitHub repository and Pages project will be named
  `Sudkorea/volume`, producing `https://sudkorea.github.io/volume/`.
- `https://snb-macbook-pro.tail643f01.ts.net` is the stable Funnel hostname for
  the existing `snb-macbook-pro` Tailscale node.
- The source repository may be public; `.env`, runtime state, and webhook
  credentials remain excluded from version control.
- Only `https://sudkorea.github.io` needs browser CORS access to the backend.
