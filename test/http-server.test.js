import assert from "node:assert/strict";
import test from "node:test";
import { createVolumeServer } from "../server/http-server.js";

const pagesOrigin = "https://sudkorea.github.io";

function snapshot() {
  return {
    sequence: 1,
    upstream: { status: "live", nextPollMs: 2000 },
    discordConfigured: false,
    trackedPages: [1],
    modes: {},
  };
}

async function withServer(run) {
  const tracker = {
    snapshot,
    subscribe() {
      return () => {};
    },
  };
  const server = createVolumeServer({ tracker, allowedOrigins: new Set([pagesOrigin]) });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("allows state reads and preflight from the GitHub Pages origin", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/state`, {
      headers: { Origin: pagesOrigin },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), pagesOrigin);
    assert.equal(response.headers.get("vary"), "Origin");

    const preflight = await fetch(`${baseUrl}/api/state`, {
      method: "OPTIONS",
      headers: { Origin: pagesOrigin },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), pagesOrigin);
  });
});

test("does not grant CORS access to an unrelated browser origin", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/state`, {
      headers: { Origin: "https://example.com" },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), null);

    const preflight = await fetch(`${baseUrl}/api/state`, {
      method: "OPTIONS",
      headers: { Origin: "https://example.com" },
    });
    assert.equal(preflight.status, 403);
  });
});
