// ==========================================
// In-process concurrency semaphore
// ==========================================
// Bounds the number of concurrent model calls a single worker process will make
// against upstream gateways. The durable worker already caps claims via `concurrency`,
// but a Semaphore gives an explicit, testable guard (and is reusable anywhere a
// finite external-resource budget must be honored). Across multiple worker
// processes a shared store (e.g. Redis) would be needed; for a single Railway
// worker instance this in-process gate is sufficient and avoids a hard dependency.

class Semaphore {
  constructor(max = 1) {
    this.max = Math.max(1, Math.trunc(max));
    this.active = 0;
    this.waiters = [];
  }

  get available() {
    return this.max - this.active;
  }

  async acquire() {
    if (this.active < this.max) {
      this.active += 1;
      return () => this.release();
    }
    await new Promise((resolve) => this.waiters.push(resolve));
    this.active += 1;
    return () => this.release();
  }

  release() {
    if (this.active > 0) this.active -= 1;
    const next = this.waiters.shift();
    if (next) next();
  }
}

module.exports = { Semaphore };
