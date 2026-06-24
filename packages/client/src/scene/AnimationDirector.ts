export type TickFn = (timeMs: number) => void;

/**
 * Drives a per-frame tick on top of `requestAnimationFrame`.
 *
 * The owning renderer hands AnimationDirector a callback; AnimationDirector
 * owns the rAF handle and last-frame timestamp. The renderer requests frames
 * on demand; AnimationDirector keeps the loop running only while the
 * renderer keeps asking.
 *
 * Behaviour matches the previous inline loop in `Board`:
 * - `tick(timeMs)` is called once per scheduled frame.
 * - A scheduled frame is dropped if `requestFrame()` is not called again
 *   before the next rAF tick (this is how idle/animating gating worked).
 * - `stop()` cancels any pending frame and resets the timing baseline.
 */
export class AnimationDirector {
  private raf = 0;
  private lastMs = 0;
  private scheduled = false;

  constructor(private readonly tick: TickFn) {}

  /** Schedule a single frame on the next animation tick. */
  requestFrame(): void {
    this.scheduled = true;
    if (this.raf) return;
    this.raf = requestAnimationFrame((t) => this.run(t));
  }

  /** Cancel any pending frame and reset the timing baseline. */
  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.lastMs = 0;
    this.scheduled = false;
  }

  private run(t: number): void {
    this.raf = 0;
    if (!this.scheduled) return;
    this.scheduled = false;
    this.tick(t);
  }
}
