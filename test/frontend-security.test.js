import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("GitHub Pages document declares a restrictive client security policy", async () => {
  const [html, httpServer] = await Promise.all([
    readFile("public/index.html", "utf8"),
    readFile("server/http-server.js", "utf8"),
  ]);
  assert.match(html, /http-equiv="Content-Security-Policy"/);
  assert.match(html, /script-src 'self' https:\/\/www\.youtube\.com/);
  assert.match(html, /connect-src 'self' https:\/\/snb-macbook-pro\.tail643f01\.ts\.net/);
  assert.match(html, /frame-src https:\/\/www\.youtube-nocookie\.com/);
  assert.match(html, /name="referrer" content="strict-origin-when-cross-origin"/);
  assert.doesNotMatch(html, /'unsafe-(?:inline|eval)'/);
  assert.match(html, /href="\.\/styles\.css\?v=20260819-youtube1"/);
  assert.match(html, /src="\.\/app\.js\?v=20260819-youtube1"/);
  assert.match(httpServer, /"script-src 'self' https:\/\/www\.youtube\.com"/);
  assert.match(httpServer, /"frame-src https:\/\/www\.youtube-nocookie\.com"/);
  assert.match(httpServer, /"Referrer-Policy": "strict-origin-when-cross-origin"/);
});

test("YouTube playback is visible, privacy-enhanced, and follows oracle volume", async () => {
  const [html, app, styles] = await Promise.all([
    readFile("public/index.html", "utf8"),
    readFile("public/app.js", "utf8"),
    readFile("public/styles.css", "utf8"),
  ]);
  assert.match(html, /id="youtube-frame"/);
  assert.match(html, /id="youtube-player"/);
  assert.doesNotMatch(html, /id="audio-file"/);
  assert.match(app, /const YOUTUBE_VIDEO_ID = "XsStb0xbF9Q"/);
  assert.match(app, /const YOUTUBE_EMBED_ORIGIN = "https:\/\/www\.youtube-nocookie\.com"/);
  assert.match(app, /new YT\.Player\(iframe/);
  assert.match(app, /onAutoplayBlocked:/);
  assert.match(app, /entry\.intersectionRatio > 0\.5/);
  assert.match(app, /this\.player\.setVolume\(this\.volume\)/);
  assert.match(app, /this\.player\.mute\(\);\s+this\.player\.playVideo\(\)/);
  assert.match(app, /this\.player\.unMute\(\)/);
  assert.match(app, /script\?\.remove\(\)/);
  assert.match(app, /#www-widgetapi-script\[src\^="https:\/\/www\.youtube\.com\/"\]/);
  assert.match(app, /window\.YT = undefined/);
  assert.match(app, /playerInstance\?\.destroy\?\.\(\)/);
  assert.match(app, /generation !== this\.playerGeneration/);
  assert.match(app, /if \(this\.errorMessage\) this\.resetAfterError\(\)/);
  assert.match(app, /audio\.setVolume\(volume\)/);
  assert.doesNotMatch(app, /AudioContext|createOscillator|createMediaElementSource/);
  assert.match(styles, /\.youtube-frame\s*\{[^}]*min-width:\s*200px/s);
  assert.match(styles, /\.youtube-frame\s*\{[^}]*min-height:\s*200px/s);
  assert.match(styles, /aspect-ratio:\s*16 \/ 9/);
  assert.doesNotMatch(styles, /\.youtube-frame\s*\{[^}]*(?:overflow:\s*hidden|border-radius)/s);
});

test("browser recovery keeps background SSE and bounds retry pressure", async () => {
  const app = await readFile("public/app.js", "utf8");
  assert.match(app, /const FETCH_TIMEOUT_MS = 5000/);
  assert.match(app, /function retryDelay\(/);
  assert.match(app, /Math\.random\(\)/);
  assert.match(app, /controller\.abort\(\)/);
  assert.match(
    app,
    /const snapshot = await response\.json\(\);\s+if \(generation !== fallbackGeneration\) return;\s+applySnapshot\(snapshot\);/,
  );
  assert.doesNotMatch(app, /document\.hidden\s*\|\|\s*eventSource/);
  assert.doesNotMatch(app, /document\.hidden\) disconnectEvents\(\)/);
});

test("Pages workflow verifies before deploy and pins every action by commit", async () => {
  const workflow = await readFile(".github/workflows/pages.yml", "utf8");
  const actions = [...workflow.matchAll(/uses:\s+[^@\s]+@([^\s#]+)/g)].map((match) => match[1]);
  assert.ok(actions.length >= 6);
  assert.ok(actions.every((reference) => /^[a-f0-9]{40}$/.test(reference)));
  assert.match(workflow, /run: npm ci --ignore-scripts --no-audit --no-fund/);
  assert.match(workflow, /run: npm run verify/);
  assert.match(workflow, /pull_request:\n\s+branches: \[main\]/);
  assert.match(workflow, /group: pages-\$\{\{ github\.ref \}\}/);
  assert.match(workflow, /deploy:\n\s+needs: verify/);
  assert.match(workflow, /if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/);
});

test("build scans tracked files or a bounded deploy tree and runtime artifacts stay ignored", async () => {
  const [build, ignore] = await Promise.all([
    readFile("scripts/build.js", "utf8"),
    readFile(".gitignore", "utf8"),
  ]);
  assert.match(build, /spawnSync\("git", \["ls-files", "-z"\]/);
  assert.match(build, /collectProjectFiles/);
  assert.match(build, /SCAN_IGNORED_DIRECTORIES/);
  assert.match(build, /private key/);
  assert.match(ignore, /^runtime\/$/m);
});

test("deployment leaves file-descriptor headroom and ignores spoofable proxy headers", async () => {
  const [httpServer, plist, installer] = await Promise.all([
    readFile("server/http-server.js", "utf8"),
    readFile("deploy/com.volume-oracle.plist.template", "utf8"),
    readFile("scripts/install-snb-service.sh", "utf8"),
  ]);
  assert.match(httpServer, /maxConnections: 256/);
  assert.doesNotMatch(httpServer, /x-forwarded-for/i);
  assert.match(plist, /<key>NumberOfFiles<\/key>\s+<integer>1024<\/integer>/);
  assert.match(plist, /<key>SSH_AUTH_SOCK<\/key>\s+<string><\/string>/);
  assert.match(installer, /for bootstrap_attempt in \{1\.\.10\}/);
  assert.match(installer, /for attempt in \{1\.\.20\}/);
  assert.match(installer, /chmod 600 "\$runtime_file"/);
});
