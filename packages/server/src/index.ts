/**
 * Server entry point. Stage 1 split the protocol layer into `transport/`,
 * Stage 3 split the lobby domain into `lobby/`. Stage C collected the
 * static-file free functions into `StaticFileServer`. `index.ts` now
 * wires transport + lobby + game-phase handlers.
 */
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ServerMessage } from '@eldorado/core';
import { WebSocketServer as Transport } from './transport/WebSocketServer.js';
import { MessageRouter } from './transport/MessageRouter.js';
import { StaticFileServer } from './transport/StaticFileServer.js';
import type { IClock } from './shared/ports.js';
import { encodeServer } from './transport/protocolCodec.js';
import { RoomRegistry } from './lobby/RoomRegistry.js';
import { LobbyService } from './lobby/LobbyService.js';

const PORT = Number(process.env.PORT ?? 8787);

const clientDistDir = resolve(
  fileURLToPath(new URL('../../client/dist', import.meta.url)),
);

class SystemClock implements IClock {
  now(): number { return Date.now(); }
}

let transportRef: Transport | null = null;

const staticFiles = new StaticFileServer(clientDistDir);
const httpServer = createServer((req, res) =>
  staticFiles.handleRequest(req.url ?? '/', req.method ?? 'GET', res),
);

function sendToConn(connId: string, msg: ServerMessage): void {
  const ws = transportRef?.getSocket(connId);
  if (ws && ws.readyState === ws.OPEN) ws.send(encodeServer(msg));
}

const registry = new RoomRegistry();
const lobby = new LobbyService({
  registry,
  sendTo: sendToConn,
});

const router = new MessageRouter({
  send(connId: string, msg: ServerMessage): void {
    sendToConn(connId, msg);
  },
  broadcast(_roomId: string, _msg: ServerMessage): void {
    // Stage 1 shim: broadcasting is done by Room.broadcast directly through
    // the legacy `send` closure. Stage 7's IMessageBus takes over.
  },
  close(_connId: string, _reason?: string): void {
    // no-op for Stage 1
  },
});

const transport = new Transport(httpServer, router, new SystemClock(), {
  onOpen(connId: string): void {
    registry.setSession(connId, { room: null, playerId: null, send: null });
  },
  onClose(connId: string): void {
    const session = registry.getSession(connId);
    if (!session) return;
    if (session.room && session.playerId && !session.room.closed) {
      const changed = session.room.disconnect(session.playerId, session.send ?? undefined);
      if (changed) {
        session.room.broadcastRoom();
        session.room.broadcastState();
        void session.room.runAITurns();
      }
    }
    registry.clearSession(connId);
  },
});
transportRef = transport;

// --- lobby messages (Stage 3: delegated to LobbyService) ------------------

router.on('createRoom', (connId, msg) => {
  if (msg.type === 'createRoom') lobby.handle(connId, msg);
});
router.on('joinRoom', (connId, msg) => {
  if (msg.type === 'joinRoom') lobby.handle(connId, msg);
});
router.on('rejoin', (connId, msg) => {
  if (msg.type === 'rejoin') lobby.handle(connId, msg);
});
router.on('addAI', (connId, msg) => {
  if (msg.type === 'addAI') lobby.handle(connId, msg);
});
router.on('removePlayer', (connId, msg) => {
  if (msg.type === 'removePlayer') lobby.handle(connId, msg);
});
router.on('setMap', (connId, msg) => {
  if (msg.type === 'setMap') lobby.handle(connId, msg);
});
router.on('leaveRoom', (connId, msg) => {
  if (msg.type === 'leaveRoom') lobby.handle(connId, msg);
});
router.on('returnToLobby', (connId, msg) => {
  if (msg.type === 'returnToLobby') lobby.handle(connId, msg);
});
router.on('startGame', (connId, msg) => {
  if (msg.type === 'startGame') lobby.handle(connId, msg);
});

// --- game-phase messages (Stage 7 will move to ActionDispatcher) ---------

router.on('setAiDelay', (connId, msg) => {
  if (msg.type !== 'setAiDelay') return;
  const session = registry.getSession(connId);
  if (!session || !session.room || !session.playerId) return;
  session.room.setAiDelay(session.playerId, msg.ms);
  session.room.broadcastRoom();
});

router.on('action', (connId, msg) => {
  if (msg.type !== 'action') return;
  const session = registry.getSession(connId);
  if (!session || !session.room || !session.playerId) {
    return void sendToConn(connId, { type: 'error', message: '你还没有进入游戏' });
  }
  const res = session.room.handleAction(session.playerId, msg.action);
  if (!res.ok) sendToConn(connId, { type: 'error', message: res.error ?? '这个操作不符合规则' });
});

router.on('ready', (connId, _msg) => {
  const session = registry.getSession(connId);
  if (!session || !session.room || !session.playerId) return;
  if (session.room.phase !== 'playing') return;
  session.room.markReady(session.playerId);
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`[el-dorado] http://localhost:${PORT}`);
  console.log(`[el-dorado] ws://localhost:${PORT}/ws`);
});
