import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { validateConfig } from "../server/config.js";

const required = [
  "public/index.html",
  "public/styles.css",
  "public/app.js",
  "public/share.js",
  "server/main.js",
  "server/tracker.js",
  "config/oracles.json",
];

const SECRET_PATTERNS = [
  {
    label: "Discord webhook",
    pattern: /https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/\d{5,}\/[A-Za-z0-9._-]{20,}/i,
  },
  {
    label: "GitHub token",
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,})\b/,
  },
  {
    label: "AWS access key",
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  },
  {
    label: "private key",
    pattern: /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/,
  },
];

async function collectJavaScript(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectJavaScript(target));
    else if (/\.(m?js)$/.test(entry.name)) files.push(target);
  }
  return files;
}

const SCAN_IGNORED_DIRECTORIES = new Set([
  ".git",
  ".playwright-cli",
  "dist",
  "node_modules",
  "output",
  "runtime",
]);

async function collectProjectFiles(directory = ".") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && SCAN_IGNORED_DIRECTORIES.has(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectProjectFiles(target));
    else if (entry.isFile()) files.push(path.relative(".", target));
  }
  return files;
}

function listTrackedFiles() {
  if (!existsSync(".git")) return null;
  const result = spawnSync("git", ["ls-files", "-z"], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`Could not enumerate tracked files for secret scanning: ${result.stderr.trim()}`);
  }
  return result.stdout.split("\0").filter(Boolean);
}

async function scanTrackedFiles() {
  const files = listTrackedFiles() || await collectProjectFiles();
  for (const file of files) {
    const content = await readFile(file);
    if (content.includes(0)) continue;
    const text = content.toString("utf8");
    for (const { label, pattern } of SECRET_PATTERNS) {
      if (pattern.test(text)) throw new Error(`${label} found in tracked file: ${file}`);
    }
  }
}

for (const file of required) await readFile(file);
const config = validateConfig(JSON.parse(await readFile("config/oracles.json", "utf8")));
const scripts = [...await collectJavaScript("server"), ...await collectJavaScript("public"), ...await collectJavaScript("scripts")];

for (const file of scripts) {
  if (file.endsWith("build.js")) continue;
  const checked = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (checked.status !== 0) throw new Error(`${file} failed syntax check:\n${checked.stderr}`);
}

await scanTrackedFiles();

await mkdir("dist", { recursive: true });
await writeFile("dist/manifest.json", `${JSON.stringify({
  builtAt: new Date().toISOString(),
  galleryId: config.galleryId,
  posts: {
    guards: config.guards,
    normal: config.modes.normal.postNo,
    boost: config.modes.boost.postNo,
  },
  files: required,
}, null, 2)}\n`);
console.log(`Build manifest created; ${scripts.length} JavaScript files passed syntax checks.`);
