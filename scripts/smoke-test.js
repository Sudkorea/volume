import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const temporary = await mkdtemp(path.join(os.tmpdir(), "volume-oracle-smoke-"));
process.env.ORACLE_MOCK = "1";
process.env.HOST = "127.0.0.1";
process.env.PORT = "0";
process.env.RUNTIME_STATE_PATH = path.join(temporary, "state.json");

const { boot } = await import("../server/main.js");
const app = await boot();
const baseUrl = `http://127.0.0.1:${app.port}`;

try {
  const page = await fetch(baseUrl);
  const html = await page.text();
  const hasSetup = html.includes('id="boost-choice"') && html.includes('id="delegate-button"');
  const hasDashboard = html.includes('id="volume-number"') && html.includes('id="view-count"');
  const hasProjectAssets = html.includes('href="./styles.css?v=20260819-youtube1"')
    && html.includes('src="./app.js?v=20260819-youtube1"');
  const hasPublicApi = html.includes("https://snb-macbook-pro.tail643f01.ts.net");
  const hasYouTubePlayer = html.includes('id="youtube-player"') && html.includes('id="audio-toggle"');
  if (!page.ok || !hasSetup || !hasDashboard || !hasProjectAssets || !hasPublicApi || !hasYouTubePlayer) {
    throw new Error("UI did not render with Pages configuration");
  }

  let state = await fetch(`${baseUrl}/api/state`).then((response) => response.json());
  if (state.modes.boost.volume !== 86) throw new Error("initial modulo 101 value is wrong");

  const accepted = await fetch(`${baseUrl}/api/dev/increment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ postNo: 10, amount: 1 }),
  });
  if (accepted.status !== 202) throw new Error("mock update was not accepted");

  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    state = await fetch(`${baseUrl}/api/state`).then((response) => response.json());
    if (state.modes.boost.volume === 87) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (state.modes.boost.volume !== 87) throw new Error("shared tracker did not apply the view update");

  console.log(`Smoke test passed at ${baseUrl}; boost volume changed 86 -> 87.`);
} finally {
  await app.close();
  await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
}
