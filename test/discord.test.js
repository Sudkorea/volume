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
