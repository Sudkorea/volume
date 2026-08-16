import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { DiscordNotifier } from "../server/discord.js";

test("posts a deletion alert to a Discord-compatible webhook", async (context) => {
  let received = null;
  const receiver = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    received = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    response.writeHead(204).end();
  });
  await new Promise((resolve) => receiver.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => receiver.close(resolve)));
  const { port } = receiver.address();

  const notifier = new DiscordNotifier({
    webhookUrl: `http://127.0.0.1:${port}/webhook`,
    mention: "owner",
  });
  const result = await notifier.notifyDeletion({
    mode: "boost",
    modeLabel: "제목낚시 부스트",
    postNo: 10,
    lastViews: 187,
    lastVolume: 86,
    guardPosts: [11, 8],
    detectedAt: "2026-08-16T09:00:00.000Z",
  });

  assert.equal(result.delivered, true);
  assert.match(received.content, /10/);
  assert.match(received.content, /187/);
  assert.match(received.content, /새 게시글/);
  assert.deepEqual(received.allowed_mentions, { parse: [] });
});

test("allows only an explicit Discord user or role mention", async (context) => {
  const received = [];
  const receiver = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    received.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    response.writeHead(204).end();
  });
  await new Promise((resolve) => receiver.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => receiver.close(resolve)));
  const { port } = receiver.address();

  await new DiscordNotifier({
    webhookUrl: `http://127.0.0.1:${port}/webhook`,
    mention: "<@123456789>",
  }).notifyTest();
  await new DiscordNotifier({
    webhookUrl: `http://127.0.0.1:${port}/webhook`,
    mention: "<@&987654321>",
  }).notifyTest();

  assert.deepEqual(received[0].allowed_mentions, { parse: [], users: ["123456789"] });
  assert.deepEqual(received[1].allowed_mentions, { parse: [], roles: ["987654321"] });
});

test("rejects a non-Discord webhook destination", () => {
  assert.throws(
    () => new DiscordNotifier({ webhookUrl: "https://example.com/collect" }),
    /HTTPS Discord webhook URL/,
  );
});

test("preserves Discord retry-after on rate limiting", async (context) => {
  const receiver = createServer((_request, response) => {
    response.writeHead(429, { "Content-Type": "application/json", "Retry-After": "2" });
    response.end(JSON.stringify({ retry_after: 2.5 }));
  });
  await new Promise((resolve) => receiver.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => receiver.close(resolve)));
  const { port } = receiver.address();

  const notifier = new DiscordNotifier({ webhookUrl: `http://127.0.0.1:${port}/webhook` });
  await assert.rejects(
    notifier.notifyTest(),
    (error) => error.retryAfterMs === 2500,
  );
});

test("posts a guard-loss operational alert", async (context) => {
  let received = null;
  const receiver = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    received = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    response.writeHead(204).end();
  });
  await new Promise((resolve) => receiver.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => receiver.close(resolve)));
  const { port } = receiver.address();

  const notifier = new DiscordNotifier({ webhookUrl: `http://127.0.0.1:${port}/webhook` });
  await notifier.notifyOperationalIssue({
    type: "guard_missing",
    key: "guard-newer",
    postNo: 11,
    firstDetectedAt: "2026-08-16T09:00:00.000Z",
    detectedAt: "2026-08-16T09:00:10.000Z",
    trackedPages: [1, 2],
  });

  assert.match(received.content, /확인용 게시글/);
  assert.match(received.content, /11/);
  assert.match(received.content, /1, 2/);
});
