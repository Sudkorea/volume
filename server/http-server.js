import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

const SECURITY_HEADERS = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "connect-src 'self'",
    "img-src 'self' data:",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join("; "),
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

const DEFAULT_LIMITS = Object.freeze({
  maxConnections: 256,
  maxSseClients: 200,
  maxSseClientsPerIp: 8,
  maxSseAttemptsPerMinute: 20,
  maxSseAttemptsPerMinuteGlobal: 600,
  maxApiRequestsPerWindow: 60,
  maxApiRequestsPerWindowGlobal: 1200,
  requestWindowMs: 10_000,
  maxTrackedClients: 2048,
  maxSseBufferedBytes: 64 * 1024,
  sseBackpressureTimeoutMs: 5000,
});

class HttpInputError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

class FixedWindowLimiter {
  constructor({ limit, windowMs, maxKeys }) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
    this.entries = new Map();
  }

  check(key, now = Date.now()) {
    let entry = this.entries.get(key);
    if (entry && now >= entry.resetAt) {
      this.entries.delete(key);
      entry = null;
    }
    if (!entry) {
      if (this.entries.size >= this.maxKeys) {
        for (const [candidate, value] of this.entries) {
          if (now >= value.resetAt) this.entries.delete(candidate);
        }
      }
      const boundedKey = this.entries.size < this.maxKeys ? key : "__overflow__";
      entry = this.entries.get(boundedKey);
      if (!entry || now >= entry.resetAt) {
        entry = { count: 0, resetAt: now + this.windowMs };
        this.entries.set(boundedKey, entry);
      }
    }
    entry.count += 1;
    return {
      allowed: entry.count <= this.limit,
      retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
    };
  }
}

function positiveLimit(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function resolveLimits(overrides) {
  return Object.fromEntries(
    Object.entries(DEFAULT_LIMITS).map(([name, fallback]) => [
      name,
      positiveLimit(overrides?.[name], fallback),
    ]),
  );
}

function isLoopback(address) {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function clientIdentity(request) {
  const remoteAddress = request.socket.remoteAddress || "unknown";
  // Funnel reaches this loopback-only service through a local proxy. Do not
  // trust caller-controlled forwarding headers without a documented proxy
  // contract; global limits remain authoritative for shared-proxy traffic.
  return { key: remoteAddress, sharedProxy: isLoopback(remoteAddress) };
}

function sendRateLimited(response, retryAfterSeconds, message = "rate limit exceeded") {
  sendJson(response, 429, { error: message }, { "Retry-After": String(retryAfterSeconds) });
}

function sendJson(response, status, value, extraHeaders = {}) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    ...SECURITY_HEADERS,
    ...extraHeaders,
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  response.end(body);
}

async function readJson(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 16_384) throw new HttpInputError("request body too large", 413);
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpInputError("invalid JSON");
  }
}

function sseSnapshotFrame(snapshot) {
  return `id: ${snapshot.sequence}\nevent: oracle\ndata: ${JSON.stringify(snapshot)}\n\n`;
}

function corsHeaders(request, allowedOrigins) {
  const origin = request.headers.origin;
  if (!origin || !allowedOrigins.has(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
  };
}

async function serveStatic(response, publicDir, pathname) {
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const normalized = path.normalize(requested);
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
    sendJson(response, 400, { error: "invalid path" });
    return;
  }
  const filePath = path.join(publicDir, normalized);
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw Object.assign(new Error("not found"), { code: "ENOENT" });
    const body = await readFile(filePath);
    response.writeHead(200, {
      ...SECURITY_HEADERS,
      "Cache-Control": normalized === "index.html" ? "no-cache" : "public, max-age=300",
      "Content-Type": MIME_TYPES[path.extname(filePath)] ?? "application/octet-stream",
      "Content-Length": body.length,
    });
    response.end(body);
  } catch (error) {
    if (error.code === "ENOENT") {
      sendJson(response, 404, { error: "not found" });
      return;
    }
    throw error;
  }
}

