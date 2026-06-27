/**
 * interaction/actionCards — pure helpers for querying action-card state
 * from the player's hand and selection. Extracted from InteractionController
 * so they can be tested in isolation.
 */
import { getDef, type CardDef } from '@eldorado/core';

export interface ActionCardSelection {
  id: string;
  defId: string;
  def: ReturnType<typeof getDef>;
}

export class ActionCardHelper {
  selectedActionCards(
    hand: Array<{ id: string; defId: string }>,
    selected: Set<string>,
  ): ActionCardSelection[] {
    return [...selected]
      .map((id) => {
        const card = hand.find((h) => h.id === id);
        if (!card) return null;
        const def = getDef(card.defId);
        return def.kind === 'action' ? { id, defId: card.defId, def } : null;
      })
      .filter((x): x is ActionCardSelection => !!x);
  }

  selectedActionCard(
    hand: Array<{ id: string; defId: string }>,
    selected: Set<string>,
  ): ActionCardSelection | null {
    const actions = this.selectedActionCards(hand, selected);
    return actions.length === 1 ? actions[0] : null;
  }

  selectedActionRemoveIds(
    actionCardId: string,
    hand: Array<{ id: string; defId: string }>,
    selected: Set<string>,
  ): string[] {
    const handIds = new Set(hand.map((c) => c.id));
    return [...selected].filter((id) => id !== actionCardId && handIds.has(id));
  }

  removeLimitForAbility(ability: string | undefined): number {
    if (ability === 'draw1_remove1') return 1;
    if (ability === 'draw2_remove2') return 2;
    return 0;
  }

  selectedActionUseLabel(
    action: ActionCardSelection | null,
    buyTargetDefId: string | null,
    compact = false,
  ): string {
    if (!action) return compact ? '使用' : '使用行动牌';
    switch (action.def.ability) {
      case 'draw2':
      case 'draw3':
        return compact ? '摸牌' : `使用${action.def.name}`;
      case 'draw1_remove1':
      case 'draw2_remove2':
        return compact ? '使用' : `使用${action.def.name}`;
      case 'take_free':
        return compact ? '免费拿' : (buyTargetDefId ? `免费获得${getDef(buyTargetDefId).name}` : '选择市场卡');
      case 'native':
        return compact ? '向导' : '使用原住民向导';
      default:
        return compact ? '使用' : `使用${action.def.name}`;
    }
  }

  handActionUseLabel(def: ReturnType<typeof getDef>): string {
    switch (def.ability) {
      case 'draw2':
      case 'draw3':
        return '摸牌';
      case 'take_free':
        return '免费拿';
      case 'native':
        return '向导';
      default:
        return '使用';
    }
  }

  canUseSelectedAction(
    action: ActionCardSelection | null,
    removeIds: string[],
    buyTargetDefId: string | null,
  ): boolean {
    if (!action) return false;
    switch (action.def.ability) {
      case 'draw2':
      case 'draw3':
        return removeIds.length === 0;
      case 'draw1_remove1':
      case 'draw2_remove2':
        return removeIds.length === 0;
      case 'take_free':
        return !!buyTargetDefId;
      case 'native':
        return true;
      default:
        return false;
    }
  }
}
