import type { ServerMessage } from '@eldorado/core';
import type { Room } from '../room.js';

export interface IClock {
  now(): number;
}

export interface IRandom {
  next(): number;
  seed(s: number): void;
}

export interface ILogger {
  info(msg: string, ctx?: object): void;
  warn(msg: string, ctx?: object): void;
  error(msg: string, ctx?: object): void;
}

export interface IMessageBus {
  broadcast(roomId: string, msg: ServerMessage): void;
  sendTo(connId: string, msg: ServerMessage): void;
}

export interface IRoomService {
  getByConnection(connId: string): Room | null;
  create(roomId: string, hostConnId: string): Room;
  destroy(roomId: string): void;
}

export interface IClientChannel {
  send(connId: string, msg: ServerMessage): void;
  broadcast(roomId: string, msg: ServerMessage): void;
  close(connId: string, reason?: string): void;
}
