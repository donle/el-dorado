/**
 * controllers/ActionLogPanel — owns the action-log state and the panel
 * DOM builder.
 *
 * Extracted from the App god class so the verbose event-to-Chinese-text
 * translation (describeActionEvents + helpers) and the panel highlight
 * tracking live in one place.
 *
 * The panel is built (and returned as an HTMLElement) by `buildPanel`;
 * App handles mounting it to the HUD / mobile dialog. ActionLogPanel
 * reads game state through an `ActionLogHost` and uses the same
 * HoverStateMachine (via `hoverMachine`) for "click a coord/blockade
 * in the log → preview it" semantics.
 */
import type {
  Axial,
  Blockade,
  GameEvent,
  GameState,
  MoveSymbol,
} from '@eldorado/core';
import { CARD_DEFS, getDef } from '@eldorado/core';
import { SYMBOL_LABEL } from '../views/common/iconMap.js';
import { button, colorHex, el, playerDisplayName } from '../views/common/dom.js';
import { terrainInfo } from './TerrainInfo.js';

export type ActionLogSegment = {
  text: string;
  defId?: string;
  coord?: Axial;
  blockadeId?: string;
};

export type ActionLogEntry = {
  id: number;
  playerId: string | null;
  playerName: string;
  playerColor: string;
  segments: ActionLogSegment[];
};

const sameCoord = (a: Axial, b: Axial): boolean => a.q === b.q && a.r === b.r;

type BoardLike = {
  setInfoHoverHex(coord: Axial): void;
  setInfoHoverBlockade(id: string): void;
  clearInfoHover(): void;
};

type HoverMachineLike = {
  showLogTerrainPreview(coord: Axial | null, blockadeId: string | null): void;
};

type MobileLayoutLike = {
  isMobileDevice(): boolean;
};

export interface ActionLogHost {
  readonly board: BoardLike;
  readonly hoverMachine: HoverMachineLike;
  readonly mobileLayout: MobileLayoutLike;

  /** Wrap a card chip with the standard hover/click preview behavior. */
  attachPreview(node: HTMLElement, defId: string): void;
  /** Force a preview popover to open on the given anchor. */
  showPreview(anchor: HTMLElement, defId: string): void;

  // Card def lookup — implementations of these helpers live in main.ts.
  findCardDefId(cardId: string, state: GameState): string | null;
  fallbackCardDefId(cardId: string): string;
}

const MAX_LOG_ENTRIES = 60;
const MAX_RENDERED_ENTRIES = 24;

export class ActionLogPanel {
  private actionLog: ActionLogEntry[] = [];
  private actionLogSeq = 0;
  private actionLogLastRenderedId = 0;
  private hasRenderedLog = false;
  private knownCardDefs = new Map<string, string>();

  constructor(private readonly host: ActionLogHost) {}

  // --- state mutations -----------------------------------------------

  resetActionLog(): void {
    this.actionLog = [];
    this.actionLogSeq = 0;
    this.hasRenderedLog = false;
    this.actionLogLastRenderedId = 0;
    this.knownCardDefs.clear();
  }

  rememberCards(state: GameState | null): void {
    if (!state) return;
    for (const p of state.players) {
      for (const card of [...p.deck, ...p.hand, ...p.discard, ...p.removed]) {
        this.knownCardDefs.set(card.id, card.defId);
      }
    }
    for (const card of [...(state.turn?.inPlay ?? []), ...(state.turn?.removedThisTurn ?? [])]) {
      this.knownCardDefs.set(card.id, card.defId);
    }
  }

  appendActionLog(events: GameEvent[], state: GameState, previousState: GameState | null): void {
    if (events.length === 0) return;
    const entry = this.describeActionEvents(events, state, previousState);
    if (!entry) return;
    this.actionLog.push(entry);
    if (this.actionLog.length > MAX_LOG_ENTRIES) {
      this.actionLog = this.actionLog.slice(-MAX_LOG_ENTRIES);
    }
  }

  // --- segment builders ----------------------------------------------

  private cardDefIdForLog(cardId: string, state: GameState, previousState: GameState | null): string {
    return this.host.findCardDefId(cardId, state)
      ?? (previousState ? this.host.findCardDefId(cardId, previousState) : null)
      ?? this.knownCardDefs.get(cardId)
      ?? this.host.fallbackCardDefId(cardId);
  }

