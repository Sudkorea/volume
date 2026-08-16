function clip(value, limit = 1800) {
  const text = String(value);
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

export class DiscordNotifier {
  constructor({
    webhookUrl = process.env.DISCORD_WEBHOOK_URL || "",
    mention = process.env.DISCORD_MENTION || "",
    publicBaseUrl = process.env.PUBLIC_BASE_URL || "",
    fetchImpl = globalThis.fetch,
  } = {}) {
    this.webhookUrl = webhookUrl.trim();
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
        allowed_mentions: { parse: [] },
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Discord webhook returned HTTP ${response.status}`);
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

  async notifyTest() {
    return this.send([
      "✅ **Volume Oracle Watchdog 연결 테스트 성공**",
      `시각: ${new Date().toISOString()}`,
      this.publicBaseUrl ? `서비스: ${this.publicBaseUrl}` : "",
      "이 메시지는 게시글 삭제 알림의 실제 전송 경로를 확인하기 위한 테스트입니다.",
    ].filter(Boolean).join("\n"));
  }
}
