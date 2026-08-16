import assert from "node:assert/strict";
import test from "node:test";
import { MemoryStateStore } from "../server/state-store.js";
import { OracleTracker } from "../server/tracker.js";
import {
  makeConfig,
  PageClient,
  RecordingNotifier,
  row,
  StaticConfigStore,
} from "./helpers.js";

function createTracker({ config = makeConfig(), pages, notifier = new RecordingNotifier(), store = new MemoryStateStore() }) {
  let time = Date.parse("2026-08-16T09:00:00.000Z");
  const listClient = new PageClient(pages);
  return {
    listClient,
    notifier,
    store,
    tracker: new OracleTracker({
      configStore: new StaticConfigStore(config),
      listClient,
      notifier,
      stateStore: store,
      now: () => (time += 1000),
    }),
  };
}

test("merges two adjacent pages when the target block straddles a boundary", async () => {
  const pages = {
    1: [row(11, 17, 1), row(10, 187, 1)],
    2: [row(9, 42, 2), row(8, 11, 2)],
  };
  const { tracker } = createTracker({ pages });
  await tracker.initialize();
  const snapshot = await tracker.pollOnce();

  assert.deepEqual(snapshot.trackedPages, [1, 2]);
  assert.equal(snapshot.modes.normal.volume, 42);
  assert.equal(snapshot.modes.boost.volume, 86);
  assert.equal(snapshot.modes.normal.status, "live");
  assert.equal(snapshot.modes.boost.status, "live");
});

test("retains an adjacent page that contains only the outer guard", async () => {
  const config = makeConfig({
    polling: { ...makeConfig().polling, deletionConfirmations: 2 },
  });
  const pages = {
    1: [row(11, 17, 1)],
    2: [row(10, 187, 2), row(9, 42, 2), row(8, 11, 2)],
  };
  const { tracker, notifier } = createTracker({ config, pages });
  await tracker.initialize();

  for (let poll = 0; poll < 3; poll += 1) {
    const snapshot = await tracker.pollOnce();
    assert.deepEqual(snapshot.trackedPages, [1, 2]);
    assert.equal(snapshot.guards.newer.status, "live");
  }
  assert.equal(notifier.events.length, 0);

  pages[2] = [row(9, 42, 2), row(8, 11, 2)];
  await tracker.pollOnce();
  const deleted = await tracker.pollOnce();
  assert.equal(deleted.modes.boost.status, "deleted");
  assert.equal(notifier.events.length, 1);
  assert.equal(notifier.events[0].postNo, 10);
});

test("discovers an outer guard when the initial page already has both targets", async () => {
  const config = makeConfig({ initialPage: 2 });
  const pages = {
    1: [row(11, 17, 1)],
    2: [row(10, 187, 2), row(9, 42, 2), row(8, 11, 2)],
  };
  const { tracker, listClient } = createTracker({ config, pages });
  await tracker.initialize();
  const snapshot = await tracker.pollOnce();

  assert.deepEqual(snapshot.trackedPages, [1, 2]);
  assert.equal(snapshot.guards.newer.status, "live");
  assert.equal(snapshot.modes.normal.status, "live");
  assert.equal(snapshot.modes.boost.status, "live");
  assert.deepEqual(listClient.calls, [2, 1]);
});

test("advances the cursor after all four posts move to the next page", async () => {
  const pages = {
    1: [],
    2: [row(11, 18, 2), row(10, 188, 2), row(9, 43, 2), row(8, 12, 2)],
  };
  const { tracker } = createTracker({ pages });
  await tracker.initialize();
  const snapshot = await tracker.pollOnce();

  assert.deepEqual(snapshot.trackedPages, [2]);
  assert.equal(snapshot.modes.normal.volume, 43);
  assert.equal(snapshot.modes.boost.volume, 87);
});

test("performs a bounded recovery scan after the whole block jumps multiple pages", async () => {
  const pages = {
    1: [],
    2: [],
    3: [row(11, 18, 3), row(10, 188, 3), row(9, 43, 3), row(8, 12, 3)],
  };
  const { tracker, listClient } = createTracker({ pages });
  await tracker.initialize();
  const snapshot = await tracker.pollOnce();

  assert.deepEqual(snapshot.trackedPages, [3]);
  assert.deepEqual(listClient.calls, [1, 2, 3]);
  assert.equal(snapshot.modes.boost.volume, 87);
});

