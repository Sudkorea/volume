import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseGalleryList } from "../server/parser.js";

test("parses fixed post numbers and comma-formatted view counts", async () => {
  const html = await readFile(new URL("./fixtures/list-page.html", import.meta.url), "utf8");
  const rows = parseGalleryList(html, 3);

  assert.equal(rows.get(10).views, 1234);
  assert.equal(rows.get(10).title, "ㅇㅎ) 터질듯한");
  assert.equal(rows.get(10).page, 3);
  assert.equal(rows.get(9).views, 42);
  assert.equal(rows.has(7), false);
});
