/**
 * ReadyBarrier — owns the per-game "wait for every human to finish their
 * 3-2-1 countdown" gate.
 *
 * Extracted from `Room` so the room aggregate doesn't have to carry the
 * timer field, the set of pending players, or the timeout-flips-to-AI
 * fallback. The barrier talks to its host through a narrow callback
 * surface (broadcast on every transition, fire the game on empty).
 *
 * Lifecycle:
 *  - barrier is created in the host's `start()` and seeded with the
 *    humans that need to ready (non-AI, non-offline members).
 *  - `arm()` starts the 30s timer; if no humans need to ready, the host
 *    is asked to run the game immediately.
 *  - `markReady(playerId)` is called by each human as they finish; once
 *    the set is empty, the host is asked to run the game.
 *  - `onPlayerGone(playerId)` is called by the host's disconnect path;
 *    if the player was pending and the set empties as a result, the
 *    host is asked to run the game.
 *  - The 30s timer flips any still-pending humans to AI+offline and
 *    fires the game.
 */
export interface ReadyBarrierHost {
  /** All humans in the room that need to send a `ready` message before
   *  the game can begin. Computed at barrier-construction time. */
  membersNeedingReady(): string[];
  /** Flip a still-human member to AI+offline. No-op if the id is unknown. */
  flipHumanToAI(playerId: string): void;
  /** Broadcast an updated `starting` message (reflects the new
   *  pendingPlayers snapshot). */
  broadcastStarting(): void;
  /** Broadcast a `room` snapshot — used after the timeout flips humans. */
  broadcastRoom(): void;
  /** All humans have readied (or the barrier never had any to begin
   *  with). Host should kick off the game. */
  runGame(): void;
}

export class ReadyBarrier {
  /** Set of human playerIds that still need to ready. */
  pendingReady: Set<string>;
  private readyTimer: NodeJS.Timeout | null = null;
  /** Must be < the WS heartbeat (default 30s) so a silently-dead client
   *  hits this barrier before the heartbeat kills the socket. */
  private readonly TIMEOUT_MS = 30_000;

  constructor(private readonly host: ReadyBarrierHost) {
    this.pendingReady = new Set(host.membersNeedingReady());
  }

  /** Start the 30s countdown. If no humans need to ready, run the game. */
  arm(): void {
    this.clearTimer();
    if (this.pendingReady.size === 0) {
      // All-AI or all-offline game: nothing to wait for.
      this.host.runGame();
      return;
    }
    this.readyTimer = setTimeout(() => this.handleTimeout(), this.TIMEOUT_MS);
  }

  /** Called when a human client finishes their countdown. No-op if not pending. */
  markReady(playerId: string): void {
    if (!this.pendingReady.has(playerId)) return;
    this.pendingReady.delete(playerId);
    this.host.broadcastStarting();
    if (this.pendingReady.size === 0) {
      this.clearTimer();
      this.host.runGame();
    }
  }

  /**
   * Called when a player disconnects (or is otherwise removed from the
   * room). Returns true if the disconnect emptied the barrier; the host
   * uses that to decide whether to broadcast the updated pending list
   * (non-empty) or simply run the game.
   */
  onPlayerGone(playerId: string): boolean {
    if (!this.pendingReady.delete(playerId)) return false;
    this.clearTimer();
    if (this.pendingReady.size === 0) {
      this.host.runGame();
    } else {
      this.host.broadcastStarting();
    }
    return true;
  }

  /** Clear the pending set and the timer. Called by `host.start()`. */
  reset(): void {
    this.clearTimer();
    this.pendingReady = new Set(this.host.membersNeedingReady());
  }

  private clearTimer(): void {
    if (this.readyTimer) {
      clearTimeout(this.readyTimer);
      this.readyTimer = null;
    }
  }

  /** Fired by the 30s timer: flip any still-unready humans to AI+offline. */
  private handleTimeout(): void {
    this.readyTimer = null;
    for (const id of this.pendingReady) this.host.flipHumanToAI(id);
    this.pendingReady.clear();
    this.host.broadcastRoom();
    this.host.broadcastStarting(); // pendingPlayers now []
    this.host.runGame();
  }
}