test("advances bounded recovery windows until a distant block is found", async () => {
  let now = 0;
  const base = makeConfig();
  const config = makeConfig({
    polling: {
      ...base.polling,
      recoveryPageRadius: 2,
      recoveryScanCooldownMs: 100,
    },
  });
  const pages = {
    1: [],
    2: [],
    3: [],
    4: [],
    5: [],
    6: [],
    7: [row(11, 18, 7), row(10, 188, 7), row(9, 43, 7), row(8, 12, 7)],
  };
  const listClient = new PageClient(pages);
  const tracker = new OracleTracker({
    configStore: new StaticConfigStore(config),
    listClient,
    notifier: new RecordingNotifier(),
    stateStore: new MemoryStateStore(),
    now: () => now,
  });
  await tracker.initialize();

  for (let poll = 0; poll < 3; poll += 1) {
    const callsBefore = listClient.calls.length;
    await tracker.pollOnce();
    const requestsThisPoll = listClient.calls.length - callsBefore;
    assert.ok(requestsThisPoll <= 4, `poll made ${requestsThisPoll} upstream requests`);
    now += config.polling.recoveryScanCooldownMs;
  }

  const snapshot = tracker.snapshot();
  assert.deepEqual(snapshot.trackedPages, [7]);
  assert.equal(snapshot.modes.normal.status, "live");
  assert.equal(snapshot.modes.boost.status, "live");
  assert.ok(listClient.calls.includes(7));
});

test("freezes the last value and sends one alert after confirmed deletion", async () => {
  const config = makeConfig({
    polling: { ...makeConfig().polling, deletionConfirmations: 2 },
  });
  const pages = {
    1: [row(11, 17, 1), row(10, 187, 1), row(9, 42, 1), row(8, 11, 1)],
  };
  const { tracker, notifier } = createTracker({ config, pages });
  await tracker.initialize();
  await tracker.pollOnce();

  pages[1] = [row(11, 17, 1), row(9, 42, 1), row(8, 11, 1)];
  await tracker.pollOnce();
  let snapshot = await tracker.pollOnce();

  assert.equal(snapshot.modes.boost.status, "deleted");
  assert.equal(snapshot.modes.boost.views, 187);
  assert.equal(snapshot.modes.boost.volume, 86);
  assert.equal(snapshot.modes.boost.alertStatus, "delivered");
  assert.equal(notifier.events.length, 1);

  snapshot = await tracker.pollOnce();
  assert.equal(notifier.events.length, 1);
  assert.equal(snapshot.modes.normal.status, "live");
});

test("restores the persisted page cursor and last good values", async () => {
  const store = new MemoryStateStore();
  const pages = {
    1: [],
    2: [row(11, 18, 2), row(10, 188, 2), row(9, 43, 2), row(8, 12, 2)],
  };
  const first = createTracker({ pages, store }).tracker;
  await first.initialize();
  await first.pollOnce();

  const second = createTracker({ pages, store }).tracker;
  await second.initialize();
  const snapshot = second.snapshot();
  assert.deepEqual(snapshot.trackedPages, [2]);
  assert.equal(snapshot.modes.normal.views, 43);
  assert.equal(snapshot.modes.boost.views, 188);
});

test("subscribing clients neither broadcasts globally nor advances polling", async () => {
  const pages = {
    1: [row(11, 18, 1), row(10, 188, 1), row(9, 43, 1), row(8, 12, 1)],
  };
  const { tracker, listClient } = createTracker({ pages });
  await tracker.initialize();
  const first = [];
  const second = [];
  const unsubscribeFirst = tracker.subscribe((value) => first.push(value.connectedClients));
  const unsubscribeSecond = tracker.subscribe((value) => second.push(value.connectedClients));
  unsubscribeFirst();
  unsubscribeSecond();

  assert.deepEqual(first, [1]);
  assert.deepEqual(second, [2]);
  assert.equal(listClient.calls.length, 0);
});

test("the first subscriber advances an idle timer without polling immediately", async () => {
  let now = 1000;
  const config = makeConfig();
  const pages = {
    1: [row(11, 18, 1), row(10, 188, 1), row(9, 43, 1), row(8, 12, 1)],
  };
  const listClient = new PageClient(pages);
  const tracker = new OracleTracker({
    configStore: new StaticConfigStore(config),
    listClient,
    notifier: new RecordingNotifier(),
    stateStore: new MemoryStateStore(),
    now: () => now,
  });
  await tracker.initialize();
  tracker.started = true;
  tracker.lastPollStartedAt = now;
  tracker.scheduleAt(now + config.polling.idleMs);
  const unsubscribe = tracker.subscribe(() => {});

  assert.equal(tracker.timerDueAt, now + config.polling.activeMs);
  assert.equal(listClient.calls.length, 0);
  unsubscribe();
  await tracker.stop();
});

test("marks missing guards and long-stale targets as degraded", async () => {
  let now = 1000;
  const config = makeConfig({
    polling: {
      ...makeConfig().polling,
      deletionConfirmations: 2,
      staleAfterMs: 1500,
    },
  });
  const pages = {
    1: [row(11, 18, 1), row(10, 188, 1), row(9, 43, 1), row(8, 12, 1)],
  };
  const tracker = new OracleTracker({
    configStore: new StaticConfigStore(config),
    listClient: new PageClient(pages),
    notifier: new RecordingNotifier(),
    stateStore: new MemoryStateStore(),
    now: () => now,
  });
  await tracker.initialize();
  await tracker.pollOnce();
  pages[1] = [row(9, 43, 1), row(8, 12, 1)];
  now = 2000;
  await tracker.pollOnce();
  now = 4000;
  const snapshot = await tracker.pollOnce();

  assert.equal(snapshot.guards.newer.status, "missing");
  assert.equal(snapshot.modes.boost.status, "stale");
  assert.equal(snapshot.upstream.status, "degraded");
  assert.deepEqual(snapshot.upstream.issues.sort(), ["boost-stale-too-long", "guard-newer-missing"]);
});

