import type { ClientMessage, ServerMessage } from '@eldorado/core';

export type SocketEvent =
  | { kind: 'open' }
  | { kind: 'close'; reason: string }
  | { kind: 'error'; message: string }
  | { kind: 'message'; payload: ServerMessage };

export type SocketEventHandler = (e: SocketEvent) => void;
export type Unsubscribe = () => void;

export interface ISocketPort {
  send(msg: ClientMessage): void;
  on(handler: SocketEventHandler): Unsubscribe;
  close(): void;
}
