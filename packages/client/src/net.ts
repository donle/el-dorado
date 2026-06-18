import type { ClientMessage, ServerMessage } from '@eldorado/core';

/** Thin typed WebSocket client with auto-reconnect-on-demand. */
export class Net {
  private ws: WebSocket | null = null;
  private queue: ClientMessage[] = [];
  onMessage: (msg: ServerMessage) => void = () => {};
  onOpen: () => void = () => {};

  connect(): void {
    const url =
      import.meta.env.DEV
        ? `ws://${location.hostname}:8787`
        : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.queue.forEach((m) => ws.send(JSON.stringify(m)));
      this.queue = [];
      this.onOpen();
    };
    ws.onmessage = (ev) => {
      try {
        this.onMessage(JSON.parse(ev.data) as ServerMessage);
      } catch {
        /* ignore malformed */
      }
    };
    ws.onclose = () => {
      this.ws = null;
    };
  }

  send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      this.queue.push(msg);
      if (!this.ws) this.connect();
    }
  }
}
