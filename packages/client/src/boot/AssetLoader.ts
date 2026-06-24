import type { IAssetLoader, ProgressFn } from '../shared/ports.js';
import { BOOT_ASSET_URLS } from './assetUrls.js';

/**
 * Default image preload primitive. Mirrors the inline implementation that
 * lived in `main.ts`:
 *  - sets `decoding="async"`
 *  - resolves on `onload` once `img.decode()` finishes (or synchronously if
 *    `decode` is unavailable)
 *  - rejects on `onerror` so callers can decide whether to tolerate missing
 *    assets (the original `preloadBootAssets` swallowed the rejection).
 */
function preloadOne(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      if (img.decode) {
        void img.decode().catch(() => undefined).finally(() => resolve());
      } else {
        resolve();
      }
    };
    img.onerror = () => reject(new Error(url));
    img.src = url;
  });
}

/**
 * Pre-loads every URL grouped under `BOOT_ASSET_URLS`. Concurrency is left to
 * the browser (each `Image` request is fired eagerly), then `progress` is
 * invoked synchronously as each promise settles.
 */
export class AssetLoader implements IAssetLoader {
  async preloadAll(progress: ProgressFn): Promise<void> {
    const all = [...new Set(Object.values(BOOT_ASSET_URLS).flat())];
    const total = all.length;
    let done = 0;
    progress(0, total);
    await Promise.all(
      all.map((url) =>
        preloadOne(url)
          .catch(() => undefined)
          .finally(() => {
            done += 1;
            progress(done, total);
          }),
      ),
    );
  }
}