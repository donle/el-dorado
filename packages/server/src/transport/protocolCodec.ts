import type { ClientMessage, ServerMessage } from '@eldorado/core';

export function encodeServer(msg: ServerMessage): string {
  return JSON.stringify(msg);
}

export function decodeClient(raw: string): ClientMessage {
  return JSON.parse(raw) as ClientMessage;
}
