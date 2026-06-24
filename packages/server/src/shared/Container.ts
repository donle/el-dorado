/**
 * Hand-written DI container. ~60 lines; no runtime deps.
 *
 * Mirror of `packages/client/src/shared/Container.ts`. Kept as a copy (no
 * shared module) so server and client can each evolve their DI tokens
 * independently.
 */
export type Token<T> = symbol | (new (...args: never[]) => T);

const keyOf = (token: Token<unknown>): symbol =>
  typeof token === 'symbol' ? token : Symbol.for(token.name);

export class Container {
  private singletons = new Map<symbol, unknown>();
  private factories = new Map<symbol, () => unknown>();

  register<T>(token: Token<T>, factory: () => T): void {
    this.factories.set(keyOf(token), factory);
  }

  registerSingleton<T>(token: Token<T>, instance: T): void {
    this.singletons.set(keyOf(token), instance);
  }

  resolve<T>(token: Token<T>): T {
    const k = keyOf(token);
    const singleton = this.singletons.get(k);
    if (singleton !== undefined) return singleton as T;
    const f = this.factories.get(k);
    if (!f) throw new Error(`No binding for ${String(k.description ?? k.toString())}`);
    const inst = f();
    this.singletons.set(k, inst);
    return inst as T;
  }
}
