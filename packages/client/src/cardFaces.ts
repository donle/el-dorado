import { getDef, type AbilityType, type CardDef, type CardKind, type MoveSymbol } from '@eldorado/core';

type Palette = {
  base: string;
  deep: string;
  pale: string;
  accent: string;
  washA: string;
  washB: string;
};

const PALETTE: Record<CardKind, Palette> = {
  green: {
    base: '#2f7a45',
    deep: '#173f29',
    pale: '#dceecf',
    accent: '#76b65b',
    washA: '#5b8f4c',
    washB: '#173f29',
  },
  blue: {
    base: '#2766a8',
    deep: '#153756',
    pale: '#d9eff8',
    accent: '#66b8d6',
    washA: '#3f92c5',
    washB: '#153756',
  },
  yellow: {
    base: '#b8902f',
    deep: '#684a16',
    pale: '#f6e3aa',
    accent: '#f0c44f',
    washA: '#d7b153',
    washB: '#6d4c19',
  },
  joker: {
    base: '#7253b7',
    deep: '#31204f',
    pale: '#e8dcff',
    accent: '#b98cff',
    washA: '#8d78c8',
    washB: '#31204f',
  },
  action: {
    base: '#b54a68',
    deep: '#542030',
    pale: '#f4d9df',
    accent: '#e6788d',
    washA: '#be6774',
    washB: '#542030',
  },
};

const SYMBOL_LABEL: Record<MoveSymbol, string> = {
  machete: 'MACHETE',
  paddle: 'PADDLE',
  coin: 'COIN',
};

const KIND_LABEL: Record<CardKind, string> = {
  green: 'Jungle',
  blue: 'River',
  yellow: 'Village',
  joker: 'Wild',
  action: 'Action',
};

const ABILITY_LABEL: Record<AbilityType, string> = {
  draw2: 'DRAW 2',
  draw1_remove1: 'DRAW 1 / TRIM',
  draw3: 'DRAW 3',
  draw2_remove2: 'LOG / TRIM',
  take_free: 'MARKET',
  native: 'GUIDE',
};

const CARD_TAGLINE: Record<string, string> = {
  explorer: 'Cuts the first path',
  traveller: 'Ready for the road',
  sailor: 'Steady on the river',
  scout: 'Sees the trail ahead',
  trailblazer: 'Opens dense jungle',
  pioneer: 'Pushes through danger',
  giant_machete: 'One sweeping strike',
  captain: 'Commands the current',
  photographer: 'Finds value in the wild',
  journalist: 'Turns stories into coin',
  treasure_chest: 'A glittering cache',
  millionaire: 'Funds the expedition',
  jack: 'Any tool at hand',
  adventurer: 'Prepared for anything',
  prop_plane: 'Over the canopy',
  cartographer: 'Maps the route',
  scientist: 'Studies every clue',
  compass: 'Points to fortune',
  travel_log: 'Lessons from the trail',
  transmitter: 'Calls in supplies',
  native: 'Knows the hidden way',
};

const riverWaves = `
  <path d="M13 145 C35 134 51 151 72 140 C91 130 109 148 130 137 C145 130 155 132 169 139 L169 177 L13 177 Z"
    fill="#2d83b8" opacity="0.82"/>
  <path d="M16 153 C34 145 50 158 68 150 T116 149 T166 151" fill="none" stroke="#bde9f8" stroke-width="3" opacity="0.82"/>
  <path d="M28 164 C45 156 61 169 78 161 T126 160 T158 163" fill="none" stroke="#bde9f8" stroke-width="2" opacity="0.5"/>`;

const jungleCanopy = `
  <path d="M13 70 C28 51 48 59 57 73 C72 44 107 48 116 76 C135 55 158 61 169 82 L169 46 L13 46 Z"
    fill="#235d36"/>
  <path d="M16 174 C24 148 42 132 67 124 C87 117 113 120 132 132 C151 144 162 158 169 174 Z"
    fill="#244c2e" opacity="0.9"/>
  <path d="M20 111 C36 93 56 98 67 118 C86 86 117 91 122 122 C138 100 159 106 166 130"
    fill="none" stroke="#6dbb58" stroke-width="8" stroke-linecap="round" opacity="0.6"/>`;

