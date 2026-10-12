/**
 * Tiny in-process job queue for the Bulk Tracker (12 Oct) — the same shape as
 * affiliate-creator-tool's InProcessQueue (add / process, per-job attempts +
 * fixed backoff, fixed concurrency). No Redis: like the rest of this server's
 * background work (assets/service.js scrapeSequentially, node-cron jobs) it
 * lives in the API process. Jobs are lost on restart, which is why the worker
 * re-enqueues every still-"queued" row on boot (worker.js recoverQueuedRows).
 */
export class InProcessQueue {
  constructor(name) {
    this.name = name;
    this.pending = [];
    this.running = 0;
    this.handler = null;
    this.concurrency = 1;
  }

  /** Same signature as the source's queue: (jobName, data, { attempts, backoff: { delay } }). */
  async add(jobName, data, { attempts = 1, backoff } = {}) {
    this.pending.push({ name: jobName, data, attemptsLeft: attempts, delay: backoff?.delay ?? 0 });
    this.#drain();
  }

  process(handler, { concurrency = 1 } = {}) {
    this.handler = handler;
    this.concurrency = concurrency;
    this.#drain();
  }

  /** Jobs waiting + in flight — for tests and logging. */
  get size() {
    return this.pending.length + this.running;
  }

  #drain() {
    if (!this.handler) return;
    while (this.running < this.concurrency && this.pending.length > 0) {
      const job = this.pending.shift();
      this.running++;
      Promise.resolve()
        .then(() => this.handler(job))
        .catch((err) => {
          job.attemptsLeft--;
          if (job.attemptsLeft > 0) {
            setTimeout(() => {
              this.pending.push(job);
              this.#drain();
            }, job.delay);
          } else {
            console.error(`[${this.name}] job ${job.name} failed for good`, err);
          }
        })
        .finally(() => {
          this.running--;
          this.#drain();
        });
    }
  }
}

export const bulkTrackQueue = new InProcessQueue("bulk-track");
