import type { ArenaScene } from './game/ArenaScene';
import { LocalPrediction } from './game/physics';
import { InputController } from './input/InputController';
import { InterpolationBuffer } from './multiplayer/Interpolation';
import { MultiplayerService } from './multiplayer/WebSocketService';
import type {
  GameConfig,
  Health,
  Profile,
  RoomSettings,
  RoomState,
  Snapshot,
} from './multiplayer/protocol';
import { Api } from './services/Api';
import { SettingsStore, type Settings } from './services/Settings';
import { Dialogs } from './ui/Dialogs';
import { MenuScreen } from './ui/MenuScreen';
import { RoomScreen } from './ui/RoomScreen';
import { AudioSystem } from './audio/AudioSystem';

/** Coordinates replaceable services, input, and presentation. No game authority. */
export class GameApp {
  private screenHost = document.createElement('div');
  private toastHost = document.createElement('div');
  private dialogs: Dialogs;
  private network = new MultiplayerService();
  private settings = new SettingsStore();
  private audio = new AudioSystem(() => this.settings.value);
  private lastCountdown = -1;
  private interpolation = new InterpolationBuffer();
  private prediction: LocalPrediction | null = null;
  private config: GameConfig | null = null;
  private fieldConfig: GameConfig | null = null;
  private profile: Profile | null = null;
  private health: Health | null = null;
  private menu: MenuScreen | null = null;
  private field: RoomScreen | null = null;
  private scene: ArenaScene | null = null;
  private input: InputController | null = null;
  private room: RoomState | null = null;
  private latestSnapshot: Snapshot | null = null;
  private inputTimer = 0;
  private generation = 0;
  private actionBusy = false;
  private inviteCode = '';
  private healthTimer = 0;
  private events = new AbortController();
  private unsubscribe: (() => void)[] = [];

