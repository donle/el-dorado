/**
 * End-of-game ranking panel.
 *
 * Returns the `end-overlay` element; the caller is responsible for appending
 * it to its host (typically `this.hud`). The overlay is a pure renderer —
 * the actions (return to lobby / leave room) are passed in via `env`.
 */
import type { GameState, Player } from '@eldorado/core';
import { button, colorHex, el, escapeHtml, playerDisplayName } from '../common/dom.js';

export interface GameOverOverlayState {
  players: Player[];
  winnerId: string | null;
}

export interface GameOverOverlayEnv {
  onReturnToLobby: () => void;
  onLeaveRoom: () => void;
}

export function renderGameOverOverlay(
  state: GameOverOverlayState,
  env: GameOverOverlayEnv,
): HTMLElement {
  const winner = state.winnerId
    ? state.players.find((p) => p.id === state.winnerId)
    : null;
  const ranked = [...state.players].sort((a, b) => {
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    if (b.blockades !== a.blockades) return b.blockades - a.blockades;
    return (a.finishedAt ?? Infinity) - (b.finishedAt ?? Infinity);
  });
  const rows = ranked
    .map(
      (p, i) => `
          <div class="end-row">
            <span class="end-rank">${i + 1}</span>
            <span class="end-dot" style="background:${colorHex(p.color)}"></span>
            <span class="end-name">${escapeHtml(playerDisplayName(p))}${p.offline ? ' · 离线' : ''}</span>
            <span class="end-score">${p.finished ? `第 ${p.finishedAt} 回合` : '未抵达'} · ${p.blockades} 阻挡物</span>
          </div>`,
    )
    .join('');
  const overlay = el('div', 'end-overlay');
  overlay.innerHTML = `
      <div class="end-modal">
        <div class="end-kicker">游戏已经结束</div>
        <h2>${winner ? `${escapeHtml(playerDisplayName(winner))} 抵达黄金城` : '无人抵达黄金城'}</h2>
        <div class="end-sub">最终排名</div>
        <div class="end-list">${rows}</div>
        <div class="end-actions"></div>
      </div>`;
  const actionWrap = overlay.querySelector<HTMLDivElement>('.end-actions')!;
  const roomBtn = button('返回房间', () => env.onReturnToLobby(), false);
  roomBtn.className = 'gold';
  const lobbyBtn = button('返回大厅', () => env.onLeaveRoom(), true);
  actionWrap.appendChild(roomBtn);
  actionWrap.appendChild(lobbyBtn);
  return overlay;
}

/** Convenience overload: accept a full `GameState` directly. */
export function renderGameOverOverlayFromState(
  s: GameState,
  env: GameOverOverlayEnv,
): HTMLElement {
  return renderGameOverOverlay(
    { players: s.players, winnerId: s.winnerId },
    env,
  );
}