  private cardSegmentByDefId(defId: string): ActionLogSegment {
    if (!CARD_DEFS[defId]) return { text: defId };
    return { text: getDef(defId).name, defId };
  }

  private cardSegmentByCardId(cardId: string, state: GameState, previousState: GameState | null): ActionLogSegment {
    return this.cardSegmentByDefId(this.cardDefIdForLog(cardId, state, previousState));
  }

  private playerLogInfo(
    playerId: string | null,
    state: GameState,
    previousState: GameState | null,
  ): { name: string; color: string } {
    const p = playerId
      ? state.players.find((x) => x.id === playerId) ?? previousState?.players.find((x) => x.id === playerId)
      : null;
    return p
      ? { name: playerDisplayName(p), color: colorHex(p.color) }
      : { name: '系统', color: '#ffd166' };
  }

  private activeMoverForPlayer(
    playerId: string,
    state: GameState,
    previousState: GameState | null,
  ): { cardId: string; symbol: MoveSymbol; remaining: number } | null {
    const states = [state, previousState].filter((x): x is GameState => !!x);
    for (const s of states) {
      const mover = s.turn?.playerId === playerId ? s.turn.activeMover : undefined;
      if (mover) return mover;
    }
    return null;
  }

  private activeMoverForCard(
    cardId: string,
    state: GameState,
    previousState: GameState | null,
  ): { cardId: string; symbol: MoveSymbol; remaining: number } | null {
    const states = [state, previousState].filter((x): x is GameState => !!x);
    for (const s of states) {
      const mover = s.turn?.activeMover;
      if (mover?.cardId === cardId) return mover;
    }
    return null;
  }

  private terrainLogSegment(to: Axial, state: GameState): ActionLogSegment {
    const hex = state.hexes.find((h) => sameCoord(h, to));
    return {
      text: hex ? `${terrainInfo(hex).name} (${to.q}, ${to.r})` : `(${to.q}, ${to.r})`,
      coord: { q: to.q, r: to.r },
    };
  }

  private blockadeLogSegment(blockadeId: string): ActionLogSegment {
    return { text: '连接地形', blockadeId };
  }

  private inferTakenMarketDefId(state: GameState, previousState: GameState | null): string | null {
    if (!previousState) return null;
    for (const pile of state.market) {
      const before = previousState.market.find((m) => m.defId === pile.defId);
      if (before && before.count > pile.count) return pile.defId;
    }
    return null;
  }

  private makeActionLogEntry(
    playerId: string | null,
    segments: ActionLogSegment[],
    state: GameState,
    previousState: GameState | null,
  ): ActionLogEntry {
    const player = this.playerLogInfo(playerId, state, previousState);
    return {
      id: ++this.actionLogSeq,
      playerId,
      playerName: player.name,
      playerColor: player.color,
      segments,
    };
  }

