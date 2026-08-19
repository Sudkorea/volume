import assert from "node:assert/strict";
import test from "node:test";
import { shareUrl } from "../public/share.js";

const target = {
  title: "ㅇㅎ) 터질듯한",
  url: "https://gall.dcinside.com/mgallery/board/view/?id=volume&no=10&page=1",
};

test("uses native sharing without touching the clipboard", async () => {
  const shared = [];
  const copied = [];
  const result = await shareUrl(target, {
    share: async (payload) => shared.push(payload),
    writeText: async (url) => copied.push(url),
  });
  assert.equal(result, "shared");
  assert.deepEqual(shared, [target]);
  assert.deepEqual(copied, []);
});

test("copies the selected post when native sharing is unavailable", async () => {
  const copied = [];
  const result = await shareUrl(target, {
    share: null,
    writeText: async (url) => copied.push(url),
  });
  assert.equal(result, "copied");
  assert.deepEqual(copied, [target.url]);
});

test("falls back to copying after a non-cancellation share error", async () => {
  const copied = [];
  const result = await shareUrl(target, {
    share: async () => { throw new Error("share failed"); },
    writeText: async (url) => copied.push(url),
  });
  assert.equal(result, "copied");
  assert.deepEqual(copied, [target.url]);
});

test("does nothing when the user cancels native sharing", async () => {
  const copied = [];
  const cancellation = new Error("cancelled");
  cancellation.name = "AbortError";
  const result = await shareUrl(target, {
    share: async () => { throw cancellation; },
    writeText: async (url) => copied.push(url),
  });
  assert.equal(result, "cancelled");
  assert.deepEqual(copied, []);
});

test("reports an unavailable share path when clipboard copying fails", async () => {
  const result = await shareUrl(target, {
    share: null,
    writeText: async () => { throw new Error("clipboard denied"); },
  });
  assert.equal(result, "unavailable");
});
