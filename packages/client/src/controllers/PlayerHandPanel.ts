/**
 * controllers/PlayerHandPanel — owns the "pinned player hand" inspector.
 *
 * Extracted from the App god class so the panel state (`pinnedPlayerId`),
 * the panel DOM, the click-outside-to-close listener, and the card-highlight
 * side effect on `playerCardEls` all live in one place.
 *
 * Lifecycle: created once in the App constructor. The element is mounted to
 * `document.body` by App, and the document-level click-outside listener is
 * registered on construction (so the panel knows when to close itself).
 *
 * Reads game state through `PlayerHandPanelHost`; no back-references to App.
 */
import type { GameState } from '@eldorado/core';
import { getDef } from '@eldorado/core';
import { cardFace } from '../cardFaces.js';
import {
  colorHex,
  el,
  escapeHtml,
  playerDisplayName,
} from '../views/common/dom.js';
import { KIND_LABEL } from '../views/common/iconMap.js';

export interface PlayerHandPanelHost {
  readonly state: GameState | null;
  /**
   * Player card DOM elements keyed by player id. Used to toggle the
   * `pinned-hand` highlight class on the pinned player's card in the
   * players panel.
   */
  readonly playerCardEls: ReadonlyMap<string, HTMLElement>;
}

export class PlayerHandPanel {
  /** Panel root element. App mounts this to `document.body`. */
  readonly element: HTMLElement;
  private pinnedPlayerId: string | null = null;

  constructor(private readonly host: PlayerHandPanelHost) {
    this.element = el('div', 'player-hand-panel panel hidden');
    document.body.appendChild(this.element);
    // Click outside (but not on the pinned card) → close.
    // Listener is attached once; the inner check on pinnedPlayerId is cheap.
    document.addEventListener('mousedown', (ev) => {
      if (!this.pinnedPlayerId) return;
      const t = ev.target as Node | null;
      if (!t) return;
      if (this.element.contains(t)) return;
      if (this.host.playerCardEls.get(this.pinnedPlayerId)?.contains(t)) return;
      this.close();
    });
  }

  // --- external API ---------------------------------------------------

  getPinnedPlayerId(): string | null {
    return this.pinnedPlayerId;
  }

  isPinned(playerId: string): boolean {
    return this.pinnedPlayerId === playerId;
  }

  toggle(playerId: string): void {
    if (this.pinnedPlayerId === playerId) {
      this.close();
    } else {
      this.pinnedPlayerId = playerId;
      this.refresh();
      // Highlight the pinned card.
      for (const [id, cardEl] of this.host.playerCardEls) {
        cardEl.classList.toggle('pinned-hand', id === playerId);
      }
    }
  }

  close(): void {
    this.pinnedPlayerId = null;
    this.element.classList.add('hidden');
    this.element.innerHTML = '';
    for (const cardEl of this.host.playerCardEls.values()) {
      cardEl.classList.remove('pinned-hand');
    }
  }

  /**
   * Re-render the panel content using the latest state. Called when:
   *   - the user pins a player (toggle)
   *   - renderHud rebuilds the players panel (line ~1150 in App) and the
   *     pinned player's hand may have changed.
   */
  refresh(): void {
    if (!this.host.state || !this.pinnedPlayerId) return;
    const player = this.host.state.players.find((p) => p.id === this.pinnedPlayerId);
    if (!player) {
      // 玩家已离开（断线/被踢）→ 自动关闭
      this.close();
      return;
    }
    // 整局汇总：手牌 + 牌库 + 弃牌（removed 是永久离开游戏的牌，不计入）
    const counts = new Map<string, { defId: string; count: number; hand: number; deck: number; discard: number }>();
    const bump = (c: { defId: string }, bucket: 'hand' | 'deck' | 'discard') => {
      const cur = counts.get(c.defId) ?? { defId: c.defId, count: 0, hand: 0, deck: 0, discard: 0 };
      cur.count++;
      cur[bucket]++;
      counts.set(c.defId, cur);
    };
    for (const c of player.hand) bump(c, 'hand');
    for (const c of player.deck) bump(c, 'deck');
    for (const c of player.discard) bump(c, 'discard');
    // 按 kind 排（green/blue/yellow/action/joker），同 kind 按牌名
    const kindRank: Record<string, number> = { green: 0, blue: 1, yellow: 2, action: 3, joker: 4 };
    const entries = [...counts.values()]
      .map((e) => ({ def: getDef(e.defId), ...e }))
      .sort((a, b) =>
        (kindRank[a.def.kind] ?? 9) - (kindRank[b.def.kind] ?? 9)
        || a.def.name.localeCompare(b.def.name, 'zh'),
      );
    const totalAll = player.hand.length + player.deck.length + player.discard.length;
    const playerColor = colorHex(player.color);
    const breakdown = (e: { hand: number; deck: number; discard: number }) => {
      const parts: string[] = [];
      if (e.hand) parts.push(`手 ${e.hand}`);
      if (e.deck) parts.push(`库 ${e.deck}`);
      if (e.discard) parts.push(`弃 ${e.discard}`);
      return parts.join(' · ');
    };
    const rows = entries.length === 0
      ? '<div class="php-empty">该玩家目前没有任何牌</div>'
      : entries.map((e) => `
          <div class="php-row" style="--pc: ${playerColor}">
            <div class="php-thumb">${cardFace(e.def)}</div>
            <div class="php-info">
              <div class="php-name">${escapeHtml(e.def.name)}</div>
              <div class="php-kind">${KIND_LABEL[e.def.kind] ?? ''}${e.def.singleUse ? ' · 单次' : ''} · ${breakdown(e)}</div>
            </div>
            <div class="php-count" title="手牌 + 牌库 + 弃牌合计">×${e.count}</div>
          </div>`).join('');
    this.element.style.setProperty('--pc', playerColor);
    this.element.innerHTML = `
      <div class="php-head">
        <span class="php-dot"></span>
        <div class="php-title-wrap">
          <div class="php-kicker">整局持牌</div>
          <div class="php-title">${escapeHtml(playerDisplayName(player))}</div>
        </div>
        <button class="php-close" aria-label="关闭持牌详情" type="button">×</button>
      </div>
      <div class="php-list">${rows}</div>
      <div class="php-foot">合计 ${totalAll} 张（手 ${player.hand.length} · 库 ${player.deck.length} · 弃 ${player.discard.length}）</div>`;
    this.element.classList.remove('hidden');
    this.element
      .querySelector<HTMLButtonElement>('.php-close')!
      .addEventListener('click', () => this.close());
  }
}