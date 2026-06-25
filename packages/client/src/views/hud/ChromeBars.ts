/**
 * HUD chrome bars — the small, mostly-static DOM elements that flank the
 * big panels:
 *
 *   - buildGearDock() — floating gear button (opens settings)
 *   - buildTopBar()   — the top "brand + turn banner + camera hint" strip
 *   - buildMobileToolbar() — the log/market sheet toggles on small viewports
 *
 * Extracted from App.renderHud (C7). Like the rest of the views/, these
 * are pure renderers — the owning controller wires the callbacks.
 */
import type { GameState } from '@eldorado/core';
import { button, el, escapeHtml, playerDisplayName } from '../common/dom.js';

export interface GearDockEnv {
  /** Toggle the in-game settings menu. */
  onToggle: () => void;
  /** True when the settings menu is currently open (drives the .active class). */
  isOpen: boolean;
}

/** Build the floating gear button (top-right) that opens the settings menu. */
export function buildGearDock(env: GearDockEnv): HTMLElement {
  const dock = el('div', 'settings-dock');
  const gear = button('⚙', () => env.onToggle(), true);
  gear.className = `settings-gear ${env.isOpen ? 'active' : ''}`;
  gear.title = '设置';
  dock.appendChild(gear);
  return dock;
}

export interface TopBarState {
  /** Current GameState — drives the turn banner variant. */
  state: GameState;
  /** True if the local player is the active player. */
  myTurn: boolean;
  /** The 6-char room code shown in the top-left brand. */
  roomCode: string | null;
  /** 3D or 2D camera — drives the camera-hint text. */
  viewMode: '3d' | '2d';
}

export interface TopBarEnv {
  // No callbacks — the top bar is informational.
}

/**
 * Build the top strip: brand + turn banner + camera-hint text.
 *
 * Banner variants:
 *   - `state.phase === 'finished'` → win banner with winner's name
 *   - `myTurn`                     → "🟢 轮到你行动"
 *   - otherwise                    → "⏳ 等待 <turn player>"
 */
export function buildTopBar(state: TopBarState): HTMLElement {
  const top = el('div', 'topbar panel');
  const s = state.state;
  const turnPlayer = s.players.find((p) => p.id === s.turn?.playerId);
  const winnerPlayer = s.winnerId ? s.players.find((p) => p.id === s.winnerId) : null;
  const turnName = turnPlayer ? playerDisplayName(turnPlayer) : '';
  const winnerName = winnerPlayer ? playerDisplayName(winnerPlayer) : null;

  let banner = `<div class="turn-banner">⏳ 等待 ${escapeHtml(turnName)}</div>`;
  if (s.phase === 'finished') banner = `<div class="turn-banner win">🏆 ${escapeHtml(winnerName ?? '')} 抵达黄金城！</div>`;
  else if (state.myTurn) banner = `<div class="turn-banner you">🟢 轮到你行动</div>`;

  top.innerHTML = `
    <div class="brand"><span class="logo">🏆</span><span>冲向黄金城</span><span class="code">${escapeHtml(state.roomCode ?? '')}</span></div>
    ${banner}
    <div class="hint-inline">${state.viewMode === '2d' ? '2D 俯视 · 拖拽平移 · 滚轮缩放' : '滚轮缩放 · 拖拽平移 · 右键转视角'}</div>`;
  return top;
}

export type MobilePanel = 'players' | 'market' | 'log' | null;

export interface MobileToolbarEnv {
  /** Which bottom-sheet (if any) is currently open. */
  getOpen: () => MobilePanel;
  /** Toggle a sheet open/closed. Caller re-renders HUD after the change. */
  toggle: (which: Exclude<MobilePanel, null | 'players'>) => void;
  /** Clear the market preview when the user opens a non-market sheet. */
  clearMarketPreview: () => void;
  /** Re-render the HUD after a state change. */
  renderHud: () => void;
}

/** Build the small-viewport toolbar with log + market sheet toggles. */
export function buildMobileToolbar(env: MobileToolbarEnv): HTMLElement {
  const toolbar = el('div', 'mobile-toolbar');
  const open = env.getOpen();
  const logBtn = button('日志', () => {
    env.toggle('log');
    if (env.getOpen() !== 'log') env.clearMarketPreview();
    env.renderHud();
  });
  if (open === 'log') logBtn.classList.add('active');
  toolbar.appendChild(logBtn);
  const marketBtn = button('市场', () => {
    env.toggle('market');
    if (env.getOpen() !== 'market') env.clearMarketPreview();
    env.renderHud();
  });
  if (open === 'market') marketBtn.classList.add('active');
  toolbar.appendChild(marketBtn);
  return toolbar;
}
