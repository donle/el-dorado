/**
 * Turn info panel — the floating bottom-right action bar that shows the
 * current command state plus the action buttons available for that state.
 *
 * Pure renderer: builds the `action-bar command-panel` `HTMLElement` from
 * pre-computed state. The owning controller (App) computes every flag and
 * wires click handlers through the env.
 */
import {
  getDef,
  type GameState,
  type Player,
} from '@eldorado/core';
import { button, el, escapeHtml } from '../common/dom.js';
import { SYMBOL_GLYPH, SYMBOL_LABEL } from '../common/iconMap.js';

export type TurnPanelMode = 'idle' | 'clear' | 'remove' | 'trim';

export interface ActionCardPrompt {
  /** Number of action cards currently selected (0/1/>1). */
  count: number;
  /** Display name of the single selected action card (when count === 1). */
  name: string;
  /** The ability key of the selected action card (when count === 1). */
  ability: string | undefined;
  /** Limit imposed by the ability (remove-count cap), 0 if none. */
  removeLimit: number;
  /** How many hand-card ids the player has selected for removal. */
  removeSelectedCount: number;
}

export interface TurnInfoPanelState {
  /** True iff it is the local player's turn. */
  myTurn: boolean;
  /** Current game phase. */
  phase: GameState['phase'];
  /** Display name of the player whose turn it currently is. */
  turnName: string;
  /** The local player (or null if not seated). */
  me: Player | null;
  /** The full game state (drives `commandStateHtml` derived text). */
  state: GameState;
  /** Active UI mode (drives which set of action buttons render). */
  mode: TurnPanelMode;
  /** How many hand cards the player may remove during the post-draw remove step. */
  removeAfterDrawLimit: number;
  /** True iff the current turn is in the end-of-turn trim step. */
  pendingTrim: boolean;
  /** Hand-size ceiling used to compute the trim target. */
  handSizeLimit: number;
  /** defId being promoted into an on-board market slot, if any. */
  promoteTargetDefId: string | null;
  /** defId currently being bought, if any. */
  buyTargetDefId: string | null;
  /** Cost of `buyTargetDefId` (or null). */
  cost: number | null;
  /** Sum of coin values of selected card ids. */
  coinHave: number;
  /** True when the action-card "use" button should render. */
  hasActionCards: boolean;
  /** Native action card id selected from the board (for native guide). */
  nativeActionCardId: string | null;
  /** True iff the selected action card ability is `take_free` (drives buy-target hint). */
  takeFreeSelected: boolean;
  /** Action-card prompt summary (null when no action cards are selected). */
  actionPrompt: ActionCardPrompt | null;
  /** Pre-computed label for the action-card use button. */
  useLabel: string;
  /** Whether the use button should be disabled. */
  useDisabled: boolean;
  /** True when the selected action card can actually be used right now. */
  canUseAction: boolean;
  /** Number of selected hand cards (for remove confirm). */
  removeCount: number;
  /** Number of selected hand cards (for trim confirm). */
  trimSel: number;
  /** Minimum cards the player must trim to. */
  trimMin: number;
  /** True when the compact mobile command layout is active. */
  isCompact: boolean;
  /** True when the market has an empty slot that needs promotion (greeting hint). */
  marketNeedsPromotion: boolean;
  /** Total number of selected card ids (drives "已选手牌" hint). */
  selectedCount: number;
  /** Cost of the hex/blockade being cleared (used by the clear-mode hint). */
  clearCost: number;
  /** True when clearing a blockade (gates the verb in the clear-mode hint). */
  clearIsBlockade: boolean;
}

export interface TurnInfoPanelEnv {
  onConfirmRemove: () => void;
  onCancelMode: () => void;
  onConfirmTrim: () => void;
  onConfirmPromote: () => void;
  onConfirmBuy: () => void;
  onUseAction: () => void;
  onEndTurn: () => void;
  onDiscard: () => void;
}

