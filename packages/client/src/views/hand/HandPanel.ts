/**
 * Hand panel — the bottom-dock tray of cards the local player holds.
 *
 * Pure renderer: builds an `HTMLElement` representing the tray, including the
 * wheel-to-scroll behaviour and every card thumb. The owning controller is
 * expected to wire click + use-button handlers through the env.
 */
import type { GameState, Player } from '@eldorado/core';
import { getDef } from '@eldorado/core';
import { el } from '../common/dom.js';
import { renderCardThumb, type CardThumbEnv } from './CardThumb.js';

export interface HandPanelState {
  /** The local player (or null if not seated). */
  me: Player | null;
  /** True if it's currently the local player's turn (gates interactivity). */
  myTurn: boolean;
  /** Current game phase (action-card "use" button only shows during 'playing'). */
  phase: GameState['phase'];
  /** Cards the local player has selected (drives the .selected class). */
  selectedIds: ReadonlySet<string>;
  /** Whether the local player is in 'remove' mode (suppresses the use button). */
  modeIsRemove: boolean;
  /** Pre-computed label for the action-card use button. */
  useLabelFor: (defId: string) => string;
  /** Look up the defId for a card id in the hand. */
  defIdFor: (cardId: string) => string;
  /** Forward `attachPreview` from the host App. */
  attachPreview: (node: HTMLElement, defId: string) => void;
}

export interface HandPanelEnv {
  onCardClick: (cardId: string) => void;
  onUseClick: (cardId: string, ev: MouseEvent) => void;
}

/** Build the hand tray DOM element. */
export function renderHandPanel(state: HandPanelState, env: HandPanelEnv): HTMLElement {
  const tray = el('div', 'hand-tray');
  tray.addEventListener(
    'wheel',
    (ev) => {
      if (tray.scrollWidth <= tray.clientWidth || Math.abs(ev.deltaX) >= Math.abs(ev.deltaY)) return;
      tray.scrollLeft += ev.deltaY;
      ev.preventDefault();
    },
    { passive: false },
  );
  if (state.me) {
    for (const c of state.me.hand) {
      const defId = state.defIdFor(c.id);
      const def = getDef(defId);
      const selected = state.selectedIds.has(c.id);
      const showUseButton =
        state.myTurn && state.phase === 'playing' && def.kind === 'action' && !state.modeIsRemove;
      const thumbEnv: CardThumbEnv = {
        onClick: () => env.onCardClick(c.id),
        onUseClick: (ev) => env.onUseClick(c.id, ev),
      };
      tray.appendChild(
        renderCardThumb(
          {
            def,
            defId,
            selected,
            showUseButton,
            useButtonLabel: state.useLabelFor(defId),
            attachPreview: state.attachPreview,
          },
          thumbEnv,
        ),
      );
    }
  }
  return tray;
}