# 冲向黄金城 · The Quest for El Dorado (联机版)

A networked, multiplayer digital implementation of Reiner Knizia's deck-building
race game **The Quest for El Dorado**. TypeScript end-to-end, Three.js renderer,
authoritative Node WebSocket server.

## Architecture

A pnpm monorepo with three packages, rendering/networking decoupled from rules:

| Package | What it is |
|---|---|
| `@eldorado/core` | Pure, deterministic rules engine — `applyAction(state, action)` reducer, card catalog, maps, seeded RNG, wire protocol, and a greedy AI planner. No rendering, no network. Reused by both server and client. |
| `@eldorado/server` | Authoritative Node + `ws` server: rooms, 4-letter room codes, the canonical game state, and server-side AI turns. Clients send action **intents**; the server validates with `core` and broadcasts full state snapshots. |
| `@eldorado/client` | Three.js 2.5D board renderer + HTML overlay (lobby, hand, market, turn HUD). Sends intents, renders snapshots. |

> The game design and full ruleset reference live in
> `docs/superpowers/specs/2026-06-18-el-dorado-online-design.md`.

## Run it

```bash
pnpm install

# terminal 1 — authoritative server (ws://localhost:8787)
pnpm dev:server

# terminal 2 — client dev server (http://localhost:5173)
pnpm dev:client
```

Open http://localhost:5173, create a room, share the 4-letter code with friends
(or **+ 添加 AI** to fill seats), and start. 2–4 players.

## Test

```bash
pnpm test          # all packages
pnpm --filter @eldorado/core test     # rules engine + AI (19 cases)
pnpm --filter @eldorado/server test    # rooms + full AI game
```

## How to play (MVP)

- On your turn, click a hand card, then click a highlighted adjacent hex to move.
  Green = machete/jungle, blue = paddle/river, yellow = coin/village. A single
  card must cover a whole hex (no combining); leftover power carries to the next hex.
- Grey **rubble** / red **base camp** hexes: click them, then pick cards to pay
  (base camp removes those cards from your deck permanently).
- Click a market card, select payment cards, **确认购买** to buy (goes to discard).
- **结束回合** ends your turn; you draw back up to 4. First to El Dorado wins.

## Status / not yet implemented

MVP scope. Faithful core loop (move / buy / trim / draw / win + final round).
Deferred: modular tile map builder, caves expansion, action-card abilities in the
UI (engine supports several already), reconnection polish, accounts.
A few market card **costs** are best-estimates pending physical-card verification
(flagged `// TODO: verify` in `packages/core/src/cards.ts`).
