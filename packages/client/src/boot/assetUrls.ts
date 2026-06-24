import { CARD_DEFS, type AssetCategory } from '@eldorado/core';

/**
 * All assets preloaded at boot, grouped by category.
 *
 * - `terrain`: terrain-realistic textures
 * - `card`: per-card-face images (card-back + each defId)
 * - `card-icon`: action card / move-symbol icons
 * - `ui`: lobby / loading backgrounds, golden-city ground texture
 * - `icon`: generic UI icons (reserved)
 * - `pwa`: PWA icon set used by the manifest
 *
 * Categories are closed (`AssetCategory` union) — every category MUST appear
 * even if its list is empty, per P1.
 */
export const BOOT_ASSET_URLS: Record<AssetCategory, string[]> = {
  terrain: [
    '/textures/terrain-realistic/green.jpg',
    '/textures/terrain-realistic/blue.jpg',
    '/textures/terrain-realistic/yellow.jpg',
    '/textures/terrain-realistic/rubble.jpg',
    '/textures/terrain-realistic/basecamp.jpg',
    '/textures/terrain-realistic/mountain.jpg',
    '/textures/terrain-realistic/start.jpg',
    '/textures/terrain-realistic/finish.jpg',
    '/textures/terrain-realistic/eldorado.jpg',
  ],
  card: [
    '/cards/card-back.jpg',
    ...Object.keys(CARD_DEFS).map((id) => `/cards/${id}.jpg`),
  ],
  'card-icon': [
    '/card-icons/machete.jpg',
    '/card-icons/paddle.jpg',
    '/card-icons/coin.jpg',
    '/card-icons/discard.jpg',
    '/card-icons/remove.jpg',
    '/card-icons/single_use.jpg',
    '/card-icons/native-move.png',
  ],
  ui: [
    '/ui/loading-table.jpg',
    '/ui/lobby-hero.jpg',
    '/ui/lobby-props.jpg',
    '/ui/turn-intro-tomb.jpg',
    '/textures/golden-city-ground.jpg',
  ],
  icon: [],
  pwa: ['/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-512-maskable.png'],
};