/** Build the floating action bar DOM element. */
export function renderTurnInfoPanel(state: TurnInfoPanelState, env: TurnInfoPanelEnv): HTMLElement {
  const bar = el('div', 'action-bar command-panel');
  const ctx = el('div', 'ctx command-state');
  ctx.innerHTML = commandStateHtml(state);
  bar.appendChild(ctx);

  const actions = el('div', 'command-actions');
  if (state.myTurn && state.phase === 'playing') {
    if (state.mode === 'remove') {
      const confirm = button(
        state.removeCount > 0
          ? `确认移除 ${state.removeCount}/${state.removeAfterDrawLimit}`
          : '跳过移除',
        () => env.onConfirmRemove(),
        false,
      );
      confirm.className = 'gold cmd-btn';
      actions.appendChild(confirm);
    } else if (state.mode === 'clear') {
      const cancel = button('取消', () => env.onCancelMode(), true);
      cancel.classList.add('cmd-btn');
      actions.appendChild(cancel);
    } else if (state.mode === 'trim' && state.pendingTrim && state.me) {
      const btn = button(`确认精简 ${state.trimSel}/${state.trimMin}`, () => env.onConfirmTrim(), false);
      btn.className = 'gold cmd-btn';
      btn.disabled = state.trimSel < state.trimMin;
      actions.appendChild(btn);
    } else {
      if (state.promoteTargetDefId) {
        const promote = button(
          state.isCompact ? '放入' : '放入市场',
          () => env.onConfirmPromote(),
          false,
        );
        promote.className = 'gold cmd-btn';
        actions.appendChild(promote);
      }
      if (state.buyTargetDefId) {
        const cost = state.cost ?? 0;
        const have = state.coinHave;
        const buy = button(
          state.isCompact ? `购买 ${have}/${cost}` : `确认购买 (${have}/${cost}💰)`,
          () => env.onConfirmBuy(),
          false,
        );
        buy.className = 'gold cmd-btn';
        buy.disabled = have < cost;
        actions.appendChild(buy);
      }
      if (state.hasActionCards) {
        const use = button(state.useLabel, () => env.onUseAction(), false);
        use.className = 'gold cmd-btn';
        use.disabled = state.useDisabled || !state.canUseAction;
        actions.appendChild(use);
      }
      const end = button(state.isCompact ? '结束' : '结束回合', () => env.onEndTurn(), true);
      end.classList.add('cmd-btn');
      actions.appendChild(end);
      const skill = button('弃牌', () => env.onDiscard(), true);
      skill.classList.add('cmd-btn');
      skill.disabled = state.selectedCount === 0;
      actions.appendChild(skill);
    }
  }
  bar.appendChild(actions);
  return bar;
}

function commandStateHtml(state: TurnInfoPanelState): string {
  if (state.phase === 'finished') return '<b>游戏结束</b><span>结算完成</span>';
  if (!state.myTurn) return `<b>等待行动</b><span>${escapeHtml(state.turnName)}</span>`;
  if (state.mode === 'remove') {
    return `<b>移除手牌</b><span>${state.removeCount}/${state.removeAfterDrawLimit} 张，可跳过</span>`;
  }
  if (state.mode === 'clear') {
    const verb = state.clearIsBlockade ? '移除连接地形' : '清除地形';
    return `<b>${verb}</b><span>${state.selectedCount}/${state.clearCost} 张牌</span>`;
  }
  if (state.mode === 'trim') {
    const handSize = state.me?.hand.length ?? 0;
    const min = Math.max(0, handSize - state.handSizeLimit);
    return `<b>回合末精简</b><span>已选 ${state.trimSel}/${min} 张，至少弃到 ${state.handSizeLimit} 张</span>`;
  }
  if (state.promoteTargetDefId) {
    return `<b>放入市场</b><span>${escapeHtml(getDef(state.promoteTargetDefId).name)}</span>`;
  }
  if (state.buyTargetDefId) {
    const cost = state.cost ?? 0;
    const have = state.coinHave;
    if (state.takeFreeSelected) {
      return `<b>发报机目标</b><span>${escapeHtml(getDef(state.buyTargetDefId).name)}</span>`;
    }
    return `<b>购买 ${escapeHtml(getDef(state.buyTargetDefId).name)}</b><span>${have}/${cost} 金币</span>`;
  }
  if (state.nativeActionCardId) {
    return '<b>原住民向导</b><span>点选一个相邻地形</span>';
  }
  const prompt = state.actionPrompt;
  if (prompt && prompt.count > 1) {
    return '<b>行动牌</b><span>一次只能使用 1 张</span>';
  }
  if (prompt && prompt.count === 1) {
    const { name, ability, removeLimit, removeSelectedCount } = prompt;
    if (removeLimit > 0) {
      return removeSelectedCount > 0
        ? `<b>使用 ${escapeHtml(name)}</b><span>先只选择这张行动牌</span>`
        : `<b>使用 ${escapeHtml(name)}</b><span>先摸牌，再选择移除</span>`;
    }
    if (ability === 'take_free') {
      return `<b>使用 ${escapeHtml(name)}</b><span>先选择市场卡</span>`;
    }
    if (ability === 'native') {
      return `<b>使用 ${escapeHtml(name)}</b><span>点击使用后选地形</span>`;
    }
    return `<b>使用 ${escapeHtml(name)}</b><span>点击使用行动牌</span>`;
  }
  const mover = state.state.turn?.activeMover;
  if (mover) {
    return `<b>${SYMBOL_GLYPH[mover.symbol]} ${SYMBOL_LABEL[mover.symbol]}</b><span>剩余 ${mover.remaining} 点</span>`;
  }
  if (state.selectedCount > 0) {
    return `<b>已选手牌</b><span>${state.selectedCount} 张可用于行动</span>`;
  }
  if (state.myTurn && !state.state.turn?.hasBought && state.marketNeedsPromotion) {
    return '<b>市场有空位</b><span>可买在售牌，或放入候补牌</span>';
  }
  return '<b>你的回合</b><span>选择手牌或目标地形</span>';
}