/**
 * Server entry point. Stage 1 split the protocol layer into `transport/`,
 * Stage 3 split the lobby domain into `lobby/`. `index.ts` now wires
 * transport + lobby + game-phase handlers. Stage 7 will move the game
 * internals into `game/` and retire the remaining inline handlers.
 */
import { createServer, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ServerMessage } from '@eldorado/core';
import { Room, type Send } from './room.js';
import { WebSocketServer as Transport } from './transport/WebSocketServer.js';
import { MessageRouter } from './transport/MessageRouter.js';
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

const httpServer = createServer((req, res) =>
  serveClient(req.url ?? '/', req.method ?? 'GET', res),
);

function sendToConn(connId: string, msg: ServerMessage): void {
  const ws = transportRef?.getSocket(connId);
  if (ws && ws.readyState === ws.OPEN) ws.send(encodeServer(msg));
}

const registry = new RoomRegistry();
const lobby = new LobbyService({
  registry,
  sendTo: sendToConn,
  makeBroadcastSend,
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
    registry.setSession(connId, { room: null, playerId: null });
  },
  onClose(connId: string): void {
    const session = registry.getSession(connId);
    if (!session) return;
    if (session.room && session.playerId && !session.room.closed) {
      const changed = session.room.disconnect(session.playerId, makeBroadcastSend(session.room));
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

/**
 * Stage 1 shim: `Room` is given a `Send` that broadcasts to every connection
 * currently mapped to that room. Stage 7's IMessageBus replaces this.
 */
function makeBroadcastSend(room: Room): Send {
  return (msg: ServerMessage): void => {
    for (const [connId] of registry.connectionsInRoom(room)) {
      sendToConn(connId, msg);
    }
  };
}

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`[el-dorado] http://localhost:${PORT}`);
  console.log(`[el-dorado] ws://localhost:${PORT}/ws`);
});

function serveClient(rawUrl: string, method: string, response: ServerResponse): void {
  if (method !== 'GET' && method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end();
    return;
  }
  const url = new URL(rawUrl, 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);
  if (pathname.startsWith('/ws')) {
    response.writeHead(426, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Upgrade Required');
    return;
  }
  const requestedPath = pathname === '/' ? '/index.html' : pathname;
  const filePath = safeResolveClientFile(requestedPath);
  if (filePath && existsSync(filePath) && statSync(filePath).isFile()) {
    writeFileResponse(filePath, method, response);
    return;
  }
  if (pathname.startsWith('/assets/') || pathname.includes('.')) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('资源不存在。');
    return;
  }
  const indexPath = safeResolveClientFile('/index.html');
  if (indexPath && existsSync(indexPath)) {
    writeFileResponse(indexPath, method, response);
    return;
  }
  response.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end('前端文件不存在，请先在 client 目录运行 pnpm build。');
}

function safeResolveClientFile(pathname: string): string | null {
  const filePath = resolve(clientDistDir, `.${pathname}`);
  const rel = relative(clientDistDir, filePath);
  if (rel.startsWith('..') || rel === '') return null;
  return filePath;
}

function writeFileResponse(filePath: string, method: string, response: ServerResponse): void {
  response.writeHead(200, {
    'Content-Type': contentTypeFor(filePath),
    'Cache-Control': shouldAvoidStaticCache(filePath)
      ? 'no-cache'
      : 'public, max-age=31536000, immutable',
  });
  if (method === 'HEAD') {
    response.end();
    return;
  }
  createReadStream(filePath).pipe(response);
}

function contentTypeFor(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case '.html': return 'text/html; charset=utf-8';
    case '.js': return 'text/javascript; charset=utf-8';
    case '.mjs': return 'text/javascript; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.svg': return 'image/svg+xml';
    case '.json':
    case '.map': return 'application/json; charset=utf-8';
    case '.webmanifest': return 'application/manifest+json; charset=utf-8';
    case '.woff':
    case '.woff2': return 'font/woff2';
    case '.ico': return 'image/x-icon';
    default: return 'application/octet-stream';
  }
}

function shouldAvoidStaticCache(filePath: string): boolean {
  return (
    filePath.endsWith('index.html') ||
    filePath.endsWith('sw.js') ||
    filePath.endsWith('manifest.webmanifest')
  );
}
