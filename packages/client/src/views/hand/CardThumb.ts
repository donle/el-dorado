/**
 * A single card thumb inside the hand tray.
 *
 * Renders the card artwork plus an optional "use" button when the card is an
 * action card and it isn't the discard mode.
 */
import type { CardDef } from '@eldorado/core';
import { cardFace } from '../../cardFaces.js';
import { el } from '../common/dom.js';

export interface CardThumbEnv {
  onClick: () => void;
  onUseClick: (ev: MouseEvent) => void;
}

export interface CardThumbOptions {
  def: CardDef;
  defId: string;
  selected: boolean;
  showUseButton: boolean;
  useButtonLabel: string;
  /** Hook for attaching preview hover/long-press behaviour. */
  attachPreview: (node: HTMLElement, defId: string) => void;
}

/** Build a single card in the hand tray. */
export function renderCardThumb(opts: CardThumbOptions, env: CardThumbEnv): HTMLElement {
  const { def, defId, selected, showUseButton, useButtonLabel, attachPreview } = opts;
  const card = el('div', `card ${def.kind} ${selected ? 'selected' : ''}`);
  card.innerHTML = `${cardFace(def)}`;
  card.onclick = env.onClick;
  if (showUseButton) {
    const use = document.createElement('button');
    use.type = 'button';
    use.className = 'card-use-btn';
    use.textContent = useButtonLabel;
    use.onclick = (ev) => env.onUseClick(ev);
    card.appendChild(use);
  }
  attachPreview(card, defId);
  return card;
}