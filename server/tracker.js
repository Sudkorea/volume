import { postUrl } from "./config.js";

const MODE_NAMES = ["normal", "boost"];

function uniquePages(pages) {
  return [...new Set((Array.isArray(pages) ? pages : []).filter((page) => Number.isInteger(page) && page > 0))]
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
    missingSinceAt: null,
    staleSinceAt: null,
    missingConfirmations: 0,
    alertStatus: "none",
    alertSentAt: null,
    nextAlertAt: 0,
  };
}

function initialGuardState(postNo) {
  return {
    postNo,
    status: "initializing",
    lastSeenAt: null,
    missingConfirmations: 0,
    alertStatus: "none",
    alertSentAt: null,
    nextAlertAt: 0,
  };
}

function safeModeState(saved, mode, now, alertRetryMs) {
  if (!saved || typeof saved !== "object" || saved.postNo !== mode.postNo) {
    return initialModeState(mode);
  }
  const state = initialModeState(mode);
  if (Number.isInteger(saved.views) && saved.views >= 0) state.views = saved.views;
  if (Number.isInteger(saved.volume) && saved.volume >= 0 && saved.volume < mode.modulus) {
    state.volume = saved.volume;
  }
  if (typeof saved.status === "string") state.status = saved.status;
  if (typeof saved.lastSeenAt === "string") state.lastSeenAt = saved.lastSeenAt;
  if (typeof saved.missingSinceAt === "string") state.missingSinceAt = saved.missingSinceAt;
  if (typeof saved.staleSinceAt === "string") state.staleSinceAt = saved.staleSinceAt;
  if (Number.isInteger(saved.missingConfirmations) && saved.missingConfirmations >= 0) {
    state.missingConfirmations = saved.missingConfirmations;
  }
  if (typeof saved.alertStatus === "string") state.alertStatus = saved.alertStatus;
  if (typeof saved.alertSentAt === "string") state.alertSentAt = saved.alertSentAt;
  if (Number.isFinite(saved.nextAlertAt) && saved.nextAlertAt >= 0) {
    state.nextAlertAt = saved.nextAlertAt;
  }
  if (state.alertStatus !== "delivered" && state.nextAlertAt > now + alertRetryMs) {
    state.nextAlertAt = now;
  }
  return state;
}

