/**
 * views/cards/CardDescription — pure HTML/text builders for card
 * metadata (description, preview popover, market inline detail).
 *
 * Moved out of `main.ts` so the card preview subsystem and market panel
 * can import directly without going through the App host interface.
 *
 * All functions are deterministic and side-effect free. Output strings
 * are pre-escaped; callers can safely assign to `innerHTML`.
 */
import { getDef } from '@eldorado/core';
import { cardFace } from '../../cardFaces.js';
import { KIND_LABEL } from '../common/iconMap.js';
import { escapeHtml } from '../common/dom.js';

export function cardDescription(defId: string): string {
  const def = getDef(defId);
  if (def.kind === 'joker') {
    return `万能牌：出牌时可当作 🗡️砍刀 / 🛶船桨 / 🪙金币 中任意一种使用（每次选一种，不可混用）。购买时按 ${def.power} 金币计。`;
  }
  if (def.kind === 'action') {
    switch (def.ability) {
      case 'draw2':
        return '抽 2 张牌，本回合可立即打出使用。';
      case 'draw1_remove1':
        return '抽 1 张牌，然后可将手牌中 1 张永久移出游戏（精简牌库）。';
      case 'draw3':
        return '抽 3 张牌。';
      case 'draw2_remove2':
        return '抽 2 张牌，并可移除至多 2 张手牌。';
      case 'take_free':
        return '免费获得市场上任意一张牌，置入弃牌堆。';
      case 'native':
        return '将棋子移动到相邻 1 格，无视该格地形需求（包括山地；未移除的连接地形仍会阻挡）。';
      default:
        return '行动牌。';
    }
  }
  const sym = def.symbol === 'machete' ? '丛林（绿）' : def.symbol === 'paddle' ? '水域（蓝）' : '村庄（黄）';
  let s = `移动牌：提供 ${def.power} 点力量，进入需求 ≤ ${def.power} 的${sym}地格，余力可逐格穿越。`;
  s += def.symbol === 'coin' ? ` 购买时按 ${def.power} 金币计。` : ' 购买时按 ½ 金币计。';
  return s;
}

export function previewHtml(defId: string): string {
  const def = getDef(defId);
  const cost = def.starting
    ? '<span class="cp-cost">起始牌 · 不可购买</span>'
    : `<span class="cp-cost">购买消耗 <b>${def.cost}</b> 💰</span>`;
  const power = def.power ? `<span class="cp-pow">力量 ${def.power}</span>` : '';
  return `
    <div class="cp-art">${cardFace(def)}</div>
    <div class="cp-title">${escapeHtml(def.name)}</div>
    <div class="cp-type">${KIND_LABEL[def.kind] ?? ''}${def.singleUse ? ' · 单次性' : ''}</div>
    <div class="cp-desc">${cardDescription(defId)}</div>
    <div class="cp-foot">${cost}${power}</div>`;
}

export function marketInlineDetailHtml(defId: string): string {
  const def = getDef(defId);
  const tags = [
    KIND_LABEL[def.kind] ?? '',
    def.singleUse ? '单次' : '',
    def.power ? `力量 ${def.power}` : '',
    def.starting ? '不可购买' : `${def.cost} 金币`,
  ].filter(Boolean).join(' · ');
  return `
    <div class="market-detail-head">
      <b>${escapeHtml(def.name)}</b>
      <span>${escapeHtml(tags)}</span>
    </div>
    <div class="market-detail-desc">${escapeHtml(cardDescription(defId))}</div>`;
}