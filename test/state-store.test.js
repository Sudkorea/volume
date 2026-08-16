import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { JsonStateStore } from "../server/state-store.js";

test("quarantines corrupt state and continues from an empty state", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "volume-state-"));
  const filePath = path.join(directory, "oracle.json");
  await writeFile(filePath, "{broken", "utf8");
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const store = new JsonStateStore(filePath);
    assert.equal(await store.load(), null);
    const entries = await readdir(directory);
    assert.equal(entries.some((name) => name.startsWith("oracle.json.corrupt-")), true);

    await store.save({ version: 1, modes: {} });
    assert.deepEqual(JSON.parse(await readFile(filePath, "utf8")), { version: 1, modes: {} });
    assert.equal((await stat(filePath)).mode & 0o777, 0o600);
  } finally {
    console.warn = originalWarn;
  }
});
