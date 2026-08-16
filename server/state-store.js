import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export class JsonStateStore {
  constructor(filePath = process.env.RUNTIME_STATE_PATH || "runtime/oracle-state.json") {
    this.filePath = path.resolve(filePath);
  }

  async load() {
    try {
      return JSON.parse(await readFile(this.filePath, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  async save(state) {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(temporary, this.filePath);
  }
}

export class MemoryStateStore {
  constructor(initial = null) {
    this.value = initial;
  }

  async load() {
    return this.value ? structuredClone(this.value) : null;
  }

  async save(state) {
    this.value = structuredClone(state);
  }
}
