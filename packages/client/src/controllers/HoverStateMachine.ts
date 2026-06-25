/**
 * controllers/HoverStateMachine — owns the terrain/blockade hover & pin
 * state plus the inspector popover (`terrainPanel`) it drives.
 *
 * Extracted from the App god class so the panel HTML builder, the
 * pointer-move debounce, and the "pinned" semantics can evolve
 * independently of the rest of the client.
 *
 * Dependencies are injected through a `HoverHost` so the class is
 * testable in isolation. Several host methods (tryActOn*, isMyTurn,
 * selected, mode, …) still live on `App` for now and will migrate to
 * `InteractionController` in Stage B3; the host interface is stable
 * across that move.
 */
import type {
  Axial,
  Blockade,
  GameState,
  Hex,
  MoveSymbol,
  Player,
  Terrain,
} from '@eldorado/core';
import {
  SYMBOL_GLYPH,
  SYMBOL_LABEL,
} from '../views/common/iconMap.js';
import { escapeHtml, playerDisplayName } from '../views/common/dom.js';
import {
  terrainInfo,
  blockadeInfo,
  blockadeTerrain,
  terrainCostText,
  blockadeCostText,
} from './TerrainInfo.js';

/** Mirrors the Mode union in main.ts. Stays in lock-step until B3 owns it. */
export type Mode = 'idle' | 'clear' | 'remove' | 'trim';

type MovementRequirement = {
  required: MoveSymbol | null;
  cost: number;
  blockade?: Blockade;
  discard?: boolean;
  destReq?: MoveSymbol | null;
};

type BoardLike = {
  setInspectedHex(coord: Axial | null): void;
  setInspectedBlockade(id: string | null): void;
  setInfoHoverHex(coord: Axial): void;
  setInfoHoverBlockade(id: string): void;
  clearInfoHover(): void;
  clearHover(): void;
};

/** Surface area HoverStateMachine needs from its host (App today,
 *  InteractionController after B3). Keep this list small and explicit. */
export interface HoverHost {
  /** Board instance — used for inspection / hover indicators. */
  readonly board: BoardLike;
  /** Which mobile overlay is open (drives `from-log` class on the panel). */
  getMobilePanel(): 'players' | 'market' | 'log' | null;

  // --- state lookups ---
  hexAt(c: Axial): Hex | undefined;
  blockadeById(id: string | null): Blockade | undefined;
  blockadeEdges(b: Blockade): Array<{ a: Axial; b: Axial }>;
  blockadeDestination(b: Blockade, sym?: MoveSymbol, power?: number): Hex | undefined;
  getState(): GameState | null;

  // --- player state ---
  isMyTurn(): boolean;
  readonly me: Player | null;
  getMode(): Mode;
  getSelected(): Set<string>;
  getNativeActionCardId(): string | null;
  selectedHandCardIds(): string[];

  // --- movement legality (B3 will own these) ---
  movementRequirement(hex: Hex): MovementRequirement;
  canEnter(hex: Hex, symbol: MoveSymbol, power: number): boolean;
  canStepToEldorado(hex: Hex): boolean;
  canUseNativeOn(hex: Hex): boolean;
  pickHandMover(
    req: MoveSymbol | null,
    cost: number,
    candidates: Array<{ id: string; defId: string }>,
  ): { cardId: string; symbol: MoveSymbol } | null;

  // --- panel render helpers (imported directly from controllers/TerrainInfo) ---
  blockadeRequiresDiscard(b: Blockade): boolean;
  blockadeMoveSymbol(b: Blockade): MoveSymbol | null;
  cardDefId(cardId: string, state: GameState): string;

  // --- UI coordination ---
  previewCtl: { hidePreview(): void; refreshPinnedPreview(): void };

  // --- action dispatch (B3 will own these) ---
  tryActOnHex(c: Axial): boolean;
  tryActOnBlockade(id: string): boolean;
}

const sameCoord = (a: Axial, b: Axial): boolean => a.q === b.q && a.r === b.r;
const isFinishEntrance = (hex: Hex | null | undefined): boolean =>
  !!hex && (hex.finishEntrance === true || hex.terrain === 'finish');
const isAdjacent = (a: Axial, b: Axial): boolean => {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) === 2;
};