  constructor(private root: HTMLElement) {
    root.replaceChildren(this.screenHost);
    this.toastHost.className = 'toast-region';
    this.toastHost.setAttribute('aria-live', 'polite');
    this.dialogs = new Dialogs(root, () => this.updateInputEnabled());
    root.append(this.toastHost);
    this.unsubscribe.push(this.network.onRoom((room) => this.onRoom(room)));
    this.unsubscribe.push(this.network.onSnapshot((snapshot) => this.onSnapshot(snapshot)));
    this.unsubscribe.push(
      this.network.onCombat((message) => {
        this.scene?.combatEvent(message);
        this.field?.combatEvent(message, this.settings.value);
        this.audio.event(
          message,
          this.network.playerId ?? '',
          this.latestSnapshot?.players.find((p) => p.id === this.network.playerId) ?? null,
          this.scene?.camera.yaw ?? 0,
        );
      }),
    );
    this.unsubscribe.push(
      this.network.onProfile((profile) => {
        this.profile = profile;
        this.menu?.setProfile(profile);
      }),
    );
    this.unsubscribe.push(
      this.network.onError((message) => {
        this.toast(message, true);
      }),
    );
    this.unsubscribe.push(
      this.network.onStatus((status) => {
        this.field?.setConnection(status);
        this.updateInputEnabled();
        if (status !== 'connected') {
          this.prediction?.reset();
          this.input?.reset();
        }
      }),
    );
    const signal = this.events.signal;
    root.addEventListener('pointerdown', () => this.audio.activate(), { signal });
    root.addEventListener(
      'click',
      (e) => {
        const button = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-action]');
        if (button && !button.disabled) void this.action(button.dataset.action ?? '');
      },
      { signal },
    );
    window.addEventListener('beforeunload', () => this.network.disconnect(), { signal });
    document.addEventListener(
      'visibilitychange',
      () => {
        this.updateInputEnabled();
      },
      { signal },
    );
    this.applySettings();
    this.showMenu();
    const query = new URLSearchParams(window.location.search);
    const code = query.get('room')?.toUpperCase() ?? '';
    if (/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(code)) this.inviteCode = code;
  }

  async initialize(): Promise<void> {
    const [config, session] = await Promise.allSettled([
      Api.config(),
      Api.session(),
      this.refreshHealth(),
    ]);
    if (config.status === 'fulfilled') {
      this.config = config.value;
      this.prediction = new LocalPrediction(config.value);
    } else
      this.toast(
        'Unable to load field configuration. Recheck room service before creating a room.',
        true,
      );
    if (session.status === 'fulfilled' && this.profile === null)
      this.profile = session.value.profile;
    if (!this.room) this.showMenu();
    this.healthTimer = window.setInterval(() => {
      if (!this.room && !document.hidden) void this.refreshHealth();
    }, 15_000);
    if (session.status === 'fulfilled' && session.value.roomCode && this.config) {
      try {
        await this.network.connect();
      } catch (error) {
        this.toast(this.errorText(error), true);
      }
    } else if (this.inviteCode)
      this.dialogs.join(this.profile, this.inviteCode, (form) => void this.join(form));
  }

  private showMenu(): void {
    this.audio.setMenu(true);
    this.menu = new MenuScreen(this.config, this.profile);
    this.menu.setHealth(this.health);
    this.screenHost.replaceChildren(this.menu.element);
  }

  private async refreshHealth(): Promise<void> {
    try {
      this.health = await Api.health();
    } catch {
      this.health = null;
    }
    this.menu?.setHealth(this.health);
  }

  private async ensureConfig(): Promise<GameConfig> {
    if (!this.config) {
      this.config = await Api.config();
      this.prediction = new LocalPrediction(this.config);
    }
    return this.config;
  }
  private async ensureGuest(name: string): Promise<void> {
    this.profile = await Api.saveGuest(name.trim());
    this.menu?.setProfile(this.profile);
  }
  private async create(form: FormData): Promise<void> {
    this.dialogs.setBusy(true);
    try {
      await this.ensureConfig();
      await this.ensureGuest(String(form.get('name') ?? ''));
      await this.network.connect();
      const settings = {
        mapId: String(form.get('mapId') ?? 'outpost'),
        teamSize: Number(form.get('teamSize')),
        timeLimitSeconds: Number(form.get('timeLimitSeconds')),
        mode: String(form.get('mode') ?? 'TEAM_DEATHMATCH'),
        scoreLimit: Number(form.get('scoreLimit') ?? 50),
        bots: Number(form.get('bots') ?? 0),
        difficulty: String(form.get('difficulty') ?? 'normal'),
        friendlyFire: form.get('friendlyFire') === 'on',
      } as RoomSettings;
      await this.network.action('create_room', { settings });
      this.dialogs.setBusy(false);
      this.dialogs.close();
    } catch (error) {
      this.dialogs.setBusy(false);
      this.dialogs.error(this.errorText(error));
    }
  }
  private async join(form: FormData): Promise<void> {
    this.dialogs.setBusy(true);
    try {
      await this.ensureConfig();
      await this.ensureGuest(String(form.get('name') ?? ''));
      await this.network.connect();
      await this.network.action('join_room', {
        code: String(form.get('code') ?? '')
          .trim()
          .toUpperCase(),
      });
      this.dialogs.setBusy(false);
      this.dialogs.close();
    } catch (error) {
      this.dialogs.setBusy(false);
      this.dialogs.error(this.errorText(error));
    }
  }
  private async quickPlay(form: FormData): Promise<void> {
    this.dialogs.setBusy(true);
    try {
      await this.ensureConfig();
      await this.ensureGuest(String(form.get('name') ?? ''));
      await this.network.connect();
      await this.network.action('quick_play', { mapId: String(form.get('mapId') ?? 'outpost') });
      this.dialogs.setBusy(false);
      this.dialogs.close();
    } catch (error) {
      this.dialogs.setBusy(false);
      this.dialogs.error(this.errorText(error));
    }
  }
  private async saveLoadout(form: FormData): Promise<void> {
    this.dialogs.setBusy(true);
    try {
      this.profile = await Api.saveLoadout(
        String(form.get('primary') ?? 'rifle'),
        String(form.get('cosmetic') ?? 'olive'),
      );
      this.menu?.setProfile(this.profile);
      this.dialogs.setBusy(false);
      this.dialogs.close();
      this.toast('Loadout saved on the server.');
    } catch (error) {
      this.dialogs.setBusy(false);
      this.dialogs.error(this.errorText(error));
    }
  }
  private async saveCallsign(form: FormData): Promise<void> {
    this.dialogs.setBusy(true);
    try {
      await this.ensureGuest(String(form.get('name') ?? ''));
      this.dialogs.setBusy(false);
      this.dialogs.close();
      this.toast('Guest callsign saved on the server.');
    } catch (error) {
      this.dialogs.setBusy(false);
      this.dialogs.error(this.errorText(error));
    }
  }

  private onRoom(room: RoomState | null): void {
    const previous = this.room;
    this.room = room;
    if (!room) {
      if (previous || this.field) {
        this.dialogs.setBusy(false);
        this.dialogs.close();
        this.destroyField();
        this.showMenu();
      }
      return;
    }
    if (!this.field || previous?.id !== room.id) {
      this.destroyField();
      const ownId = this.network.playerId;
      if (!ownId || !this.config) {
        this.toast('Field configuration or guest identity is missing. Reload to recover.', true);
        return;
      }
      const selectedMap = this.config.maps.find((m) => m.id === room.mapId) ?? this.config.map;
      this.fieldConfig = { ...this.config, map: selectedMap };
      this.prediction = new LocalPrediction(this.fieldConfig);
      this.menu = null;
      this.field = new RoomScreen(room, ownId, this.fieldConfig);
      this.screenHost.replaceChildren(this.field.element);
      this.input = new InputController(
        this.field.element,
        () => this.settings.value,
        () => this.toggleMenu(),
        (visible) => this.field?.setRoster(visible),
        (delta) => this.zoom(delta),
        (action) => {
          void this.action(action);
        },
        () => this.stepInput(false),
      );
      const token = ++this.generation,
        config = this.fieldConfig,
        screen = this.field;
      void import('./game/ArenaScene')
        .then(({ ArenaScene: Scene }) => {
          if (token !== this.generation || this.field !== screen) return;
          try {
            this.scene = new Scene(
              screen.sceneElement,
              screen.labelsElement,
              config,
              ownId,
              this.settings.value,
              (dt) => this.frame(dt),
            );
            this.scene.setCombatEnabled(this.room?.combatEnabled ?? false);
            if (this.latestSnapshot) this.scene.snapshot(this.latestSnapshot);
            this.syncVisiblePlayers();
            this.scene.camera.overview = this.room?.phase === 'LOBBY';
            screen.sceneReady();
            this.updateInputEnabled();
            this.inputTimer = window.setInterval(() => this.stepInput(), 1000 / config.tickHz);
          } catch {
            screen.sceneError(
              'WebGL could not start. The network lobby still works, but field movement needs a WebGL-capable browser.',
            );
            this.toast(
              '3D field renderer unavailable. Use the field menu to leave this room.',
              true,
            );
          }
        })
        .catch(() =>
          screen.sceneError('Field assets could not load. Reload with a stable connection.'),
        );
    }
    this.field.update(room);
    this.scene?.setCombatEnabled(room.combatEnabled);
    this.syncVisiblePlayers();
    if (this.scene) this.scene.camera.overview = room.phase === 'LOBBY';
    if (previous?.phase !== room.phase) {
      this.input?.reset();
      if (room.phase !== 'ACTIVE') this.prediction?.reset();
    }
    this.audio.setMenu(room.phase === 'LOBBY' || room.phase === 'RESULTS');
    this.updateInputEnabled();
  }
  private onSnapshot(snapshot: Snapshot): void {
    this.latestSnapshot = snapshot;
    this.interpolation.push(snapshot);
    this.scene?.snapshot(snapshot);
    this.syncVisiblePlayers();
    this.field?.snapshot(snapshot);
    const own = snapshot.players.find((p) => p.id === this.network.playerId);
    if (own) {
      this.prediction?.world(snapshot.destroyed, snapshot.players, own.id);
      this.prediction?.accept(own);
    }
    this.updateInputEnabled();
  }
  private syncVisiblePlayers(): void {
    if (this.room) this.scene?.setPlayers(this.room.players);
  }
  private updateAim(): void {
    if (!this.input?.enabled || !this.scene || !this.input.pointer.active) return;
    const position = this.scene.localPosition;
    const target = this.scene.mousePoint(this.input.pointer.x, this.input.pointer.y);
    const own = this.latestSnapshot?.players.find((p) => p.id === this.network.playerId);
    if (position && target)
      this.input.faceMouse(
        target.x,
        target.z,
        position.x,
        position.z,
        target.y,
        own?.combat?.crouch ? 0.79 : 1.21,
      );
  }
  private frame(dt: number): void {
    if (!this.scene || !this.input || !this.field || !this.room) return;
    const scene = this.scene,
      input = this.input;
    scene.camera.rotate(input.rotation(dt));
    this.updateAim();
    scene.setServerTime(this.network.serverNow());
    const poses = this.interpolation.sample(this.network.serverNow());
    const ownIndex = poses.findIndex((p) => p.id === this.network.playerId);
    if (
      ownIndex !== -1 &&
      this.room.phase === 'ACTIVE' &&
      this.network.status === 'connected' &&
      this.prediction?.pose
    )
      poses[ownIndex] = this.prediction.pose;
    scene.updatePoses(poses, dt);
    this.audio.tick(poses, this.network.playerId ?? '', performance.now(), scene.camera.yaw);
    if (this.room.phase === 'COUNTDOWN') {
      const n = Math.ceil(
        Math.max(0, (this.room.phaseEndsAtMs ?? 0) - this.network.serverNow()) / 1000,
      );
      if (n !== this.lastCountdown && n >= 1 && n <= 3) {
        this.audio.countdown();
        this.lastCountdown = n;
      }
    } else this.lastCountdown = -1;
    const grenadePose = poses.find((p) => p.id === this.network.playerId) ?? null;
    const mouseTarget = input.pointer.active
      ? scene.mousePoint(input.pointer.x, input.pointer.y)
      : null;
    const guide = scene.grenadeTarget(
      grenadePose,
      mouseTarget,
      input.enabled && this.room.phase === 'ACTIVE' && input.pointer.active,
    );
    this.field.grenadeTarget(guide);
    this.field.inputState(input.pointer, this.settings.value, scene.camera.yaw);
    this.field.tick(this.network.serverNow(), poses, performance.now());
  }
  // Intent transport is not tied to render FPS. The server still owns elapsed time.
  private stepInput(predict = true): void {
    if (
      !this.scene ||
      !this.input ||
      this.room?.phase !== 'ACTIVE' ||
      this.network.status !== 'connected' ||
      document.hidden
    )
      return;
    this.updateAim();
    const intent = this.input.sample(this.scene.camera.yaw);
    const seq = this.network.input(intent);
    if (seq !== null && predict)
      this.prediction?.step(seq, intent, 1 / (this.config?.tickHz ?? 30));
  }
  private updateInputEnabled(): void {
    if (!this.input) return;
    const alive =
      !this.room?.combatEnabled ||
      (this.latestSnapshot?.players.find((p) => p.id === this.network.playerId)?.combat?.health ??
        0) > 0;
    const enabled =
      alive &&
      this.room?.phase === 'ACTIVE' &&
      this.network.status === 'connected' &&
      !this.dialogs.isOpen &&
      !document.hidden &&
      this.scene !== null;
    if (this.input.enabled && !enabled) this.input.reset();
    this.input.enabled = enabled;
  }
  private destroyField(): void {
    window.clearInterval(this.inputTimer);
    this.inputTimer = 0;
    this.generation++;
    this.input?.dispose();
    this.input = null;
    this.scene?.dispose();
    this.scene = null;
    this.field = null;
    this.fieldConfig = null;
    this.latestSnapshot = null;
    this.interpolation.reset();
    this.prediction?.reset();
  }
  private applySettings(next?: Partial<Settings>): boolean {
    const saved = next ? this.settings.save(next) : true;
    this.root.style.setProperty('--touch-scale', String(this.settings.value.touchScale));
    this.scene?.applySettings(this.settings.value);
    this.audio.apply();
    return saved;
  }
  private zoom(delta: number): void {
    this.applySettings({ zoom: Math.max(11, Math.min(22, this.settings.value.zoom + delta)) });
  }
  private toggleMenu(): void {
    if (this.dialogs.isOpen) {
      this.dialogs.close();
      return;
    }
    if (this.room && this.network.playerId) this.dialogs.pause(this.room, this.network.playerId);
  }

  private async action(action: string): Promise<void> {
    try {
      this.audio.ui();
      switch (action) {
        case 'operations':
          this.dialogs.close();
          break;
        case 'quick-play':
          this.dialogs.quickPlay(
            this.profile,
            await this.ensureConfig(),
            (form) => void this.quickPlay(form),
          );
          break;
        case 'profile': {
          const current = await Api.session();
          this.profile = current.profile;
          if (!this.profile) this.dialogs.callsign(null, (form) => void this.saveCallsign(form));
          else this.dialogs.profile(this.profile, this.config);
          break;
        }
        case 'loadout': {
          if (this.room) throw new Error('Leave your room before changing your stored loadout.');
          const current = await Api.session();
          this.profile = current.profile;
          if (!this.profile) this.dialogs.callsign(null, (form) => void this.saveCallsign(form));
          else
            this.dialogs.loadout(
              this.profile,
              await this.ensureConfig(),
              (form) => void this.saveLoadout(form),
            );
          break;
        }
        case 'create':
          this.dialogs.create(
            this.profile,
            await this.ensureConfig(),
            (form) => void this.create(form),
          );
          break;
        case 'join':
          this.dialogs.join(this.profile, this.inviteCode, (form) => void this.join(form));
          break;
        case 'callsign':
          this.dialogs.callsign(this.profile, (form) => void this.saveCallsign(form));
          break;
        case 'settings':
          this.dialogs.settings(this.settings.value, (next) => this.applySettings(next));
          break;
        case 'help':
          this.dialogs.help();
          break;
        case 'brief':
          this.dialogs.brief(await this.ensureConfig());
          break;
        case 'pause':
          this.toggleMenu();
          break;
        case 'roster':
          this.field?.toggleRoster();
          break;
        case 'refresh-service':
          await this.refreshHealth();
          if (!this.config && this.health) {
            await this.ensureConfig();
            if (!this.room) this.showMenu();
          }
          this.toast(
            this.health ? 'Room service checked.' : 'Room service is unavailable.',
            !this.health,
          );
          break;
        case 'fullscreen':
          if (document.fullscreenElement) await document.exitFullscreen();
          else await this.root.requestFullscreen();
          break;
        case 'copy-code':
          if (this.room) await this.copy(this.room.code, 'Room code copied.');
          break;
        case 'copy-link':
          if (this.room) {
            const url = new URL(window.location.href);
            url.search = '';
            url.searchParams.set('room', this.room.code);
            url.hash = '';
            await this.copy(
              url.toString(),
              'Invite link copied. Open it in another browser or private window.',
            );
          }
          break;
        case 'share':
          if (this.room && typeof navigator.share === 'function') {
            const url = new URL(window.location.href);
            url.search = '';
            url.hash = '';
            url.searchParams.set('room', this.room.code);
            try {
              await navigator.share({
                title: 'Tactical Arena · Private field test',
                text: `Join room ${this.room.code}. Stage 01 network drill; combat is not enabled.`,
                url: url.toString(),
              });
            } catch (error) {
              if (!(error instanceof DOMException && error.name === 'AbortError'))
                throw new Error(
                  'Sharing is unavailable in this browser context. Use Copy invite link instead.',
                );
            }
          }
          break;
        case 'reload':
          await this.command('reload');
          break;
        case 'weapon-1':
          await this.command('switch_weapon', { slot: 1 });
          break;
        case 'weapon-2':
          await this.command('switch_weapon', { slot: 2 });
          break;
        case 'weapon-toggle':
          await this.command('switch_weapon', {
            slot:
              this.latestSnapshot?.players.find((p) => p.id === this.network.playerId)?.combat
                ?.slot === 2
                ? 1
                : 2,
          });
          break;
        case 'grenade': {
          this.updateAim();
          const target =
            this.scene && this.input?.pointer.active
              ? this.scene.mousePoint(this.input.pointer.x, this.input.pointer.y)
              : null;
          await this.command(
            'grenade',
            target ? { targetX: target.x, targetZ: target.z } : { power: 0.85 },
          );
          break;
        }
        case 'retry-results':
          await this.command('retry_results');
          break;
        case 'ready':
          await this.command('ready', {
            ready: !this.room?.players.find((p) => p.id === this.network.playerId)?.ready,
          });
          break;
        case 'start':
          await this.command('start');
          break;
        case 'return-lobby':
          if (this.room?.combatEnabled && this.room.phase === 'ACTIVE') {
            this.dialogs.abort();
            break;
          }
          await this.command('return_lobby');
          this.dialogs.close();
          break;
        case 'confirm-return-lobby':
          await this.command('return_lobby');
          this.dialogs.close();
          break;
        case 'leave':
          this.dialogs.leave();
          break;
        case 'confirm-leave':
          if (this.network.status === 'connected' && this.room) await this.command('leave');
          this.network.disconnect();
          this.room = null;
          this.destroyField();
          this.showMenu();
          this.dialogs.close();
          void this.refreshHealth();
          break;
        case 'retry-connection':
          await this.network.connect();
          break;
        case 'zoom-in':
          this.zoom(-1);
          break;
        case 'zoom-out':
          this.zoom(1);
          break;
      }
    } catch (error) {
      const message = this.errorText(error);
      if (this.dialogs.isOpen) this.dialogs.error(message);
      else this.toast(message, true);
    }
  }
  private async command(
    type: import('./multiplayer/protocol').Action,
    data: Record<string, unknown> = {},
  ): Promise<void> {
    if (this.actionBusy)
      throw new Error('A room action is already pending. Please wait for the server.');
    this.actionBusy = true;
    this.field?.setBusy(true);
    try {
      await this.network.action(type, data);
    } finally {
      this.actionBusy = false;
      this.field?.setBusy(false);
    }
  }
  private async copy(text: string, confirmation: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const input = document.createElement('textarea');
      input.value = text;
      input.style.position = 'fixed';
      input.style.opacity = '0';
      this.root.append(input);
      input.select();
      const copied = document.execCommand('copy');
      input.remove();
      if (!copied)
        throw new Error('Clipboard unavailable. Select the room code and copy it manually.');
    }
    this.toast(confirmation);
  }
  private toast(message: string, error = false): void {
    const toast = document.createElement('div');
    toast.className = `toast${error ? ' error' : ''}`;
    toast.textContent = message;
    this.toastHost.append(toast);
    if (this.toastHost.children.length > 3) this.toastHost.firstElementChild?.remove();
    window.setTimeout(() => toast.remove(), error ? 7000 : 4300);
  }
  private errorText(error: unknown): string {
    return error instanceof Error
      ? error.message
      : 'An unexpected error occurred. Please try again.';
  }

  /** Lifecycle seam for a future native shell; no retained matches/listeners. */
  dispose(): void {
    window.clearInterval(this.healthTimer);
    this.network.disconnect();
    this.destroyField();
    this.dialogs.close();
    this.unsubscribe.forEach((fn) => fn());
    this.events.abort();
    this.audio.dispose();
  }
}
