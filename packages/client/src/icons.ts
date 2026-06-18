/**
 * Original, code-drawn SVG card illustrations — concrete little pictures, no
 * external or copyrighted artwork. viewBox is 0 0 64 64.
 */
import { getDef, type CardDef } from '@eldorado/core';

const TINT: Record<string, string> = {
  green: '#2f7a45',
  blue: '#2766a8',
  yellow: '#b8902f',
  joker: '#7e57d6',
  action: '#c2476a',
};

function frame(body: string, tint: string): string {
  return `<svg viewBox="0 0 64 64" width="100%" height="100%">
    <rect x="3" y="3" width="58" height="58" rx="13" fill="${tint}" opacity="0.16"/>
    <rect x="3" y="3" width="58" height="58" rx="13" fill="none" stroke="${tint}" stroke-opacity="0.4"/>
    ${body}</svg>`;
}

const ART: Record<string, string> = {
  machete: `
    <path d="M12 53 L25 40" stroke="#6e4824" stroke-width="8" stroke-linecap="round"/>
    <path d="M12 53 L25 40" stroke="#a06a36" stroke-width="4" stroke-linecap="round"/>
    <path d="M23 42 C35 30 47 20 56 14 C58 21 54 32 44 41 C38 46 30 47 24 46 Z"
      fill="#d2d9e2" stroke="#8b95a2" stroke-width="1.5"/>
    <path d="M27 43 C37 34 47 25 54 19" stroke="#f1f5fa" stroke-width="2" fill="none"/>
    <path d="M16 45 C8 44 5 38 5 31 C13 32 17 38 18 45 Z" fill="#3fa65a" stroke="#2c7a42" stroke-width="1"/>`,
  paddle: `
    <rect x="29" y="7" width="6" height="33" rx="3" fill="#a06a36"/>
    <rect x="30.5" y="7" width="2" height="33" fill="#c89a5e"/>
    <path d="M32 36 C21 39 19 52 32 59 C45 52 43 39 32 36 Z" fill="#b6783e" stroke="#6e4824" stroke-width="1.5"/>
    <line x1="32" y1="39" x2="32" y2="57" stroke="#6e4824" stroke-width="1.3"/>
    <path d="M8 60 q7 -5 13 0 t13 0 t13 0" stroke="#5fb0ef" stroke-width="2.2" fill="none" opacity="0.85"/>`,
  coin: `
    <ellipse cx="32" cy="47" rx="17" ry="6" fill="#c79a2e"/>
    <ellipse cx="32" cy="43" rx="17" ry="6" fill="#f4c64a" stroke="#c79a2e" stroke-width="1.5"/>
    <circle cx="32" cy="25" r="14" fill="#f4c64a" stroke="#c79a2e" stroke-width="2"/>
    <circle cx="32" cy="25" r="9" fill="none" stroke="#c79a2e" stroke-width="1.4" opacity="0.6"/>
    <path d="M32 18 l2 4.5 5 .6 -3.6 3.4 1 5 -4.4 -2.4 -4.4 2.4 1 -5 -3.6 -3.4 5 -.6 Z" fill="#c79a2e"/>
    <ellipse cx="27" cy="21" rx="3" ry="2" fill="#fff3c4" opacity="0.7"/>`,
  joker: `
    <path d="M32 16 C20 18 15 31 15 41 L49 41 C49 31 44 18 32 16 Z" fill="#7e57d6"/>
    <path d="M15 41 C9 43 6 49 6 54 C12 53 16 49 18 43 Z" fill="#b98cff"/>
    <path d="M49 41 C55 43 58 49 58 54 C52 53 48 49 46 43 Z" fill="#5fb0ef"/>
    <path d="M32 16 C29 10 30 4 32 2 C34 4 35 10 32 16 Z" fill="#f0cf5a"/>
    <rect x="14" y="40" width="36" height="6" rx="3" fill="#fff" opacity="0.85"/>
    <circle cx="6" cy="56" r="3.2" fill="#f0cf5a"/><circle cx="58" cy="56" r="3.2" fill="#5fb0ef"/><circle cx="32" cy="2" r="3" fill="#e0567f"/>`,
  compass: `
    <circle cx="32" cy="33" r="20" fill="#1b2740" stroke="#cdd6e2" stroke-width="2"/>
    <g stroke="#cdd6e2" stroke-width="1.6"><line x1="32" y1="15" x2="32" y2="19"/><line x1="32" y1="47" x2="32" y2="51"/><line x1="14" y1="33" x2="18" y2="33"/><line x1="46" y1="33" x2="50" y2="33"/></g>
    <path d="M32 33 L38 21 L32 31 Z" fill="#e0567f"/>
    <path d="M32 33 L26 45 L32 35 Z" fill="#cdd6e2"/>
    <circle cx="32" cy="33" r="3" fill="#f0cf5a"/>`,
  flask: `
    <path d="M27 12 L27 27 L15 49 Q13 56 22 56 L42 56 Q51 56 49 49 L37 27 L37 12 Z"
      fill="#dff2ff" fill-opacity="0.3" stroke="#bcd6ea" stroke-width="2"/>
    <path d="M19 42 L18 49 Q17 53 22 53 L42 53 Q47 53 46 49 L45 42 Z" fill="#5ed17a"/>
    <rect x="24" y="9" width="16" height="4" rx="2" fill="#9aa2ad"/>
    <circle cx="27" cy="47" r="1.6" fill="#fff" opacity="0.85"/><circle cx="34" cy="49" r="1.2" fill="#fff" opacity="0.85"/>`,
  map: `
    <path d="M10 18 L26 14 L42 18 L54 14 L54 48 L38 52 L22 48 L10 52 Z" fill="#efe2c0" stroke="#b9a77a" stroke-width="2"/>
    <path d="M26 14 L26 48 M42 18 L42 52" stroke="#b9a77a" stroke-width="1.4"/>
    <path d="M16 42 Q26 32 34 36 T49 24" stroke="#c0563f" stroke-width="2" fill="none" stroke-dasharray="3 3"/>
    <path d="M45 20 l5 5 M50 20 l-5 5" stroke="#c0563f" stroke-width="2.4"/>`,
  book: `
    <path d="M32 17 C26 13 18 14 12 17 L12 49 C18 46 26 45 32 49 C38 45 46 46 52 49 L52 17 C46 14 38 13 32 17 Z"
      fill="#c98b5a" stroke="#7e4f2a" stroke-width="2"/>
    <path d="M32 17 L32 49" stroke="#7e4f2a" stroke-width="1.6"/>
    <path d="M16 24 L28 22 M16 30 L28 28 M36 22 L48 24 M36 28 L48 30" stroke="#7e4f2a" stroke-width="1" opacity="0.6"/>`,
  tower: `
    <path d="M22 52 L32 14 L42 52 Z" fill="none" stroke="#cdd6e2" stroke-width="2.6"/>
    <path d="M25 42 L39 42 M27 33 L37 33" stroke="#cdd6e2" stroke-width="1.6"/>
    <circle cx="32" cy="13" r="2.6" fill="#e0567f"/>
    <path d="M24 11 a11 11 0 0 1 16 0" stroke="#e0567f" fill="none" stroke-width="1.7" opacity="0.85"/>
    <path d="M19 7 a17 17 0 0 1 26 0" stroke="#e0567f" fill="none" stroke-width="1.4" opacity="0.5"/>`,
  native: `
    <line x1="47" y1="9" x2="47" y2="53" stroke="#9c6b3f" stroke-width="2.4"/>
    <path d="M47 7 l-3.5 7 7 0 Z" fill="#cdd6e2"/>
    <path d="M32 14 L34 4 L36 14 Z" fill="#e0567f"/><path d="M28 15 L29 7 L33 14 Z" fill="#f0cf5a"/>
    <circle cx="32" cy="21" r="7.5" fill="#d8a06a" stroke="#9c6b3f" stroke-width="1.5"/>
    <path d="M19 54 C19 37 45 37 45 54 Z" fill="#3fa65a" stroke="#2c7a42" stroke-width="1.5"/>`,
  gear: `
    <circle cx="32" cy="32" r="13" fill="none" stroke="#cdd6e2" stroke-width="3"/>
    <circle cx="32" cy="32" r="4" fill="#cdd6e2"/>
    <g stroke="#cdd6e2" stroke-width="3" stroke-linecap="round">
      <line x1="32" y1="14" x2="32" y2="19"/><line x1="32" y1="45" x2="32" y2="50"/>
      <line x1="14" y1="32" x2="19" y2="32"/><line x1="45" y1="32" x2="50" y2="32"/></g>`,
};

const ABILITY_ART: Record<string, string> = {
  draw3: 'compass',
  draw2_remove2: 'book',
  take_free: 'tower',
  native: 'native',
  draw2: 'map',
  draw1_remove1: 'flask',
};

/** SVG markup illustrating a card definition (or def id). */
export function cardIcon(defOrId: CardDef | string): string {
  const def = typeof defOrId === 'string' ? getDef(defOrId) : defOrId;
  const tint = TINT[def.kind] ?? '#888';
  let key = 'gear';
  if (def.kind === 'joker') key = 'joker';
  else if (def.kind === 'action') key = (def.ability && ABILITY_ART[def.ability]) || 'gear';
  else if (def.symbol) key = def.symbol;
  return frame(ART[key] ?? ART.gear, tint);
}
