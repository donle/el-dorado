import type { ClientMessage, ServerMessage } from '@eldorado/core';
import type { IClientChannel } from '../shared/ports.js';
import { decodeClient } from './protocolCodec.js';

export type MessageHandler = (connId: string, msg: ClientMessage) => void | Promise<void>;

/**
 * Routes incoming ClientMessages by `type` to registered handlers. Outbound
 * errors use `IClientChannel.send` so the channel implementation (and only
 * the channel) owns framing.
 */
export class MessageRouter {
  private handlers = new Map<ClientMessage['type'], MessageHandler>();

  constructor(private readonly channel: IClientChannel) {}

  on(type: ClientMessage['type'], handler: MessageHandler): void {
    this.handlers.set(type, handler);
  }

  async handle(connId: string, raw: string): Promise<void> {
    let msg: ClientMessage;
    try {
      msg = decodeClient(raw);
    } catch {
      this.channel.send(connId, { type: 'error', message: '消息格式错误' });
      return;
    }
    const h = this.handlers.get(msg.type);
    if (!h) {
      this.channel.send(connId, { type: 'error', message: `未知消息类型: ${msg.type}` });
      return;
    }
    try {
      await h(connId, msg);
    } catch (e) {
      const message = e instanceof Error ? e.message : '未知错误';
      this.channel.send(connId, { type: 'error', message });
    }
  }

  /** Encode a ServerMessage for the channel; thin wrapper kept for symmetry. */
  encode(msg: ServerMessage): string {
    return JSON.stringify(msg);
  }
}
