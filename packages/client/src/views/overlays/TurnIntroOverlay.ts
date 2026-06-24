/**
 * Full-screen "你的回合" / "开始行动" flash overlay.
 *
 * The overlay is appended directly to `document.body` (not the HUD) and is
 * cleared automatically after `TURN_INTRO_MS`. Successive calls clear the
 * previous overlay and timer before showing a new one.
 */
import { el } from '../common/dom.js';

export const TURN_INTRO_MS = 1900;

let currentOverlay: HTMLElement | null = null;
let currentTimer: ReturnType<typeof setTimeout> | null = null;

export function showTurnIntro(): void {
  clearTurnIntro();
  const overlay = el('div', 'turn-intro-overlay');
  overlay.innerHTML = `
      <div class="turn-intro-panel" role="status" aria-live="polite">
        <span class="turn-intro-mark" aria-hidden="true"></span>
        <span class="turn-intro-title">你的回合</span>
        <span class="turn-intro-sub">开始行动</span>
      </div>`;
  document.body.appendChild(overlay);
  currentOverlay = overlay;
  currentTimer = setTimeout(() => clearTurnIntro(), TURN_INTRO_MS);
}

export function clearTurnIntro(): void {
  if (currentTimer) {
    clearTimeout(currentTimer);
    currentTimer = null;
  }
  currentOverlay?.remove();
  currentOverlay = null;
}
