/**
 * Lobby view — pure DOM renderer.
 *
 * Mirrors the lobby DOM code previously embedded in `main.ts`. The view is
 * stateless: every interaction goes through `env.dispatch(intent)`. The
 * controller (`LobbyController`) owns the actual state and translates intents
 * into `ClientMessage` payloads on the socket.
 */
import type { PlayerColor, RoomPlayer } from '@eldorado/core';
import { MAP_OPTIONS } from '@eldorado/core';

/** Mirrors `RoomView.players[]` — typed here to keep the view self-contained. */
export interface LobbyPlayer extends RoomPlayer {
  id: string;
  name: string;
  color: PlayerColor;
  isAI: boolean;
  offline?: boolean;
}

/** A single map option rendered in the lobby map picker. */
export interface LobbyMapOption {
  id: string;
  name: string;
}

/** View-level state for the lobby. The controller computes this from `RoomView`. */
export interface LobbyViewState {
  /** True when the user has not joined a room yet. */
  isEntry: boolean;
  /** True while the launch countdown overlay is showing. */
  isLaunching: boolean;
  /** True after the local user has fired the `ready` message during the countdown. */
  isStartingDone: boolean;
  /** Pending players during the post-countdown ready barrier. */
  startingPendingPlayers: string[];
  /** Local player id (when in a room). */
  selfId: string | null;
  /** Room code, if joined. */
  roomCode: string | null;
  /** Player list to render; empty when in the entry modal. */
  players: LobbyPlayer[];
  /** Map option list (mirrors core's MAP_OPTIONS). */
  mapOptions: LobbyMapOption[];
  /** Currently selected map id (host-only state mirrored from localStorage). */
  selectedMapId: string;
  /** Map id announced by the server (non-host sees this). */
  serverMapId: string | null;
  /** True when the local player is the host. */
  isHost: boolean;
  /** Local player's display name. */
  nameValue: string;
  /** Transient error message displayed under the modal. */
  errorMessage: string;
}

/** Intents the view dispatches upward. */
export type LobbyIntent =
  | { type: 'createRoom'; name: string }
  | { type: 'joinRoom'; code: string; name: string }
  | { type: 'leaveRoom' }
  | { type: 'addAI' }
  | { type: 'removePlayer'; playerId: string }
  | { type: 'setMap'; mapId: string }
  | { type: 'startGame'; mapId: string }
  | { type: 'setName'; name: string }
  | { type: 'launchComplete' } // local countdown fired → controller sends 'ready'
  | { type: 'updatePending'; pendingPlayers: string[] }; // server `starting` message

/** Environment provided to the view by the controller. */
export interface LobbyViewEnv {
  dispatch(intent: LobbyIntent): void;
}

/** Card-color dot (matches `colorHex()` in main.ts for now; will move later). */
function colorHex(c: PlayerColor | string): string {
  return (
    {
      red: '#e05656',
      blue: '#4c9bef',
      green: '#5ed17a',
      yellow: '#f0d24c',
    } as Record<string, string>
  )[c] ?? '#aaa';
}

function playerDisplayName(p: { name: string; isAI?: boolean }): string {
  if (!p.isAI) return p.name;
  const aiName = p.name.match(/^AI\s*(\d+)$/i);
  return aiName ? `电脑 ${aiName[1]}` : p.name;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]!));
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

/**
 * Render the lobby into a root element.
 *
 * `root` should already be the `#lobby` element from `index.html`. The view
 * wipes its children and rebuilds the modal on every call, exactly like the
 * legacy `renderLobby` did.
 */
export function renderLobby(root: HTMLElement, state: LobbyViewState, env: LobbyViewEnv): void {
  // Hide the lobby whenever the room is mid-game (handled by the controller
  // by re-rendering with isEntry=false plus an empty players list — but we
  // also guard here to mirror legacy behavior).
  if (state.isLaunching) {
    root.classList.remove('hidden');
  } else if (state.roomCode && state.players.length === 0) {
    // Game in progress and no lobby state — keep hidden.
    root.classList.add('hidden');
  } else {
    root.classList.remove('hidden');
  }
  root.innerHTML = '';

  if (state.isLaunching) {
    renderLaunching(root, state, env);
    return;
  }

  const modal = el('div', 'modal lobby-modal');
  modal.classList.add(state.isEntry ? 'entry-modal' : 'room-modal');
  const artHtml = '<div class="lobby-art"></div>';

  if (state.isEntry) {
    renderEntry(modal, artHtml, state, env);
  } else {
    renderRoom(modal, artHtml, state, env);
  }
  root.appendChild(modal);
}

// ---------------------------------------------------------------------------
// Entry modal (no room yet)
// ---------------------------------------------------------------------------

