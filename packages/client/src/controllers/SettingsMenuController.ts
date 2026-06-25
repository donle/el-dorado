/**
 * controllers/SettingsMenuController — owns the in-game settings dropdown
 * (view-mode 3D/2D + AI delay + exit-game) plus the view-mode toggle.
 *
 * Extracted from the App god class so the four settings-related methods
 * (`toggleViewMode`, `setViewMode`, `toggleSettings`, `renderSettingsMenu`)
 * and the `settingsOpen` + `aiDelay` state live in one place.
 *
 * `viewMode` is read/written through the host because App still reads it
 * inline in `renderHud` (the camera-hint text). `aiDelay` is fully owned
 * here — App doesn't read it elsewhere.
 */
import type { ClientMessage, GameState, RoomView } from '@eldorado/core';
import { button, el } from '../views/common/dom.js';

export interface SettingsMenuHost {
  /** HUD root — settings scrim + menu mount here. */
  readonly hud: HTMLElement;
  readonly state: GameState | null;
  readonly room: RoomView | null;
  readonly you: string | null;
  /** Bidirectional view-mode slot the controller flips + persists to localStorage. */
  viewMode: '3d' | '2d';
  /** Board scene controller — pushed the new mode on toggle. */
  readonly board: { setViewMode(mode: '3d' | '2d'): void };
  /** Re-render HUD after toggle / settings-open change. */
  renderHud(): void;
  /** Exit current room (the "退出游戏" button calls this). */
  leaveRoom(): void;
  /** Send a client → server message (e.g. setAiDelay). */
  send(message: ClientMessage): void;
}

export class SettingsMenuController {
  private settingsOpen = false;
  private aiDelay = Number(localStorage.getItem('eldorado.aiDelay')) || 1000;

  constructor(private readonly host: SettingsMenuHost) {}

  // --- external accessors --------------------------------------------

  isOpen(): boolean {
    return this.settingsOpen;
  }

  // --- view mode toggle ----------------------------------------------

  toggleViewMode(): void {
    this.host.viewMode = this.host.viewMode === '3d' ? '2d' : '3d';
    localStorage.setItem('eldorado.viewMode', this.host.viewMode);
    this.host.board.setViewMode(this.host.viewMode);
    this.host.renderHud();
  }

  setViewMode(mode: '3d' | '2d'): void {
    if (mode === this.host.viewMode) return;
    this.toggleViewMode(); // only two modes; flips and re-renders (keeps menu open)
  }

  // --- settings dropdown ---------------------------------------------

  toggleSettings(): void {
    this.settingsOpen = !this.settingsOpen;
    this.host.renderHud();
  }

  close(): void {
    this.settingsOpen = false;
  }

  /** In-game settings modal: view mode + exit, blocking game interaction behind it. */
  renderSettingsMenu(s: GameState): void {
    const scrim = el('div', 'settings-scrim');
    scrim.onclick = () => {
      this.settingsOpen = false;
      this.host.renderHud();
    };
    this.host.hud.appendChild(scrim);

    const menu = el('div', 'settings-menu panel');
    menu.innerHTML = `
      <button class="settings-close" aria-label="关闭设置">×</button>
      <div class="settings-head">探险设置</div>
      <div class="settings-group">
        <span class="settings-label">视图模式</span>
        <div class="seg" role="group" aria-label="视图模式">
          <button class="seg-btn ${this.host.viewMode === '3d' ? 'on' : ''}" data-v="3d">3D</button>
          <button class="seg-btn ${this.host.viewMode === '2d' ? 'on' : ''}" data-v="2d">2D</button>
        </div>
      </div>
      <div class="settings-group">
        <span class="settings-label">AI 行动间隔</span>
        <div class="settings-delay">
          <input type="range" class="delay-range" min="0" max="10" step="0.5"
                 value="${(((this.host.room?.aiDelayMs ?? 1000) / 1000)).toFixed(1)}"
                 style="--fill:${(((this.host.room?.aiDelayMs ?? 1000) / 1000) / 10 * 100).toFixed(1)}%"
                 ${this.host.room?.hostId === this.host.you ? '' : 'disabled'} />
          <span class="delay-value">${(((this.host.room?.aiDelayMs ?? 1000) / 1000)).toFixed(1)}<i>s</i></span>
        </div>
        ${this.host.room?.hostId === this.host.you ? '' : '<span class="settings-hint">仅房主可调整</span>'}
      </div>`;
    menu.querySelector<HTMLButtonElement>('.settings-close')!.onclick = () => {
      this.settingsOpen = false;
      this.host.renderHud();
    };
    menu.querySelectorAll<HTMLButtonElement>('.seg-btn').forEach((b) => {
      b.onclick = () => this.setViewMode(b.dataset.v as '3d' | '2d');
    });
    const range = menu.querySelector<HTMLInputElement>('.delay-range');
    const valueLabel = menu.querySelector<HTMLSpanElement>('.delay-value');
    if (range) {
      range.oninput = () => {
        const secs = Number(range.value);
        range.style.setProperty('--fill', `${(secs / 10) * 100}%`);
        if (valueLabel) valueLabel.innerHTML = `${secs.toFixed(1)}<i>s</i>`;
      };
      range.onchange = () => {
        if (this.host.room?.hostId !== this.host.you) return;
        const ms = Math.round(Number(range.value) * 1000);
        this.aiDelay = ms;
        localStorage.setItem('eldorado.aiDelay', String(ms));
        this.host.send({ type: 'setAiDelay', ms });
      };
    }
    if (s.phase === 'playing') {
      const exit = button('退出游戏', () => {
        this.settingsOpen = false;
        this.host.leaveRoom();
      });
      exit.className = 'danger settings-exit';
      exit.title = '退出本局，AI 将接管你的座位';
      menu.appendChild(exit);
    }
    this.host.hud.appendChild(menu);
  }
}