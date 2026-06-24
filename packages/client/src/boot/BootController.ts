import type { IAssetLoader } from '../shared/ports.js';
import { AssetLoader } from './AssetLoader.js';
import { ServiceWorkerGate } from './ServiceWorkerGate.js';
import { BootOverlay } from '../views/overlays/BootOverlay.js';

interface BootControllerDeps {
  assetLoader?: IAssetLoader;
  swGate?: ServiceWorkerGate;
  overlay?: BootOverlay;
}

/**
 * Orchestrates the first-load boot sequence:
 *
 *   1. Kick the service worker precache and animate the SW phase (2..35%).
 *   2. Preload every entry of `BOOT_ASSET_URLS`, mapping per-image progress
 *      onto the asset phase (8..92% when SW was skipped/timeout; 36..92%
 *      when the SW reported `ready`).
 *   3. Fade out the boot screen.
 *
 * Step 3 of the original flow (engine preload → 94..98%, then `hideBootloader`
 * at 100%) still belongs to `main.ts` — `run()` returns once assets are done
 * so `main.ts` can finish loading the Board module and then call `hide()`.
 */
export class BootController {
  private overlay: BootOverlay;
  private assetLoader: IAssetLoader;
  private swGate: ServiceWorkerGate;

  constructor(deps: BootControllerDeps = {}) {
    this.overlay = deps.overlay ?? new BootOverlay();
    this.assetLoader = deps.assetLoader ?? new AssetLoader();
    this.swGate = deps.swGate ?? new ServiceWorkerGate();
  }

  /**
   * Runs the boot sequence. Returns once the asset preload finishes; the
   * overlay hide is fired inside this method so the screen disappears as
   * soon as we are ready, even if the engine preload takes a moment longer.
   */
  async run(): Promise<void> {
    this.overlay.setBootProgress(2, '缓存离线资源');
    const swStatus = await this.swGate.waitForReady({
      onProgress: (ratio) => {
        const eased = 1 - Math.pow(1 - ratio, 3);
        this.overlay.setBootProgress(2 + Math.round(eased * 33), '缓存离线资源');
      },
    });

    const waitedForSw = swStatus !== 'skipped';
    const imageStart = waitedForSw ? 36 : 8;
    const imageRange = waitedForSw ? 56 : 84;
    this.overlay.setBootProgress(imageStart, swStatus === 'ready' ? '离线资源已缓存' : '装载本地资源');

    await this.assetLoader.preloadAll((done, total) => {
      const value = imageStart + Math.round((done / total) * imageRange);
      const text = done < total ? '装载图像' : '整理界面';
      this.overlay.setBootProgress(value, text);
    });
  }

  /** Public for `main.ts` to advance past the asset phase. */
  markEngineLoading(): void {
    this.overlay.setBootProgress(94, '装载3D引擎');
  }

  markUiInitializing(): void {
    this.overlay.setBootProgress(98, '初始化界面');
  }

  /** Fades the boot screen out. */
  hide(): void {
    this.overlay.hide();
  }
}