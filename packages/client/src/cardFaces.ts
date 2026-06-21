import { getDef, type CardDef, type CardKind, type MoveSymbol } from '@eldorado/core';

const KIND_COLOR: Record<CardKind, string> = {
  green: '#2f7a45',
  blue: '#2766a8',
  yellow: '#b8902f',
  joker: '#7253b7',
  action: '#b54a68',
};

const TERRAIN_COLOR: Record<MoveSymbol, string> = {
  machete: '#2f7a45',
  paddle: '#2766a8',
  coin: '#d4a629',
};

function titleLines(name: string): string[] {
  const words = name.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > 18 && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  if (lines.length <= 2) return lines;
  return [lines[0], lines.slice(1).join(' ')];
}

function titleSvg(name: string): string {
  const lines = titleLines(name);
  const y = lines.length === 1 ? 27 : 21;
  return `<text text-anchor="middle" font-family="Georgia, serif" font-weight="850" fill="#fff7dd"
    stroke="rgba(0,0,0,0.48)" stroke-width="1.1" paint-order="stroke" font-size="${lines.length === 1 ? 17 : 13.5}">
    ${lines.map((line, i) => `<tspan x="90" y="${y + i * 14}">${escapeSvg(line)}</tspan>`).join('')}
  </text>`;
}

function terrainSymbols(def: CardDef): MoveSymbol[] {
  if (def.kind === 'joker') return ['machete', 'paddle', 'coin'];
  if (def.symbol) return [def.symbol];
  return [];
}

function terrainIcon(symbol: MoveSymbol, y: number, svgId: string): string {
  const fill = TERRAIN_COLOR[symbol];
  return `<g transform="translate(10 ${y})">
    <circle cx="20" cy="20" r="16" fill="url(#${svgId}-icon-${symbol})" stroke="#fff6d8" stroke-width="1.5"/>
    <circle cx="20" cy="20" r="16" fill="${fill}" fill-opacity="0.12"/>
    <circle cx="20" cy="20" r="18.5" fill="none" stroke="rgba(0,0,0,0.42)" stroke-width="2.4"/>
  </g>`;
}

function terrainStrip(def: CardDef, svgId: string): string {
  if (def.ability === 'native') return nativeBadge();
  return terrainSymbols(def)
    .map((symbol, i) => terrainIcon(symbol, 44 + i * 34, svgId))
    .join('');
}

function movementAmount(def: CardDef): number {
  return def.power;
}

function powerBadge(def: CardDef): string {
  const amount = movementAmount(def);
  if (!amount) return '';
  return `<g transform="translate(33 42)">
    <circle cx="13" cy="13" r="12" fill="rgba(11,12,16,0.8)" stroke="#fff6d8" stroke-width="1.5"/>
    <text x="13" y="20" text-anchor="middle" font-family="Georgia, serif" font-size="20" font-weight="950" fill="#fff6d8"
      stroke="rgba(0,0,0,0.5)" stroke-width="1" paint-order="stroke">${amount}</text>
  </g>`;
}

function costBadge(def: CardDef, svgId: string): string {
  if (def.starting) {
    return '';
  }
  return `<g transform="translate(132 202)">
    <circle cx="20" cy="20" r="16" fill="url(#${svgId}-icon-coin)" stroke="#fff6d8" stroke-width="1.5"/>
    <circle cx="20" cy="20" r="16" fill="#f4c64a" opacity="0.25"/>
    <circle cx="20" cy="20" r="18.5" fill="none" stroke="rgba(0,0,0,0.42)" stroke-width="2.4"/>
    <text x="20" y="27" text-anchor="middle" font-family="Georgia, serif" font-size="20" font-weight="900" fill="#fff1b8"
      stroke="#5a3306" stroke-width="2" paint-order="stroke">${def.cost}</text>
  </g>`;
}

function singleUseBadge(def: CardDef, svgId: string): string {
  if (!def.singleUse) return '';
  return `<g transform="translate(10 202)">
    <circle cx="20" cy="20" r="16" fill="url(#${svgId}-icon-single-use)" stroke="#fff6d8" stroke-width="1.5"/>
    <circle cx="20" cy="20" r="16" fill="#b32a43" opacity="0.16"/>
    <circle cx="20" cy="20" r="18.5" fill="none" stroke="rgba(0,0,0,0.42)" stroke-width="2.4"/>
  </g>`;
}

