import { ConfigStore } from "./config.js";
import { DcListClient } from "./dc-client.js";
import { DiscordNotifier } from "./discord.js";
import { createVolumeServer } from "./http-server.js";
import { MockDcListClient } from "./mock-dc-client.js";
import { JsonStateStore } from "./state-store.js";
import { OracleTracker } from "./tracker.js";

export async function boot() {
  const configStore = new ConfigStore();
  const config = await configStore.load({ force: true });
  const mockMode = process.env.ORACLE_MOCK === "1";
  const listClient = mockMode ? new MockDcListClient(config) : new DcListClient();
  const tracker = new OracleTracker({
    configStore,
    listClient,
    notifier: new DiscordNotifier(),
    stateStore: new JsonStateStore(),
  });
  await tracker.start();

  const server = createVolumeServer({
    tracker,
    mockClient: mockMode ? listClient : null,
    allowedOrigins: new Set(
      (process.env.ALLOWED_ORIGINS || "")
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  });
  const host = process.env.HOST || "127.0.0.1";
  const port = Number.parseInt(process.env.PORT || "3000", 10);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  console.log(`Volume Oracle listening on http://${host}:${actualPort} (${mockMode ? "mock" : "live"})`);

  const close = async () => {
    await tracker.stop();
    await new Promise((resolve) => server.close(resolve));
  };
  return { server, tracker, close, host, port: actualPort };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = await boot();
  const shutdown = async () => {
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
