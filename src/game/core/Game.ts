// Game orchestrator: renderer, scene, loop, state machine, system wiring.
// Single rAF loop, explicit states, full restart/menu cleanup.
import * as THREE from 'three';
import { GameState, type HudSnapshot } from './GameStates';
import { EventBus } from './EventBus';
import { InputManager } from './InputManager';
import { createMaterials, createGeometries, createTextures, type MaterialLib, type GeometryLib } from '../world/Materials';
import { Level } from '../world/Level';
import { TacticalCamera } from '../camera/TacticalCamera';
import { Player } from '../entities/Player';
import { Enemy } from '../entities/Enemy';
import { AIController, type AIContext } from '../ai/AIController';
import { CoverSystem } from '../ai/CoverSystem';
import { SquadAwareness } from '../ai/SquadAwareness';
import { CombatSystem } from '../systems/CombatSystem';
import { GrenadeSystem } from '../systems/GrenadeSystem';
import { SpawnSystem } from '../systems/SpawnSystem';
import { ProgressionSystem } from '../systems/ProgressionSystem';
import { SettingsManager } from '../systems/SettingsManager';
import { ParticleSystem } from '../vfx/ParticleSystem';
import { ThreatIndicator, type ThreatContact } from '../vfx/ThreatIndicator';
import { AudioManager } from '../audio/AudioManager';
import { CAMERA_CONFIG, ROUNDS, THREATS, WEAPON_ORDER, type EnemyArchetype } from '../data/config';
import { clamp } from '../utils/math';

// Per-frame scratch (no allocation in the hot loop).
const _camFwd = new THREE.Vector3(0, 0, -1);
const _camRight = new THREE.Vector3(1, 0, 0);

export class Game {
  state: GameState = GameState.MENU;
  events = new EventBus();
  input = new InputManager();
  settings = new SettingsManager();
  audio = new AudioManager();

  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private cameraRig: TacticalCamera | null = null;
  private level: Level | null = null;
  private player: Player | null = null;
  private mats: MaterialLib | null = null;
  private geos: GeometryLib | null = null;
  private particles: ParticleSystem | null = null;
  private threats: ThreatIndicator | null = null;
  private combat: CombatSystem | null = null;
  private grenades: GrenadeSystem | null = null;
  private spawns: SpawnSystem | null = null;
  private progression = new ProgressionSystem();
  private cover: CoverSystem | null = null;
  private squad = new SquadAwareness();
  private enemies: Enemy[] = [];
  private controllers = new Map<number, AIController>();
  private corpses: { enemy: Enemy; removeAt: number }[] = [];
  private threatContacts: ThreatContact[] = [];

  private container: HTMLElement | null = null;
  private rafId = 0;
  private loopRunning = false;
  private lastFrameAt = 0;
  private gameTime = 0;
  private fpsEma = 60;
  private stateTimer = 0;
  private roundBannerUntil = 0;
  private lastHitmarkerAt = 0;
  private lastHitmarkerHead = false;
  private damageFlash = 0;
  private menuOrbit = 0;
  private footstepAcc = 0;
  private keyLight: THREE.DirectionalLight | null = null;
  private aimPoint = new THREE.Vector3();
  private disposed = false;
  private loadingTimer = 0;

  get time(): number {
    return this.gameTime;
  }

  get currentRoundLabel(): string {
    return ROUNDS[this.progression.roundIndex]?.label ?? '';
  }

