import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer as WSS, type WebSocket } from 'ws';
import type { IClock } from '../shared/ports.js';
import { ConnectionTracker } from './ConnectionTracker.js';
import type { MessageRouter } from './MessageRouter.js';

export interface ConnectionHooks {
  onOpen?(connId: string, ws: WebSocket): void;
  onClose(connId: string): void;
}

const DEFAULT_HEARTBEAT_MS = 30_000;

/**
 * Boots the WebSocket transport: binds to an HTTP server's `/ws` upgrade,
 * tracks per-connection liveness, and routes raw payloads into a
 * `MessageRouter`. The transport knows nothing about rooms or sessions; those
 * concerns are layered on top via the `ConnectionHooks` callbacks.
 */
export class WebSocketServer {
  private readonly wss: WSS;
  private readonly tracker: ConnectionTracker;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private connSeq = 0;

  constructor(
    private readonly httpServer: import('node:http').Server,
    private readonly router: MessageRouter,
    clock: IClock,
    private readonly hooks: ConnectionHooks,
    private readonly heartbeatMs: number = DEFAULT_HEARTBEAT_MS,
  ) {
    this.wss = new WSS({ noServer: true });
    this.tracker = new ConnectionTracker(clock);
    this.wireUpgrade();
    this.wireConnection();
    this.startHeartbeat(clock);
  }

  getConnectionTracker(): ConnectionTracker {
    return this.tracker;
  }

  /** Look up the underlying WebSocket for a connection id (legacy shim path). */
  getSocket(connId: string): WebSocket | undefined {
    return this.tracker.get(connId);
  }

  close(): void {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    this.wss.close();
  }

  private wireUpgrade(): void {
    this.httpServer.on('upgrade', (req, socket, head) => {
      const { pathname } = new URL(req.url ?? '/', 'http://localhost');
      if (pathname !== '/ws') {
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket as Duplex, head, (ws) =>
        this.wss.emit('connection', ws, req),
      );
    });
  }

  private wireConnection(): void {
    this.wss.on('connection', (raw: WebSocket, _req: IncomingMessage) => {
      const connId = this.newConnId();
      this.tracker.add(connId, raw);
      this.hooks.onOpen?.(connId, raw);
      raw.on('message', (data) => {
        void this.router.handle(connId, this.dataToString(data));
      });
      raw.on('pong', () => this.tracker.markAlive(connId));
      raw.on('close', () => {
        this.tracker.remove(connId);
        this.hooks.onClose(connId);
      });
    });
  }

  private startHeartbeat(clock: IClock): void {
    this.heartbeat = setInterval(() => {
      for (const ws of this.wss.clients) {
        const live = ws as WebSocket & { isAlive?: boolean };
        if (live.isAlive === false) {
          ws.terminate();
          continue;
        }
        live.isAlive = false;
        try {
          ws.ping();
        } catch {
          ws.terminate();
        }
      }
      // ConnectionTracker.reapStale is informational at this stage; the
      // ping-driven isAlive flag is what actually kills dead sockets.
      void this.tracker.reapStale(clock.now());
    }, this.heartbeatMs);
    this.heartbeat.unref?.();
    this.wss.on('close', () => {
      if (this.heartbeat) {
        clearInterval(this.heartbeat);
        this.heartbeat = null;
      }
    });
  }

  private newConnId(): string {
    this.connSeq += 1;
    return `${Date.now().toString(36)}-${this.connSeq.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private dataToString(data: unknown): string {
    if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
    if (data instanceof ArrayBuffer) return Buffer.from(new Uint8Array(data)).toString('utf8');
    return (data as { toString(): string }).toString();
  }
}
