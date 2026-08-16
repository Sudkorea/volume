import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const DEFAULT_CONFIG_PATH = path.resolve("config/oracles.json");

function positiveInteger(value, name) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
}

export function validateConfig(config) {
  if (!config || typeof config !== "object") {
    throw new Error("Oracle config must be an object");
  }
  if (!/^[a-zA-Z0-9_]+$/.test(config.galleryId ?? "")) {
    throw new Error("galleryId contains unsupported characters");
  }
  positiveInteger(config.initialPage, "initialPage");
  positiveInteger(config.guards?.newer, "guards.newer");
  positiveInteger(config.guards?.older, "guards.older");
  if (config.guards.newer <= config.guards.older) {
    throw new Error("newer guard must have the larger post number");
  }

  for (const modeName of ["normal", "boost"]) {
    const mode = config.modes?.[modeName];
    positiveInteger(mode?.postNo, `modes.${modeName}.postNo`);
    positiveInteger(mode?.modulus, `modes.${modeName}.modulus`);
    if (mode.postNo >= config.guards.newer || mode.postNo <= config.guards.older) {
      throw new Error(`${modeName} post must remain between both guard posts`);
    }
  }

  for (const field of [
    "activeMs",
    "burstMs",
    "burstWindowMs",
    "idleMs",
    "requestTimeoutMs",
    "maxBackoffMs",
    "deletionConfirmations",
  ]) {
    positiveInteger(config.polling?.[field], `polling.${field}`);
  }
  return config;
}

export class ConfigStore {
  constructor(configPath = process.env.ORACLE_CONFIG_PATH || DEFAULT_CONFIG_PATH) {
    this.configPath = path.resolve(configPath);
    this.cached = null;
    this.mtimeMs = -1;
  }

  async load({ force = false } = {}) {
    const fileStat = await stat(this.configPath);
    if (!force && this.cached && fileStat.mtimeMs === this.mtimeMs) {
      return this.cached;
    }
    const parsed = JSON.parse(await readFile(this.configPath, "utf8"));
    this.cached = validateConfig(parsed);
    this.mtimeMs = fileStat.mtimeMs;
    return this.cached;
  }
}

export function postUrl(config, postNo) {
  const query = new URLSearchParams({
    id: config.galleryId,
    no: String(postNo),
    page: "1",
  });
  return `https://gall.dcinside.com/mgallery/board/view/?${query}`;
}