  private describeActionEvents(
    events: GameEvent[],
    state: GameState,
    previousState: GameState | null,
  ): ActionLogEntry | null {
    const cardPlayed = events.find((e) => e.type === 'cardPlayed') as Extract<GameEvent, { type: 'cardPlayed' }> | undefined;
    const moved = events.find((e) => e.type === 'movedTo') as Extract<GameEvent, { type: 'movedTo' }> | undefined;
    const spaceCleared = events.find((e) => e.type === 'spaceCleared') as Extract<GameEvent, { type: 'spaceCleared' }> | undefined;
    const marketPromoted = events.find((e) => e.type === 'marketPromoted') as Extract<GameEvent, { type: 'marketPromoted' }> | undefined;
    const bought = events.find((e) => e.type === 'bought') as Extract<GameEvent, { type: 'bought' }> | undefined;
    const discarded = events.find((e) => e.type === 'discarded') as Extract<GameEvent, { type: 'discarded' }> | undefined;
    const removedCards = events.find((e) => e.type === 'removedCards') as Extract<GameEvent, { type: 'removedCards' }> | undefined;
    const ability = events.find((e) => e.type === 'ability') as Extract<GameEvent, { type: 'ability' }> | undefined;
    const drew = events.find((e) => e.type === 'drew') as Extract<GameEvent, { type: 'drew' }> | undefined;
    const blockadeClaimed = events.find((e) => e.type === 'blockadeClaimed') as Extract<GameEvent, { type: 'blockadeClaimed' }> | undefined;
    const reachedEldorado = events.find((e) => e.type === 'reachedEldorado') as Extract<GameEvent, { type: 'reachedEldorado' }> | undefined;
    const turnStarted = events.find((e) => e.type === 'turnStarted') as Extract<GameEvent, { type: 'turnStarted' }> | undefined;
    const gameOver = events.find((e) => e.type === 'gameOver') as Extract<GameEvent, { type: 'gameOver' }> | undefined;

    if (gameOver) {
      const winner = gameOver.winnerId ? this.playerLogInfo(gameOver.winnerId, state, previousState).name : null;
      return this.makeActionLogEntry(gameOver.winnerId, [{ text: winner ? '赢得游戏' : '游戏结束' }], state, previousState);
    }

    if (bought) {
      return this.makeActionLogEntry(
        bought.playerId,
        [{ text: '购买 ' }, this.cardSegmentByDefId(bought.defId)],
        state,
        previousState,
      );
    }

    if (marketPromoted) {
      return this.makeActionLogEntry(
        marketPromoted.playerId,
        [{ text: '将 ' }, this.cardSegmentByDefId(marketPromoted.defId), { text: ' 补入市场' }],
        state,
        previousState,
      );
    }

    if (ability) {
      const segments: ActionLogSegment[] = [
        { text: '使用 ' },
        this.cardSegmentByCardId(ability.cardId, state, previousState),
      ];
      if (moved) segments.push({ text: '，移动到 ' }, this.terrainLogSegment(moved.to, state));
      if (drew) segments.push({ text: `，摸 ${drew.count} 张牌` });
      if (removedCards) segments.push({ text: removedCards.count > 0 ? `，移除 ${removedCards.count} 张手牌` : '，不移除手牌' });
      const takenDefId = this.inferTakenMarketDefId(state, previousState);
      if (takenDefId) segments.push({ text: '，获得 ' }, this.cardSegmentByDefId(takenDefId));
      if (reachedEldorado) segments.push({ text: '，抵达黄金城' });
      return this.makeActionLogEntry(ability.playerId, segments, state, previousState);
    }

    if (spaceCleared) {
      return this.makeActionLogEntry(
        spaceCleared.playerId,
        [
          { text: `${spaceCleared.removed ? '移除手牌清除营地' : '弃掉手牌清除碎石'}，移动到 ` },
          this.terrainLogSegment(spaceCleared.to, state),
        ],
        state,
        previousState,
      );
    }

    if (cardPlayed && blockadeClaimed) {
      return this.makeActionLogEntry(
        cardPlayed.playerId,
        [
          { text: '打出 ' },
          this.cardSegmentByCardId(cardPlayed.cardId, state, previousState),
          { text: '，移除' },
          this.blockadeLogSegment(blockadeClaimed.blockadeId),
        ],
        state,
        previousState,
      );
    }

    if (cardPlayed) {
      const mover = this.activeMoverForCard(cardPlayed.cardId, state, previousState);
      const symbol = mover ? `（${SYMBOL_LABEL[mover.symbol]}）` : '';
      return this.makeActionLogEntry(
        cardPlayed.playerId,
        [{ text: '打出 ' }, this.cardSegmentByCardId(cardPlayed.cardId, state, previousState), { text: symbol }],
        state,
        previousState,
      );
    }

    if (blockadeClaimed) {
      return this.makeActionLogEntry(
        blockadeClaimed.playerId,
        [{ text: '移除' }, this.blockadeLogSegment(blockadeClaimed.blockadeId)],
        state,
        previousState,
      );
    }

    if (moved) {
      const mover = this.activeMoverForPlayer(moved.playerId, state, previousState);
      const segments: ActionLogSegment[] = mover
        ? [
          { text: '使用 ' },
          this.cardSegmentByCardId(mover.cardId, state, previousState),
          { text: '，移动到 ' },
          this.terrainLogSegment(moved.to, state),
        ]
        : [{ text: '移动到 ' }, this.terrainLogSegment(moved.to, state)];
      if (reachedEldorado) segments.push({ text: '，抵达黄金城' });
      return this.makeActionLogEntry(moved.playerId, segments, state, previousState);
    }

    if (discarded) {
      return this.makeActionLogEntry(
        discarded.playerId,
        [{ text: `弃掉 ${discarded.count} 张手牌` }],
        state,
        previousState,
      );
    }

    if (removedCards) {
      return this.makeActionLogEntry(
        removedCards.playerId,
        [{ text: removedCards.count > 0 ? `移除 ${removedCards.count} 张手牌` : '不移除手牌' }],
        state,
        previousState,
      );
    }

    if (drew || turnStarted) {
      const actorId = drew?.playerId ?? previousState?.turn?.playerId ?? turnStarted?.playerId ?? null;
      const segments: ActionLogSegment[] = [];
      if (turnStarted && actorId !== turnStarted.playerId) {
        segments.push({ text: '结束回合' });
        if (drew) segments.push({ text: `，摸 ${drew.count} 张牌` });
        segments.push({ text: `；轮到 ${this.playerLogInfo(turnStarted.playerId, state, previousState).name}` });
      } else if (drew) {
        segments.push({ text: `摸 ${drew.count} 张牌` });
      } else if (turnStarted) {
        segments.push({ text: '开始回合' });
      }
      return this.makeActionLogEntry(actorId, segments, state, previousState);
    }

    return null;
  }

