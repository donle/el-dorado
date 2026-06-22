import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import type { ClientMessage, ServerMessage } from '@eldorado/core';
import { Room, RoomManager, type Send } from './room.js';

// 端口：dev 默认 8787（vite proxy 转发），prod 走环境变量 PORT（Dockerfile 设为 3000）
const PORT = Number(process.env.PORT ?? 8787);
const HEARTBEAT_INTERVAL_MS = Number(process.env.WS_HEARTBEAT_INTERVAL_MS ?? 30000);

// 解析 client/dist 路径：dev 时是 ../client/dist（workspace 兄弟）；
// Docker 内由 import.meta.url 解到 /app/packages/client/dist。
// dev 与 prod 同一份代码，无 if 分支。
const clientDistDir = resolve(
  fileURLToPath(new URL('../../client/dist', import.meta.url)),
);

const manager = new RoomManager();

interface Session {
  room: Room | null;
  playerId: string | null;
}
interface AliveWebSocket extends WebSocket {
  isAlive: boolean;
}

// HTTP 服务：负责静态文件 + SPA fallback
const httpServer = createServer((req, res) =>
  serveClient(req.url ?? '/', req.method ?? 'GET', res),
);

// WS 服务：noServer 模式，自己处理 upgrade 事件，固定在 /ws 路径
const wss = new WebSocketServer({ noServer: true });

httpServer.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost');
  if (pathname !== '/ws') {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

const heartbeat = setInterval(() => {
  for (const client of wss.clients) {
    const ws = client as AliveWebSocket;
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    try {
      ws.ping();
    } catch {
      ws.terminate();
    }
  }
}, HEARTBEAT_INTERVAL_MS);
heartbeat.unref?.();
wss.on('close', () => clearInterval(heartbeat));

wss.on('connection', (raw: WebSocket) => {
  const ws = raw as AliveWebSocket;
  ws.isAlive = true;
  const session: Session = { room: null, playerId: null };
  const send: Send = (msg: ServerMessage) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };
  const err = (message: string) => send({ type: 'error', message });

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (data) => {
    let msg: ClientMessage;
    try {
      msg = parseMessage(data);
    } catch {
      return err('消息格式错误');
    }
    try {
      handle(session, send, msg);
    } catch (e) {
      err(e instanceof Error ? e.message : '未知错误');
    }
  });

  ws.on('close', () => {
    if (session.room && session.playerId && !session.room.closed) {
      const changed = session.room.disconnect(session.playerId, send);
      if (changed) {
        session.room.broadcastRoom();
        session.room.broadcastState();
        void session.room.runAITurns();
      }
    }
  });
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`[el-dorado] http://localhost:${PORT}`);
  console.log(`[el-dorado] ws://localhost:${PORT}/ws`);
});

function parseMessage(raw: RawData): ClientMessage {
  let text: string;
  if (Array.isArray(raw)) {
    text = Buffer.concat(raw).toString('utf8');
  } else if (raw instanceof ArrayBuffer) {
    text = Buffer.from(new Uint8Array(raw)).toString('utf8');
  } else {
    text = raw.toString('utf8');
  }
  const value = JSON.parse(text) as unknown;
  if (!value || typeof value !== 'object' || !('type' in value)) {
    throw new Error('消息格式错误');
  }
  return value as ClientMessage;
}

function serveClient(rawUrl: string, method: string, response: ServerResponse): void {
  if (method !== 'GET' && method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end();
    return;
  }

  const url = new URL(rawUrl, 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);

  // /ws 由 upgrade 处理，这里只接 HTTP
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

  // 静态资源缺失 → 404（避免 SPA fallback 把 API 路径吞了）
  if (pathname.startsWith('/assets/') || pathname.includes('.')) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('资源不存在。');
    return;
  }

  // SPA fallback：找不到时返回 index.html
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
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.mjs':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.svg':
      return 'image/svg+xml';
    case '.json':
    case '.map':
      return 'application/json; charset=utf-8';
    case '.webmanifest':
      return 'application/manifest+json; charset=utf-8';
    case '.woff':
    case '.woff2':
      return 'font/woff2';
    case '.ico':
      return 'image/x-icon';
    default:
      return 'application/octet-stream';
  }
}

function shouldAvoidStaticCache(filePath: string): boolean {
  return (
    filePath.endsWith('index.html') ||
    filePath.endsWith('sw.js') ||
    filePath.endsWith('manifest.webmanifest')
  );
}

function handle(session: Session, send: Send, msg: ClientMessage): void {
  switch (msg.type) {
    case 'createRoom': {
      const room = manager.create();
      const me = room.addHuman(msg.name, send);
      session.room = room;
      session.playerId = me.id;
      send({ type: 'joined', code: room.code, playerId: me.id });
      room.broadcastRoom();
      return;
    }
    case 'joinRoom': {
      const room = manager.get(msg.code);
      if (!room) return void send({ type: 'error', message: '没有找到这个房间' });
      const me = room.addHuman(msg.name, send);
      session.room = room;
      session.playerId = me.id;
      send({ type: 'joined', code: room.code, playerId: me.id });
      room.broadcastRoom();
      return;
    }
    case 'rejoin': {
      const room = manager.get(msg.code);
      if (!room) return void send({ type: 'error', message: '没有找到这个房间' });
      const me = room.reconnect(msg.playerId, send);
      if (!me) return void send({ type: 'error', message: '玩家不在这个房间里' });
      session.room = room;
      session.playerId = me.id;
      send({ type: 'joined', code: room.code, playerId: me.id });
      room.broadcastRoom();
      if (room.game) send({ type: 'state', state: room.game });
      return;
    }
    case 'addAI': {
      requireHost(session);
      session.room!.addAI();
      session.room!.broadcastRoom();
      return;
    }
    case 'removePlayer': {
      requireHost(session);
      session.room!.remove(msg.playerId);
      session.room!.broadcastRoom();
      return;
    }
    case 'setMap': {
      requireHost(session);
      session.room!.setMap(msg.mapId);
      session.room!.broadcastRoom();
      return;
    }
    case 'leaveRoom': {
      if (!session.room || !session.playerId) return;
      const room = session.room;
      const playerId = session.playerId;
      if (room.phase === 'playing') {
        const changed = room.disconnect(playerId, send);
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
      return;
    }
    case 'returnToLobby': {
      if (!session.room || !session.playerId)
        return void send({ type: 'error', message: '你还没有进入房间' });
      session.room.returnToLobby();
      session.room.broadcastRoom();
      return;
    }
    case 'startGame': {
      requireHost(session);
      const room = session.room!;
      room.start(msg.mapId ?? room.mapId);
      room.broadcastRoom();
      room.broadcastState();
      void room.runAITurns(); // in case the first player is an AI
      return;
    }
    case 'setAiDelay': {
      if (!session.room || !session.playerId) return;
      session.room.setAiDelay(session.playerId, msg.ms);
      session.room.broadcastRoom();
      return;
    }
    case 'action': {
      if (!session.room || !session.playerId)
        return void send({ type: 'error', message: '你还没有进入游戏' });
      const res = session.room.handleAction(session.playerId, msg.action);
      if (!res.ok) send({ type: 'error', message: res.error ?? '这个操作不符合规则' });
      return;
    }
  }
}

function requireHost(session: Session): void {
  if (!session.room || !session.playerId) throw new Error('你还没有进入房间');
  if (session.room.hostId !== session.playerId) throw new Error('只有房主可以这样做');
}