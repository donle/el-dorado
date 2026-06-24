/**
 * Cross-cutting ports shared by the client.
 *
 * Currently houses the `IAssetLoader` port — Stage 2 introduced it to move
 * asset preloading out of `main.ts`. Future stages may add more ports here.
 */

export type ProgressFn = (loaded: number, total: number) => void;

export interface IAssetLoader {
  preloadAll(progress: ProgressFn): Promise<void>;
}