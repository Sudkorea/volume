import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { validateConfig } from "../server/config.js";

const required = [
  "public/index.html",
  "public/styles.css",
  "public/app.js",
  "server/main.js",
  "server/tracker.js",
  "config/oracles.json",
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

for (const file of required) await readFile(file);
const config = validateConfig(JSON.parse(await readFile("config/oracles.json", "utf8")));
const scripts = [...await collectJavaScript("server"), ...await collectJavaScript("public"), ...await collectJavaScript("scripts")];

for (const file of scripts) {
  if (file.endsWith("build.js")) continue;
  const checked = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (checked.status !== 0) throw new Error(`${file} failed syntax check:\n${checked.stderr}`);
}

const trackedText = await Promise.all(required.map((file) => readFile(file, "utf8")));
if (trackedText.some((text) => /discord(?:app)?\.com\/api\/webhooks\//i.test(text))) {
  throw new Error("A Discord webhook URL was found in tracked source files");
}

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
