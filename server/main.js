import { ConfigStore } from "./config.js";
import { DcListClient } from "./dc-client.js";
import { DiscordNotifier } from "./discord.js";
import { createVolumeServer } from "./http-server.js";
import { MockDcListClient } from "./mock-dc-client.js";
import { JsonStateStore } from "./state-store.js";
import { OracleTracker } from "./tracker.js";
import { installFileLogger } from "./logger.js";

function isLoopbackHost(host) {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

export async function boot() {
  const restoreLogger = installFileLogger();
  let tracker = null;
  try {
    const host = process.env.HOST || "127.0.0.1";
    const mockSetting = process.env.ORACLE_MOCK || "0";
    if (!["0", "1"].includes(mockSetting)) {
      throw new Error("ORACLE_MOCK must be either 0 or 1");
    }
    const mockMode = mockSetting === "1";
    if (mockMode && (process.env.NODE_ENV === "production" || !isLoopbackHost(host))) {
      throw new Error("Mock mode is restricted to a loopback development server");
    }
    const configStore = new ConfigStore();
    const config = await configStore.load({ force: true });
    const listClient = mockMode ? new MockDcListClient(config) : new DcListClient();
    tracker = new OracleTracker({
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
    const port = Number.parseInt(process.env.PORT || "3000", 10);
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, resolve);
    });
    const address = server.address();
    const actualPort = typeof address === "object" && address ? address.port : port;
    console.log(`Volume Oracle listening on http://${host}:${actualPort} (${mockMode ? "mock" : "live"})`);

    const close = async () => {
      const closed = new Promise((resolve) => server.close(resolve));
      server.closeSseConnections?.();
      server.closeIdleConnections?.();
      const forceClose = setTimeout(() => server.closeAllConnections?.(), 5000);
      forceClose.unref?.();
      try {
        await tracker.stop();
        await closed;
      } finally {
        clearTimeout(forceClose);
        restoreLogger();
      }
    };
    return { server, tracker, close, host, port: actualPort };
  } catch (error) {
    console.error("Startup failed:", error);
    await tracker?.stop().catch((stopError) => console.error("Startup cleanup failed:", stopError));
    restoreLogger();
    throw error;
  }
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