export function createVolumeServer({
  tracker,
  mockClient = null,
  publicDir = "public",
  allowedOrigins = new Set(),
  limits: limitOverrides = {},
}) {
  const resolvedPublicDir = path.resolve(publicDir);
  const limits = resolveLimits(limitOverrides);
  const apiClientLimiter = new FixedWindowLimiter({
    limit: limits.maxApiRequestsPerWindow,
    windowMs: limits.requestWindowMs,
    maxKeys: limits.maxTrackedClients,
  });
  const apiGlobalLimiter = new FixedWindowLimiter({
    limit: limits.maxApiRequestsPerWindowGlobal,
    windowMs: limits.requestWindowMs,
    maxKeys: 1,
  });
  const sseClientLimiter = new FixedWindowLimiter({
    limit: limits.maxSseAttemptsPerMinute,
    windowMs: 60_000,
    maxKeys: limits.maxTrackedClients,
  });
  const sseGlobalLimiter = new FixedWindowLimiter({
    limit: limits.maxSseAttemptsPerMinuteGlobal,
    windowMs: 60_000,
    maxKeys: 1,
  });
  const sseClients = new Set();
  const sseClientsByIp = new Map();
  let heartbeat = null;

  const closeSseClient = (client, finalFrame = "") => {
    if (client.closed) return;
    client.closed = true;
    sseClients.delete(client);
    const remaining = (sseClientsByIp.get(client.key) ?? 1) - 1;
    if (remaining > 0) sseClientsByIp.set(client.key, remaining);
    else sseClientsByIp.delete(client.key);
    if (client.blockedTimer) clearTimeout(client.blockedTimer);
    if (client.onDrain) client.response.off("drain", client.onDrain);
    client.unsubscribe?.();
    if (!client.response.writableEnded && !client.response.destroyed) {
      client.response.end(finalFrame);
    }
    if (sseClients.size === 0 && heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  };

  const writeSse = (client, frame) => {
    if (client.closed || client.response.writableEnded || client.response.destroyed) {
      closeSseClient(client);
      return;
    }
    const frameBytes = Buffer.byteLength(frame);
    if (frameBytes > limits.maxSseBufferedBytes) {
      closeSseClient(client);
      return;
    }
    if (client.blocked) {
      if (frame.startsWith(":") && client.pendingFrame) return;
      client.pendingFrame = frame;
      return;
    }
    if (client.response.writableLength + frameBytes > limits.maxSseBufferedBytes) {
      closeSseClient(client);
      return;
    }
    if (client.response.write(frame)) return;

    client.blocked = true;
    client.blockedTimer = setTimeout(() => closeSseClient(client), limits.sseBackpressureTimeoutMs);
    client.blockedTimer.unref?.();
    client.onDrain = () => {
      if (client.closed) return;
      clearTimeout(client.blockedTimer);
      client.blockedTimer = null;
      client.blocked = false;
      client.onDrain = null;
      const pending = client.pendingFrame;
      client.pendingFrame = null;
      if (pending) writeSse(client, pending);
    };
    client.response.once("drain", client.onDrain);
  };

  const startHeartbeat = () => {
    if (heartbeat) return;
    heartbeat = setInterval(() => {
      for (const client of sseClients) writeSse(client, ": heartbeat\n\n");
    }, 15_000);
    heartbeat.unref?.();
  };

  const server = createServer({
    headersTimeout: 5000,
    requestTimeout: 10_000,
    keepAliveTimeout: 5000,
    maxHeaderSize: 16_384,
  }, async (request, response) => {
    try {
      let url;
      try {
        url = new URL(request.url, "http://localhost");
      } catch {
        sendJson(response, 400, { error: "invalid URL" });
        return;
      }
      const { key, sharedProxy } = clientIdentity(request);
      const globalRate = apiGlobalLimiter.check("global");
      const clientRate = sharedProxy
        ? { allowed: true, retryAfterSeconds: 1 }
        : apiClientLimiter.check(key);
      if (!globalRate.allowed || !clientRate.allowed) {
        sendRateLimited(
          response,
          Math.max(globalRate.retryAfterSeconds, clientRate.retryAfterSeconds),
        );
        return;
      }
      if (url.pathname.startsWith("/api/")) {
        if (request.headers.origin && !allowedOrigins.has(request.headers.origin)) {
          sendJson(response, 403, { error: "origin not allowed" });
          return;
        }
      }
      const apiCorsHeaders = corsHeaders(request, allowedOrigins);

      if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
        if (!request.headers.origin || !allowedOrigins.has(request.headers.origin)) {
          sendJson(response, 403, { error: "origin not allowed" });
          return;
        }
        response.writeHead(204, {
          ...SECURITY_HEADERS,
          ...apiCorsHeaders,
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Max-Age": "86400",
        });
        response.end();
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/state") {
        sendJson(response, 200, tracker.snapshot(), apiCorsHeaders);
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/health") {
        const state = tracker.snapshot();
        sendJson(response, state.upstream.status === "degraded" ? 503 : 200, {
          ok: state.upstream.status !== "degraded",
          upstream: state.upstream,
          discordConfigured: state.discordConfigured,
          trackedPages: state.trackedPages,
        }, apiCorsHeaders);
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/events") {
        const globalAttempt = sseGlobalLimiter.check("global");
        const clientAttempt = sharedProxy
          ? { allowed: true, retryAfterSeconds: 1 }
          : sseClientLimiter.check(key);
        if (!globalAttempt.allowed || !clientAttempt.allowed) {
          sendRateLimited(
            response,
            Math.max(globalAttempt.retryAfterSeconds, clientAttempt.retryAfterSeconds),
            "event connection rate limit exceeded",
          );
          return;
        }
        if (
          sseClients.size >= limits.maxSseClients
          || (!sharedProxy && (sseClientsByIp.get(key) ?? 0) >= limits.maxSseClientsPerIp)
        ) {
          sendJson(response, 503, { error: "event connection capacity reached" }, {
            ...apiCorsHeaders,
            "Retry-After": "10",
          });
          return;
        }
        response.writeHead(200, {
          ...SECURITY_HEADERS,
          ...apiCorsHeaders,
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "Content-Type": "text/event-stream; charset=utf-8",
          "X-Accel-Buffering": "no",
        });
        response.flushHeaders?.();
        const client = {
          response,
          key,
          closed: false,
          blocked: false,
          blockedTimer: null,
          onDrain: null,
          pendingFrame: null,
          unsubscribe: null,
        };
        sseClients.add(client);
        sseClientsByIp.set(key, (sseClientsByIp.get(key) ?? 0) + 1);
        writeSse(client, "retry: 3000\n\n");
        const unsubscribe = tracker.subscribe((snapshot) => {
          writeSse(client, sseSnapshotFrame(snapshot));
        });
        client.unsubscribe = unsubscribe;
        if (client.closed) unsubscribe();
        else startHeartbeat();
        response.once("close", () => closeSseClient(client));
        response.once("error", () => closeSseClient(client));
        return;
      }

      if (url.pathname.startsWith("/api/dev/")) {
        if (!mockClient) {
          sendJson(response, 404, { error: "not found" });
          return;
        }
        if (request.method !== "POST") {
          sendJson(response, 405, { error: "method not allowed" });
          return;
        }
        const body = await readJson(request);
        const postNo = Number(body.postNo);
        if (!Number.isInteger(postNo) || postNo < 1) {
          sendJson(response, 400, { error: "postNo must be a positive integer" });
          return;
        }
        if (url.pathname === "/api/dev/increment") {
          const amount = Number.isInteger(Number(body.amount)) ? Number(body.amount) : 1;
          if (amount < 1 || amount > 1000) {
            sendJson(response, 400, { error: "amount must be between 1 and 1000" });
            return;
          }
          mockClient.increment(postNo, amount);
        } else if (url.pathname === "/api/dev/delete") {
          mockClient.remove(postNo);
        } else if (url.pathname === "/api/dev/restore") {
          mockClient.restore(postNo);
        } else {
          sendJson(response, 404, { error: "not found" });
          return;
        }
        tracker.requestImmediatePoll();
        sendJson(response, 202, { accepted: true });
        return;
      }

      if (request.method !== "GET" && request.method !== "HEAD") {
        sendJson(response, 405, { error: "method not allowed" });
        return;
      }
      let pathname;
      try {
        pathname = decodeURIComponent(url.pathname);
      } catch {
        sendJson(response, 400, { error: "invalid URL encoding" });
        return;
      }
      await serveStatic(response, resolvedPublicDir, pathname);
    } catch (error) {
      if (error instanceof HttpInputError && !response.headersSent) {
        sendJson(response, error.status, { error: error.message });
        return;
      }
      console.error(`HTTP request failed: ${error.message}`);
      if (!response.headersSent) sendJson(response, 500, { error: "internal server error" });
      else response.end();
    }
  });
  server.maxConnections = limits.maxConnections;
  server.closeSseConnections = () => {
    for (const client of [...sseClients]) {
      closeSseClient(client, "event: shutdown\ndata: {}\n\n");
    }
  };
  server.on("close", () => {
    server.closeSseConnections();
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
  });
  return server;
}