  // --- panel builder -------------------------------------------------

  /**
   * Build the action-log panel DOM. Caller (App) decides where to
   * mount it — HUD for desktop, mobile dialog wrapper for portrait.
   * Returns a fresh element each call; this panel is rebuilt on
   * every renderHud.
   */
  buildPanel(extraClass = ''): HTMLElement {
    const panel = el('div', `action-log panel ${extraClass}`.trim());
    panel.innerHTML = '<h3>行动日志</h3>';
    const list = el('div', 'action-log-list');
    if (this.actionLog.length > 0) {
      const rendered = this.actionLog.slice(-MAX_RENDERED_ENTRIES);
      for (const entry of rendered) {
        const row = el('div', 'action-log-entry');
        // 新加的 entry（id > 上次渲染见过的最大 id，且不是首次 render）触发高亮动画
        if (this.hasRenderedLog && entry.id > this.actionLogLastRenderedId) {
          row.classList.add('action-log-entry--fresh');
        }
        row.style.setProperty('--log-player', entry.playerColor);

        const dot = document.createElement('span');
        dot.className = 'action-log-dot';
        row.appendChild(dot);

        const body = el('div', 'action-log-body');
        const player = el('div', 'action-log-player');
        player.textContent = entry.playerName;
        const text = el('div', 'action-log-text');
        for (const segment of entry.segments) {
          const node = document.createElement('span');
          node.textContent = segment.text;
          const classes: string[] = [];
          if (segment.defId) {
            classes.push('action-log-card');
            this.host.attachPreview(node, segment.defId);
            node.addEventListener('click', (ev) => {
              if (!this.host.mobileLayout.isMobileDevice()) return;
              ev.preventDefault();
              ev.stopPropagation();
              this.host.showPreview(node, segment.defId!);
            });
          }
          if (segment.coord || segment.blockadeId) {
            classes.push('action-log-terrain');
            node.addEventListener('mouseenter', () => {
              if (segment.blockadeId) this.host.board.setInfoHoverBlockade(segment.blockadeId);
              else if (segment.coord) this.host.board.setInfoHoverHex(segment.coord);
            });
            node.addEventListener('mouseleave', () => this.host.board.clearInfoHover());
            node.addEventListener('click', (ev) => {
              if (!this.host.mobileLayout.isMobileDevice()) return;
              ev.preventDefault();
              ev.stopPropagation();
              this.host.hoverMachine.showLogTerrainPreview(segment.coord ?? null, segment.blockadeId ?? null);
            });
          }
          if (classes.length) node.className = classes.join(' ');
          text.appendChild(node);
        }
        body.appendChild(player);
        body.appendChild(text);
        row.appendChild(body);
        list.appendChild(row);
      }
    } else {
      const empty = el('div', 'action-log-empty');
      empty.textContent = '暂无行动记录';
      list.appendChild(empty);
    }
    panel.appendChild(list);
    // 新消息进来时滚到底。panel 每次 renderHud 都重建（scrollTop 从 0 开始），
    // 没有"之前的位置"可以参考做 sticky，所以无条件跟随最新内容。
    // 下一帧设值：保证 panel 已挂上 DOM、layout 完成，scrollHeight 才是准的。
    requestAnimationFrame(() => {
      list.scrollTop = list.scrollHeight;
    });
    // 记录这次渲染过的最大 id，下一次 render 时用它判断"新的"
    const lastEntry = this.actionLog[this.actionLog.length - 1];
    if (lastEntry) this.actionLogLastRenderedId = lastEntry.id;
    this.hasRenderedLog = true;
    return panel;
  }
}