function safeGuardState(saved, postNo, now, alertRetryMs) {
  const state = initialGuardState(postNo);
  if (!saved || typeof saved !== "object" || saved.postNo !== postNo) return state;
  if (typeof saved.status === "string") state.status = saved.status;
  if (typeof saved.lastSeenAt === "string") state.lastSeenAt = saved.lastSeenAt;
  if (Number.isInteger(saved.missingConfirmations) && saved.missingConfirmations >= 0) {
    state.missingConfirmations = saved.missingConfirmations;
  }
  if (typeof saved.alertStatus === "string") state.alertStatus = saved.alertStatus;
  if (typeof saved.alertSentAt === "string") state.alertSentAt = saved.alertSentAt;
  if (Number.isFinite(saved.nextAlertAt) && saved.nextAlertAt >= 0) {
    state.nextAlertAt = saved.nextAlertAt;
  }
  if (state.alertStatus !== "delivered" && state.nextAlertAt > now + alertRetryMs) {
    state.nextAlertAt = now;
  }
  return state;
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
    this.guardState = {};
    this.listeners = new Set();
    this.sequence = 0;
    this.lastSuccessAt = null;
    this.lastError = null;
    this.consecutiveErrors = 0;
    this.retryAfterMs = null;
    this.burstUntil = 0;
    this.burstStartedAt = 0;
    this.burstCooldownUntil = 0;
    this.timer = null;
    this.timerDueAt = null;
    this.lastPollStartedAt = null;
    this.pendingImmediatePoll = false;
    this.nextRecoveryScanAt = 0;
    this.recoveryScanDistance = 2;
    this.recoveryScanSide = 0;
    this.lastPersistFingerprint = null;
    this.lastPersistAt = 0;
    this.started = false;
    this.polling = false;
  }

  async initialize() {
    this.config = await this.configStore.load({ force: true });
    const persisted = await this.stateStore.load();
    this.trackedPages = uniquePages(persisted?.trackedPages ?? [this.config.initialPage]);
    if (this.trackedPages.length === 0) this.trackedPages = [this.config.initialPage];

    const initializedAt = this.now();
    for (const modeName of MODE_NAMES) {
      const mode = this.config.modes[modeName];
      const saved = persisted?.modes?.[modeName];
      this.modeState[modeName] = safeModeState(
        saved,
        mode,
        initializedAt,
        this.config.polling.alertRetryMs,
      );
    }
    for (const guardName of ["newer", "older"]) {
      const postNo = this.config.guards[guardName];
      this.guardState[guardName] = safeGuardState(
        persisted?.guards?.[guardName],
        postNo,
        initializedAt,
        this.config.polling.alertRetryMs,
      );
    }
    if (persisted) {
      this.lastPersistFingerprint = this.persistenceFingerprint();
      const savedAt = Date.parse(persisted.savedAt);
      this.lastPersistAt = Number.isFinite(savedAt) ? savedAt : initializedAt;
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
    this.timerDueAt = null;
    this.pendingImmediatePoll = false;
    while (this.polling) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  subscribe(listener) {
    const wasIdle = this.listeners.size === 0;
    this.listeners.add(listener);
    listener(this.snapshot());
    if (wasIdle && this.started) this.schedule();
    return () => this.listeners.delete(listener);
  }

  requestImmediatePoll() {
    if (!this.started) return;
    if (this.polling) {
      this.pendingImmediatePoll = true;
      return;
    }
    const now = this.now();
    const earliest = this.lastPollStartedAt === null
      ? now
      : Math.max(now, this.lastPollStartedAt + this.config.polling.minIntervalMs);
    this.scheduleAt(earliest);
  }

  schedule() {
    if (!this.started) return;
    const now = this.now();
    const earliest = this.lastPollStartedAt === null
      ? now
      : this.lastPollStartedAt + this.config.polling.minIntervalMs;
    this.scheduleAt(Math.max(earliest, now + this.nextDelayMs(now)));
  }

  scheduleAt(dueAt) {
    if (!this.started) return;
    if (this.timer && this.timerDueAt !== null && this.timerDueAt <= dueAt) return;
    if (this.timer) clearTimeout(this.timer);
    this.timerDueAt = dueAt;
    this.timer = setTimeout(async () => {
      this.timer = null;
      this.timerDueAt = null;
      const now = this.now();
      const earliest = this.lastPollStartedAt === null
        ? now
        : this.lastPollStartedAt + this.config.polling.minIntervalMs;
      if (now < earliest) {
        this.scheduleAt(earliest);
        return;
      }
      await this.pollOnce();
      if (!this.started) return;
      if (this.pendingImmediatePoll) {
        this.pendingImmediatePoll = false;
        this.requestImmediatePoll();
      } else {
        this.schedule();
      }
    }, Math.max(0, dueAt - this.now()));
    this.timer.unref?.();
  }

  settleBurst(now) {
    if (this.burstStartedAt > 0 && now >= this.burstUntil) {
      this.burstStartedAt = 0;
      this.burstUntil = 0;
      this.burstCooldownUntil = Math.max(
        this.burstCooldownUntil,
        now + this.config.polling.burstCooldownMs,
      );
    }
  }

  activateBurst(now) {
    this.settleBurst(now);
    if (now < this.burstCooldownUntil) return;
    if (this.burstStartedAt === 0) this.burstStartedAt = now;
    const absoluteEnd = this.burstStartedAt + this.config.polling.burstMaxDurationMs;
    this.burstUntil = Math.min(absoluteEnd, now + this.config.polling.burstWindowMs);
  }

  nextDelayMs(now = this.now()) {
    const polling = this.config.polling;
    if (this.consecutiveErrors > 0) {
      const exponential = polling.activeMs * 2 ** Math.min(this.consecutiveErrors, 6);
      return Math.min(
        polling.maxBackoffMs,
        Math.max(this.retryAfterMs ?? 0, exponential),
      );
    }
    this.settleBurst(now);
    if (now < this.burstUntil && this.listeners.size > 0) return polling.burstMs;
    if (this.healthIssues(now).length > 0) return polling.degradedMs;
    return this.listeners.size > 0 ? polling.activeMs : polling.idleMs;
  }

  snapshot() {
    const now = this.now();
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
        missingSinceAt: state.missingSinceAt,
        staleSinceAt: state.staleSinceAt,
        missingConfirmations: state.missingConfirmations,
        alertStatus: state.alertStatus,
      };
    }
    const guards = {};
    for (const guardName of ["newer", "older"]) {
      const state = this.guardState[guardName];
      guards[guardName] = {
        postNo: state.postNo,
        status: state.status,
        lastSeenAt: state.lastSeenAt,
        missingConfirmations: state.missingConfirmations,
        alertStatus: state.alertStatus,
      };
    }
    const issues = this.healthIssues(now);
    return {
      sequence: this.sequence,
      observedAt: this.lastSuccessAt,
      connectedClients: this.listeners.size,
      trackedPages: [...this.trackedPages],
      upstream: {
        status: this.lastError || issues.length > 0
          ? "degraded"
          : this.lastSuccessAt ? "live" : "initializing",
        error: this.lastError ?? issues[0] ?? null,
        issues,
        consecutiveErrors: this.consecutiveErrors,
        nextPollMs: this.nextDelayMs(now),
      },
      discordConfigured: this.notifier.configured,
      guards,
      modes,
    };
  }

  healthIssues(now) {
    const issues = [];
    for (const guardName of ["newer", "older"]) {
      const state = this.guardState[guardName];
      if (state?.status === "missing") issues.push(`guard-${guardName}-missing`);
    }
    for (const modeName of MODE_NAMES) {
      const state = this.modeState[modeName];
      if (state?.status === "deleted") {
        issues.push(`${modeName}-target-deleted`);
        continue;
      }
      if (!state?.staleSinceAt || !["stale", "locating"].includes(state.status)) continue;
      const staleSince = Date.parse(state.staleSinceAt);
      if (Number.isFinite(staleSince) && now - staleSince >= this.config.polling.staleAfterMs) {
        issues.push(`${modeName}-${state.status}-too-long`);
      }
    }
    return issues;
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
    this.lastPollStartedAt = this.now();
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
    let markersChanged = false;
    for (const modeName of MODE_NAMES) {
      const nextMode = nextConfig.modes[modeName];
      if (this.modeState[modeName]?.postNo !== nextMode.postNo) {
        this.modeState[modeName] = initialModeState(nextMode);
        this.trackedPages = [nextConfig.initialPage];
        markersChanged = true;
      }
    }
    for (const guardName of ["newer", "older"]) {
      const nextPostNo = nextConfig.guards[guardName];
      if (this.guardState[guardName]?.postNo !== nextPostNo) {
        this.guardState[guardName] = initialGuardState(nextPostNo);
        this.trackedPages = [nextConfig.initialPage];
        markersChanged = true;
      }
    }
    this.config = nextConfig;
    if (markersChanged) this.resetRecoveryScan();
  }

  resetRecoveryScan() {
    this.nextRecoveryScanAt = 0;
    this.recoveryScanDistance = 2;
    this.recoveryScanSide = 0;
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
    const markerNumbers = [
      this.config.guards.newer,
      ...targetNumbers,
      this.config.guards.older,
    ];
    const missingTargets = () => targetNumbers.filter((postNo) => !merged.has(postNo));
    const missingMarkers = () => markerNumbers.filter((postNo) => !merged.has(postNo));
    const hasAnyMarker = () => markerNumbers.some((postNo) => merged.has(postNo));
    if (missingMarkers().length > 0) {
      const hasNewer = merged.has(this.config.guards.newer);
      const hasOlder = merged.has(this.config.guards.older);
      // Both sentinels bracket the targets, so a missing target cannot have
      // moved to an adjacent page. Avoid an unnecessary upstream request.
      if (!(missingTargets().length > 0 && hasNewer && hasOlder)) {
        const minimum = Math.min(...this.trackedPages);
        const maximum = Math.max(...this.trackedPages);
        const candidates = hasOlder && !hasNewer
          ? [minimum - 1, maximum + 1]
          : [maximum + 1, minimum - 1];
        for (const page of candidates) {
          await fetchOne(page);
          if (
            missingMarkers().length === 0
            || (
              missingTargets().length > 0
              && merged.has(this.config.guards.newer)
              && merged.has(this.config.guards.older)
            )
          ) break;
        }
      }
    }

    const recoveryNow = this.now();
    if (
      missingTargets().length > 0
      && !hasAnyMarker()
      && recoveryNow >= this.nextRecoveryScanAt
    ) {
      this.nextRecoveryScanAt = recoveryNow + this.config.polling.recoveryScanCooldownMs;
      const minimum = Math.min(...this.trackedPages);
      const maximum = Math.max(...this.trackedPages);
      let recoveryRequests = 0;
      while (
        recoveryRequests < this.config.polling.recoveryPageRadius
        && missingTargets().length > 0
      ) {
        let page;
        if (this.recoveryScanSide === 0) {
          page = maximum + this.recoveryScanDistance;
          this.recoveryScanSide = 1;
        } else {
          page = minimum - this.recoveryScanDistance;
          this.recoveryScanSide = 0;
          this.recoveryScanDistance += 1;
        }
        if (page < 1 || fetched.has(page)) continue;
        await fetchOne(page);
        recoveryRequests += 1;
      }
    }

    if (hasAnyMarker()) this.resetRecoveryScan();

    const markerPages = markerNumbers
      .map((postNo) => merged.get(postNo)?.page)
      .filter(Boolean);
    if (markerPages.length > 0) this.trackedPages = uniquePages(markerPages);

    return { merged, fetchedPages: [...fetched.keys()].sort((a, b) => a - b) };
  }

  async applyObservation({ merged }) {
    const observedAtMs = this.now();
    const observedAt = new Date(observedAtMs).toISOString();

    for (const guardName of ["newer", "older"]) {
      const state = this.guardState[guardName];
      if (merged.has(state.postNo)) {
        state.status = "live";
        state.lastSeenAt = observedAt;
        state.missingSinceAt = null;
        state.missingConfirmations = 0;
        state.alertStatus = "none";
        state.alertSentAt = null;
        state.nextAlertAt = 0;
      } else {
        state.missingSinceAt ??= observedAt;
        state.missingConfirmations += 1;
        state.status = state.missingConfirmations < this.config.polling.deletionConfirmations
          ? "suspected-missing"
          : "missing";
        if (
          state.status === "missing"
          && state.alertStatus !== "delivered"
          && observedAtMs >= state.nextAlertAt
        ) {
          await this.sendGuardAlert(guardName, state, observedAtMs);
        }
      }
    }

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
        state.lastSeenAt = observedAt;
        state.staleSinceAt = null;
        state.missingConfirmations = 0;
        if (state.alertStatus !== "none") {
          state.alertStatus = "none";
          state.alertSentAt = null;
          state.nextAlertAt = 0;
        }
        if (changed) this.activateBurst(observedAtMs);
        continue;
      }

      if (!bothGuardsVisible) {
        state.staleSinceAt ??= observedAt;
        state.status = state.views === null ? "locating" : "stale";
        continue;
      }

      state.staleSinceAt ??= observedAt;
      state.missingConfirmations += 1;
      if (state.missingConfirmations < this.config.polling.deletionConfirmations) {
        state.status = "suspected-deleted";
        continue;
      }

      state.status = "deleted";
      if (state.alertStatus === "delivered" || observedAtMs < state.nextAlertAt) continue;
      await this.sendDeletionAlert(modeName, definition, state, observedAtMs);
    }
  }

  async sendDeletionAlert(modeName, definition, state, detectedAtMs = this.now()) {
    try {
      const result = await this.notifier.notifyDeletion({
        mode: modeName,
        modeLabel: definition.label,
        postNo: definition.postNo,
        lastViews: state.views,
        lastVolume: state.volume,
        guardPosts: [this.config.guards.newer, this.config.guards.older],
        detectedAt: new Date(detectedAtMs).toISOString(),
      });
      state.alertStatus = result.delivered ? "delivered" : result.reason;
      state.alertSentAt = result.delivered ? new Date(detectedAtMs).toISOString() : null;
      state.nextAlertAt = result.delivered
        ? 0
        : detectedAtMs + this.config.polling.alertRetryMs;
    } catch (error) {
      state.alertStatus = "failed";
      state.nextAlertAt = detectedAtMs + Math.max(
        1000,
        error.retryAfterMs ?? this.config.polling.alertRetryMs,
      );
      console.warn(`Discord alert failed: ${error.message}`);
    }
  }

  async sendGuardAlert(guardName, state, detectedAtMs = this.now()) {
    try {
      const result = await this.notifier.notifyOperationalIssue({
        type: "guard_missing",
        key: `guard-${guardName}`,
        postNo: state.postNo,
        firstDetectedAt: state.missingSinceAt,
        detectedAt: new Date(detectedAtMs).toISOString(),
        trackedPages: [...this.trackedPages],
      });
      state.alertStatus = result.delivered ? "delivered" : result.reason;
      state.alertSentAt = result.delivered ? new Date(detectedAtMs).toISOString() : null;
      state.nextAlertAt = result.delivered
        ? 0
        : detectedAtMs + this.config.polling.alertRetryMs;
    } catch (error) {
      state.alertStatus = "failed";
      state.nextAlertAt = detectedAtMs + Math.max(
        1000,
        error.retryAfterMs ?? this.config.polling.alertRetryMs,
      );
      console.warn(`Discord guard alert failed: ${error.message}`);
    }
  }

  async persist() {
    const now = this.now();
    const fingerprint = this.persistenceFingerprint();
    if (
      fingerprint === this.lastPersistFingerprint
      && now - this.lastPersistAt < this.config.polling.stateCheckpointMs
    ) {
      return;
    }
    await this.stateStore.save({
      version: 1,
      trackedPages: this.trackedPages,
      guards: this.guardState,
      modes: this.modeState,
      savedAt: new Date(now).toISOString(),
    });
    this.lastPersistFingerprint = fingerprint;
    this.lastPersistAt = now;
  }

  persistenceFingerprint() {
    return JSON.stringify({
      trackedPages: this.trackedPages,
      guards: Object.fromEntries(
        ["newer", "older"].map((name) => {
          const state = this.guardState[name];
          return [name, [
            state.postNo,
            state.status,
            state.missingConfirmations,
            state.missingSinceAt,
            state.alertStatus,
            state.nextAlertAt,
          ]];
        }),
      ),
      modes: Object.fromEntries(
        MODE_NAMES.map((name) => {
          const state = this.modeState[name];
          return [name, [
            state.postNo,
            state.views,
            state.volume,
            state.status,
            state.missingConfirmations,
            state.alertStatus,
            state.nextAlertAt,
          ]];
        }),
      ),
    });
  }
}