  // --- lifecycle ------------------------------------------------------------------
  init(container: HTMLElement): void {
    if (this.renderer) return; // idempotent
    this.container = container;
    this.settings.load();

    const canvasRect = container.getBoundingClientRect();
    const w = Math.max(320, canvasRect.width || window.innerWidth);
    const h = Math.max(240, canvasRect.height || window.innerHeight);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    container.appendChild(this.renderer.domElement);

    // Procedural dusk sky (equirect) doubles as the IBL source below.
    const textures = createTextures();
    if (textures?.sky) {
      this.scene.background = textures.sky;
      this.scene.backgroundIntensity = 0.9;
    } else {
      this.scene.background = new THREE.Color(0x0b0e11);
    }
    this.scene.fog = new THREE.Fog(0x39424f, 46, 165);

    // Lighting: key (sun) + hemi bounce + rim + practicals.
    const hemi = new THREE.HemisphereLight(0xa7bcd8, 0x33302a, 0.85);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffe0b4, 2.05);
    key.position.set(30, 40, 14);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -34;
    key.shadow.camera.right = 34;
    key.shadow.camera.top = 34;
    key.shadow.camera.bottom = -34;
    key.shadow.camera.far = 130;
    key.shadow.camera.updateProjectionMatrix();
    key.shadow.bias = -0.00035;
    key.shadow.normalBias = 0.02;
    this.scene.add(key);
    this.keyLight = key;
    // Cool rim light opposite the sun: separates silhouettes from the ground.
    const rim = new THREE.DirectionalLight(0x8fb6ff, 0.5);
    rim.position.set(-26, 18, -22);
    this.scene.add(rim);
    const plaza = new THREE.PointLight(0xffc37a, 38, 30, 1.9);
    plaza.position.set(0, 5.5, 0);
    this.scene.add(plaza);
    const gate = new THREE.PointLight(0x9adcff, 16, 22, 1.9);
    gate.position.set(0, 4.5, -14);
    this.scene.add(gate);

    this.mats = createMaterials(textures);
    this.geos = createGeometries();
    this.applyEnvironment(textures?.sky ?? null);

    this.level = new Level(this.mats, this.geos);
    this.level.build();
    this.scene.add(this.level.group);

    this.cameraRig = new TacticalCamera(w / h);
    this.cameraRig.setBounds(this.level.boundsHalf);
    this.cameraRig.setDistance(this.settings.data.cameraDistance);
    this.cameraRig.setTarget(0, 0, 0, true);

    this.particles = new ParticleSystem(this.scene);
    this.threats = new ThreatIndicator(this.scene);
    this.cover = new CoverSystem(this.level);
    this.player = new Player(this.mats, this.geos);
    this.player.reset(this.level.playerSpawn);
    // Weapon-specific reload foley (magazine slap vs pump vs bolt).
    this.player.onReloadComplete = (id) => this.audio.playReload(id);
    this.scene.add(this.player.rig.root);

    this.combat = new CombatSystem(
      this.level, this.particles, this.audio, this.cameraRig, this.squad, this.player.pos,
    );
    this.grenades = new GrenadeSystem(
      this.scene, this.level, this.particles, this.audio, this.combat, this.player.pos,
    );
    this.spawns = new SpawnSystem(this.level);

