import { parseGalleryList } from "./parser.js";

export class UpstreamError extends Error {
  constructor(message, { status = null, retryAfterMs = null } = {}) {
    super(message);
    this.name = "UpstreamError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

function parseRetryAfter(header) {
  if (!header) return null;
  const seconds = Number.parseInt(header, 10);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

function assertExpectedResponse(response) {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("text/html") && !contentType.startsWith("application/xhtml+xml")) {
    throw new UpstreamError(`DCInside returned unexpected content type: ${contentType || "missing"}`);
  }

  let finalUrl;
  try {
    finalUrl = new URL(response.url);
  } catch {
    throw new UpstreamError("DCInside response URL was missing or invalid");
  }
  if (finalUrl.protocol !== "https:" || finalUrl.hostname !== "gall.dcinside.com") {
    throw new UpstreamError("DCInside response came from an unexpected host");
  }
}

async function readLimitedText(response, maxBytes) {
  const declaredLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new UpstreamError(`DCInside response exceeded ${maxBytes} bytes`);
  }
  if (!response.body) throw new UpstreamError("DCInside returned an empty response body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        await reader.cancel("response too large");
        throw new UpstreamError(`DCInside response exceeded ${maxBytes} bytes`);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}

function parseAndValidateList(html, page) {
  const rows = parseGalleryList(html, page);
  // User-controlled gallery titles can contain words such as "captcha" or
  // "cloudflare". Valid list rows take precedence over textual challenge
  // heuristics so another poster cannot force the tracker into degraded mode.
  if (rows.size > 0) return rows;

  const normalized = html.toLowerCase();
  const challengeMarkers = [
    "captcha",
    "cf-chl-",
    "cloudflare",
    "비정상적인 접근",
    "자동입력 방지",
    "접근이 제한",
    "서비스 이용 제한",
  ];
  const challenge = challengeMarkers.some((marker) => normalized.includes(marker));
  if (challenge) {
    throw new UpstreamError("DCInside returned a challenge or access-denied page");
  }

  const hasListShell = /<table\b[^>]*class=["'][^"']*\bgall_list\b/i.test(html)
    && /<tbody\b[^>]*class=["'][^"']*\blistwrap2\b/i.test(html);
  if (hasListShell) return rows;
  throw new UpstreamError(
    "DCInside list HTML contained no valid post rows or list structure",
  );
}

export class DcListClient {
  constructor({ fetchImpl = globalThis.fetch } = {}) {
    this.fetchImpl = fetchImpl;
  }

  async fetchPage(config, page) {
    const url = new URL("https://gall.dcinside.com/mgallery/board/lists/");
    url.searchParams.set("id", config.galleryId);
    url.searchParams.set("page", String(page));

    let response;
    try {
      response = await this.fetchImpl(url, {
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "ko-KR,ko;q=0.9",
          "User-Agent": "VolumeOracleContest/1.0 (+public gallery view counter)",
        },
        redirect: "error",
        signal: AbortSignal.timeout(config.polling.requestTimeoutMs),
      });
    } catch (error) {
      throw new UpstreamError(`DCInside request failed: ${error.message}`);
    }

    if (!response.ok) {
      throw new UpstreamError(`DCInside returned HTTP ${response.status}`, {
        status: response.status,
        retryAfterMs: parseRetryAfter(response.headers.get("retry-after")),
      });
    }
    assertExpectedResponse(response);
    const html = await readLimitedText(response, config.polling.maxResponseBytes);
    return parseAndValidateList(html, page);
  }
}
