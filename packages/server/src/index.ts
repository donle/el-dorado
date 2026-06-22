import { WebSocketServer, WebSocket } from 'ws';
import type { ClientMessage, ServerMessage } from '@eldorado/core';
import { Room, RoomManager, type Send } from './room.js';

const PORT = Number(process.env.PORT ?? 8787);
const HEARTBEAT_INTERVAL_MS = Number(process.env.WS_HEARTBEAT_INTERVAL_MS ?? 30000);
const manager = new RoomManager();

interface Session {
  room: Room | null;
  playerId: string | null;
}

interface AliveWebSocket extends WebSocket {
  isAlive: boolean;
}

const wss = new WebSocketServer({ port: PORT });
console.log(`[el-dorado] server listening on ws://localhost:${PORT}`);

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
      msg = JSON.parse(data.toString());
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
      if (!session.room || !session.playerId) return void send({ type: 'error', message: '你还没有进入房间' });
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
      if (!session.room || !session.playerId) return void send({ type: 'error', message: '你还没有进入游戏' });
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
