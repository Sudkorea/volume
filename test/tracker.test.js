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
  return {
    notifier,
    store,
    tracker: new OracleTracker({
      configStore: new StaticConfigStore(config),
      listClient: new PageClient(pages),
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