const trail = `
  <path d="M72 176 C68 154 77 138 92 123 C103 112 113 96 104 75 L130 75 C145 106 128 126 113 140 C101 152 100 163 112 176 Z"
    fill="#c99b58" opacity="0.92"/>
  <path d="M83 176 C80 158 88 145 101 132 C112 121 122 107 116 84" fill="none" stroke="#f1d18b" stroke-width="3" opacity="0.55"/>`;

const sun = `
  <circle cx="145" cy="67" r="13" fill="#ffe08a" opacity="0.9"/>
  <circle cx="145" cy="67" r="22" fill="#ffe08a" opacity="0.18"/>`;

const SCENES: Record<string, string> = {
  explorer: `
    ${jungleCanopy}
    ${trail}
    <circle cx="78" cy="96" r="12" fill="#c9975f"/>
    <path d="M63 91 C68 79 89 78 95 91 Z" fill="#6c4b2a"/>
    <path d="M57 92 L99 92" stroke="#2e241b" stroke-width="4" stroke-linecap="round"/>
    <path d="M66 174 C68 143 74 116 88 106 C101 118 109 144 113 174 Z" fill="#e6c27d"/>
    <path d="M88 109 L95 139 L84 139 Z" fill="#2f7a45"/>
    <path d="M109 128 L143 91" stroke="#d9dee5" stroke-width="7" stroke-linecap="round"/>
    <path d="M112 127 L145 94" stroke="#f8fbff" stroke-width="2" stroke-linecap="round"/>
    <path d="M57 131 C43 123 35 111 31 96" fill="none" stroke="#9a6a37" stroke-width="5" stroke-linecap="round"/>`,

  traveller: `
    ${sun}
    <path d="M13 123 C39 97 60 112 80 91 C100 70 125 82 169 53 L169 177 L13 177 Z" fill="#5d8d42"/>
    ${trail}
    <circle cx="88" cy="92" r="10" fill="#c9975f"/>
    <path d="M74 91 C79 80 96 80 103 91 Z" fill="#5b3923"/>
    <path d="M80 170 C83 140 90 113 100 101 C111 114 118 140 121 170 Z" fill="#48669a"/>
    <rect x="67" y="111" width="20" height="33" rx="7" fill="#7b4d2f"/>
    <path d="M101 119 L128 109" stroke="#6a4327" stroke-width="5" stroke-linecap="round"/>
    <path d="M67 135 L46 152" stroke="#6a4327" stroke-width="4" stroke-linecap="round"/>`,

  sailor: `
    ${riverWaves}
    <path d="M14 94 C37 76 57 86 79 72 C111 51 140 62 169 49 L169 138 C138 123 115 122 91 132 C62 144 38 131 14 146 Z"
      fill="#3e7f51"/>
    <path d="M50 139 C67 126 112 126 130 139 C119 154 64 154 50 139 Z" fill="#9b6335" stroke="#5c3a21" stroke-width="2"/>
    <rect x="70" y="116" width="38" height="16" rx="8" fill="#e5c686"/>
    <circle cx="89" cy="101" r="9" fill="#c9975f"/>
    <path d="M78 99 C83 90 98 90 103 99 Z" fill="#28405f"/>
    <path d="M101 111 L133 158" stroke="#7b4d2f" stroke-width="5" stroke-linecap="round"/>
    <path d="M130 154 C142 155 148 164 142 173 C130 169 125 162 130 154 Z" fill="#c28b4b"/>`,

  scout: `
    ${jungleCanopy}
    <path d="M13 147 C43 132 68 138 91 122 C118 103 139 118 169 105 L169 177 L13 177 Z" fill="#4f7c3f"/>
    <circle cx="89" cy="87" r="10" fill="#c9975f"/>
    <path d="M74 88 C79 75 99 75 106 88 Z" fill="#4d3b25"/>
    <path d="M73 171 C75 132 81 104 91 96 C103 106 111 133 116 171 Z" fill="#486a36"/>
    <rect x="73" y="81" width="13" height="9" rx="4" fill="#1a2230"/>
    <rect x="91" y="81" width="13" height="9" rx="4" fill="#1a2230"/>
    <path d="M86 85 L91 85" stroke="#1a2230" stroke-width="3"/>
    <path d="M72 114 L47 103 M108 114 L131 100" stroke="#7c5434" stroke-width="5" stroke-linecap="round"/>
    <path d="M132 93 L144 84" stroke="#d9dee5" stroke-width="4" stroke-linecap="round"/>`,

  trailblazer: `
    ${jungleCanopy}
    ${trail}
    <path d="M24 86 C43 113 48 139 43 176" fill="none" stroke="#1d512f" stroke-width="11" stroke-linecap="round"/>
    <path d="M155 85 C130 116 128 143 139 176" fill="none" stroke="#1d512f" stroke-width="11" stroke-linecap="round"/>
    <circle cx="91" cy="93" r="10" fill="#c9975f"/>
    <path d="M76 93 C82 82 100 81 107 93 Z" fill="#714c27"/>
    <path d="M74 174 C76 139 83 113 93 102 C106 113 114 140 117 174 Z" fill="#9b6a3f"/>
    <path d="M109 119 C127 106 140 90 148 75" fill="none" stroke="#d9dee5" stroke-width="7" stroke-linecap="round"/>
    <path d="M112 116 C95 133 74 139 49 139" fill="none" stroke="#e1e6ed" stroke-width="4" stroke-linecap="round"/>`,

  pioneer: `
    ${sun}
    <path d="M13 130 L47 86 L73 125 L101 73 L139 130 L169 96 L169 177 L13 177 Z" fill="#415a45"/>
    <path d="M35 142 C65 121 109 120 145 142 L169 177 L13 177 Z" fill="#285233"/>
    <path d="M35 150 C66 136 104 137 140 151" stroke="#b78343" stroke-width="4" fill="none" stroke-dasharray="6 7"/>
    <circle cx="88" cy="86" r="11" fill="#c9975f"/>
    <path d="M72 87 C80 73 99 73 106 87 Z" fill="#6c4b2a"/>
    <path d="M66 174 C70 134 79 106 91 96 C106 108 116 136 121 174 Z" fill="#465f8d"/>
    <path d="M62 126 L44 108" stroke="#7a4f2a" stroke-width="5" stroke-linecap="round"/>
    <path d="M113 126 L146 89" stroke="#dfe4ea" stroke-width="8" stroke-linecap="round"/>
    <path d="M117 123 L149 92" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>`,

  giant_machete: `
    ${jungleCanopy}
    <path d="M23 149 C58 129 102 134 159 108 C158 139 136 166 96 174 C66 180 42 168 23 149 Z"
      fill="#d8dee7" stroke="#87919e" stroke-width="3"/>
    <path d="M42 151 C78 138 113 138 151 117" stroke="#ffffff" stroke-width="4" fill="none" opacity="0.75"/>
    <path d="M18 166 L58 139" stroke="#6b4226" stroke-width="12" stroke-linecap="round"/>
    <path d="M20 166 L58 140" stroke="#b47b42" stroke-width="5" stroke-linecap="round"/>
    <path d="M35 92 C22 98 18 111 20 127 C35 125 45 115 48 99 Z" fill="#62ad50"/>
    <path d="M138 72 C153 79 162 93 163 110 C147 107 136 94 133 78 Z" fill="#76b65b"/>`,

  captain: `
    ${riverWaves}
    <path d="M13 98 C48 77 79 90 106 73 C128 59 149 59 169 53 L169 137 C143 128 119 124 92 134 C61 146 35 133 13 146 Z" fill="#477c47"/>
    <path d="M39 143 L50 118 L132 118 L144 143 C122 157 66 157 39 143 Z" fill="#8f5a2f" stroke="#5c3a21" stroke-width="2"/>
    <rect x="65" y="95" width="45" height="27" rx="5" fill="#e4c487"/>
    <circle cx="91" cy="84" r="11" fill="#c9975f"/>
    <path d="M76 82 L105 82 L101 73 L82 73 Z" fill="#28405f"/>
    <path d="M83 73 L99 73" stroke="#f4d36a" stroke-width="3"/>
    <circle cx="91" cy="121" r="12" fill="none" stroke="#f4d36a" stroke-width="4"/>
    <path d="M91 109 L91 133 M79 121 L103 121" stroke="#f4d36a" stroke-width="2"/>`,

  photographer: `
    ${jungleCanopy}
    <path d="M13 139 C42 127 66 138 91 126 C119 112 139 117 169 101 L169 177 L13 177 Z" fill="#caa74a"/>
    <rect x="56" y="98" width="54" height="36" rx="7" fill="#263241" stroke="#111827" stroke-width="3"/>
    <circle cx="83" cy="116" r="16" fill="#10161f" stroke="#dce4ec" stroke-width="3"/>
    <circle cx="83" cy="116" r="8" fill="#67b7d8"/>
    <rect x="96" y="88" width="22" height="18" rx="4" fill="#263241"/>
    <path d="M65 135 L44 168 M100 135 L121 168 M83 134 L83 171" stroke="#5f4528" stroke-width="4" stroke-linecap="round"/>
    <path d="M125 75 L135 89 L152 89 L139 99 L144 115 L130 105 L116 115 L121 99 L108 89 L124 89 Z"
      fill="#fff5c7" opacity="0.9"/>`,

  journalist: `
    ${sun}
    <path d="M13 128 C42 107 67 116 93 99 C118 82 145 86 169 69 L169 177 L13 177 Z" fill="#c89f42"/>
    <rect x="45" y="82" width="75" height="73" rx="5" fill="#efe0bd" stroke="#a9854f" stroke-width="3"/>
    <path d="M56 101 L108 96 M56 115 L108 110 M56 129 L92 126" stroke="#7b6541" stroke-width="3" opacity="0.72"/>
    <rect x="55" y="142" width="47" height="11" rx="3" fill="#b54a68"/>
    <path d="M119 75 L144 108 L135 114 L110 81 Z" fill="#263241"/>
    <circle cx="146" cy="111" r="10" fill="#d9dee5" stroke="#7d8791" stroke-width="2"/>
    <path d="M58 73 C72 62 97 62 111 75" stroke="#3e5f3d" stroke-width="6" fill="none" stroke-linecap="round"/>`,

  treasure_chest: `
    <path d="M13 105 C45 82 75 94 96 72 C120 48 149 62 169 49 L169 177 L13 177 Z" fill="#465d3f"/>
    <path d="M41 139 L139 139 L130 174 L51 174 Z" fill="#7a4d2b" stroke="#4b2d19" stroke-width="3"/>
    <path d="M49 104 L128 104 Q143 112 139 139 L41 139 Q37 113 49 104 Z" fill="#9a6335" stroke="#4b2d19" stroke-width="3"/>
    <rect x="84" y="104" width="12" height="70" fill="#e0b945"/>
    <rect x="39" y="136" width="102" height="9" fill="#e0b945"/>
    <circle cx="90" cy="145" r="7" fill="#f5d86a" stroke="#9b7a21" stroke-width="2"/>
    <path d="M68 96 L75 107 L88 107 L77 114 L82 126 L69 118 L57 126 L62 114 L51 107 L64 107 Z" fill="#ffe88f"/>
    <path d="M119 84 L123 92 L132 92 L125 98 L128 107 L120 102 L112 107 L115 98 L108 92 L117 92 Z" fill="#fff3bb"/>`,

  millionaire: `
    ${sun}
    <path d="M13 125 C45 103 70 113 95 91 C121 68 145 77 169 59 L169 177 L13 177 Z" fill="#b8902f"/>
    <circle cx="89" cy="84" r="12" fill="#c9975f"/>
    <path d="M74 85 C81 72 100 72 107 85 Z" fill="#2a2730"/>
    <path d="M63 174 C68 134 78 107 91 96 C107 108 118 136 123 174 Z" fill="#322f3c"/>
    <path d="M75 112 L91 142 L106 112" fill="none" stroke="#f2d36b" stroke-width="5" stroke-linejoin="round"/>
    <circle cx="142" cy="137" r="18" fill="#f4c64a" stroke="#9b7a21" stroke-width="3"/>
    <text x="142" y="145" text-anchor="middle" font-family="serif" font-size="22" font-weight="700" fill="#9b7a21">$</text>
    <path d="M52 138 C39 130 35 117 40 103" fill="none" stroke="#2a2730" stroke-width="5" stroke-linecap="round"/>`,

  jack: `
    <path d="M13 103 C36 85 58 93 82 73 C108 51 137 60 169 49 L169 177 L13 177 Z" fill="#54536f"/>
    <rect x="36" y="126" width="108" height="35" rx="7" fill="#6b3f24" stroke="#3c2516" stroke-width="3"/>
    <rect x="47" y="111" width="86" height="21" rx="5" fill="#925c33" stroke="#3c2516" stroke-width="2"/>
    <path d="M57 105 L77 85 L84 92 L64 112 Z" fill="#d9dee5" stroke="#79818c" stroke-width="2"/>
    <path d="M93 93 L120 120" stroke="#8b5d34" stroke-width="7" stroke-linecap="round"/>
    <path d="M118 85 C132 95 134 108 124 120 L113 109 C119 104 118 96 109 92 Z" fill="#e5c04f"/>
    <circle cx="76" cy="145" r="8" fill="#2f7a45"/>
    <circle cx="91" cy="145" r="8" fill="#2766a8"/>
    <circle cx="106" cy="145" r="8" fill="#b8902f"/>`,

  adventurer: `
    ${jungleCanopy}
    <path d="M13 141 C50 120 80 131 107 113 C131 97 148 101 169 87 L169 177 L13 177 Z" fill="#4b713b"/>
    <path d="M24 152 C66 132 106 134 156 151" stroke="#6b4226" stroke-width="4" fill="none" stroke-dasharray="5 6"/>
    <circle cx="91" cy="83" r="11" fill="#c9975f"/>
    <path d="M74 82 C82 68 101 68 109 82 Z" fill="#6c4b2a"/>
    <path d="M71 174 C75 133 82 105 93 94 C107 107 116 136 121 174 Z" fill="#5a4d35"/>
    <path d="M78 114 L57 102 M108 113 L130 98" stroke="#6a4327" stroke-width="5" stroke-linecap="round"/>
    <circle cx="132" cy="96" r="8" fill="#ffe08a"/>
    <path d="M48 169 L78 145 L108 169" fill="none" stroke="#d9dee5" stroke-width="4" stroke-linecap="round"/>`,

  prop_plane: `
    ${sun}
    <path d="M13 127 C36 104 64 114 92 92 C119 70 147 78 169 60 L169 177 L13 177 Z" fill="#315d39"/>
    <path d="M13 153 C43 137 67 147 92 132 C121 115 146 124 169 109 L169 177 L13 177 Z" fill="#244c2e"/>
    <path d="M47 96 L126 83 L153 97 L128 104 L98 132 L83 131 L100 108 L52 115 Z"
      fill="#d9dee5" stroke="#7d8791" stroke-width="3" stroke-linejoin="round"/>
    <path d="M72 93 L102 66 L113 69 L96 99 Z" fill="#f2c95d" stroke="#9b7a21" stroke-width="2"/>
    <circle cx="52" cy="96" r="10" fill="none" stroke="#263241" stroke-width="3"/>
    <path d="M42 96 L62 96 M52 86 L52 106" stroke="#263241" stroke-width="2"/>`,

  cartographer: `
    <path d="M13 106 C41 86 65 95 93 74 C119 55 145 61 169 50 L169 177 L13 177 Z" fill="#485f45"/>
    <rect x="34" y="77" width="112" height="75" rx="8" fill="#e7d3a5" stroke="#a9854f" stroke-width="3"/>
    <path d="M58 80 L58 149 M92 77 L92 152 M125 78 L125 152" stroke="#b49b6c" stroke-width="2"/>
    <path d="M36 104 L145 95 M36 127 L145 137" stroke="#b49b6c" stroke-width="2"/>
    <path d="M47 135 C68 112 83 127 99 105 C116 83 130 95 139 82" fill="none" stroke="#b54a68" stroke-width="4" stroke-dasharray="5 5"/>
    <circle cx="119" cy="123" r="15" fill="#273040" stroke="#d9dee5" stroke-width="3"/>
    <path d="M119 123 L126 111 L121 125 Z" fill="#e6788d"/>
    <path d="M119 123 L112 135 L117 121 Z" fill="#d9dee5"/>`,

  scientist: `
    <path d="M13 110 C42 91 69 99 95 78 C119 59 145 63 169 52 L169 177 L13 177 Z" fill="#53636f"/>
    <rect x="32" y="137" width="116" height="20" rx="6" fill="#6b3f24"/>
    <path d="M70 83 L70 116 L52 148 Q49 156 61 156 L96 156 Q108 156 104 148 L86 116 L86 83 Z"
      fill="#dff7ff" fill-opacity="0.42" stroke="#d9eef7" stroke-width="3"/>
    <rect x="65" y="77" width="27" height="8" rx="4" fill="#d9dee5"/>
    <path d="M57 137 L99 137 L104 150 Q106 155 96 155 L62 155 Q52 155 54 150 Z" fill="#62c46b"/>
    <circle cx="68" cy="145" r="3" fill="#f4fff4"/>
    <circle cx="86" cy="146" r="2" fill="#f4fff4"/>
    <path d="M112 107 C124 88 142 93 146 113 C137 120 121 122 112 107 Z" fill="#76b65b" stroke="#2f7a45" stroke-width="2"/>
    <path d="M127 109 C132 104 138 103 145 104" stroke="#2f7a45" stroke-width="2" fill="none"/>`,

  compass: `
    <rect x="28" y="68" width="124" height="90" rx="8" fill="#e6d2a6" stroke="#a9854f" stroke-width="3"/>
    <path d="M36 96 L143 85 M36 126 L144 139 M64 70 L64 157 M108 68 L108 158" stroke="#b49b6c" stroke-width="2"/>
    <circle cx="90" cy="113" r="38" fill="#263241" stroke="#d9dee5" stroke-width="5"/>
    <circle cx="90" cy="113" r="28" fill="#1b2740" stroke="#657486" stroke-width="2"/>
    <path d="M90 113 L106 80 L94 116 Z" fill="#e6788d"/>
    <path d="M90 113 L74 146 L86 110 Z" fill="#d9dee5"/>
    <circle cx="90" cy="113" r="5" fill="#f4c64a"/>
    <text x="90" y="91" text-anchor="middle" font-size="10" font-weight="800" fill="#d9dee5">N</text>`,

  travel_log: `
    <path d="M13 108 C41 87 67 98 91 78 C117 57 145 64 169 52 L169 177 L13 177 Z" fill="#5e6f44"/>
    <path d="M90 83 C75 73 51 75 36 84 L36 155 C53 147 74 147 90 157 C106 147 127 147 144 155 L144 84 C129 75 105 73 90 83 Z"
      fill="#e6d2a6" stroke="#8d6a3c" stroke-width="3"/>
    <path d="M90 83 L90 157" stroke="#8d6a3c" stroke-width="2"/>
    <path d="M48 101 L78 96 M48 116 L79 111 M101 100 L132 97 M101 115 L132 113" stroke="#84663e" stroke-width="2" opacity="0.65"/>
    <path d="M59 137 C69 122 79 130 75 145 C67 148 61 145 59 137 Z" fill="#76b65b" stroke="#2f7a45" stroke-width="2"/>
    <path d="M111 137 C123 128 134 134 135 148 C123 151 115 147 111 137 Z" fill="#b54a68" opacity="0.75"/>`,

  transmitter: `
    <path d="M13 127 C41 106 69 115 96 92 C120 72 145 80 169 64 L169 177 L13 177 Z" fill="#394d4a"/>
    <path d="M63 164 L90 72 L117 164 Z" fill="none" stroke="#d9dee5" stroke-width="5" stroke-linejoin="round"/>
    <path d="M73 133 L107 133 M80 109 L100 109" stroke="#d9dee5" stroke-width="3"/>
    <circle cx="90" cy="70" r="6" fill="#e6788d"/>
    <path d="M72 66 C82 51 99 51 109 66" fill="none" stroke="#f2d36b" stroke-width="4" stroke-linecap="round"/>
    <path d="M58 56 C75 32 105 32 122 56" fill="none" stroke="#f2d36b" stroke-width="3" stroke-linecap="round" opacity="0.65"/>
    <rect x="42" y="146" width="35" height="18" rx="5" fill="#263241" stroke="#111827" stroke-width="2"/>
    <circle cx="52" cy="155" r="4" fill="#66b8d6"/>`,

  native: `
    ${jungleCanopy}
    ${trail}
    <circle cx="82" cy="91" r="11" fill="#b98256"/>
    <path d="M66 92 C74 79 92 79 100 92 Z" fill="#273040"/>
    <path d="M63 174 C67 135 75 107 85 100 C99 111 109 138 114 174 Z" fill="#3f6f42"/>
    <path d="M109 118 C125 110 138 98 149 82" fill="none" stroke="#b98256" stroke-width="5" stroke-linecap="round"/>
    <path d="M146 82 L155 87 L148 95" fill="none" stroke="#f2d36b" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M57 121 L38 139" stroke="#b98256" stroke-width="5" stroke-linecap="round"/>
    <path d="M41 79 L41 164" stroke="#6b4226" stroke-width="4" stroke-linecap="round"/>
    <path d="M41 76 L35 89 L47 89 Z" fill="#d9dee5"/>`,
};

