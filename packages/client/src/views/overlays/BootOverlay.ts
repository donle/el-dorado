/**
 * Drives the boot screen that ships in `index.html` (#bootloader + #bootbar +
 * #bootpct + #boottext). The HTML structure and CSS are untouched; this class
 * just owns the imperative API the original inline functions used to call.
 *
 * Two progress shapes are supported:
 *   - `setProgress(loaded, total)`: simple fraction-based (used by
 *     `BootController` for the asset preload phase).
 *   - `setBootProgress(value, text)`: arbitrary 0..100 value with a status
 *     string (used for the SW precache easing curve and the engine preload
 *     copy). Both forms update the same DOM nodes.
 */
export class BootOverlay {
  private root: HTMLElement | null;
  private bar: HTMLElement | null;
  private percentLabel: HTMLElement | null;
  private textLabel: HTMLElement | null;

  constructor() {
    this.root = document.getElementById('bootloader');
    this.bar = document.getElementById('bootbar');
    this.percentLabel = document.getElementById('bootpct');
    this.textLabel = document.getElementById('boottext');
  }

  /** Simple loaded/total progress — used by `BootController` asset preload. */
  setProgress(loaded: number, total: number): void {
    const pct = total === 0 ? 100 : Math.round((loaded / total) * 100);
    this.setBootProgress(pct, total === 0 ? '准备完成' : `装载图像 ${loaded}/${total}`);
  }

  /**
   * Direct 0..100 + status text. Public for callers that need finer control
   * (e.g. the SW precache easing curve).
   */
  setBootProgress(value: number, text: string): void {
    const pct = Math.max(0, Math.min(100, value));
    if (this.bar) this.bar.style.width = `${pct}%`;
    if (this.percentLabel) this.percentLabel.textContent = `${pct}%`;
    if (this.textLabel) this.textLabel.textContent = text;
  }

  /** Marks the loader finished and removes it from the DOM after a fade. */
  hide(): void {
    this.setBootProgress(100, '准备完成');
    if (!this.root) return;
    this.root.classList.add('done');
    window.setTimeout(() => this.root?.remove(), 420);
  }
}