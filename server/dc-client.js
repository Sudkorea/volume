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
        redirect: "follow",
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
    return parseGalleryList(await response.text(), page);
  }
}