function titleLines(name: string): string[] {
  const words = name.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > 17 && current) {
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
  const y = lines.length === 1 ? 31 : 25;
  return `<text text-anchor="middle" font-family="Georgia, serif" font-weight="800" fill="#fff7dd"
    stroke="rgba(0,0,0,0.25)" stroke-width="0.7" paint-order="stroke" font-size="${lines.length === 1 ? 15 : 12.5}">
    ${lines.map((line, i) => `<tspan x="90" y="${y + i * 13}">${escapeSvg(line)}</tspan>`).join('')}
  </text>`;
}

function miniSymbol(symbol: MoveSymbol, x: number, y: number, scale = 1): string {
  const t = `translate(${x} ${y}) scale(${scale})`;
  if (symbol === 'machete') {
    return `<g transform="${t}">
      <path d="M-12 12 L-2 2" stroke="#6e4824" stroke-width="6" stroke-linecap="round"/>
      <path d="M0 0 C8 -11 17 -17 23 -21 C25 -13 19 -3 8 3 C4 5 0 5 -4 4 Z" fill="#e8edf4" stroke="#8b95a2" stroke-width="1.5"/>
    </g>`;
  }
  if (symbol === 'paddle') {
    return `<g transform="${t}">
      <path d="M0 -22 L0 8" stroke="#8d5b31" stroke-width="5" stroke-linecap="round"/>
      <path d="M0 7 C-10 10 -10 23 0 28 C10 23 10 10 0 7 Z" fill="#c28b4b" stroke="#6e4824" stroke-width="1.5"/>
    </g>`;
  }
  return `<g transform="${t}">
    <circle cx="0" cy="0" r="14" fill="#f4c64a" stroke="#9b7a21" stroke-width="2"/>
    <path d="M0 -8 L2.5 -2.5 L8 -2 L4 2 L5 8 L0 5 L-5 8 L-4 2 L-8 -2 L-2.5 -2.5 Z" fill="#9b7a21"/>
  </g>`;
}