export class HoverStateMachine {
  private hoveredTerrain: Axial | null = null;
  private pinnedTerrain: Axial | null = null;
  private hoveredBlockadeId: string | null = null;
  private pinnedBlockadeId: string | null = null;
  private terrainPanelHovering = false;
  private terrainHoverClearTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly panel: HTMLElement,
    private readonly host: HoverHost,
  ) {}

  // --- input ---------------------------------------------------------

  onHexHover(c: Axial | null): void {
    this.cancelTerrainHoverClear();
    if (!c && this.hoveredTerrain && !this.pinnedTerrain && !this.pinnedBlockadeId) {
      this.scheduleTerrainHoverClear();
      return;
    }
    this.hoveredTerrain = c;
    if (c) this.hoveredBlockadeId = null;
    this.renderTerrainPanel();
    if (!c && !this.pinnedTerrain && !this.pinnedBlockadeId) this.host.previewCtl.refreshPinnedPreview();
  }

  onHexClick(c: Axial): void {
    if (this.host.tryActOnHex(c)) return;

    if (this.pinnedTerrain && sameCoord(this.pinnedTerrain, c) && !this.pinnedBlockadeId) {
      this.pinnedTerrain = null;
      this.hoveredTerrain = null;
      this.host.board.setInspectedHex(null);
      this.host.board.clearHover();
      this.renderTerrainPanel();
      this.host.previewCtl.refreshPinnedPreview();
      return;
    }

    this.pinnedTerrain = c;
    this.pinnedBlockadeId = null;
    this.host.board.setInspectedHex(c);
    this.host.board.setInspectedBlockade(null);
    this.renderTerrainPanel();
  }

  onBlockadeHover(id: string | null): void {
    this.cancelTerrainHoverClear();
    if (!id && this.hoveredBlockadeId && !this.pinnedTerrain && !this.pinnedBlockadeId) {
      this.scheduleTerrainHoverClear();
      return;
    }
    this.hoveredBlockadeId = id;
    if (id) this.hoveredTerrain = null;
    this.renderTerrainPanel();
    if (!id && !this.pinnedTerrain && !this.pinnedBlockadeId) this.host.previewCtl.refreshPinnedPreview();
  }

  onBlockadeClick(id: string): void {
    if (this.host.tryActOnBlockade(id)) return;

    if (this.pinnedBlockadeId === id && !this.pinnedTerrain) {
      this.pinnedBlockadeId = null;
      this.hoveredBlockadeId = null;
      this.host.board.setInspectedBlockade(null);
      this.host.board.clearHover();
      this.renderTerrainPanel();
      this.host.previewCtl.refreshPinnedPreview();
      return;
    }

    this.pinnedBlockadeId = id;
    this.pinnedTerrain = null;
    this.host.board.setInspectedBlockade(id);
    this.host.board.setInspectedHex(null);
    this.renderTerrainPanel();
  }

  // --- public API ----------------------------------------------------

  /** Force the panel closed. Used when leaving the game view or
   *  resetting UI state. */
  closeTerrainPanel(): void {
    this.cancelTerrainHoverClear();
    this.terrainPanelHovering = false;
    this.pinnedTerrain = null;
    this.hoveredTerrain = null;
    this.pinnedBlockadeId = null;
    this.hoveredBlockadeId = null;
    this.host.board.setInspectedHex(null);
    this.host.board.setInspectedBlockade(null);
    this.host.board.clearInfoHover();
    this.renderTerrainPanel();
    this.host.previewCtl.refreshPinnedPreview();
  }

  /** Click on a coord/blockade in the action log → preview it
   *  non-destructively (no pin, just hover). */
  showLogTerrainPreview(coord: Axial | null, blockadeId: string | null): void {
    this.cancelTerrainHoverClear();
    this.pinnedTerrain = null;
    this.pinnedBlockadeId = null;
    this.hoveredTerrain = coord ? { q: coord.q, r: coord.r } : null;
    this.hoveredBlockadeId = blockadeId;
    if (blockadeId) this.host.board.setInfoHoverBlockade(blockadeId);
    else if (coord) this.host.board.setInfoHoverHex(coord);
    this.renderTerrainPanel();
  }

  // --- internals -----------------------------------------------------

  private cancelTerrainHoverClear(): void {
    clearTimeout(this.terrainHoverClearTimer);
    this.terrainHoverClearTimer = undefined;
  }

  private scheduleTerrainHoverClear(): void {
    this.cancelTerrainHoverClear();
    this.terrainHoverClearTimer = setTimeout(() => {
      this.terrainHoverClearTimer = undefined;
      if (this.terrainPanelHovering) return;
      this.hoveredTerrain = null;
      this.hoveredBlockadeId = null;
      this.host.board.clearInfoHover();
      this.renderTerrainPanel();
      if (!this.pinnedTerrain && !this.pinnedBlockadeId) this.host.previewCtl.refreshPinnedPreview();
    }, 80);
  }

  private bindTerrainPanelHover(coord: Axial | null, blockadeId: string | null): void {
    const enter = () => {
      this.terrainPanelHovering = true;
      this.cancelTerrainHoverClear();
      if (blockadeId) this.host.board.setInfoHoverBlockade(blockadeId);
      else if (coord) this.host.board.setInfoHoverHex(coord);
    };
    this.panel.onmouseenter = enter;
    this.panel.onmouseleave = () => {
      this.terrainPanelHovering = false;
      this.host.board.clearInfoHover();
      if (!this.pinnedTerrain && !this.pinnedBlockadeId) {
        this.hoveredTerrain = null;
        this.hoveredBlockadeId = null;
        this.renderTerrainPanel();
        this.host.previewCtl.refreshPinnedPreview();
      }
    };
    if (this.panel.matches(':hover')) enter();
  }

  /** Re-render the panel from current state. Call after selection / mode /
   *  card-click changes that the host owns. */
  renderTerrainPanel(): void {
    if (this.pinnedTerrain && !this.host.hexAt(this.pinnedTerrain)) this.pinnedTerrain = null;
    if (this.hoveredTerrain && !this.host.hexAt(this.hoveredTerrain)) this.hoveredTerrain = null;
    if (this.pinnedBlockadeId && !this.host.blockadeById(this.pinnedBlockadeId)) {
      this.pinnedBlockadeId = null;
      this.host.board.setInspectedBlockade(null);
    }
    if (this.hoveredBlockadeId && !this.host.blockadeById(this.hoveredBlockadeId)) this.hoveredBlockadeId = null;

    const activeBlockade = this.host.blockadeById(this.hoveredBlockadeId ?? this.pinnedBlockadeId);
    const activeCoord = activeBlockade ? null : this.hoveredTerrain ?? this.pinnedTerrain;
    const hex = activeCoord ? this.host.hexAt(activeCoord) : undefined;
    const state = this.host.getState();
    if (!state || state.phase === 'lobby' || (!hex && !activeBlockade)) {
      this.cancelTerrainHoverClear();
      this.terrainPanelHovering = false;
      this.panel.onmouseenter = null;
      this.panel.onmouseleave = null;
      this.panel.classList.add('hidden');
      this.panel.classList.remove('from-log');
      this.panel.innerHTML = '';
      if (!hex) this.host.board.setInspectedHex(null);
      if (!activeBlockade) this.host.board.setInspectedBlockade(null);
      this.host.board.clearInfoHover();
      return;
    }

    this.host.previewCtl.hidePreview();
    if (activeBlockade) {
      const terrain = blockadeTerrain(activeBlockade);
      const info = blockadeInfo(activeBlockade);
      const pinned = !!this.pinnedBlockadeId && !this.hoveredBlockadeId;
      const owner = activeBlockade.claimedBy ? state.players.find((p) => p.id === activeBlockade.claimedBy) : null;
      const ownerText = owner ? `归属：${playerDisplayName(owner)}` : '尚未被领取';
      const edgeCount = this.host.blockadeEdges(activeBlockade).length;
      this.panel.classList.remove('hidden');
      this.panel.classList.toggle('from-log', this.host.getMobilePanel() === 'log');
      this.panel.classList.toggle('pinned', pinned);
      this.panel.innerHTML = `
        <div class="terrain-head">
          <div class="terrain-icon terrain-${terrain}">${info.icon}</div>
          <div class="terrain-title-wrap">
            <div class="terrain-kicker">${pinned ? '点击固定' : '悬浮查看'}</div>
            <div class="terrain-title">${escapeHtml(info.name)}</div>
          </div>
          <button class="terrain-close" aria-label="关闭地形说明">×</button>
        </div>
        <div class="terrain-desc">${escapeHtml(info.description)}</div>
        <div class="terrain-rule"><b>规则</b><span>${escapeHtml(info.rule)}</span></div>
        <div class="terrain-meta">
          <span>${escapeHtml(blockadeCostText(activeBlockade))}</span>
          <span>${escapeHtml(ownerText)}</span>
          <span>连接 ${edgeCount} 条边</span>
        </div>
        <div class="terrain-status">${escapeHtml(this.blockadeActionStatus(activeBlockade))}</div>`;
      this.panel.querySelector<HTMLButtonElement>('.terrain-close')!.onclick = () => this.closeTerrainPanel();
      this.bindTerrainPanelHover(null, activeBlockade.id);
      return;
    }
    if (!hex) return;

    const info = terrainInfo(hex);
    const pinned = !!this.pinnedTerrain && !this.hoveredTerrain;
    const occupant = hex.occupant ? state.players.find((p) => p.id === hex.occupant) : null;
    const occupantText = occupant ? `占据：${playerDisplayName(occupant)}` : '未被占据';
    const status = this.terrainActionStatus(hex);
    this.panel.classList.remove('hidden');
    this.panel.classList.toggle('from-log', this.host.getMobilePanel() === 'log');
    this.panel.classList.toggle('pinned', pinned);
    this.panel.innerHTML = `
      <div class="terrain-head">
        <div class="terrain-icon terrain-${hex.terrain}">${info.icon}</div>
        <div class="terrain-title-wrap">
          <div class="terrain-kicker">${pinned ? '点击固定' : '悬浮查看'}</div>
          <div class="terrain-title">${escapeHtml(info.name)}</div>
        </div>
        <button class="terrain-close" aria-label="关闭地形说明">×</button>
      </div>
      <div class="terrain-desc">${escapeHtml(info.description)}</div>
      <div class="terrain-rule"><b>规则</b><span>${escapeHtml(info.rule)}</span></div>
      <div class="terrain-meta">
        <span>${escapeHtml(terrainCostText(hex))}</span>
        <span>${escapeHtml(occupantText)}</span>
        <span>坐标 ${hex.q}, ${hex.r}</span>
      </div>
      <div class="terrain-status">${escapeHtml(status)}</div>`;
    this.panel.querySelector<HTMLButtonElement>('.terrain-close')!.onclick = () => this.closeTerrainPanel();
    this.bindTerrainPanelHover({ q: hex.q, r: hex.r }, null);
  }

  private blockadeActionStatus(blockade: Blockade): string {
    if (!this.host.isMyTurn()) return '当前不是你的回合，可以查看说明，但不能执行地形行动。';
    if (this.host.getMode() === 'clear') return '你正在清除地形，点击手牌支付费用。点击连接地形只会固定说明。';
    if (this.host.getMode() === 'remove') return '正在处理行动牌摸牌后的移除选择，完成后才能继续执行地形行动。';
    if (blockade.claimedBy) return '这块连接地形已经被领取，不再作为可领取阻挡物。';
    if (!this.host.blockadeDestination(blockade)) return '当前棋子不在这块连接地形覆盖的边旁边，暂时不能行动。';

    const requirementText = `连接地形需要 ${blockadeCostText(blockade)}；第一个移除的玩家会领取它，玩家信息中的阻挡物数量会增加。`;
    if (this.host.blockadeRequiresDiscard(blockade)) {
      return `${requirementText} 选 ${blockade.cost} 张手牌弃掉即可移除这块连接地形（棋子留在原地），之后再走到对面。`;
    }
    const state = this.host.getState();
    const mover = state?.turn?.activeMover;
    if (mover) {
      const dest = this.host.blockadeDestination(blockade, mover.symbol, mover.remaining);
      return dest
        ? `${requirementText} 当前移动力足够，点击会移除这块连接地形（棋子留在原地），之后再走到对面。`
        : `${requirementText} 当前正在使用的移动力不足以移除这里的连接地形。`;
    }

    const selected = this.host.getSelected();
    if (selected.size > 0) {
      const seamSym = this.host.blockadeMoveSymbol(blockade);
      const hand = this.host.me?.hand ?? [];
      const candidates = [...selected]
        .filter((id) => hand.some((h) => h.id === id))
        .map((id) => ({ id, defId: this.host.cardDefId(id, state!) }));
      const pick = this.host.pickHandMover(seamSym, blockade.cost, candidates);
      return pick
        ? `${requirementText} 已选可用移动牌，点击这块地形会打出对应资源并移除障碍（棋子留在原地），之后再走到对面。`
        : `${requirementText} 已选 ${selected.size} 张手牌，但没有满足这块连接地形要求的移动牌。`;
    }

    return `${requirementText} 选择匹配的移动牌后，可以点击这块连接地形移除障碍（棋子留在原地），之后再走到对面。`;
  }

  private terrainActionStatus(hex: Hex): string {
    if (!this.host.isMyTurn()) return '当前不是你的回合，可以查看说明，但不能执行地形行动。';
    const me = this.host.me;
    if (!me) return '没有找到你的棋子。';
    if (this.host.getMode() === 'clear') return '你正在清除地形，点击手牌支付费用。点击地形只会固定说明。';
    if (this.host.getMode() === 'remove') return '正在处理行动牌摸牌后的移除选择，完成后才能继续执行地形行动。';
    if (this.host.getNativeActionCardId()) {
      return this.host.canUseNativeOn(hex)
        ? '原住民向导可以无视此格地形需求，点击即可移动到这里。'
        : '原住民向导只能移动到可到达、未被其他玩家占用的相邻格；未移除的连接地形仍会阻挡。';
    }
    if (hex.terrain === 'mountain') return '山地不可进入，只能绕行。';
    if (!isAdjacent(me.position, hex)) return '此格不与当前棋子相邻，暂时不能行动。';
    const current = this.host.hexAt(me.position);
    if (hex.terrain === 'eldorado' && !isFinishEntrance(current)) return '必须先进入相邻的黄金城入口，才能进入黄金城。';
    if (hex.occupant && hex.occupant !== me.id) return '此格已有其他玩家，当前不能进入。';
    if (this.host.canStepToEldorado(hex)) return '点击即可进入黄金城，无需出牌。';
    if (hex.terrain === 'rubble' || hex.terrain === 'basecamp') {
      const selected = this.host.selectedHandCardIds().length;
      const effect = hex.terrain === 'basecamp' ? '永久移出游戏' : '弃掉';
      if (selected === hex.cost) return `已选择 ${selected} 张手牌，点击此格会清除并进入；这些牌会${effect}。`;
      if (selected > 0) return `需要正好选择 ${hex.cost} 张手牌；当前选择了 ${selected} 张。`;
      return `先选择 ${hex.cost} 张手牌，再点击此格清除并进入；这些牌会${effect}。`;
    }

    const requirement = this.host.movementRequirement(hex);
    const requirementText = requirement.blockade && requirement.discard
      ? `边界碎石路障需要弃 ${requirement.cost} 张手牌；成功通过后会收入你的玩家信息。`
      : requirement.blockade && requirement.required
      ? `跨越边界阻挡物并进入对岸地形共需 ${SYMBOL_GLYPH[requirement.required]}${SYMBOL_LABEL[requirement.required]} ${requirement.cost} 点（阻挡物 + 目的地地形，须同一种符号）；成功通过后阻挡物会收入你的玩家信息。`
      : `此格需要 ${terrainCostText(hex)}。`;
    const mover = this.host.getState()?.turn?.activeMover;
    if (mover) {
      return this.host.canEnter(hex, mover.symbol, mover.remaining)
        ? `${requirementText} 当前移动力可以进入，进入后剩余 ${Math.max(0, mover.remaining - requirement.cost)} 点。`
        : `${requirementText} 当前正在使用的移动力不能进入此处。`;
    }

    if (this.host.getSelected().size > 0) {
      return `${requirementText} 已选 ${this.host.getSelected().size} 张手牌，点击此格会自动挑最省的一张打出并移动。`;
    }

    return `${requirementText} 选择匹配的移动牌后，点击相邻格即可移动。`;
  }
}
