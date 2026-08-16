import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("GitHub Pages document declares a restrictive client security policy", async () => {
  const html = await readFile("public/index.html", "utf8");
  assert.match(html, /http-equiv="Content-Security-Policy"/);
  assert.match(html, /connect-src 'self' https:\/\/snb-macbook-pro\.tail643f01\.ts\.net/);
  assert.match(html, /name="referrer" content="no-referrer"/);
  assert.doesNotMatch(html, /'unsafe-(?:inline|eval)'/);
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
  assert.match(workflow, /deploy:\n\s+needs: verify/);
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
  assert.match(installer, /for attempt in \{1\.\.20\}/);
  assert.match(installer, /chmod 600 "\$runtime_file"/);
});