function cardStats(def: CardDef): string {
  const ability = def.ability ? ABILITY_LABEL[def.ability] : 'SPECIAL';
  if (def.kind === 'action') {
    return `
      <text x="90" y="205" text-anchor="middle" font-family="system-ui, sans-serif" font-size="14" font-weight="900" fill="#fff7dd">${ability}</text>
      <text x="90" y="224" text-anchor="middle" font-family="system-ui, sans-serif" font-size="8.5" font-weight="800" fill="#f8e8b7">${escapeSvg(
        CARD_TAGLINE[def.defId] ?? 'Special action',
      )}</text>`;
  }
  if (def.kind === 'joker') {
    return `
      <text x="90" y="202" text-anchor="middle" font-family="system-ui, sans-serif" font-size="13" font-weight="900" fill="#fff7dd">WILD ${def.power}</text>
      ${miniSymbol('machete', 62, 219, 0.37)}
      ${miniSymbol('paddle', 90, 219, 0.37)}
      ${miniSymbol('coin', 118, 219, 0.37)}`;
  }
  const symbol = def.symbol ?? 'coin';
  return `
    ${miniSymbol(symbol, 62, 213, 0.44)}
    <text x="104" y="210" font-family="system-ui, sans-serif" font-size="24" font-weight="950" fill="#fff7dd">${def.power}</text>
    <text x="104" y="225" font-family="system-ui, sans-serif" font-size="9" font-weight="900" fill="#f8e8b7">${SYMBOL_LABEL[symbol]}</text>`;
}

