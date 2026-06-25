/**
 * controllers/OverlaysController — owns transient-UI overlays that aren't
 * tied to a specific game subsystem:
 *
 *   1. `flash(msg)` — toast that surfaces in the HUD error slot for ~1.8s.
 *   2. `showSystemDialog(title, message)` — modal scrim used for room-closed
 *      / kicked messages.
 *   3. `attachSheetDismiss(panel)` — touch-drag-down-to-dismiss gesture for
 *      bottom-sheet panels (market / log / players).
 *   4. `renderGameOverOverlay(state)` — end-of-game screen rendered on top
 *      of the HUD.
 *
 * Extracted from the App god class so the four transient-UI concerns live
 * in one place. They share no mutable state with each other beyond the
 * `error` text slot used by `flash` — App exposes that via the host
 * interface.
 */
import type { GameState } from '@eldorado/core';
import { el, escapeHtml } from '../views/common/dom.js';
import { renderGameOverOverlay as renderGameOverOverlayEl } from '../views/overlays/GameOverOverlay.js';

export interface OverlaysHost {
  /** The HUD root element (used by renderGameOverOverlay). */
  readonly hud: HTMLElement;
  /** Writable error slot the HUD renders; flash sets + clears this. */
  error: string;
  /** Re-render the HUD (used after flash sets/clears `error`). */
  renderHud(): void;
  /** Re-render the lobby overlay (used after system dialog dismissal). */
  renderLobby(): void;
  /** Close any open mobile bottom sheet (called by sheet-drag-dismiss). */
  closeMobilePanel(): void;
  /** Leave the current room (used by game-over overlay's leave button). */
  leaveRoom(): void;
  /** Return to the lobby view (used by game-over overlay's lobby button). */
  returnToLobby(): void;
}

export class OverlaysController {
  private flashTimer: ReturnType<typeof setTimeout> | undefined;
  private systemDialog: HTMLElement | null = null;

  constructor(private readonly host: OverlaysHost) {}

  // --- 1. flash toast ------------------------------------------------

  flash(msg: string): void {
    this.host.error = msg;
    this.host.renderHud();
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => {
      this.host.error = '';
      this.host.renderHud();
    }, 1800);
  }

  // --- 2. system dialog ----------------------------------------------

  showSystemDialog(title: string, message: string): void {
    this.systemDialog?.remove();
    const scrim = el('div', 'system-dialog-scrim');
    scrim.innerHTML = `
      <div class="system-dialog panel" role="dialog" aria-modal="true" aria-labelledby="system-dialog-title">
        <div class="system-dialog-mark" aria-hidden="true"></div>
        <h2 id="system-dialog-title">${escapeHtml(title)}</h2>
        <p>${escapeHtml(message)}</p>
        <button type="button" class="gold">确认</button>
      </div>`;
    scrim.querySelector<HTMLButtonElement>('button')!.onclick = () => {
      scrim.remove();
      if (this.systemDialog === scrim) this.systemDialog = null;
      this.host.renderLobby();
      this.host.renderHud();
    };
    document.body.appendChild(scrim);
    this.systemDialog = scrim;
  }

  // --- 3. sheet drag-dismiss ----------------------------------------

  /**
   * Let a bottom sheet be dragged down (when scrolled to top) to dismiss it.
   * Returns early if the user releases without dragging past the threshold.
   */
  attachSheetDismiss(panel: HTMLElement): void {
    let startY = 0;
    let dragging = false;
    panel.addEventListener(
      'touchstart',
      (e) => {
        dragging = panel.scrollTop <= 0;
        startY = e.touches[0].clientY;
        if (dragging) panel.style.transition = 'none';
      },
      { passive: true },
    );
    panel.addEventListener(
      'touchmove',
      (e) => {
        if (!dragging) return;
        const dy = e.touches[0].clientY - startY;
        if (dy > 0) panel.style.transform = `translateY(${dy}px)`;
      },
      { passive: true },
    );
    panel.addEventListener('touchend', (e) => {
      if (!dragging) return;
      const dy = e.changedTouches[0].clientY - startY;
      panel.style.transition = '';
      panel.style.transform = '';
      dragging = false;
      if (dy > 70) this.host.closeMobilePanel();
    });
  }

  // --- 4. game-over overlay -----------------------------------------

  renderGameOverOverlay(s: GameState): void {
    const overlay = renderGameOverOverlayEl(
      { players: s.players, winnerId: s.winnerId },
      {
        onReturnToLobby: () => this.host.returnToLobby(),
        onLeaveRoom: () => this.host.leaveRoom(),
      },
    );
    this.host.hud.appendChild(overlay);
  }
}