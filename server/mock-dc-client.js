export class MockDcListClient {
  constructor(config) {
    this.deleted = new Set();
    this.views = new Map([
      [config.guards.newer, 17],
      [config.modes.boost.postNo, 187],
      [config.modes.normal.postNo, 42],
      [config.guards.older, 11],
    ]);
  }

  async fetchPage(config, page) {
    if (page !== config.initialPage) return new Map();
    const rows = new Map();
    for (const postNo of [
      config.guards.newer,
      config.modes.boost.postNo,
      config.modes.normal.postNo,
      config.guards.older,
    ]) {
      if (this.deleted.has(postNo)) continue;
      rows.set(postNo, {
        postNo,
        views: this.views.get(postNo) ?? 0,
        title: `mock post ${postNo}`,
        href: `/mock/${postNo}`,
        page,
      });
    }
    return rows;
  }

  increment(postNo, amount = 1) {
    this.views.set(postNo, (this.views.get(postNo) ?? 0) + amount);
    this.deleted.delete(postNo);
  }

  remove(postNo) {
    this.deleted.add(postNo);
  }

  restore(postNo) {
    this.deleted.delete(postNo);
  }
}
