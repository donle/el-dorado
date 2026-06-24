/**
 * Server entry point. Stage 1 split the protocol layer into `transport/`;
 * `index.ts` now boots transport, then registers message handlers that
 * delegate to `room.ts` via a shim. Stage 7 will move the room internals
 * into `game/` and retire this shim.
 */
import { createServer, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ServerMessage } from '@eldorado/core';
import { Room, RoomManager, type Send } from './room.js';
import { WebSocketServer as Transport } from './transport/WebSocketServer.js';
import { MessageRouter } from './transport/MessageRouter.js';
import type { IClock } from './shared/ports.js';
import { encodeServer } from './transport/protocolCodec.js';

const PORT = Number(process.env.PORT ?? 8787);

const clientDistDir = resolve(
  fileURLToPath(new URL('../../client/dist', import.meta.url)),
);

const manager = new RoomManager();

interface Session {
  room: Room | null;
  playerId: string | null;
}

class SystemClock implements IClock {
  now(): number { return Date.now(); }
}

const sessions = new Map<string, Session>();

const httpServer = createServer((req, res) =>
  serveClient(req.url ?? '/', req.method ?? 'GET', res),
);

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

function sendToConn(connId: string, msg: ServerMessage): void {
  const ws = transportRef?.getSocket(connId);
  if (ws && ws.readyState === ws.OPEN) ws.send(encodeServer(msg));
}

let transportRef: Transport | null = null;

const transport = new Transport(httpServer, router, new SystemClock(), {
  onOpen(connId: string): void {
    sessions.set(connId, { room: null, playerId: null });
  },
  onClose(connId: string): void {
    const session = sessions.get(connId);
    if (!session) return;
    if (session.room && session.playerId && !session.room.closed) {
      const changed = session.room.disconnect(session.playerId, makeBroadcastSend(session.room));
      if (changed) {
        session.room.broadcastRoom();
        session.room.broadcastState();
        void session.room.runAITurns();
      }
    }
    sessions.delete(connId);
  },
});
transportRef = transport;

router.on('createRoom', (connId, msg) => {
  if (msg.type !== 'createRoom') return;
  const room = manager.create();
  const me = room.addHuman(msg.name, makeBroadcastSend(room));
  const session = sessions.get(connId)!;
  session.room = room;
  session.playerId = me.id;
  sendToConn(connId, { type: 'joined', code: room.code, playerId: me.id });
  room.broadcastRoom();
});

router.on('joinRoom', (connId, msg) => {
  if (msg.type !== 'joinRoom') return;
  const room = manager.get(msg.code);
  if (!room) return void sendToConn(connId, { type: 'error', message: '没有找到这个房间' });
  const me = room.addHuman(msg.name, makeBroadcastSend(room));
  const session = sessions.get(connId)!;
  session.room = room;
  session.playerId = me.id;
  sendToConn(connId, { type: 'joined', code: room.code, playerId: me.id });
  room.broadcastRoom();
});

router.on('rejoin', (connId, msg) => {
  if (msg.type !== 'rejoin') return;
  const room = manager.get(msg.code);
  if (!room) return void sendToConn(connId, { type: 'error', message: '没有找到这个房间' });
  const me = room.reconnect(msg.playerId, makeBroadcastSend(room));
  if (!me) return void sendToConn(connId, { type: 'error', message: '玩家不在这个房间里' });
  const session = sessions.get(connId)!;
  session.room = room;
  session.playerId = me.id;
  sendToConn(connId, { type: 'joined', code: room.code, playerId: me.id });
  room.broadcastRoom();
  if (room.game) sendToConn(connId, { type: 'state', state: room.game });
});

router.on('addAI', (connId, _msg) => {
  const session = sessions.get(connId)!;
  requireHost(session);
  session.room!.addAI();
  session.room!.broadcastRoom();
});

router.on('removePlayer', (connId, msg) => {
  if (msg.type !== 'removePlayer') return;
  const session = sessions.get(connId)!;
  requireHost(session);
  session.room!.remove(msg.playerId);
  session.room!.broadcastRoom();
});

router.on('setMap', (connId, msg) => {
  if (msg.type !== 'setMap') return;
  const session = sessions.get(connId)!;
  requireHost(session);
  session.room!.setMap(msg.mapId);
  session.room!.broadcastRoom();
});

router.on('leaveRoom', (connId, _msg) => {
  const session = sessions.get(connId)!;
  if (!session.room || !session.playerId) return;
  const room = session.room;
  const playerId = session.playerId;
  if (room.phase === 'playing') {
    const changed = room.disconnect(playerId, makeBroadcastSend(room));
    if (changed) {
      room.broadcastRoom();
      room.broadcastState();
      void room.runAITurns();
    }
  } else {
    if (playerId === room.hostId) {
      room.broadcastClosed('房主已退出，房间已解散', playerId);
      manager.dispose(room.code);
      session.room = null;
      session.playerId = null;
      return;
    }
    room.remove(playerId);
    room.broadcastRoom();
    if (room.members.length === 0) manager.dispose(room.code);
  }
  session.room = null;
  session.playerId = null;
});

router.on('returnToLobby', (connId, _msg) => {
  const session = sessions.get(connId)!;
  if (!session.room || !session.playerId)
    return void sendToConn(connId, { type: 'error', message: '你还没有进入房间' });
  session.room.returnToLobby();
  session.room.broadcastRoom();
});

router.on('startGame', (connId, msg) => {
  if (msg.type !== 'startGame') return;
  const session = sessions.get(connId)!;
  requireHost(session);
  const room = session.room!;
  room.start(msg.mapId ?? room.mapId);
  room.broadcastRoom();
  room.broadcastState();
  room.broadcastStarting();
  room.armReadyTimeout();
});

router.on('setAiDelay', (connId, msg) => {
  if (msg.type !== 'setAiDelay') return;
  const session = sessions.get(connId)!;
  if (!session.room || !session.playerId) return;
  session.room.setAiDelay(session.playerId, msg.ms);
  session.room.broadcastRoom();
});

router.on('action', (connId, msg) => {
  if (msg.type !== 'action') return;
  const session = sessions.get(connId)!;
  if (!session.room || !session.playerId)
    return void sendToConn(connId, { type: 'error', message: '你还没有进入游戏' });
  const res = session.room.handleAction(session.playerId, msg.action);
  if (!res.ok) sendToConn(connId, { type: 'error', message: res.error ?? '这个操作不符合规则' });
});

router.on('ready', (connId, _msg) => {
  const session = sessions.get(connId)!;
  if (!session.room || !session.playerId) return;
  if (session.room.phase !== 'playing') return;
  session.room.markReady(session.playerId);
});

/**
 * Stage 1 shim: `Room` is given a `Send` that broadcasts to every connection
 * currently mapped to that room. The legacy implementation captured the
 * sending socket in a closure; this preserves wire-equivalent behavior
 * without forcing the Stage 7 IMessageBus split. It does mean a stale conn
 * will receive room broadcasts after `leaveRoom`/`disconnect` until the
 * session is deleted — which the legacy code also did until
 * `ws.on('close')` cleared `send`. We match that by deleting sessions in
 * `onClose` above.
 */
function makeBroadcastSend(room: Room): Send {
  return (msg: ServerMessage): void => {
    for (const [connId, session] of sessions) {
      if (session.room === room) sendToConn(connId, msg);
    }
  };
}

function requireHost(session: Session): void {
  if (!session.room || !session.playerId) throw new Error('你还没有进入房间');
  if (session.room.hostId !== session.playerId) throw new Error('只有房主可以这样做');
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
