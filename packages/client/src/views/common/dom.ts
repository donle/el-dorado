/**
 * Common DOM helpers used by every panel view.
 *
 * These were duplicated between `main.ts` and `lobby/LobbyView.ts`. Stage 4
 * promotes them to `views/common/dom.ts` so the hand/market/players/turn
 * panels share a single implementation.
 */
import type { PlayerColor } from '@eldorado/core';

/** Create an HTMLElement with an optional className. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

/** Create a button with a click handler. */
export function button(
  label: string,
  onClick: () => void,
  secondary = false,
): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  if (secondary) b.className = 'secondary';
  b.onclick = onClick;
  return b;
}

/** Escape user-visible string content before injecting via innerHTML. */
export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!),
  );
}

/** Resolve a `PlayerColor` to its CSS hex value. Falls back to grey. */
export function colorHex(c: PlayerColor | string): string {
  return (
    {
      red: '#e05656',
      blue: '#4c9bef',
      green: '#5ed17a',
      yellow: '#f0d24c',
    } as Record<string, string>
  )[c] ?? '#aaa';
}

/** Render a player name, localising AI nicks like "AI 3" → "电脑 3". */
export function playerDisplayName(p: { name: string; isAI?: boolean }): string {
  if (!p.isAI) return p.name;
  const aiName = p.name.match(/^AI\s*(\d+)$/i);
  return aiName ? `电脑 ${aiName[1]}` : p.name;
}

/** Generated card-back artwork for the deck/discard piles. */
export function cardBack(): string {
  return '<img src="/cards/card-back.jpg" alt="卡背" draggable="false" />';
}