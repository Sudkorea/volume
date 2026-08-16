export function makeConfig(overrides = {}) {
  return {
    galleryId: "volume",
    initialPage: 1,
    guards: { newer: 11, older: 8 },
    modes: {
      normal: { label: "일반", postNo: 9, modulus: 100, title: "normal" },
      boost: { label: "부스트", postNo: 10, modulus: 101, title: "boost" },
    },
    polling: {
      activeMs: 2000,
      burstMs: 1000,
      burstWindowMs: 10000,
      burstMaxDurationMs: 20000,
      burstCooldownMs: 30000,
      idleMs: 30000,
      degradedMs: 10000,
      minIntervalMs: 1000,
      requestTimeoutMs: 4500,
      maxResponseBytes: 1500000,
      maxBackoffMs: 60000,
      deletionConfirmations: 3,
      staleAfterMs: 120000,
      alertRetryMs: 300000,
      stateCheckpointMs: 300000,
      recoveryPageRadius: 5,
      recoveryScanCooldownMs: 60000,
    },
    ...overrides,
  };
}

export class StaticConfigStore {
  constructor(config) {
    this.config = config;
  }

  async load() {
    return this.config;
  }
}

export function row(postNo, views, page) {
  return { postNo, views, page, title: `post ${postNo}`, href: `?no=${postNo}` };
}

export class PageClient {
  constructor(pages = {}) {
    this.pages = pages;
    this.calls = [];
  }

  async fetchPage(_config, page) {
    this.calls.push(page);
    return new Map((this.pages[page] ?? []).map((entry) => [entry.postNo, entry]));
  }
}

export class RecordingNotifier {
  constructor() {
    this.configured = true;
    this.events = [];
  }

  async notifyDeletion(event) {
    this.events.push(event);
    return { delivered: true };
  }

  async notifyOperationalIssue(event) {
    this.events.push(event);
    return { delivered: true };
  }
}
