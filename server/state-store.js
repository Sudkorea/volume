import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export class JsonStateStore {
  constructor(filePath = process.env.RUNTIME_STATE_PATH || "runtime/oracle-state.json") {
    this.filePath = path.resolve(filePath);
  }

  async load() {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new SyntaxError("state root must be an object");
      }
      return parsed;
    } catch (error) {
      if (error.code === "ENOENT") return null;
      if (!(error instanceof SyntaxError)) throw error;

      const quarantinePath = `${this.filePath}.corrupt-${Date.now()}`;
      try {
        await rename(this.filePath, quarantinePath);
        console.warn(`Ignored corrupt state file; moved it to ${path.basename(quarantinePath)}`);
      } catch (renameError) {
        if (renameError.code !== "ENOENT") throw renameError;
      }
      return null;
    }
  }

  async save(state) {
    await mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
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
