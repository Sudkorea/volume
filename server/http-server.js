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
    if (length > 16_384) throw new Error("request body too large");
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function writeSse(response, snapshot) {
  response.write(`id: ${snapshot.sequence}\n`);
  response.write("event: oracle\n");
  response.write(`data: ${JSON.stringify(snapshot)}\n\n`);
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
}) {
  const resolvedPublicDir = path.resolve(publicDir);

  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
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
        response.writeHead(200, {
          ...SECURITY_HEADERS,
          ...apiCorsHeaders,
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "Content-Type": "text/event-stream; charset=utf-8",
          "X-Accel-Buffering": "no",
        });
        response.write("retry: 3000\n\n");
        const unsubscribe = tracker.subscribe((snapshot) => writeSse(response, snapshot));
        const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), 15_000);
        request.on("close", () => {
          clearInterval(heartbeat);
          unsubscribe();
        });
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
      await serveStatic(response, resolvedPublicDir, decodeURIComponent(url.pathname));
    } catch (error) {
      console.error(error);
      if (!response.headersSent) sendJson(response, 500, { error: "internal server error" });
      else response.end();
    }
  });
}
