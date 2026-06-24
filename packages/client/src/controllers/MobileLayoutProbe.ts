/**
 * controllers/MobileLayoutProbe — owns the body's mobile / landscape
 * CSS classes plus the queries App uses to switch between compact and
 * roomy layouts. Pure DOM probe: no state beyond the body's class list
 * and the two media queries it listens to.
 *
 * Extracted from the App god class so the rest of the client doesn't
 * have to remember the exact `matchMedia` strings or the order of
 * classList.toggle calls.
 */
export class MobileLayoutProbe {
  private readonly mobileDeviceQuery = window.matchMedia('(hover: none) and (pointer: coarse)');
  private readonly portraitQuery = window.matchMedia('(orientation: portrait)');

  /** Wire up listeners and apply the current classes immediately. */
  setupMobileLayoutClasses(): void {
    const update = () => {
      const mobile = this.isMobileDevice();
      document.body.classList.toggle('mobile-device', mobile);
      document.body.classList.toggle('mobile-portrait', mobile && this.portraitQuery.matches);
    };
    this.mobileDeviceQuery.addEventListener('change', update);
    this.portraitQuery.addEventListener('change', update);
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    update();
  }

  /** Coarse detection of a touch-first device — used to gate
   *  click-vs-tap handling and to skip desktop-only affordances. */
  isMobileDevice(): boolean {
    const uaMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    return uaMobile || (navigator.maxTouchPoints > 1 && this.mobileDeviceQuery.matches);
  }

  /** Landscape phone with a very short height — switch to a one-line
   *  compact toolbar. */
  isCompactLandscape(): boolean {
    return document.body.classList.contains('mobile-device')
      && !this.portraitQuery.matches
      && window.innerHeight <= 500;
  }

  /** Phone in portrait OR very-short landscape — stack the command row
   *  vertically instead of horizontally. */
  isCompactCommandLayout(): boolean {
    return document.body.classList.contains('mobile-device')
      && (this.portraitQuery.matches || window.matchMedia('(max-height: 500px) and (orientation: landscape)').matches);
  }
}