import type { CombatEvent, GameConfig, Snapshot, Transform } from '../multiplayer/protocol';
import type { Settings } from '../services/Settings';
import { icon } from './icons';
import type { GrenadePreview } from '../game/GrenadeAim';

/** Presentation reads server combat snapshots; no local ammunition or damage decisions. */
export class CombatHud {
  readonly element = document.createElement('div');
  private pose: Transform | null = null;
  private hitAt = -1e9;
  private head = false;
  private damageAt = -1e9;
  private bearing = 0;
  private killAt = -1e9;
  private deathName = '';
  private active = false;
  constructor(
    private ownId: string,
    private config: GameConfig,
  ) {
    this.element.className = 'combat-ui';
    this.element.hidden = true;
    this.element.innerHTML = `<section class="vitals-panel"><div class="vitals-heading">${icon('shield')}<span>OPERATOR VITALS</span><b data-health>100</b></div><div class="health-track"><i data-health-bar></i></div><div class="armor-row"><span>ARMOR</span><div><i data-armor-bar></i></div><b data-armor>65</b></div><span class="spawn-protection" data-protection hidden></span></section>
      <section class="weapon-panel"><span class="weapon-class" data-weapon-class></span><strong data-weapon-label></strong><div class="ammo-row"><b data-magazine>—</b><span>/</span><i data-reserve>—</i><small data-weapon-state></small></div><div class="reload-track" data-reload-track hidden><i data-reload-fill></i></div><div class="weapon-slots"><button data-action="weapon-1" data-slot="1">1 · PRIMARY</button><button data-action="weapon-2" data-slot="2">2 · PISTOL</button><button data-action="grenade">${icon('plus')} FRAG <b data-grenades>—</b></button></div></section>
      <div class="grenade-target-hint" data-grenade-target hidden></div><div class="tactical-crosshair" data-crosshair><i></i><i></i><i></i><i></i><b></b></div><div class="hit-confirmation" data-hit-marker hidden><i></i><i></i><i></i><i></i></div><div class="damage-feedback" data-damage-feedback hidden><i data-damage-bearing></i></div><div class="kill-confirmation" data-kill-confirmation hidden>ELIMINATION <b>+100</b></div>
      <div class="death-feedback" data-death hidden><span>OPERATOR DOWN</span><strong data-respawn>3.0</strong><small data-eliminated-by></small></div>`;
  }
  grenadeTarget(preview: GrenadePreview | null): void {
    const hint = this.element.querySelector<HTMLElement>('[data-grenade-target]')!;
    hint.hidden = !preview;
    if (preview) {
      hint.textContent = `G · FRAG ${preview.distance.toFixed(1)}m · ${preview.reason === 'clear' ? 'CLEAR LANDING' : preview.reason === 'blocked' ? 'COVER WILL BLOCK / BOUNCE' : preview.reason === 'range' ? 'OUT OF RANGE · MAX 32m' : 'OUTSIDE MAP'}`;
      hint.dataset.status = preview.reason;
    }
  }
  setActive(enabled: boolean) {
    this.active = enabled;
    this.element.hidden = !enabled;
  }
  snapshot(snapshot: Snapshot) {
    this.pose = snapshot.players.find((p) => p.id === this.ownId) ?? null;
  }
  event(message: CombatEvent, settings: Settings) {
    const e = message.event,
      now = performance.now();
    if (
      e.kind === 'damage' &&
      e.attackerId === this.ownId &&
      e.victimId !== this.ownId &&
      e.damage > 0 &&
      settings.hitMarkers
    ) {
      this.hitAt = now;
      this.head = e.headshot;
    }
    if (e.kind === 'damage' && e.victimId === this.ownId && settings.damageIndicators) {
      this.damageAt = now;
      this.bearing = e.bearing;
    }
    if (e.kind === 'kill' && e.attackerId === this.ownId && !e.teamkill) {
      this.killAt = now;
    }
    if (e.kind === 'kill' && e.victimId === this.ownId) this.deathName = e.attacker;
    if (e.kind === 'respawn' && e.playerId === this.ownId) this.deathName = '';
  }
  tick(
    serverNow: number,
    now: number,
    pointer: { x: number; y: number; active: boolean },
    settings: Settings,
    cameraYaw: number,
  ) {
    if (!this.active) return;
    const c = this.pose?.combat;
    if (!c) return;
    const query = (s: string) => this.element.querySelector<HTMLElement>(`[data-${s}]`)!;
    query('health').textContent = String(Math.ceil(c.health));
    query('armor').textContent = String(Math.ceil(c.armor));
    query('health-bar').style.width = `${c.health}%`;
    query('armor-bar').style.width = `${(c.armor / 65) * 100}%`;
    this.element.classList.toggle('is-hurt', c.health < 30);
    this.element.classList.toggle('is-ads', c.ads);
    query('magazine').textContent = String(c.magazine);
    query('reserve').textContent = String(c.reserve);
    query('grenades').textContent = String(c.grenades);
    const weapon = this.config.weapons.find((w) => w.id === c.weaponId);
    query('weapon-label').textContent = weapon?.label ?? c.weaponId.toUpperCase();
    query('weapon-class').textContent = weapon?.class ?? '';
    const state =
      c.health <= 0
        ? 'DISABLED'
        : c.weaponState === 'RELOADING'
          ? 'RELOADING'
          : c.weaponState === 'SWITCHING'
            ? 'DRAWING'
            : c.magazine === 0
              ? 'EMPTY'
              : c.ads
                ? 'ADS'
                : weapon?.fireMode === 'semi'
                  ? 'SEMI'
                  : 'AUTO';
    query('weapon-state').textContent = state;
    this.element
      .querySelectorAll<HTMLElement>('[data-slot]')
      .forEach((b) => b.classList.toggle('equipped', Number(b.dataset.slot) === c.slot));
    query('reload-track').hidden = c.reloadEndsAtMs === null;
    if (c.reloadEndsAtMs !== null && c.reloadStartedAtMs !== null)
      query('reload-fill').style.width =
        `${Math.max(0, Math.min(1, (serverNow - c.reloadStartedAtMs) / (c.reloadEndsAtMs - c.reloadStartedAtMs))) * 100}%`;
    query('protection').hidden = c.protectedUntilMs <= serverNow || c.health <= 0;
    query('protection').textContent =
      `SPAWN SHIELD · ${Math.max(0, (c.protectedUntilMs - serverNow) / 1000).toFixed(1)}s`;
    const dead = c.health <= 0;
    query('death').hidden = !dead;
    query('respawn').textContent = Math.max(
      0,
      ((c.respawnAtMs ?? serverNow) - serverNow) / 1000,
    ).toFixed(1);
    query('eliminated-by').textContent = this.deathName
      ? `ELIMINATED BY ${this.deathName}`
      : 'REDEPLOYING AT A SAFE TEAM SPAWN';
    const cross = query('crosshair');
    cross.hidden = dead;
    cross.classList.toggle('is-dot', settings.crosshair === 'dot');
    const px = pointer.active ? ((pointer.x + 1) / 2) * 100 : 50,
      py = pointer.active ? ((1 - pointer.y) / 2) * 100 : 50;
    cross.style.left = `${px}%`;
    cross.style.top = `${py}%`;
    const hint = query('grenade-target');
    hint.style.left = `${Math.min(72, Math.max(3, px))}%`;
    hint.style.top = `${Math.min(83, Math.max(15, py))}%`;
    cross.style.setProperty(
      '--spread',
      `${Math.min(21, (c.ads ? 4 : 8) + c.bloom * 360 + Math.hypot(this.pose?.vx ?? 0, this.pose?.vz ?? 0) * 0.7)}px`,
    );
    const marker = query('hit-marker');
    marker.hidden = !settings.hitMarkers || now - this.hitAt > 150;
    marker.classList.toggle('headshot', this.head);
    marker.style.left = `${px}%`;
    marker.style.top = `${py}%`;
    query('damage-feedback').hidden = !settings.damageIndicators || now - this.damageAt > 350;
    query('damage-bearing').style.transform =
      `translate(-50%,-50%) rotate(${((this.bearing - cameraYaw) * 180) / Math.PI}deg)`;
    query('kill-confirmation').hidden = now - this.killAt > 1400;
  }
}