function renderEntry(
  modal: HTMLElement,
  artHtml: string,
  state: LobbyViewState,
  env: LobbyViewEnv,
): void {
  modal.innerHTML = `
    ${artHtml}
    <div class="lobby-form">
      <h1>冲向黄金城</h1>
      <label>你的名字</label>
      <span class="game-field"><input id="name" value="${escapeHtml(state.nameValue)}" placeholder="玩家名" /></span>
      <label>房间码（加入已有房间）</label>
      <span class="game-field"><input id="code" placeholder="请输入 4 位房间码" maxlength="4" style="text-transform:uppercase" /></span>
      <div class="row">
        <button id="create">创建房间</button>
        <button id="join" class="secondary">加入房间</button>
      </div>
      <div class="error">${escapeHtml(state.errorMessage)}</div>
    </div>`;

  modal.querySelector<HTMLInputElement>('#name')!.oninput = (e) => {
    env.dispatch({ type: 'setName', name: (e.target as HTMLInputElement).value });
  };
  modal.querySelector<HTMLButtonElement>('#create')!.onclick = () => {
    env.dispatch({ type: 'createRoom', name: state.nameValue || '玩家' });
  };
  modal.querySelector<HTMLButtonElement>('#join')!.onclick = () => {
    const code = modal.querySelector<HTMLInputElement>('#code')!.value.trim().toUpperCase();
    if (code) env.dispatch({ type: 'joinRoom', code, name: state.nameValue || '玩家' });
  };
}

// ---------------------------------------------------------------------------
// Room modal (in a room)
// ---------------------------------------------------------------------------

function renderRoom(
  modal: HTMLElement,
  artHtml: string,
  state: LobbyViewState,
  env: LobbyViewEnv,
): void {
  const players = state.players
    .map(
      (p) => `
        <div class="player-chip">
          <span class="dot" style="background:${colorHex(p.color)}"></span>${escapeHtml(
            playerDisplayName(p),
          )}${p.isAI ? ' 🤖' : ''}${p.offline ? ' · 离线' : ''}${p.id === state.selfId && state.isHost ? ' 👑' : ''}
        </div>`,
    )
    .join('');

  // Non-hosts cannot change the map; they just see the server-side selection.
  const effectiveMapId = state.isHost
    ? state.selectedMapId
    : state.serverMapId ?? state.selectedMapId;
  const safeMapId = state.mapOptions.some((m) => m.id === effectiveMapId)
    ? effectiveMapId
    : state.mapOptions[0]?.id ?? '';
  const selectedMap = state.mapOptions.find((m) => m.id === safeMapId) ?? state.mapOptions[0];

  const mapControl = state.isHost
    ? `
        <label for="map-select">地图</label>
        <div class="map-picker" id="map-picker">
          <button id="map-select" class="map-trigger" type="button" aria-haspopup="listbox" aria-expanded="false">
            <span class="map-trigger-mark" aria-hidden="true"></span>
            <span class="map-trigger-name">${escapeHtml(selectedMap?.name ?? '')}</span>
            <i aria-hidden="true"></i>
          </button>
          <div class="map-menu" role="listbox" aria-label="选择地图">
            ${state.mapOptions
              .map(
                (map) => `
                  <button type="button" class="map-option ${map.id === safeMapId ? 'selected' : ''}" data-map-id="${escapeHtml(
                    map.id,
                  )}" role="option" aria-selected="${map.id === safeMapId ? 'true' : 'false'}">
                    <span class="map-option-mark" aria-hidden="true"></span>
                    <span class="map-option-name">${escapeHtml(map.name)}</span>
                    ${map.id === safeMapId ? '<b>当前</b>' : ''}
                  </button>`,
              )
              .join('')}
          </div>
        </div>`
    : `
        <label>地图</label>
        <div class="map-picker map-picker-static">
          <div class="map-trigger map-readout" role="status" aria-live="polite">
            <span class="map-trigger-mark" aria-hidden="true"></span>
            <span class="map-trigger-name">${escapeHtml(selectedMap?.name ?? '')}</span>
          </div>
        </div>`;

  modal.innerHTML = `
    ${artHtml}
    <div class="lobby-form">
      <h1>房间 <span class="room-code">${escapeHtml(state.roomCode ?? '')}</span></h1>
      ${mapControl}
      <div class="lobby-players">${players}</div>
      <div class="row room-actions">
        <button id="leave-room" class="secondary room-leave" type="button">退出房间</button>
        ${state.isHost ? '<button id="ai" class="secondary">+ 添加电脑</button>' : ''}
        ${
          state.isHost
            ? `<button id="start" ${state.players.length < 2 ? 'disabled' : ''}>开始游戏</button>`
            : '<div class="sub">等待房主开始…</div>'
        }
      </div>
      <div class="error">${escapeHtml(state.errorMessage)}</div>
    </div>`;

  if (state.isHost) {
    modal.querySelector<HTMLButtonElement>('#ai')!.onclick = () => env.dispatch({ type: 'addAI' });
    const mapPicker = modal.querySelector<HTMLElement>('#map-picker');
    const mapTrigger = modal.querySelector<HTMLButtonElement>('#map-select');
    if (mapPicker && mapTrigger) {
      const setOpen = (open: boolean) => {
        mapPicker.classList.toggle('open', open);
        modal.classList.toggle('map-menu-open', open);
        mapTrigger.setAttribute('aria-expanded', String(open));
      };
      mapTrigger.onclick = (e) => {
        e.stopPropagation();
        setOpen(!mapPicker.classList.contains('open'));
      };
      for (const option of modal.querySelectorAll<HTMLButtonElement>('.map-option')) {
        option.onclick = (e) => {
          e.stopPropagation();
          const id = option.dataset.mapId ?? '';
          if (id) env.dispatch({ type: 'setMap', mapId: id });
        };
      }
      modal.addEventListener('click', (e) => {
        if (!mapPicker.contains(e.target as Node)) setOpen(false);
      });
    }
    const startBtn = modal.querySelector<HTMLButtonElement>('#start');
    if (startBtn) {
      startBtn.onclick = () => {
        env.dispatch({ type: 'startGame', mapId: state.selectedMapId });
      };
    }
  }
  modal.querySelector<HTMLButtonElement>('#leave-room')!.onclick = () => env.dispatch({ type: 'leaveRoom' });
}