function nativeBadge(): string {
  return `<image x="7" y="41" width="46" height="46" href="/card-icons/native-move.png" preserveAspectRatio="xMidYMid meet" aria-label="无视地形移动 1 格"/>`;
}

function artHref(def: CardDef): string {
  return `/cards/${def.defId}.jpg`;
}

function iconHref(symbol: MoveSymbol): string {
  return `/card-icons/${symbol}.jpg`;
}

function singleUseHref(): string {
  return '/card-icons/single_use.jpg';
}

/** Full card face: generated raster artwork as the card base with compact overlays. */
export function cardFace(defOrId: CardDef | string): string {
  const def = typeof defOrId === 'string' ? getDef(defOrId) : defOrId;
  const id = `card-face-${def.defId.replace(/[^a-z0-9_-]/gi, '-')}`;
  const kindColor = KIND_COLOR[def.kind] ?? '#777';

  return `<svg class="card-face-svg" viewBox="0 0 180 250" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeSvg(
    def.name,
  )}卡牌">
    <defs>
      <clipPath id="${id}-clip">
        <rect x="4" y="4" width="172" height="242" rx="14"/>
      </clipPath>
      <pattern id="${id}-icon-machete" patternUnits="objectBoundingBox" width="1" height="1" viewBox="0 0 128 128" preserveAspectRatio="xMidYMid slice">
        <image width="128" height="128" href="${iconHref('machete')}" preserveAspectRatio="xMidYMid slice"/>
      </pattern>
      <pattern id="${id}-icon-paddle" patternUnits="objectBoundingBox" width="1" height="1" viewBox="0 0 128 128" preserveAspectRatio="xMidYMid slice">
        <image width="128" height="128" href="${iconHref('paddle')}" preserveAspectRatio="xMidYMid slice"/>
      </pattern>
      <pattern id="${id}-icon-coin" patternUnits="objectBoundingBox" width="1" height="1" viewBox="0 0 128 128" preserveAspectRatio="xMidYMid slice">
        <image width="128" height="128" href="${iconHref('coin')}" preserveAspectRatio="xMidYMid slice"/>
      </pattern>
      <pattern id="${id}-icon-single-use" patternUnits="objectBoundingBox" width="1" height="1" viewBox="0 0 128 128" preserveAspectRatio="xMidYMid slice">
        <image width="128" height="128" href="${singleUseHref()}" preserveAspectRatio="xMidYMid slice"/>
      </pattern>
      <linearGradient id="${id}-name" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#000000" stop-opacity="0.78"/>
        <stop offset="0.78" stop-color="#000000" stop-opacity="0.42"/>
        <stop offset="1" stop-color="#000000" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="${id}-bottom" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0" stop-color="#000000" stop-opacity="0.58"/>
        <stop offset="1" stop-color="#000000" stop-opacity="0"/>
      </linearGradient>
    </defs>

    <rect width="180" height="250" rx="16" fill="#0b0b0b"/>
    <g clip-path="url(#${id}-clip)">
      <image x="4" y="4" width="172" height="242" href="${artHref(def)}" preserveAspectRatio="xMidYMid slice"/>
      <rect x="4" y="4" width="172" height="65" fill="url(#${id}-name)"/>
      <rect x="4" y="165" width="172" height="81" fill="url(#${id}-bottom)"/>
      <rect x="4" y="4" width="172" height="242" fill="none" stroke="${kindColor}" stroke-width="8" stroke-opacity="0.55"/>
      ${titleSvg(def.name)}
      ${terrainStrip(def, id)}
      ${powerBadge(def)}
      ${singleUseBadge(def, id)}
      ${costBadge(def, id)}
    </g>
    <rect x="4" y="4" width="172" height="242" rx="14" fill="none" stroke="#fff7dd" stroke-opacity="0.55" stroke-width="2"/>
    <rect x="1.5" y="1.5" width="177" height="247" rx="16" fill="none" stroke="rgba(0,0,0,0.85)" stroke-width="3"/>
  </svg>`;
}

function escapeSvg(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}
