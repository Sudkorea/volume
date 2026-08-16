import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
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

async function withServer(run, options = {}) {
  const tracker = options.tracker ?? {
    snapshot,
    subscribe() {
      return () => {};
    },
  };
  const server = createVolumeServer({
    tracker,
    allowedOrigins: new Set([pagesOrigin]),
    limits: options.limits,
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`, server);
  } finally {
    server.closeSseConnections?.();
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
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("access-control-allow-origin"), null);

    const preflight = await fetch(`${baseUrl}/api/state`, {
      method: "OPTIONS",
      headers: { Origin: "https://example.com" },
    });
    assert.equal(preflight.status, 403);
  });
});

test("returns 400 for malformed URI encoding without logging an exception", async () => {
  await withServer(async (baseUrl) => {
    const url = new URL(baseUrl);
    const originalError = console.error;
    let errors = 0;
    console.error = () => { errors += 1; };
    try {
      const status = await new Promise((resolve, reject) => {
        const request = httpRequest({
          host: url.hostname,
          port: url.port,
          path: "/%",
        }, (response) => {
          response.resume();
          response.once("end", () => resolve(response.statusCode));
        });
        request.once("error", reject);
        request.end();
      });
      assert.equal(status, 400);
      assert.equal(errors, 0);
    } finally {
      console.error = originalError;
    }
  });
});

test("bounds API request rate and concurrent event streams", async () => {
  const listeners = new Set();
  const tracker = {
    snapshot,
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    },
  };
  await withServer(async (baseUrl) => {
    const firstStream = await fetch(`${baseUrl}/api/events`);
    assert.equal(firstStream.status, 200);
    const secondStream = await fetch(`${baseUrl}/api/events`);
    assert.equal(secondStream.status, 503);
    await firstStream.body.cancel();

    const first = await fetch(`${baseUrl}/api/state`);
    const second = await fetch(`${baseUrl}/api/state`);
    const third = await fetch(`${baseUrl}/api/state`);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(third.status, 429);
  }, {
    tracker,
    limits: {
      maxSseClients: 1,
      maxApiRequestsPerWindow: 4,
      maxApiRequestsPerWindowGlobal: 4,
    },
  });
  assert.equal(listeners.size, 0);
});

test("shared proxy clients use the global SSE attempt budget", async () => {
  await withServer(async (baseUrl) => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const stream = await fetch(`${baseUrl}/api/events`);
      assert.equal(stream.status, 200);
      await stream.body.cancel();
    }
    const limited = await fetch(`${baseUrl}/api/events`);
    assert.equal(limited.status, 429);
  }, {
    limits: {
      maxSseAttemptsPerMinute: 1,
      maxSseAttemptsPerMinuteGlobal: 2,
    },
  });
});

test("bounds non-API traffic and validates mock increments", async () => {
  const mockClient = {
    increment() {},
    remove() {},
    restore() {},
  };
  const tracker = {
    snapshot,
    subscribe() { return () => {}; },
    requestImmediatePoll() {},
  };
  const server = createVolumeServer({
    tracker,
    mockClient,
    allowedOrigins: new Set([pagesOrigin]),
    limits: {
      maxApiRequestsPerWindow: 100,
      maxApiRequestsPerWindowGlobal: 2,
    },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    const invalid = await fetch(`${baseUrl}/api/dev/increment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postNo: 10, amount: -1 }),
    });
    assert.equal(invalid.status, 400);
    assert.equal((await fetch(`${baseUrl}/missing`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/another-missing`)).status, 429);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("gracefully ends open event streams during shutdown", async () => {
  const tracker = {
    snapshot,
    subscribe(listener) {
      listener(snapshot());
      return () => {};
    },
  };
  await withServer(async (baseUrl, server) => {
    const stream = await fetch(`${baseUrl}/api/events`);
    server.closeSseConnections();
    const body = await stream.text();
    assert.match(body, /event: shutdown/);
  }, { tracker });
});

test("drops an event client whose pending frame exceeds the buffer bound", async () => {
  const listeners = new Set();
  const tracker = {
    snapshot,
    subscribe(listener) {
      listeners.add(listener);
      listener({ ...snapshot(), padding: "x".repeat(2048) });
      return () => listeners.delete(listener);
    },
  };
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/events`);
    assert.equal(response.status, 200);
    await response.text();
  }, { tracker, limits: { maxSseBufferedBytes: 256 } });
  assert.equal(listeners.size, 0);
});
