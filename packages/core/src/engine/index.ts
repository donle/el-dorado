/**
 * engine/index — barrel for the engine module. The monolithic engine.ts has
 * been split into helpers / movement / buying / hand / abilities / discard /
 * turn / dispatch; this file preserves the public surface (`applyAction`).
 */
export { applyAction } from './dispatch.js';