// ---------------------------------------------------------------------------
// Launch countdown overlay
// ---------------------------------------------------------------------------

/** Module-level state so the launch countdown keeps ticking across re-renders. */
let launchTimer: ReturnType<typeof setTimeout> | undefined;
let launchTickTimer: ReturnType<typeof setInterval> | undefined;
let launchCountdownEndsAt = 0;

const START_COUNTDOWN_MS = 5000;

function renderLaunching(root: HTMLElement, state: LobbyViewState, env: LobbyViewEnv): void {
  root.classList.add('launching');
  let crest = root.querySelector<HTMLElement>('.lobby-launch');
  if (!crest) {
    crest = el('div', 'lobby-launch');
    crest.innerHTML = `
      <div class="lobby-launch-crest">
        <div class="lobby-launch-kicker">路线锁定</div>
        <div class="lobby-launch-ring"><span class="countdown-number" data-countdown="5">5</span></div>
        <div class="lobby-launch-title">探险即将开始</div>
        <div class="lobby-launch-copy" data-starting-copy>确认装备，校准指南针...</div>
        <div class="lobby-launch-track"><i></i></div>
      </div>`;
    root.appendChild(crest);
  }

  const updateCountdown = () => {
    const node = crest!.querySelector<HTMLElement>('[data-countdown]');
    if (!node) return;
    const seconds = Math.max(0, Math.ceil((launchCountdownEndsAt - performance.now()) / 1000));
    const next = String(seconds);
    if (node.textContent === next) return;
    node.textContent = next;
    node.dataset.countdown = next;
    node.classList.remove('tick');
    void node.offsetWidth;
    node.classList.add('tick');
  };

  const updateCopy = () => {
    const copy = crest!.querySelector<HTMLElement>('[data-starting-copy]');
    if (!copy) return;
    if (!state.isStartingDone) {
      copy.textContent = '确认装备，校准指南针...';
      return;
    }
    const remaining = state.startingPendingPlayers.length;
    if (remaining === 0) copy.textContent = '即将开始...';
    else copy.textContent = `等待 ${remaining} 名玩家准备中...`;
  };

  // (Re)arm the timer if we don't have one running.
  if (launchTimer === undefined) {
    launchCountdownEndsAt = performance.now() + START_COUNTDOWN_MS;
    if (launchTickTimer !== undefined) clearInterval(launchTickTimer);
    updateCountdown();
    launchTickTimer = setInterval(updateCountdown, 250);
    launchTimer = setTimeout(() => {
      launchTimer = undefined;
      env.dispatch({ type: 'launchComplete' });
    }, START_COUNTDOWN_MS);
  } else {
    updateCountdown();
  }
  updateCopy();
}

/** Tear down any active launch timers. Called by the controller when leaving the launching state. */
export function clearLaunchTimers(): void {
  if (launchTimer !== undefined) {
    clearTimeout(launchTimer);
    launchTimer = undefined;
  }
  if (launchTickTimer !== undefined) {
    clearInterval(launchTickTimer);
    launchTickTimer = undefined;
  }
}

/** Static view helper for tests / debug: derive default map options from core. */
export function defaultMapOptions(): LobbyMapOption[] {
  return MAP_OPTIONS.map((m) => ({ id: m.id, name: m.name }));
}