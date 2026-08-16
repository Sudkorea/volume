function clip(value, limit = 1800) {
  const text = String(value);
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function validateWebhookUrl(value) {
  if (!value) return "";
  const url = new URL(value);
  const isDiscord =
    url.protocol === "https:" &&
    ["discord.com", "discordapp.com"].includes(url.hostname) &&
    /^\/api\/webhooks\/\d+\/[A-Za-z0-9._-]+\/?$/.test(url.pathname);
  const isLoopbackTest =
    url.protocol === "http:" && ["127.0.0.1", "::1", "localhost"].includes(url.hostname);
  if (!isDiscord && !isLoopbackTest) {
    throw new Error("DISCORD_WEBHOOK_URL must be an HTTPS Discord webhook URL");
  }
  return url.toString();
}

function allowedMentions(mention) {
  const user = mention.match(/^<@!?(\d+)>$/);
  if (user) return { parse: [], users: [user[1]] };
  const role = mention.match(/^<@&(\d+)>$/);
  if (role) return { parse: [], roles: [role[1]] };
  return { parse: [] };
}

async function discordError(response) {
  const error = new Error(`Discord webhook returned HTTP ${response.status}`);
  if (response.status !== 429) return error;

  const retryHeader = Number.parseFloat(response.headers.get("retry-after") ?? "");
  let retryBody = null;
  try {
    retryBody = Number.parseFloat((await response.clone().json()).retry_after);
  } catch {
    // Discord can return an empty or non-JSON body through an intermediary.
  }
  const retrySeconds = Number.isFinite(retryBody) ? retryBody : retryHeader;
  if (Number.isFinite(retrySeconds)) error.retryAfterMs = Math.max(1000, retrySeconds * 1000);
  return error;
}

export class DiscordNotifier {
  constructor({
    webhookUrl = process.env.DISCORD_WEBHOOK_URL || "",
    mention = process.env.DISCORD_MENTION || "",
    publicBaseUrl = process.env.PUBLIC_BASE_URL || "",
    fetchImpl = globalThis.fetch,
  } = {}) {
    this.webhookUrl = validateWebhookUrl(webhookUrl.trim());
    this.mention = mention.trim();
    this.publicBaseUrl = publicBaseUrl.trim();
    this.fetchImpl = fetchImpl;
  }

  get configured() {
    return Boolean(this.webhookUrl);
  }

  async send(content) {
    if (!this.configured) return { delivered: false, reason: "not_configured" };
    const response = await this.fetchImpl(this.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "Volume Oracle Watchdog",
        content: clip(content),
        allowed_mentions: allowedMentions(this.mention),
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw await discordError(response);
    return { delivered: true };
  }

  async notifyDeletion(event) {
    if (!this.configured) {
      console.warn(`[discord disabled] target post ${event.postNo} was deleted`);
      return { delivered: false, reason: "not_configured" };
    }

    const lines = [
      this.mention,
      "🚨 **조회수 오라클 게시글 삭제 감지**",
      `모드: ${event.modeLabel} (${event.mode})`,
      `삭제된 글: ${event.postNo}`,
      `마지막 조회수: ${event.lastViews ?? "알 수 없음"}`,
      `마지막 볼륨: ${event.lastVolume ?? "알 수 없음"}%`,
      `확인된 센티널: ${event.guardPosts.join(", ")}`,
      `감지 시각: ${event.detectedAt}`,
      this.publicBaseUrl ? `서비스: ${this.publicBaseUrl}` : "",
      "새 게시글을 만든 뒤 config/oracles.json의 postNo를 교체하세요.",
    ].filter(Boolean);

    return this.send(lines.join("\n"));
  }

  async notifyOperationalIssue(event) {
    if (!this.configured) {
      console.warn(`[discord disabled] ${event.type} for post ${event.postNo}`);
      return { delivered: false, reason: "not_configured" };
    }
    const labels = {
      guard_missing: "확인용 게시글을 찾을 수 없습니다.",
      target_stale: "게시글 추적이 오래 중단됐습니다.",
    };
    return this.send([
      this.mention,
      labels[event.type] ?? "볼륨 게시글 추적 상태를 확인하세요.",
      `게시글: ${event.postNo}`,
      `상태 키: ${event.key}`,
      `처음 감지: ${event.firstDetectedAt ?? "알 수 없음"}`,
      `확인 시각: ${event.detectedAt}`,
      `확인 중인 페이지: ${(event.trackedPages ?? []).join(", ") || "알 수 없음"}`,
      this.publicBaseUrl ? `서비스: ${this.publicBaseUrl}` : "",
      "게시글 상태를 확인하고 필요하면 config/oracles.json을 교체하세요.",
    ].filter(Boolean).join("\n"));
  }

  async notifyTest() {
    return this.send([
      "✅ **Volume Oracle Watchdog 연결 테스트 성공**",
      `시각: ${new Date().toISOString()}`,
      this.publicBaseUrl ? `서비스: ${this.publicBaseUrl}` : "",
      "이 메시지는 게시글 삭제 알림의 실제 전송 경로를 확인하기 위한 테스트입니다.",
    ].filter(Boolean).join("\n"));
  }
}