function costBadge(def: CardDef, pal: Palette): string {
  if (def.starting) {
    return `
      <rect x="118" y="176" width="45" height="20" rx="10" fill="#263241" stroke="#f8e8b7" stroke-width="1.5"/>
      <text x="140.5" y="190" text-anchor="middle" font-family="system-ui, sans-serif" font-size="8.5" font-weight="900" fill="#f8e8b7">START</text>`;
  }
  return `
    <circle cx="146" cy="186" r="15" fill="#f4c64a" stroke="#8c651a" stroke-width="2.5"/>
    <text x="146" y="194" text-anchor="middle" font-family="Georgia, serif" font-size="21" font-weight="900" fill="#6b4a12">${def.cost}</text>
    <circle cx="126" cy="186" r="8" fill="${pal.accent}" stroke="#fff3c4" stroke-width="1.3"/>`;
}

function singleUseRibbon(def: CardDef): string {
  if (!def.singleUse) return '';
  return `
    <g transform="translate(19 52) rotate(-12)">
      <rect x="0" y="0" width="57" height="17" rx="4" fill="#bb364e" stroke="#fff1d1" stroke-width="1.2"/>
      <text x="28.5" y="12" text-anchor="middle" font-family="system-ui, sans-serif" font-size="8" font-weight="900" fill="#fff1d1">ONE USE</text>
    </g>`;
}