test("sends one operational alert when a guard is confirmed missing", async () => {
  const config = makeConfig({
    polling: { ...makeConfig().polling, deletionConfirmations: 1 },
  });
  const pages = {
    1: [row(11, 18, 1), row(10, 188, 1), row(9, 43, 1), row(8, 12, 1)],
  };
  const { tracker, notifier } = createTracker({ config, pages });
  await tracker.initialize();
  await tracker.pollOnce();
  pages[1] = [row(10, 188, 1), row(9, 43, 1), row(8, 12, 1)];
  await tracker.pollOnce();
  await tracker.pollOnce();

  assert.equal(notifier.events.length, 1);
  assert.equal(notifier.events[0].type, "guard_missing");
  assert.equal(notifier.events[0].postNo, 11);
  assert.equal(tracker.snapshot().guards.newer.alertStatus, "delivered");
});

test("retries an unconfigured deletion alert instead of suppressing it forever", async () => {
  let now = 1000;
  const notifier = {
    configured: false,
    calls: 0,
    async notifyDeletion() {
      this.calls += 1;
      return { delivered: false, reason: "not_configured" };
    },
  };
  const config = makeConfig({
    polling: {
      ...makeConfig().polling,
      deletionConfirmations: 1,
      alertRetryMs: 5000,
    },
  });
  const pages = {
    1: [row(11, 18, 1), row(10, 188, 1), row(9, 43, 1), row(8, 12, 1)],
  };
  const tracker = new OracleTracker({
    configStore: new StaticConfigStore(config),
    listClient: new PageClient(pages),
    notifier,
    stateStore: new MemoryStateStore(),
    now: () => now,
  });
  await tracker.initialize();
  await tracker.pollOnce();
  pages[1] = [row(11, 18, 1), row(9, 43, 1), row(8, 12, 1)];
  now = 2000;
  await tracker.pollOnce();
  now = 3000;
  await tracker.pollOnce();
  now = 7000;
  await tracker.pollOnce();
  assert.equal(notifier.calls, 2);
});

test("honors notifier retry-after when a deletion alert is rate limited", async () => {
  let now = 1000;
  const notifier = {
    configured: true,
    calls: 0,
    async notifyDeletion() {
      this.calls += 1;
      const error = new Error("rate limited");
      error.retryAfterMs = 7000;
      throw error;
    },
  };
  const config = makeConfig({
    polling: { ...makeConfig().polling, deletionConfirmations: 1, alertRetryMs: 2000 },
  });
  const pages = {
    1: [row(11, 18, 1), row(10, 188, 1), row(9, 43, 1), row(8, 12, 1)],
  };
  const tracker = new OracleTracker({
    configStore: new StaticConfigStore(config),
    listClient: new PageClient(pages),
    notifier,
    stateStore: new MemoryStateStore(),
    now: () => now,
  });
  await tracker.initialize();
  await tracker.pollOnce();
  pages[1] = [row(11, 18, 1), row(9, 43, 1), row(8, 12, 1)];
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    now = 2000;
    await tracker.pollOnce();
    now = 7000;
    await tracker.pollOnce();
    assert.equal(notifier.calls, 1);
    now = 9000;
    await tracker.pollOnce();
    assert.equal(notifier.calls, 2);
  } finally {
    console.warn = originalWarn;
  }
});

test("does not persist unchanged observations before the checkpoint", async () => {
  const store = new MemoryStateStore();
  let saves = 0;
  const originalSave = store.save.bind(store);
  store.save = async (state) => {
    saves += 1;
    await originalSave(state);
  };
  const pages = {
    1: [row(11, 18, 1), row(10, 188, 1), row(9, 43, 1), row(8, 12, 1)],
  };
  const { tracker } = createTracker({ pages, store });
  await tracker.initialize();
  await tracker.pollOnce();
  await tracker.pollOnce();
  assert.equal(saves, 1);
});

test("coalesces immediate poll requests behind the minimum interval", async () => {
  const base = makeConfig();
  const config = makeConfig({
    polling: {
      ...base.polling,
      activeMs: 1000,
      burstMs: 50,
      burstWindowMs: 50,
      burstMaxDurationMs: 100,
      minIntervalMs: 50,
      idleMs: 1000,
    },
  });
  const pages = {
    1: [row(11, 18, 1), row(10, 188, 1), row(9, 43, 1), row(8, 12, 1)],
  };
  const tracker = new OracleTracker({
    configStore: new StaticConfigStore(config),
    listClient: new PageClient(pages),
    notifier: new RecordingNotifier(),
    stateStore: new MemoryStateStore(),
  });
  await tracker.start();
  for (let index = 0; index < 20; index += 1) tracker.requestImmediatePoll();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(tracker.snapshot().sequence, 1);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(tracker.snapshot().sequence, 2);
  await tracker.stop();
});
