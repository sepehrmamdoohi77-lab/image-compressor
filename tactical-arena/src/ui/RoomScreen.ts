import type {
  CombatEvent,
  Snapshot,
  ConnectionStatus,
  GameConfig,
  RoomState,
  Transform,
} from '../multiplayer/protocol';
import { brand, escape, icon } from './icons';
import { MiniMap } from './MapView';
import { CombatHud } from './CombatHud';
import { resultsMarkup } from './Results';
import type { GrenadePreview } from '../game/GrenadeAim';
import { defaults, type Settings } from '../services/Settings';

export class RoomScreen {
  readonly element = document.createElement('div');
  readonly sceneElement: HTMLElement;
  readonly labelsElement: HTMLElement;
  private minimap: MiniMap;
  private combatHud: CombatHud;
  private latestSnapshot: Snapshot | null = null;
  private pointer = { x: 0, y: 0, active: false };
  private preferences = { ...defaults };
  private cameraYaw = 0;
  private room: RoomState;
  private status: ConnectionStatus = 'connected';
  private rosterOpen = false;
  private busy = false;
  private teams = new Map<string, string>();
  private lastMapAt = 0;

  constructor(
    room: RoomState,
    private ownId: string,
    config: GameConfig,
  ) {
    this.room = room;
    this.element.className = 'field-root';
    this.element.dataset.mapId = config.map.id;
    this.element.innerHTML = `
      <div class="scene-wrap" data-scene><div class="scene-loading" data-scene-loading><span class="loading-ring"></span>PREPARING ${escape(config.map.name)}…</div><div class="operator-labels" data-labels></div></div>
      <div class="field-vignette" aria-hidden="true"></div>
      <header class="field-header">${brand}<span class="field-header-tag">${escape(config.map.name)} <i>/</i> SECTOR ${escape(config.map.sector)}</span>
        <div class="field-header-right"><span class="connection-pill" data-connection>${icon('signal')}<span>CONNECTED</span><b data-ping>MEASURING</b></span><button class="icon-button" data-action="roster" aria-label="Show player roster">${icon('squad')}</button><button class="icon-button" data-action="pause" aria-label="Open field menu">${icon('settings')}</button></div>
      </header>
      <div class="lobby-panel" data-lobby>
        <div class="panel-eyebrow"><span class="status-dot bronze"></span><span data-lobby-mode>PRIVATE MULTIPLAYER</span></div>
        <h1>SQUAD LOBBY</h1><p class="lobby-subtitle" data-room-details></p>
        <div class="room-invite"><div><span class="small-label">ROOM CODE</span><strong data-room-code></strong></div><button class="icon-button" data-action="copy-code" aria-label="Copy room code">${icon('copy')}</button><button class="icon-button" data-action="copy-link" aria-label="Copy room invite link">${icon('link')}</button>${typeof navigator.share === 'function' ? `<button class="icon-button" data-action="share" aria-label="Share room invitation">${icon('arrow')}</button>` : ''}</div>
        <div class="teams-roster" data-teams></div>
        <div class="lobby-bottom"><p class="lobby-guidance" data-guidance></p><button class="button secondary full" data-action="ready" data-ready>${icon('check')}<span>I’M READY</span></button><button class="button primary full" data-action="start" data-start>${icon('arrow')}<span>DEPLOY SQUAD</span></button><span class="foundation-note" data-mode-note></span><button class="text-button leave-button" data-action="leave">${icon('back')}LEAVE ROOM</button></div>
      </div>
      <div class="field-score-strip" data-field-hud hidden><span class="team-total blue"><i>B</i><b data-blue-count>0</b><small data-count-label>SCORE</small></span><div><span data-hud-mode>TEAM DEATHMATCH</span><strong data-timer>00:00</strong></div><span class="team-total red"><small data-count-label>SCORE</small><b data-red-count>0</b><i>R</i></span></div>
      <div class="mini-map-panel" data-minimap-panel hidden><canvas width="168" height="168" data-minimap aria-label="Live player minimap"></canvas><span>N ↑ <b>${escape(config.map.name)}</b></span><small class="radar-legend"><i class="blue">● ALLY</i><i class="red">▲ ENEMY</i><i>? LAST SEEN · 5s</i></small></div>
      <div class="field-status" data-field-status hidden><span class="small-label" data-your-team></span><strong data-your-name></strong><div data-field-note>SERVER-VALIDATED COMBAT</div></div>
      <div class="desktop-hints" data-hints hidden><span><kbd>WASD</kbd> MOVE</span><span><kbd>SHIFT</kbd> SPRINT</span><span><kbd>Q E</kbd> ROTATE</span><span><kbd>SCROLL</kbd> ZOOM</span><span data-combat-hint><kbd>LMB / RMB</kbd> FIRE / ADS</span><span data-combat-hint><kbd>R / G</kbd> RELOAD / FRAG</span></div>
      <div class="field-telemetry" data-telemetry hidden><span data-coordinates>POSITION —</span><small>SERVER-AUTHORITATIVE · ${config.tickHz} HZ</small></div>
      <div class="touch-controls" data-touch-controls hidden><div class="touch-left-actions"><button class="touch-button" data-touch-sprint aria-label="Toggle sprint" aria-pressed="false">${icon('run')}</button><button class="touch-button" data-touch-crouch aria-label="Toggle crouch" aria-pressed="false">C</button></div><div class="touch-stick move-stick" data-stick="move" role="group" aria-label="Virtual movement stick"><span></span><small>MOVE</small></div><div class="touch-right"><div class="touch-buttons"><button class="touch-button" data-action="reload" data-touch-combat aria-label="Reload">R</button><button class="touch-button" data-action="grenade" data-touch-combat aria-label="Throw frag grenade">G</button><button class="touch-button" data-touch-ads data-touch-combat aria-label="Toggle aiming" aria-pressed="false">ADS</button><button class="touch-button" data-action="zoom-in" aria-label="Zoom in">${icon('plus')}</button><button class="touch-button" data-action="zoom-out" aria-label="Zoom out">${icon('minus')}</button></div><button class="touch-fire" data-touch-fire data-touch-combat aria-label="Hold to fire">${icon('plus')}<small>FIRE</small></button><div class="touch-stick face-stick" data-stick="face" role="group" aria-label="Virtual facing stick"><span></span><small>AIM</small></div></div></div>
      <div class="phase-overlay" data-countdown hidden><span>ESTABLISHING FIELD SESSION</span><strong data-countdown-number>3</strong><small>COMBAT UNLOCKS AT ZERO</small></div>
      <div class="results-panel" data-results hidden><span class="panel-eyebrow">NETWORK DRILL CONCLUDED</span><h2>FIELD TEST<br>COMPLETE<span>.</span></h2><p>The movement session has ended.<br>No combat statistics or rewards were recorded.</p><button class="button primary full" data-action="return-lobby" data-return>${icon('back')}RETURN TO LOBBY</button><p class="result-waiting" data-result-waiting>Waiting for the room owner to return to lobby.</p><button class="text-button" data-action="leave">LEAVE ROOM</button></div>
      <aside class="roster-drawer" data-roster hidden><div class="drawer-title"><span>SQUAD ROSTER</span><button class="icon-button" data-action="roster" aria-label="Close roster">${icon('close')}</button></div><div data-drawer-roster></div><p>Kills, deaths and score are authoritative. BOT labels identify AI; latency is measured for real connected clients.</p></aside>
      <div class="connection-overlay" data-reconnect hidden><span class="loading-ring"></span><h2 data-reconnect-title>RECONNECTING</h2><p data-reconnect-message>Attempting to restore your room session…</p><button class="button secondary" data-action="retry-connection" data-retry>RETRY CONNECTION</button><button class="text-button" data-action="leave">LEAVE ROOM</button></div>`;
    const killfeed = document.createElement('div');
    killfeed.className = 'killfeed';
    killfeed.dataset.killfeed = '';
    this.element.append(killfeed);
    this.combatHud = new CombatHud(ownId, config);
    this.element.append(this.combatHud.element);
    this.sceneElement = this.element.querySelector('[data-scene]')!;
    this.labelsElement = this.element.querySelector('[data-labels]')!;
    this.minimap = new MiniMap(
      this.element.querySelector<HTMLCanvasElement>('[data-minimap]')!,
      config,
    );
    this.update(room);
  }

