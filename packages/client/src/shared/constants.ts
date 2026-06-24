/**
 * Shared dimensions and timings for the 3D board.
 *
 * P1 typed: every value here is a primitive. No Three.js objects, no closures.
 * Scene / camera code reads from these; tweak a value here once to retune
 * the whole board.
 */

/** Hex radius in world units. */
export const HEX_SIZE = 1;

/** Gap between adjacent hexes (1 = no gap, < 1 = overlap). */
export const HEX_GAP = 0.94;

/** Max renderer pixel ratio on desktop GPUs. */
export const DESKTOP_MAX_PIXEL_RATIO = 1.25;

/** Max renderer pixel ratio on low-end mobile GPUs. */
export const LOW_GPU_MAX_PIXEL_RATIO = 1;

/** Idle-animation frame interval in ms (when nothing is moving). */
export const IDLE_ANIMATION_FRAME_MS = 1000 / 8;

/** Frame interval in ms when the tab is hidden. */
export const HIDDEN_TAB_FRAME_MS = 1000;

/** Camera polar angle used to fake a perfectly top-down 2D view. */
export const TOP_DOWN_POLAR = 0.001;

/** Distance scale applied to the start-continent camera fit. */
export const START_CONTINENT_DISTANCE_SCALE = 1.22;

/** Camera intro animation duration. */
export const START_CAMERA_ANIMATION_MS = 1300;

/** Terminal (El Dorado) plateau height in world units. */
export const TERMINAL_HEIGHT = 0.68;

/** Per-step darkening applied to a hex top when its cost > 1. */
export const TERRAIN_DEMAND_DARKEN_STEP = 0.22;

/** Floor on the demand-darken factor (0 = pitch black, 1 = no darken). */
export const TERRAIN_DEMAND_DARKEN_MIN = 0.38;

/** Cost-label canvas resolution (square). */
export const COST_LABEL_SIZE = 160;

/** Per-icon draw size inside a cost label. */
export const COST_ICON_DRAW_SIZE = 60;

/** Width of a blockade strip in world units. */
export const BLOCKADE_WIDTH = 0.74;

/** Height (thickness) of a blockade strip in world units. */
export const BLOCKADE_HEIGHT = 0.16;

/** Vertical offset (px) of the cost icon inside a blockade label. */
export const BLOCKADE_LABEL_ICON_Y_OFFSET = 8;

/** Self-piece arrow total length. */
export const SELF_ARROW_LENGTH = 0.78;

/** Self-piece arrow head length. */
export const SELF_ARROW_HEAD_LENGTH = 0.32;

/** Self-piece arrow shaft length. */
export const SELF_ARROW_SHAFT_LENGTH = SELF_ARROW_LENGTH - SELF_ARROW_HEAD_LENGTH;

/** Height at which the self-piece arrow hovers above the pawn. */
export const SELF_ARROW_BASE_Y = 2.02;

/** Vertical bob amplitude for the self-piece arrow. */
export const SELF_ARROW_BOB = 0.14;

/** Extra lift applied to a pawn on a mountain hex. */
export const MOUNTAIN_PAWN_LANDING_LIFT = 0.9;