function paperGrain(): string {
  return `
    <path d="M18 213 C45 204 64 215 90 207 C116 199 135 211 162 202" stroke="#b99a62" stroke-width="1" opacity="0.2" fill="none"/>
    <path d="M21 37 C46 43 72 36 92 42 C116 49 137 38 158 44" stroke="#fff1c7" stroke-width="1" opacity="0.18" fill="none"/>`;
}

/** Full original SVG face for a card definition. Safe to inline into the DOM. */
export function cardFace(defOrId: CardDef | string): string {
  const def = typeof defOrId === 'string' ? getDef(defOrId) : defOrId;
  const pal = PALETTE[def.kind];
  const id = `card-face-${def.defId.replace(/[^a-z0-9_-]/gi, '-')}`;
  const scene = SCENES[def.defId] ?? SCENES.explorer;
  const typeLabel = def.kind === 'action' ? KIND_LABEL.action : def.kind === 'joker' ? KIND_LABEL.joker : KIND_LABEL[def.kind];

  return `<svg class="card-face-svg" viewBox="0 0 180 250" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeSvg(
    def.name,
  )} card">
    <defs>
      <linearGradient id="${id}-outer" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${pal.pale}"/>
        <stop offset="0.5" stop-color="#f1dfba"/>
        <stop offset="1" stop-color="#c59d63"/>
      </linearGradient>
      <linearGradient id="${id}-head" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="${pal.deep}"/>
        <stop offset="0.55" stop-color="${pal.base}"/>
        <stop offset="1" stop-color="${pal.deep}"/>
      </linearGradient>
      <linearGradient id="${id}-scene-bg" x1="0" y1="46" x2="180" y2="174">
        <stop offset="0" stop-color="${pal.washA}"/>
        <stop offset="1" stop-color="${pal.washB}"/>
      </linearGradient>
      <radialGradient id="${id}-vignette" cx="50%" cy="38%" r="70%">
        <stop offset="0" stop-color="#fff3bf" stop-opacity="0.24"/>
        <stop offset="0.58" stop-color="#000000" stop-opacity="0"/>
        <stop offset="1" stop-color="#000000" stop-opacity="0.38"/>
      </radialGradient>
      <clipPath id="${id}-clip">
        <rect x="14" y="46" width="152" height="128" rx="12"/>
      </clipPath>
    </defs>

    <rect x="2" y="2" width="176" height="246" rx="16" fill="#24190f"/>
    <rect x="6" y="6" width="168" height="238" rx="14" fill="url(#${id}-outer)"/>
    <rect x="11" y="11" width="158" height="228" rx="11" fill="#ecd7ac" stroke="#6b4a25" stroke-width="2"/>
    ${paperGrain()}

    <rect x="14" y="15" width="152" height="28" rx="7" fill="url(#${id}-head)" stroke="#fff1c7" stroke-opacity="0.45"/>
    ${titleSvg(def.name)}

    <g clip-path="url(#${id}-clip)">
      <rect x="14" y="46" width="152" height="128" fill="url(#${id}-scene-bg)"/>
      ${scene}
      <rect x="14" y="46" width="152" height="128" fill="url(#${id}-vignette)"/>
    </g>
    <rect x="14" y="46" width="152" height="128" rx="12" fill="none" stroke="#50371f" stroke-width="2.5"/>
    ${singleUseRibbon(def)}

    <rect x="15" y="178" width="150" height="55" rx="9" fill="${pal.deep}" stroke="#fff1c7" stroke-opacity="0.45"/>
    <rect x="23" y="185" width="66" height="11" rx="5.5" fill="${pal.base}" opacity="0.9"/>
    <text x="56" y="193.3" text-anchor="middle" font-family="system-ui, sans-serif" font-size="7.6" font-weight="900" fill="#fff1c7">${typeLabel.toUpperCase()}</text>
    ${costBadge(def, pal)}
    ${cardStats(def)}

    <rect x="6" y="6" width="168" height="238" rx="14" fill="none" stroke="#fff6d8" stroke-opacity="0.35"/>
    <rect x="2" y="2" width="176" height="246" rx="16" fill="none" stroke="#0b0b0b" stroke-opacity="0.65" stroke-width="3"/>
  </svg>`;
}

function escapeSvg(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}