  grenadeTarget(preview: GrenadePreview | null): void {
    this.combatHud.grenadeTarget(preview);
  }
  update(room: RoomState): void {
    this.room = room;
    this.teams = new Map(room.players.map((p) => [p.id, p.team]));
    const owner = room.ownerId === this.ownId,
      own = room.players.find((p) => p.id === this.ownId);
    const lobby = room.phase === 'LOBBY',
      field = ['ACTIVE', 'COUNTDOWN', 'ENDING'].includes(room.phase);
    this.element.dataset.phase = room.phase;
    this.element.dataset.combat = String(room.combatEnabled);
    this.element.querySelector('[data-lobby-mode]')!.textContent = room.publicRoom
      ? 'PUBLIC QUICK PLAY'
      : room.settings.bots
        ? 'PRIVATE BOT PRACTICE'
        : 'PRIVATE MULTIPLAYER';
    this.element.querySelector('[data-mode-note]')!.textContent = !room.combatEnabled
      ? 'Network drill: movement only, combat disabled.'
      : room.settings.bots
        ? 'Clearly labelled AI practice. No XP or competitive profile stats.'
        : 'Server validates every shot, magazine, hit, kill and match result.';
    this.element.querySelector('[data-field-note]')!.textContent = room.combatEnabled
      ? room.settings.bots
        ? 'BOT PRACTICE · PROGRESSION OFF'
        : 'LIVE COMBAT · SERVER AUTHORITY'
      : 'MOVEMENT ONLINE / COMBAT DISABLED';
    this.element.querySelector('[data-hud-mode]')!.textContent = room.combatEnabled
      ? `TDM · FIRST TO ${room.settings.scoreLimit}`
      : 'NETWORK DRILL';
    this.element
      .querySelectorAll<HTMLElement>('[data-count-label]')
      .forEach((e) => (e.textContent = room.combatEnabled ? 'KILLS' : 'OPS'));
    this.element
      .querySelectorAll<HTMLElement>('[data-touch-combat],[data-combat-hint]')
      .forEach((e) => (e.hidden = !room.combatEnabled));
    this.combatHud.setActive(room.combatEnabled && ['ACTIVE', 'ENDING'].includes(room.phase));
    this.element.dataset.activeRoom = room.code;
    this.element.querySelector<HTMLElement>('[data-lobby]')!.hidden = !lobby;
    this.element.querySelector<HTMLElement>('[data-countdown]')!.hidden =
      room.phase !== 'COUNTDOWN';
    this.element.querySelector<HTMLElement>('[data-results]')!.hidden = room.phase !== 'RESULTS';
    for (const key of ['field-hud', 'minimap-panel', 'field-status', 'telemetry'])
      this.element.querySelector<HTMLElement>(`[data-${key}]`)!.hidden = !field;
    this.element.querySelector<HTMLElement>('[data-touch-controls]')!.hidden =
      room.phase !== 'ACTIVE';
    this.element.querySelector<HTMLElement>('[data-hints]')!.hidden = room.phase !== 'ACTIVE';
    this.element.querySelector<HTMLElement>('[data-room-code]')!.textContent = room.code;
    this.element.querySelector<HTMLElement>('[data-room-details]')!.textContent =
      `${room.settings.teamSize}v${room.settings.teamSize} · ${room.settings.timeLimitSeconds / 60} min${room.combatEnabled ? ` · ${room.settings.scoreLimit} kills` : ' · network drill'}`;
    const roster = this.rosterMarkup(room);
    this.element.querySelector('[data-teams]')!.innerHTML = roster;
    this.element.querySelector('[data-drawer-roster]')!.innerHTML = roster;
    this.element.querySelector<HTMLElement>('[data-your-team]')!.textContent =
      `${own?.team === 'blue' ? 'B / BLUE' : 'R / RED'} TEAM · YOUR OPERATOR`;
    this.element.querySelector<HTMLElement>('[data-your-name]')!.textContent = own?.name ?? '';
    this.element.querySelector<HTMLElement>('[data-blue-count]')!.textContent = String(
      room.combatEnabled
        ? room.scores.blue
        : room.players.filter((p) => p.connected && p.team === 'blue').length,
    );
    this.element.querySelector<HTMLElement>('[data-red-count]')!.textContent = String(
      room.combatEnabled
        ? room.scores.red
        : room.players.filter((p) => p.connected && p.team === 'red').length,
    );
    this.element.querySelector<HTMLElement>('[data-ping]')!.textContent =
      own?.latencyMs === null || own?.latencyMs === undefined ? 'MEASURING' : `${own.latencyMs} MS`;
    const ready = this.element.querySelector<HTMLButtonElement>('[data-ready]')!;
    ready.classList.toggle('is-ready', Boolean(own?.ready));
    ready.setAttribute('aria-pressed', String(Boolean(own?.ready)));
    ready.querySelector('span')!.textContent = own?.ready ? 'READY · CLICK TO CANCEL' : 'I’M READY';
    ready.disabled = this.status !== 'connected' || this.busy || room.publicRoom;
    ready.setAttribute('aria-busy', String(this.busy));
    const live = room.players.filter((p) => p.connected);
    const enough = live.length >= 2 && new Set(live.map((p) => p.team)).size === 2;
    const allReady = enough && live.every((p) => p.ready);
    const start = this.element.querySelector<HTMLButtonElement>('[data-start]')!;
    start.hidden = !owner || room.publicRoom;
    start.disabled = !allReady || this.status !== 'connected' || this.busy;
    this.element.querySelector<HTMLElement>('[data-guidance]')!.textContent = !enough
      ? 'Invite an operator to the other team to begin.'
      : !allReady
        ? 'Waiting for every operator to ready up.'
        : owner
          ? 'Squad is ready. You can start the field test.'
          : 'Squad is ready. Waiting for the room owner.';
    if (room.phase === 'RESULTS')
      this.element.querySelector('[data-results]')!.innerHTML = resultsMarkup(room, this.ownId);
    this.element.querySelector('[data-killfeed]')!.innerHTML = room.killfeed
      .slice(-5)
      .map(
        (k) =>
          `<div class="kill-line ${k.headshot ? 'headshot' : ''}"><strong>${escape(k.attacker)}</strong><span>${k.headshot ? 'HEADSHOT' : k.weaponId.toUpperCase()}</span><i>${escape(k.victim)}</i></div>`,
      )
      .join('');
  }
  private rosterMarkup(room: RoomState): string {
    return (['blue', 'red'] as const)
      .map((team) => {
        const players = room.players.filter((p) => p.team === team);
        const rows = players
          .map(
            (p) =>
              `<div class="roster-player ${!p.connected ? 'is-disconnected' : ''}" data-roster-player="${p.id}"><span class="player-avatar">${icon('user')}</span><div class="player-description"><strong>${escape(p.name)}${p.isBot ? '<i class="bot-tag">BOT</i>' : p.id === this.ownId ? '<i>YOU</i>' : ''}${p.id === room.ownerId ? `<span class="owner-badge" title="Room owner">${icon('shield')}</span>` : ''}</strong><small>${!p.connected ? 'RECONNECT SLOT RESERVED' : room.phase === 'LOBBY' ? (p.ready ? 'READY' : 'WAITING') : 'CONNECTED'}</small></div>${room.combatEnabled && room.phase !== 'LOBBY' ? `<span class="roster-kd"><b>${p.stats.kills}</b><i>${p.stats.deaths}</i><small>${p.stats.score}</small></span>` : ''}<span class="roster-latency">${p.isBot ? 'BOT' : p.latencyMs === null ? '—' : p.latencyMs + 'ms'}</span><span class="ready-indicator ${p.connected && p.ready ? 'is-ready' : ''}">${p.connected && p.ready ? icon('check') : ''}</span></div>`,
          )
          .join('');
        const slots = Array.from(
          { length: Math.max(0, room.settings.teamSize - players.length) },
          () => `<div class="open-slot"><span>+</span> OPEN SLOT</div>`,
        ).join('');
        return `<section class="team-roster ${team}"><h2><span>${team === 'blue' ? 'B' : 'R'}</span>${team.toUpperCase()} TEAM<small>${players.length} / ${room.settings.teamSize}</small></h2>${rows}${slots}</section>`;
      })
      .join('');
  }
  setBusy(busy: boolean): void {
    this.busy = busy;
    this.update(this.room);
    if (busy) this.element.querySelector('[data-ready] span')!.textContent = 'SENDING REQUEST…';
  }
  setConnection(status: ConnectionStatus): void {
    this.status = status;
    this.element.querySelector<HTMLElement>('[data-reconnect]')!.hidden = status === 'connected';
    this.element.querySelector<HTMLElement>('[data-reconnect-title]')!.textContent =
      status === 'disconnected' ? 'CONNECTION LOST' : 'RECONNECTING';
    this.element.querySelector<HTMLElement>('[data-reconnect-message]')!.textContent =
      status === 'disconnected'
        ? 'Retry to restore your session if the server still has your slot.'
        : 'Your slot is reserved for up to 20 seconds. Movement is stopped while reconnecting.';
    this.element.querySelector<HTMLElement>('[data-retry]')!.hidden = status !== 'disconnected';
    const indicator = this.element.querySelector<HTMLElement>('[data-connection]')!;
    indicator.classList.toggle('is-offline', status !== 'connected');
    indicator.querySelector('span')!.textContent = status.toUpperCase();
    this.update(this.room);
  }
  setRoster(open: boolean): void {
    this.rosterOpen = open;
    this.element.querySelector<HTMLElement>('[data-roster]')!.hidden = !open;
  }
  toggleRoster(): void {
    this.setRoster(!this.rosterOpen);
  }
  snapshot(snapshot: Snapshot): void {
    this.latestSnapshot = snapshot;
    this.combatHud.snapshot(snapshot);
    this.element.querySelector('[data-blue-count]')!.textContent = String(
      this.room.combatEnabled
        ? snapshot.scores.blue
        : this.room.players.filter((p) => p.team === 'blue' && p.connected).length,
    );
    this.element.querySelector('[data-red-count]')!.textContent = String(
      this.room.combatEnabled
        ? snapshot.scores.red
        : this.room.players.filter((p) => p.team === 'red' && p.connected).length,
    );
  }
  combatEvent(message: CombatEvent, settings: Settings): void {
    this.combatHud.event(message, settings);
  }
  inputState(
    pointer: { x: number; y: number; active: boolean },
    settings: Settings,
    cameraYaw: number,
  ): void {
    this.pointer = pointer;
    this.preferences = settings;
    this.cameraYaw = cameraYaw;
  }
  tick(serverNow: number, poses: Transform[], now: number): void {
    this.combatHud.tick(serverNow, now, this.pointer, this.preferences, this.cameraYaw);
    const self = this.latestSnapshot?.players.find((p) => p.id === this.ownId);
    this.element.classList.toggle('operator-down', (self?.combat?.health ?? 100) <= 0);
    const remaining =
      this.room.phaseEndsAtMs === null ? 0 : Math.max(0, this.room.phaseEndsAtMs - serverNow);
    const seconds = Math.ceil(remaining / 1000);
    this.element.querySelector('[data-timer]')!.textContent = `${Math.floor(seconds / 60)
      .toString()
      .padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
    this.element.querySelector('[data-countdown-number]')!.textContent = String(
      Math.max(1, seconds),
    );
    const local = poses.find((p) => p.id === this.ownId);
    if (local)
      this.element.querySelector('[data-coordinates]')!.textContent =
        `X ${local.x.toFixed(1)} / Z ${local.z.toFixed(1)} M`;
    if (now - this.lastMapAt > 100) {
      this.minimap.draw(
        poses,
        this.ownId,
        this.teams,
        this.latestSnapshot?.contacts ?? [],
        serverNow,
        this.latestSnapshot?.destroyed ?? [],
        this.room.combatEnabled,
      );
      this.lastMapAt = now;
    }
  }
  sceneReady(): void {
    this.element.querySelector<HTMLElement>('[data-scene-loading]')!.hidden = true;
  }
  sceneError(message: string): void {
    const loading = this.element.querySelector<HTMLElement>('[data-scene-loading]')!;
    loading.classList.add('scene-error');
    loading.textContent = message;
  }
}
