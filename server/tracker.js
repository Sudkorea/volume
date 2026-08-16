import { postUrl } from "./config.js";

const MODE_NAMES = ["normal", "boost"];

function uniquePages(pages) {
  return [...new Set(pages.filter((page) => Number.isInteger(page) && page > 0))]
    .sort((a, b) => a - b)
    .slice(0, 2);
}

function initialModeState(mode) {
  return {
    postNo: mode.postNo,
    views: null,
    volume: null,
    status: "initializing",
    lastSeenAt: null,
    missingConfirmations: 0,
    alertStatus: "none",
    alertSentAt: null,
    nextAlertAt: 0,
  };
}

export class OracleTracker {
  constructor({ configStore, listClient, notifier, stateStore, now = () => Date.now() }) {
    this.configStore = configStore;
    this.listClient = listClient;
    this.notifier = notifier;
    this.stateStore = stateStore;
    this.now = now;
    this.config = null;
    this.trackedPages = [1];
    this.modeState = {};
    this.listeners = new Set();
    this.sequence = 0;
    this.lastSuccessAt = null;
    this.lastError = null;
    this.consecutiveErrors = 0;
    this.retryAfterMs = null;
    this.burstUntil = 0;
    this.timer = null;
    this.started = false;
    this.polling = false;
  }

  async initialize() {
    this.config = await this.configStore.load({ force: true });
    const persisted = await this.stateStore.load();
    this.trackedPages = uniquePages(persisted?.trackedPages ?? [this.config.initialPage]);
    if (this.trackedPages.length === 0) this.trackedPages = [this.config.initialPage];

    for (const modeName of MODE_NAMES) {
      const mode = this.config.modes[modeName];
      const saved = persisted?.modes?.[modeName];
      this.modeState[modeName] =
        saved?.postNo === mode.postNo
          ? { ...initialModeState(mode), ...saved }
          : initialModeState(mode);
    }
  }

  async start() {
    if (this.started) return;
    if (!this.config) await this.initialize();
    this.started = true;
    await this.pollOnce();
    this.schedule();
  }

