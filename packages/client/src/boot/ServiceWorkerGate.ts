export type ServiceWorkerStatus = 'ready' | 'timeout' | 'skipped';

/** Hard ceiling on how long we wait for the service worker to precache. */
export const SERVICE_WORKER_READY_TIMEOUT_MS = 45_000;

interface WaitOptions {
  /**
   * Called periodically (every 250ms) while waiting, so the caller can drive
   * a progress indicator. `ratio` is 0..1 over the timeout window.
   */
  onProgress?: (ratio: number) => void;
  /**
   * Inject the production flag. Defaults to `import.meta.env.PROD` so the
   * gate is a no-op during development (mirrors the original behavior).
   */
  isProduction?: boolean;
}

/**
 * Race `navigator.serviceWorker.ready` against a timeout, with optional
 * progress callbacks. Returns:
 *   - `'ready'` if the SW became active in time
 *   - `'timeout'` if the timeout fired first (SW registration is still
 *     allowed to finish in the background — we just stop waiting)
 *   - `'skipped'` if the page is not in production, or the browser has no
 *     service worker API.
 */
export class ServiceWorkerGate {
  async waitForReady(options: WaitOptions = {}): Promise<ServiceWorkerStatus> {
    const isProd = options.isProduction ?? import.meta.env.PROD;
    if (!isProd || !('serviceWorker' in navigator)) return 'skipped';
    const startedAt = performance.now();
    const timer = window.setInterval(() => {
      const elapsed = performance.now() - startedAt;
      const ratio = Math.min(1, elapsed / SERVICE_WORKER_READY_TIMEOUT_MS);
      options.onProgress?.(ratio);
    }, 250);
    const ready = await withTimeout(
      navigator.serviceWorker.ready.then(() => true).catch(() => false),
      SERVICE_WORKER_READY_TIMEOUT_MS,
      false,
    );
    window.clearInterval(timer);
    return ready ? 'ready' : 'timeout';
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(fallback), ms);
    void promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      () => {
        window.clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}