/**
 * ai/index — barrel for the AI planner module. The monolithic ai.ts has
 * been split into helpers / pathfinding / market / planner; this file
 * preserves the public surface (`planTurn`).
 */
export { planTurn } from './planner.js';