import type { ILogger } from './ports.js';

export class ConsoleLogger implements ILogger {
  info(msg: string, ctx?: object): void {
    console.log(JSON.stringify({ level: 'info', msg, ctx, t: Date.now() }));
  }
  warn(msg: string, ctx?: object): void {
    console.warn(JSON.stringify({ level: 'warn', msg, ctx, t: Date.now() }));
  }
  error(msg: string, ctx?: object): void {
    console.error(JSON.stringify({ level: 'error', msg, ctx, t: Date.now() }));
  }
}

export class NoopLogger implements ILogger {
  info(): void { /* no-op */ }
  warn(): void { /* no-op */ }
  error(): void { /* no-op */ }
}
