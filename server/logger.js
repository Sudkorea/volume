import {
  appendFileSync,
  chmodSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { formatWithOptions } from "node:util";

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

function rotateIfNeeded(filePath, incomingBytes, maxBytes) {
  let currentBytes = 0;
  try {
    currentBytes = statSync(filePath).size;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (currentBytes + incomingBytes <= maxBytes) return;

  const previous = `${filePath}.1`;
  rmSync(previous, { force: true });
  try {
    renameSync(filePath, previous);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

export function installFileLogger(filePath = process.env.ORACLE_LOG_PATH || "", {
  maxBytes = DEFAULT_MAX_BYTES,
} = {}) {
  if (!filePath) return () => {};
  const resolved = path.resolve(filePath);
  mkdirSync(path.dirname(resolved), { recursive: true, mode: 0o700 });

  const originals = {
    log: console.log,
    warn: console.warn,
    error: console.error,
  };

  const write = (level, args) => {
    const message = formatWithOptions({ colors: false, depth: 4 }, ...args);
    const line = `${new Date().toISOString()} ${level.toUpperCase()} ${message}\n`;
    try {
      rotateIfNeeded(resolved, Buffer.byteLength(line), maxBytes);
      appendFileSync(resolved, line, { encoding: "utf8", mode: 0o600 });
      chmodSync(resolved, 0o600);
    } catch (error) {
      originals.error(`Volume Oracle logger failed: ${error.message}`);
    }
  };

  console.log = (...args) => write("info", args);
  console.warn = (...args) => write("warn", args);
  console.error = (...args) => write("error", args);

  return () => {
    console.log = originals.log;
    console.warn = originals.warn;
    console.error = originals.error;
  };
}
