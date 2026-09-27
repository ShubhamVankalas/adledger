// CPU guard for PDF rendering. Rendering is synchronous-heavy JavaScript on the one app
// process, so we cap concurrent renders: a couple run at once, a few more wait briefly, and
// anything beyond that gets a 429 instead of stalling the dashboard for everyone.

export class Busy extends Error {
  constructor() {
    super("PDF renderer busy");
  }
}

export type Limiter = {
  /** Run `fn` when a slot is free; throws Busy when the queue is full or the wait times out. */
  run<T>(fn: () => Promise<T>): Promise<T>;
  readonly active: number;
  readonly waiting: number;
};

export function createLimiter(opts: { concurrency: number; queue: number; waitMs: number }): Limiter {
  let active = 0;
  const waiters: { resolve: () => void; timer: NodeJS.Timeout }[] = [];

  const acquire = () =>
    new Promise<void>((resolve, reject) => {
      if (active < opts.concurrency) {
        active++;
        return resolve();
      }
      if (waiters.length >= opts.queue) return reject(new Busy());
      const w = {
        resolve: () => {
          clearTimeout(w.timer);
          active++;
          resolve();
        },
        timer: setTimeout(() => {
          const i = waiters.indexOf(w);
          if (i >= 0) waiters.splice(i, 1);
          reject(new Busy());
        }, opts.waitMs),
      };
      w.timer.unref?.();
      waiters.push(w);
    });

  const release = () => {
    active--;
    waiters.shift()?.resolve();
  };

  return {
    async run(fn) {
      await acquire();
      try {
        return await fn();
      } finally {
        release();
      }
    },
    get active() {
      return active;
    },
    get waiting() {
      return waiters.length;
    },
  };
}

const g = globalThis as unknown as { __adledgerPdfLimiter?: Limiter };

/** Process-wide limiter for interactive PDF downloads: 2 at once, 2 waiting up to 15 s, then 429. */
export const pdfLimiter: Limiter = (g.__adledgerPdfLimiter ??= createLimiter({ concurrency: 2, queue: 2, waitMs: 15_000 }));
