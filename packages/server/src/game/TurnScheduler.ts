/**
 * TurnScheduler — drives the post-action auto-advance through AI turns until
 * either a human becomes the active player or the game ends.
 *
 * Extracted from `room.ts` so the `Room` aggregate root doesn't have to
 * carry the AI loop's pacing / guard logic. The scheduler is intentionally
 * stateless beyond the `aiRunning` latch (a single in-flight run is enough
 * to dedupe concurrent calls).
 */
import { applyAction, planTurn, type GameState, type ServerMessage } from '@eldorado/core';
import { stateMessage } from './SnapshotBuilder.js';

// SnapshotBuilder's `stateMessage` only reads `room.game`. Locally shape the
// narrowest possible `RoomSnapshot`-compatible object so the scheduler doesn't
// have to fabricate a whole Room. Type asserted because the public interface
// of SnapshotBuilder is wider than what the scheduler actually needs.
type MinimalSnapshot = Parameters<typeof stateMessage>[0];
const asSnapshot = (game: GameState | null): MinimalSnapshot =>
  ({ game } as MinimalSnapshot);

/** Sleep function used to pace AI actions. Injected so tests can use a fake clock. */
export type Sleep = (ms: number) => Promise<void>;

export interface TurnSchedulerHost {
  /** Read the current member roster. The host should return a fresh snapshot
   *  on each call so the scheduler sees AI/human flips made mid-run. */
  readonly members: () => Array<{ id: string; isAI: boolean }>;
  /** Read the current game state. Returned fresh on each call so the
   *  scheduler observes phase / turn / hand changes made by prior actions. */
  readonly game: () => GameState | null;
  readonly aiDelayMs: number;
  /** Mutate the host's game state to a new GameState. */
  setGame(next: GameState): void;
  /** Broadcast a message to every member in the room. */
  broadcast(msg: ServerMessage): void;
  /** Mark the room phase as finished and broadcast the final room snapshot. */
  markFinished(): void;
  sleep: Sleep;
}

export class TurnScheduler {
  private aiRunning = false;

  /**
   * Run AI turns until it's a human's turn or the game ends, pacing each
   * applied action by `aiDelayMs`. Concurrent calls are coalesced (only one
   * run is in flight at a time). Async; callers fire-and-forget with `void`.
   */
  async runAITurns(host: TurnSchedulerHost): Promise<void> {
    if (this.aiRunning) return;
    this.aiRunning = true;
    try {
      // Safety backstop against a pathological no-progress loop. A full
      // all-AI game on a large map can legitimately take many hundreds of
      // turns.
      let guard = 0;
      let first = true; // no delay before the very first action of the run
      while (guard++ < 5000) {
        const game = host.game();
        if (!game || game.phase !== 'playing') break;
        const cur = currentPlayerId(game);
        if (!cur) break;
        const m = host.members().find((x) => x.id === cur);
        if (!m || !m.isAI) break;

        const plan = planTurn(game, cur);
        let forcedEnd = false;
        for (const act of plan) {
          if (!first) await host.sleep(host.aiDelayMs);
          first = false;
          // Re-read game each iteration: applyAction returns a NEW state,
          // so the local `game` from the outer read is stale after the
          // first action.
          const r = applyAction(host.game() ?? game, cur, act);
          if (!r.result.ok) {
            forcedEnd = true;
            break;
          }
          host.setGame(r.state);
          const msg = stateMessage(asSnapshot(host.game()), r.result.events);
          if (msg) host.broadcast(msg);
        }
        if (forcedEnd) {
          // Safety: ensure the AI relinquishes the turn even if its plan
          // failed.
          if (!first) await host.sleep(host.aiDelayMs);
          first = false;
          const fresh = host.game()!;
          const end = applyAction(fresh, cur, { type: 'EndTurn' });
          if (end.result.ok) {
            host.setGame(end.state);
            const msg = stateMessage(asSnapshot(host.game()), end.result.events);
            if (msg) host.broadcast(msg);
          } else {
            break; // cannot recover; avoid an infinite loop
          }
        }
      }
      if (host.game()?.phase === 'finished') host.markFinished();
    } finally {
      this.aiRunning = false;
    }
  }
}

function currentPlayerId(game: GameState): string | null {
  if (game.phase !== 'playing' || !game.turn) return null;
  return game.turn.playerId;
}