    this.input.attach(container);
    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibility);

    this.applyQuality();
    this.audio.setVolumes(this.settings.data);

    // QA/debug handle (intentional dev utility, not debug UI).
    (window as unknown as { __BREACHLINE__?: unknown }).__BREACHLINE__ = {
      game: this,
      status: () => this.debugStatus(),
    };

    this.startLoop();
  }

  /**
   * Image-based lighting from the sky texture: metals and concrete pick up the
   * dusk gradient instead of reading flat. Fails soft (headless/stub renderers).
   */
  private applyEnvironment(sky: THREE.Texture | null): void {
    if (!this.renderer || !sky) return;
    try {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const env = pmrem.fromEquirectangular(sky).texture;
      this.scene.environment = env;
      this.scene.environmentIntensity = 0.45;
      pmrem.dispose();
    } catch {
      // Renderer without real GL (tests) — flat lighting only.
    }
  }

  private onResize = (): void => {
    if (!this.renderer || !this.container || !this.cameraRig) return;
    const r = this.container.getBoundingClientRect();
    const w = Math.max(320, r.width || window.innerWidth);
    const h = Math.max(240, r.height || window.innerHeight);
    this.renderer.setSize(w, h);
    this.cameraRig.setAspect(w / h);
  };

  private onVisibility = (): void => {
    if (document.hidden && this.state === GameState.PLAYING) this.pause();
  };

  dispose(): void {
    this.disposed = true;
    this.stopLoop();
    this.input.detach();
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.clearRunEntities();
    this.threats?.dispose();
    this.threats = null;
    // Environment (PMREM cube) + sky background textures are owned by the game.
    this.scene.environment?.dispose();
    this.scene.environment = null;
    (this.scene.background as THREE.Texture | null)?.dispose?.();
    this.scene.background = null;
    this.audio.dispose();
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
    this.renderer = null;
  }

  // --- loop -------------------------------------------------------------------------
  private startLoop(): void {
    if (this.loopRunning) return;
    this.loopRunning = true;
    this.lastFrameAt = performance.now();
    const tick = (): void => {
      if (!this.loopRunning || this.disposed) return;
      this.rafId = requestAnimationFrame(tick);
      this.frame();
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopLoop(): void {
    this.loopRunning = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  get isLoopRunning(): boolean {
    return this.loopRunning;
  }

  private frame(): void {
    const nowMs = performance.now();
    let dt = (nowMs - this.lastFrameAt) / 1000;
    this.lastFrameAt = nowMs;
    if (!Number.isFinite(dt) || dt < 0) dt = 0.016;
    dt = Math.min(dt, 0.05); // clamp tunneling / tab-switch jumps
    if (dt > 0) this.fpsEma += (1 / dt - this.fpsEma) * 0.05;

    try {
      switch (this.state) {
        case GameState.MENU:
          this.updateMenu(dt);
          break;
        case GameState.LOADING:
          this.updateLoading(dt);
          break;
        case GameState.PLAYING:
          this.updatePlaying(dt);
          break;
        case GameState.PAUSED:
          break; // frozen: no updates, still renders below
        case GameState.ROUND_COMPLETE:
          this.updateRoundComplete(dt);
          break;
        case GameState.VICTORY:
        case GameState.DEFEAT:
          this.updateEndScreen(dt);
          break;
      }
      this.input.endFrame();
      this.renderer?.render(this.scene, this.cameraRig?.camera as THREE.Camera);
    } catch (err) {
      console.error('[Game] frame error:', err);
    }
  }

  // --- states -------------------------------------------------------------------------
  private setState(s: GameState): void {
    if (this.state === s) return;
    this.state = s;
    this.stateTimer = 0;
    this.input.reset();
    this.events.emit('state-changed', { state: s });
  }

  /** PLAY from menu (or restart after victory/defeat). */
  startRun(): void {
    this.audio.unlock();
    this.audio.startAmbient();
    this.audio.playUI();
    this.clearRunEntities();
    this.progression.startRun();
    this.player?.reset(this.level?.playerSpawn ?? { x: 0, z: 18 });
    this.cameraRig?.setTarget(this.player?.pos.x ?? 0, 0, this.player?.pos.z ?? 0, true);
    this.cameraRig?.resetAzimuth();
    this.setState(GameState.LOADING);
    this.loadingTimer = 0.4;
  }

  private updateLoading(dt: number): void {
    this.loadingTimer -= dt;
    if (this.loadingTimer <= 0) {
      this.beginRound(this.progression.roundIndex);
      this.setState(GameState.PLAYING);
    }
  }

  private beginRound(index: number): void {
    this.progression.beginRound(index);
    const round = ROUNDS[index];
    this.spawns?.startRound(round);
    this.roundBannerUntil = this.gameTime + 3.2;
    this.events.emit('round-start', { index, label: round.label, briefing: round.briefing });
    this.player?.refillForRound();
  }

  pause(): void {
    if (this.state !== GameState.PLAYING) return;
    this.audio.playUICancel();
    this.audio.suspend();
    this.setState(GameState.PAUSED);
  }

  resume(): void {
    if (this.state !== GameState.PAUSED) return;
    this.audio.resume();
    this.audio.playUI();
    this.setState(GameState.PLAYING);
  }

  restart(): void {
    this.audio.resume();
    this.startRun();
  }

  toMenu(): void {
    this.audio.playUICancel();
    this.clearRunEntities();
    this.player?.reset(this.level?.playerSpawn ?? { x: 0, z: 18 });
    this.cameraRig?.resetAzimuth();
    this.setState(GameState.MENU);
  }

  private clearRunEntities(): void {
    for (const e of this.enemies) {
      this.scene.remove(e.rig.root);
      e.dispose();
    }
    this.enemies = [];
    this.controllers.clear();
    this.corpses = [];
    this.grenades?.clear();
    this.particles?.clear();
    this.cover?.reset();
    this.squad.reset();
    this.spawns?.clear();
    this.threats?.clear();
    this.threatContacts.length = 0;
    this.damageFlash = 0;
    this.lastHitmarkerAt = 0;
  }

  // --- updates ---------------------------------------------------------------------------
  private updateMenu(dt: number): void {
    if (!this.cameraRig || !this.player) return;
    // Slow cinematic drift over the arena.
    this.menuOrbit += dt * 0.12;
    const r = 5;
    this.cameraRig.setTarget(Math.cos(this.menuOrbit) * r, 0, Math.sin(this.menuOrbit) * r);
    this.cameraRig.setDistance(24);
    this.cameraRig.update(dt);
    this.player.menuIdle(dt);
    this.particles?.update(dt);
  }

  private updatePlaying(dt: number): void {
    if (!this.player || !this.level || !this.cameraRig || !this.combat || !this.grenades || !this.spawns) return;
    this.gameTime += dt;
    const now = this.gameTime;
    const p = this.player;

    // ESC -> pause.
    if (this.input.wasPressed('Escape')) {
      this.pause();
      return;
    }

    // Q/E -> rotate camera around the soldier.
    const ROTATE_SPEED = 110; // degrees per second
    if (this.input.isDown('KeyQ')) this.cameraRig.rotateBy(-ROTATE_SPEED * dt);
    if (this.input.isDown('KeyE')) this.cameraRig.rotateBy(ROTATE_SPEED * dt);

    // Aim point from mouse.
    const rect = this.renderer?.domElement.getBoundingClientRect();
    if (rect) {
      this.cameraRig.screenToGround(this.input.mouseX, this.input.mouseY, rect, this.aimPoint);
    }

    // Grenade.
    if (this.input.wasPressed('KeyG') && p.alive) {
      if (p.grenades > 0) {
        if (this.grenades.throwAt(p.pos, this.aimPoint)) p.grenades--;
      } else {
        this.audio.playDryFire();
      }
    }

    // Player (movement stays camera-relative under rotation).
    p.update(dt, now, this.input, this.aimPoint, this.level, true, this.cameraRig.getAzimuthDeg());
    if (p.wishFire && p.alive) {
      const res = this.combat.playerFire(p, this.enemies, now);
      if (res.fired) {
        this.progression.onShot(res.hits > 0);
        if (res.hits > 0) {
          this.lastHitmarkerAt = Date.now();
          this.lastHitmarkerHead = res.headshots > 0;
          this.audio.playHitmarker(res.headshots > 0);
          this.events.emit('hitmarker', { headshot: res.headshots > 0 });
        }
        for (const killed of res.killed) {
          this.onEnemyKilled(killed, 'bullet', res.headshots > 0, now);
        }
      }
    }

    // Footsteps.
    if (p.moving && p.alive) {
      this.footstepAcc += dt * p.speed;
      if (this.footstepAcc > 2.2) {
        this.footstepAcc = 0;
        this.audio.playFootstep(p.speed > 3.5);
      }
    }

    // Spawning.
    const aliveCount = this.enemies.reduce((n, e) => n + (e.alive ? 1 : 0), 0);
    this.spawns.update(dt, p.pos.x, p.pos.z, aliveCount, this.enemies, (arch, x, z) => this.spawnEnemy(arch, x, z, now));

    // AI.
    for (const [, c] of this.controllers) c.update(dt, now);

    // Player <-> enemy body separation (no overlap, no push-through).
    if (p.alive) {
      for (const e of this.enemies) {
        if (!e.alive) continue;
        const dx = p.pos.x - e.pos.x;
        const dz = p.pos.z - e.pos.z;
        const d2 = dx * dx + dz * dz;
        const min = p.radius + e.radius + 0.05;
        if (d2 > 1e-8 && d2 < min * min) {
          const d = Math.sqrt(d2);
          const push = ((min - d) / d) * 0.5;
          p.pos.x += dx * push;
          p.pos.z += dz * push;
          e.pos.x -= dx * push;
          e.pos.z -= dz * push;
        }
      }
      this.level.collideCircle(p.pos, p.radius);
    }

    // Grenades.
    this.grenades.update(dt, now, p, this.enemies, (e) => this.onEnemyKilled(e, 'grenade', false, now));

    // Corpses cleanup.
    for (let i = this.corpses.length - 1; i >= 0; i--) {
      if (now >= this.corpses[i].removeAt) {
        const c = this.corpses[i];
        this.scene.remove(c.enemy.rig.root);
        c.enemy.dispose();
        const ei = this.enemies.indexOf(c.enemy);
        if (ei >= 0) this.enemies.splice(ei, 1);
        this.corpses.splice(i, 1);
      }
    }

    // Player damage flash decay + defeat.
    this.damageFlash = Math.max(0, this.damageFlash - dt * 1.4);
    if (!p.alive) {
      this.stateTimer += dt;
      if (this.stateTimer > 2.2) {
        this.audio.playRoundLose();
        this.setState(GameState.DEFEAT);
        this.events.emit('defeat', { score: this.progression.score });
        return;
      }
    }

    // Round completion.
    if (p.alive && this.spawns.pending === 0 && aliveCount === 0) {
      this.stateTimer += dt;
      if (this.stateTimer > 1.0) {
        const bonus = this.progression.completeRound();
        if (this.progression.isFinalRound) {
          this.audio.playRoundWin();
          this.setState(GameState.VICTORY);
          this.events.emit('victory', { score: this.progression.score, bonus });
        } else {
          this.audio.playRoundWin();
          this.setState(GameState.ROUND_COMPLETE);
          this.events.emit('round-complete', { index: this.progression.roundIndex, bonus });
        }
        return;
      }
    } else {
      this.stateTimer = p.alive ? 0 : this.stateTimer;
    }

    // Camera: follow + aim lookahead + zoom.
    const wheel = this.input.consumeWheel();
    if (wheel !== 0) {
      this.cameraRig.zoomBy(wheel * this.settings.data.sensitivity * 0.35);
    }
    const lookK = 0.22;
    const tx = p.pos.x + (this.aimPoint.x - p.pos.x) * lookK;
    const tz = p.pos.z + (this.aimPoint.z - p.pos.z) * lookK;
    this.cameraRig.setTarget(tx, 0, tz);
    // Precision aim: subtle push-in.
    const wantDist = this.settings.data.cameraDistance + (p.aiming ? -3.5 : 0);
    this.cameraRig.setDistance(this.cameraRig.distance + (wantDist - this.cameraRig.distance) * Math.min(1, dt * 5));
    this.cameraRig.update(dt);

    this.squad.prune(now);
    this.particles?.setFocus(p.pos.x, p.pos.z);
    this.updateThreats(dt, p);
    this.particles?.update(dt);
  }

  /** Red danger streaks toward nearby hostiles + HUD danger read-out. */
  private updateThreats(dt: number, p: Player): void {
    if (!this.threats || !this.cameraRig) return;
    const az = THREE.MathUtils.degToRad(this.cameraRig.getAzimuthDeg());
    // Ground-plane view basis (screen right = camera right, forward = view dir).
    _camFwd.set(-Math.sin(az), 0, -Math.cos(az));
    _camRight.set(-_camFwd.z, 0, _camFwd.x);
    this.threatContacts.length = 0;
    for (const e of this.enemies) {
      this.threatContacts.push({ id: e.id, x: e.pos.x, z: e.pos.z, alive: e.alive, confidence: e.ai.confidence });
    }
    this.threats.update(dt, p.pos.x, p.pos.z, this.threatContacts, _camRight, _camFwd);
  }

  private updateRoundComplete(dt: number): void {
    this.gameTime += dt;
    this.stateTimer += dt;
    this.particles?.update(dt);
    this.cameraRig?.update(dt);
    if (this.stateTimer > 3.2) {
      const advanced = this.progression.advance();
      if (advanced) {
        this.beginRound(this.progression.roundIndex);
        this.setState(GameState.PLAYING);
      }
    }
  }

  private updateEndScreen(dt: number): void {
    this.particles?.update(dt);
    this.cameraRig?.update(dt);
    // Let corpses / AI settle visually behind the end screen for a moment.
    if (this.stateTimer < 3) {
      this.stateTimer += dt;
      this.gameTime += dt;
      for (const [, c] of this.controllers) c.update(dt, this.gameTime);
    }
  }

  // --- combat events --------------------------------------------------------------------------
  private spawnEnemy(arch: EnemyArchetype, x: number, z: number, now: number): void {
    if (!this.mats || !this.geos || !this.level || !this.player || !this.cover || !this.combat) return;
    const round = ROUNDS[this.progression.roundIndex];
    const e = new Enemy(arch, this.mats, this.geos);
    e.applyDifficulty(round.healthMult, round.accuracyMult, round.aggressionMult);
    const yaw = Math.atan2(this.player.pos.x - x, this.player.pos.z - z);
    e.spawnAt(x, z, yaw);
    e.ai.homeX = x;
    e.ai.homeZ = z;
    e.ai.reactionAt = now + 1.0; // spawn grace (fair)
    e.ai.decisionAt = now + Math.random() * 0.5;
    this.scene.add(e.rig.root);
    this.enemies.push(e);
    const aiCtx: AIContext = {
      level: this.level,
      player: this.player,
      enemies: this.enemies,
      cover: this.cover,
      squad: this.squad,
      combat: this.combat,
      audio: this.audio,
    };
    this.controllers.set(e.id, new AIController(e, aiCtx));
    void now;
  }

  private onEnemyKilled(e: Enemy, cause: 'bullet' | 'grenade', headshot: boolean, now: number): void {
    this.controllers.delete(e.id);
    this.cover?.releaseByEnemy(e.id);
    this.corpses.push({ enemy: e, removeAt: now + 6 });
    if (this.corpses.length > 10) {
      const oldest = this.corpses.shift();
      if (oldest) {
        this.scene.remove(oldest.enemy.rig.root);
        oldest.enemy.dispose();
        const ei = this.enemies.indexOf(oldest.enemy);
        if (ei >= 0) this.enemies.splice(ei, 1);
      }
    }
    const gained = this.progression.onEnemyKilled(e.def.scoreValue, headshot, cause, now);
    const d = e.pos.distanceTo(this.player?.pos ?? e.pos);
    this.audio.playEnemyDeath(clamp(d / 45, 0, 1));
    this.audio.playKill();
    this.events.emit('kill', {
      name: e.def.name, headshot, cause, score: gained, total: this.progression.score,
    });
    // Damage notification for nearby allies is handled via squad/noise; the
    // victim's own controller is gone.
    void headshot;
  }

  /** Called by React when the player HP drops (HUD vignette). Polled instead: */
  getSnapshot(): HudSnapshot {
    const p = this.player;
    const slots = WEAPON_ORDER.map((id) => {
      const w = p?.weapons.get(id);
      return { id, name: w?.def.name ?? id, mag: w?.magAmmo ?? 0, reserve: w?.reserveAmmo ?? 0 };
    });
    const aliveEnemies = this.enemies.reduce((n, e) => n + (e.alive ? 1 : 0), 0);
    const w = p?.weapon;
    const spreadPx = this.estimateSpreadPx();
    // Track damage for vignette: compare implicit via lastDamageAt recency.
    if (p && this.gameTime - p.lastDamageAt < 0.05 && p.alive) this.damageFlash = Math.max(this.damageFlash, 0.55);
    return {
      state: this.state,
      health: p?.health ?? 100,
      maxHealth: p?.maxHealth ?? 100,
      armor: p?.armor ?? 0,
      maxArmor: p?.maxArmor ?? 100,
      magAmmo: w?.magAmmo ?? 0,
      reserveAmmo: w?.reserveAmmo ?? 0,
      reloading: w?.reloading ?? false,
      weaponId: p?.currentId ?? 'rifle',
      weaponName: w?.def.name ?? '',
      weaponSlots: slots,
      grenades: p?.grenades ?? 0,
      score: this.progression.score,
      kills: this.progression.kills,
      headshots: this.progression.headshots,
      shotsFired: this.progression.shotsFired,
      shotsHit: this.progression.shotsHit,
      roundIndex: this.progression.roundIndex,
      roundLabel: this.currentRoundLabel,
      enemiesRemaining: (this.spawns?.pending ?? 0) + aliveEnemies,
      enemiesTotal: this.progression.roundTotal,
      aiming: p?.aiming ?? false,
      spreadPx,
      hitmarker: this.lastHitmarkerAt,
      hitmarkerHeadshot: this.lastHitmarkerHead,
      killstreak: 0,
      damageFlash: this.damageFlash,
      lowAmmo: (w?.magAmmo ?? 1) <= Math.ceil((w?.def.magSize ?? 30) * 0.25),
      fps: Math.round(this.fpsEma),
      threatLevel: this.threats?.current.level ?? 0,
      threatAngleDeg: this.threats?.current.screenAngleDeg ?? 0,
      threatCount: this.threats?.current.count ?? 0,
      threatDistance: Number.isFinite(this.threats?.current.nearest ?? Infinity)
        ? (this.threats?.current.nearest ?? 0)
        : -1,
    };
  }

  private estimateSpreadPx(): number {
    const p = this.player;
    const h = this.renderer?.domElement.clientHeight ?? 900;
    if (!p) return 12;
    const w = p.weapon;
    let s = w.def.spreadBase + w.bloom;
    if (p.moving) s += w.def.spreadMove;
    if (p.aiming) s *= w.def.spreadAimMult;
    const focal = h / 2 / Math.tan((CAMERA_CONFIG.fov * Math.PI) / 360);
    return clamp(10 + s * focal * 0.5, 10, 64);
  }

  get roundBannerActive(): boolean {
    return this.gameTime < this.roundBannerUntil;
  }

  get progressionData(): ProgressionSystem {
    return this.progression;
  }

  get aliveEnemyCount(): number {
    return this.enemies.reduce((n, e) => n + (e.alive ? 1 : 0), 0);
  }

  get enemyStates(): { id: number; archetype: string; state: string; hp: number }[] {
    return this.enemies.filter((e) => e.alive).map((e) => ({
      id: e.id, archetype: e.archetype, state: e.state, hp: Math.round(e.health),
    }));
  }

  /**
   * Quality tiers. HIGH is the full-fidelity path (supersampled pixel ratio,
   * 4096 contact-accurate shadows, IBL, denser particles and dust); low keeps the
   * game playable on weak GPUs by dropping resolution, shadows and VFX density.
   */
  applyQuality(): void {
    if (!this.renderer) return;
    const q = this.settings.data.quality;
    const dpr = window.devicePixelRatio || 1;
    const ratio = q === 'low' ? 0.8 : q === 'medium' ? Math.min(dpr, 1.35) : Math.min(dpr, 2);
    this.renderer.setPixelRatio(ratio);
    this.renderer.shadowMap.enabled = q !== 'low';
    if (this.keyLight) {
      const s = q === 'low' ? 1024 : q === 'medium' ? 2048 : 4096;
      if (this.keyLight.shadow.mapSize.x !== s) {
        this.keyLight.shadow.mapSize.set(s, s);
        if (this.keyLight.shadow.map) {
          this.keyLight.shadow.map.dispose();
          this.keyLight.shadow.map = null;
        }
      }
    }
    // Image-based lighting is a "medium and up" feature.
    this.scene.environmentIntensity = q === 'low' ? 0 : 0.45;
    this.particles?.setMultiplier(q === 'low' ? 0.45 : q === 'medium' ? 0.8 : 1.15);
    this.particles?.setDetail(q !== 'low');
    // Shadow map size/dispose above takes effect on the next render automatically.
  }

  applySettingsToAudio(): void {
    this.audio.setVolumes(this.settings.data);
  }

  debugStatus(): Record<string, unknown> {
    const size = new THREE.Vector2();
    this.renderer?.getSize(size);
    let lights = 0;
    let meshes = 0;
    this.scene.traverse((o) => {
      if ((o as THREE.Light).isLight) lights++;
      if ((o as THREE.Mesh).isMesh) meshes++;
    });
    return {
      renderer: !!this.renderer,
      canvas: !!this.renderer?.domElement,
      canvasInDom: !!this.renderer?.domElement.parentElement,
      scene: !!this.scene,
      camera: !!this.cameraRig,
      cameraPos: this.cameraRig?.camera.position.toArray().map((v) => +v.toFixed(2)),
      cameraTarget: this.cameraRig?.target.toArray().map((v) => +v.toFixed(2)),
      rendererSize: { w: size.x, h: size.y },
      loopRunning: this.loopRunning,
      sceneObjects: this.scene.children.length,
      meshes,
      lights,
      player: !!this.player,
      playerPos: this.player?.pos.toArray().map((v) => +v.toFixed(2)),
      map: !!this.level,
      state: this.state,
      enemies: this.enemies.length,
      fps: Math.round(this.fpsEma),
    };
  }
}
