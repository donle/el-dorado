import type { ClientMessage, ServerMessage } from '@eldorado/core';

export function encodeMessage(msg: ClientMessage): string {
  return JSON.stringify(msg);
}

export function decodeMessage(raw: string): ServerMessage {
  return JSON.parse(raw) as ServerMessage;
}
