/**
 * Player bar — the top-centre row of per-player cards.
 *
 * Pure renderer: builds the `HTMLElement` representing the bar of player cards.
 * The owning controller wires click + registration handlers through the env,
 * mirroring the patterns used by `HandPanel` and `MarketPanel`.
 */
import type { Player } from '@eldorado/core';
import { colorHex, el, escapeHtml, playerDisplayName } from '../common/dom.js';

export interface PlayerBarState {
  /** All seated players in the room. */
  players: Player[];
  /** Turn order ids — drives the left-to-right order of cards. */
  turnOrder: string[];
  /** Whose turn is it (drives the .active class). */
  turnPlayerId: string | null;
  /** Local player id (drives the "你" tag). */
  selfId: string | null;
  /** Pinned player id (drives the .pinned-hand class). */
  pinnedPlayerId: string | null;
  /** Forward `progressOf` from the host App. */
  progressOf: (p: Player) => number;
}

export interface PlayerBarEnv {
  /** Called when a card is clicked (forwards to `togglePlayerHand`). */
  onCardClick: (playerId: string) => void;
  /** Called for every rendered card so the host can track it (playerCardEls map). */
  onCardRendered: (cardEl: HTMLElement, playerId: string) => void;
}

/** Build the player-bar DOM element. */
export function renderPlayerBar(state: PlayerBarState, env: PlayerBarEnv): HTMLElement {
  const pcards = el('div', 'player-cards');
  const turnRank = new Map(state.turnOrder.map((id, i) => [id, i]));
  const orderedPlayers = state.players
    .slice()
    .sort((a, b) => (turnRank.get(a.id) ?? Infinity) - (turnRank.get(b.id) ?? Infinity));
  for (const p of orderedPlayers) {
    const active = p.id === state.turnPlayerId;
    const card = el('div', `pcard ${active ? 'active' : ''} ${p.finished ? 'finished' : ''}`);
    card.style.setProperty('--pc', colorHex(p.color));
    if (p.id === state.pinnedPlayerId) card.classList.add('pinned-hand');
    const tags = `${p.isAI ? '<span class="ptag">电脑</span>' : ''}${p.offline ? '<span class="ptag offline">离线</span>' : ''}${p.id === state.selfId ? '<span class="ptag you">你</span>' : ''}`;
    card.innerHTML = `
      <div class="pc-top">
        <span class="pc-dot"></span>
        <span class="pc-name">${escapeHtml(playerDisplayName(p))}</span>
        ${tags}
        <span class="pc-flag">${p.finished ? '🏆' : active ? '▶' : ''}</span>
      </div>
      <div class="pc-counts">
        <span><b>牌库</b>${p.deck.length + p.hand.length}</span>
        <span><b>弃牌</b>${p.discard.length}</span>
        <span><b>阻挡物</b>${p.blockades}</span>
        <span title="洞穴指示物（通过洞穴抽取获得）"><b>洞穴</b>${p.caveTokens.length}</span>
      </div>
      <div class="pc-progress"><span style="width:${Math.round(state.progressOf(p) * 100)}%"></span></div>`;
    card.addEventListener('click', () => env.onCardClick(p.id));
    pcards.appendChild(card);
    env.onCardRendered(card, p.id);
  }
  return pcards;
}