import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { installFileLogger } from "../server/logger.js";

test("writes private bounded service logs and retains one rotated file", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "volume-oracle-log-"));
  const logPath = path.join(temporary, "service.log");
  const restore = installFileLogger(logPath, { maxBytes: 120 });
  try {
    console.log("first", "x".repeat(70));
    console.warn("second", "y".repeat(70));
  } finally {
    restore();
  }

  const current = await readFile(logPath, "utf8");
  const previous = await readFile(`${logPath}.1`, "utf8");
  const mode = (await stat(logPath)).mode & 0o777;
  assert.match(current, /WARN second/);
  assert.match(previous, /INFO first/);
  assert.equal(mode, 0o600);
  await rm(temporary, { recursive: true, force: true });
});

test("records startup validation failures in the bounded service log", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "volume-startup-log-"));
  const logPath = path.join(temporary, "service.log");
  const result = spawnSync(process.execPath, ["server/main.js"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      ORACLE_LOG_PATH: logPath,
      ORACLE_MOCK: "invalid",
    },
  });

  assert.notEqual(result.status, 0);
  assert.match(await readFile(logPath, "utf8"), /Startup failed:.*ORACLE_MOCK must be either 0 or 1/s);
  await rm(temporary, { recursive: true, force: true });
});