  async stop() {
    this.started = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    while (this.polling) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.snapshot());
    this.broadcast();
    this.requestImmediatePoll();
    return () => {
      this.listeners.delete(listener);
      this.broadcast();
    };
  }

  requestImmediatePoll() {
    if (!this.started || this.polling) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(async () => {
      await this.pollOnce();
      this.schedule();
    }, 0);
  }

  schedule() {
    if (!this.started) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(async () => {
      await this.pollOnce();
      this.schedule();
    }, this.nextDelayMs());
  }

  nextDelayMs() {
    const polling = this.config.polling;
    if (this.consecutiveErrors > 0) {
      const exponential = polling.activeMs * 2 ** Math.min(this.consecutiveErrors, 6);
      return Math.min(
        polling.maxBackoffMs,
        Math.max(this.retryAfterMs ?? 0, exponential),
      );
    }
    if (this.now() < this.burstUntil && this.listeners.size > 0) return polling.burstMs;
    return this.listeners.size > 0 ? polling.activeMs : polling.idleMs;
  }

  snapshot() {
    const modes = {};
    for (const modeName of MODE_NAMES) {
      const definition = this.config.modes[modeName];
      const state = this.modeState[modeName];
      modes[modeName] = {
        label: definition.label,
        title: definition.title,
        postNo: definition.postNo,
        modulus: definition.modulus,
        url: postUrl(this.config, definition.postNo),
        views: state.views,
        volume: state.volume,
        status: state.status,
        lastSeenAt: state.lastSeenAt,
        missingConfirmations: state.missingConfirmations,
        alertStatus: state.alertStatus,
      };
    }
    return {
      sequence: this.sequence,
      observedAt: this.lastSuccessAt,
      connectedClients: this.listeners.size,
      trackedPages: [...this.trackedPages],
      upstream: {
        status: this.lastError ? "degraded" : this.lastSuccessAt ? "live" : "initializing",
        error: this.lastError,
        consecutiveErrors: this.consecutiveErrors,
        nextPollMs: this.nextDelayMs(),
      },
      discordConfigured: this.notifier.configured,
      modes,
    };
  }

  broadcast() {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        console.warn("SSE listener failed", error);
      }
    }
  }

  async pollOnce() {
    if (this.polling) return this.snapshot();
    this.polling = true;
    try {
      await this.syncConfig();
      const observation = await this.observePages();
      await this.applyObservation(observation);
      this.lastSuccessAt = new Date(this.now()).toISOString();
      this.lastError = null;
      this.consecutiveErrors = 0;
      this.retryAfterMs = null;
      this.sequence += 1;
      await this.persist();
    } catch (error) {
      this.consecutiveErrors += 1;
      this.retryAfterMs = error.retryAfterMs ?? null;
      this.lastError = error.message;
      this.sequence += 1;
      console.warn(`oracle poll failed: ${error.message}`);
    } finally {
      this.polling = false;
      this.broadcast();
    }
    return this.snapshot();
  }

  async syncConfig() {
    const nextConfig = await this.configStore.load();
    for (const modeName of MODE_NAMES) {
      const nextMode = nextConfig.modes[modeName];
      if (this.modeState[modeName]?.postNo !== nextMode.postNo) {
        this.modeState[modeName] = initialModeState(nextMode);
        this.trackedPages = [nextConfig.initialPage];
      }
    }
    this.config = nextConfig;
  }

  async observePages() {
    const fetched = new Map();
    const merged = new Map();
    const fetchOne = async (page) => {
      if (fetched.has(page) || page < 1) return;
      const rows = await this.listClient.fetchPage(this.config, page);
      fetched.set(page, rows);
      for (const [postNo, row] of rows) merged.set(postNo, row);
    };

    for (const page of this.trackedPages) await fetchOne(page);

    const targetNumbers = MODE_NAMES.map((name) => this.config.modes[name].postNo);
    const missingTargets = () => targetNumbers.filter((postNo) => !merged.has(postNo));
    if (missingTargets().length > 0) {
      const hasNewer = merged.has(this.config.guards.newer);
      const hasOlder = merged.has(this.config.guards.older);
      const minimum = Math.min(...this.trackedPages);
      const maximum = Math.max(...this.trackedPages);
      const candidates = hasOlder && !hasNewer
        ? [minimum - 1, maximum + 1]
        : [maximum + 1, minimum - 1];
      for (const page of candidates) {
        await fetchOne(page);
        if (missingTargets().length === 0) break;
      }
    }

    const targetPages = targetNumbers
      .map((postNo) => merged.get(postNo)?.page)
      .filter(Boolean);
    if (targetPages.length > 0) {
      this.trackedPages = uniquePages(targetPages);
    } else {
      const guardPages = [this.config.guards.newer, this.config.guards.older]
        .map((postNo) => merged.get(postNo)?.page)
        .filter(Boolean);
      if (guardPages.length > 0) this.trackedPages = uniquePages(guardPages);
    }

    return { merged, fetchedPages: [...fetched.keys()].sort((a, b) => a - b) };
  }

  async applyObservation({ merged }) {
    const bothGuardsVisible =
      merged.has(this.config.guards.newer) && merged.has(this.config.guards.older);

    for (const modeName of MODE_NAMES) {
      const definition = this.config.modes[modeName];
      const state = this.modeState[modeName];
      const row = merged.get(definition.postNo);

      if (row) {
        const changed = state.views !== null && state.views !== row.views;
        state.views = row.views;
        state.volume = row.views % definition.modulus;
        state.status = "live";
        state.lastSeenAt = new Date(this.now()).toISOString();
        state.missingConfirmations = 0;
        if (state.alertStatus !== "none") {
          state.alertStatus = "none";
          state.alertSentAt = null;
          state.nextAlertAt = 0;
        }
        if (changed) this.burstUntil = this.now() + this.config.polling.burstWindowMs;
        continue;
      }

      if (!bothGuardsVisible) {
        state.status = state.views === null ? "locating" : "stale";
        continue;
      }

      state.missingConfirmations += 1;
      if (state.missingConfirmations < this.config.polling.deletionConfirmations) {
        state.status = "suspected-deleted";
        continue;
      }

      state.status = "deleted";
      if (state.alertStatus === "delivered" || this.now() < state.nextAlertAt) continue;
      await this.sendDeletionAlert(modeName, definition, state);
    }
  }

  async sendDeletionAlert(modeName, definition, state) {
    try {
      const result = await this.notifier.notifyDeletion({
        mode: modeName,
        modeLabel: definition.label,
        postNo: definition.postNo,
        lastViews: state.views,
        lastVolume: state.volume,
        guardPosts: [this.config.guards.newer, this.config.guards.older],
        detectedAt: new Date(this.now()).toISOString(),
      });
      state.alertStatus = result.delivered ? "delivered" : result.reason;
      state.alertSentAt = result.delivered ? new Date(this.now()).toISOString() : null;
      state.nextAlertAt = result.delivered ? 0 : Number.MAX_SAFE_INTEGER;
    } catch (error) {
      state.alertStatus = "failed";
      state.nextAlertAt = this.now() + 60_000;
      console.warn(`Discord alert failed: ${error.message}`);
    }
  }

  async persist() {
    await this.stateStore.save({
      version: 1,
      trackedPages: this.trackedPages,
      modes: this.modeState,
      savedAt: new Date(this.now()).toISOString(),
    });
  }
}
