import { WebSocketServer, WebSocket } from 'ws';
import type { ClientMessage, ServerMessage } from '@eldorado/core';
import { Room, RoomManager, type Send } from './room.js';

const PORT = Number(process.env.PORT ?? 8787);
const manager = new RoomManager();

interface Session {
  room: Room | null;
  playerId: string | null;
}

const wss = new WebSocketServer({ port: PORT });
console.log(`[el-dorado] server listening on ws://localhost:${PORT}`);

wss.on('connection', (ws: WebSocket) => {
  const session: Session = { room: null, playerId: null };
  const send: Send = (msg: ServerMessage) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };
  const err = (message: string) => send({ type: 'error', message });

  ws.on('message', (data) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return err('Malformed message');
    }
    try {
      handle(session, send, msg);
    } catch (e) {
      err(e instanceof Error ? e.message : 'Unexpected error');
    }
  });

  ws.on('close', () => {
    if (session.room && session.playerId) {
      session.room.disconnect(session.playerId);
      session.room.broadcastRoom();
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
      if (!room) return void send({ type: 'error', message: 'Room not found' });
      const me = room.addHuman(msg.name, send);
      session.room = room;
      session.playerId = me.id;
      send({ type: 'joined', code: room.code, playerId: me.id });
      room.broadcastRoom();
      return;
    }
    case 'rejoin': {
      const room = manager.get(msg.code);
      if (!room) return void send({ type: 'error', message: 'Room not found' });
      const me = room.reconnect(msg.playerId, send);
      if (!me) return void send({ type: 'error', message: 'Player not in room' });
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
    case 'startGame': {
      requireHost(session);
      const room = session.room!;
      room.start(msg.mapId ?? 'classic');
      room.broadcastRoom();
      room.broadcastState();
      room.runAITurns(); // in case the first player is an AI
      return;
    }
    case 'action': {
      if (!session.room || !session.playerId) return void send({ type: 'error', message: 'Not in a game' });
      const res = session.room.handleAction(session.playerId, msg.action);
      if (!res.ok) send({ type: 'error', message: res.error ?? 'Illegal action' });
      return;
    }
  }
}

function requireHost(session: Session): void {
  if (!session.room || !session.playerId) throw new Error('Not in a room');
  if (session.room.hostId !== session.playerId) throw new Error('Only the host can do that');
}
