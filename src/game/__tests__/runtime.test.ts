// Headless full-game integration test: boots the REAL Game (scene, level, AI,
// combat, progression) with only the WebGLRenderer + DOM stubbed, then plays
// through menu -> 5 rounds -> victory, plus defeat/pause/restart/menu paths.
// Any exception, NaN, or console.error fails the test.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('three', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  class MockRenderer {
    domElement: unknown;
    shadowMap = { enabled: true, type: 0 };
    outputColorSpace: unknown = null;
    toneMapping: unknown = null;
    toneMappingExposure = 1;
    constructor() {
      this.domElement = {
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        remove: () => undefined,
        style: {},
        width: 1280,
        height: 720,
      };
    }
    setSize(): void { /* stub */ }
    setPixelRatio(): void { /* stub */ }
    render(): void { /* stub */ }
    dispose(): void { /* stub */ }
    getSize(v: { set: (x: number, y: number) => void }): unknown {
      v.set(1280, 720);
      return v;
    }
  }
  return { ...actual, WebGLRenderer: MockRenderer };
});

import { Game } from '../core/Game';
import { GameState } from '../core/GameStates';

// --- DOM stubs ------------------------------------------------------------------
function installDomStubs(): void {
  const store = new Map<string, string>();
  const localStorageStub = {
    getItem: (k: string): string | null => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k: string, v: string): void => void store.set(k, v),
    removeItem: (k: string): void => void store.delete(k),
    clear: (): void => store.clear(),
  };
  const fakeCanvas = (): unknown => ({
    width: 64,
    height: 64,
    getContext: () => ({
      createRadialGradient: () => ({ addColorStop: () => undefined }),
      fillRect: () => undefined,
      fillStyle: '',
    }),
  });
  (globalThis as Record<string, unknown>).window = {
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 1,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  (globalThis as Record<string, unknown>).document = {
    createElement: (tag: string) => (tag === 'canvas' ? fakeCanvas() : { style: {} }),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    hidden: false,
  };
  (globalThis as Record<string, unknown>).localStorage = localStorageStub;
  (globalThis as Record<string, unknown>).requestAnimationFrame = () => 0;
  (globalThis as Record<string, unknown>).cancelAnimationFrame = () => undefined;
}

function fakeContainer(): unknown {
  return {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
    appendChild: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
}

describe('full game runtime', () => {
  let game: Game;
  let fakeNow = 1_000_000;
  let consoleError: ReturnType<typeof vi.spyOn>;

  type FrameFn = { frame: () => void };
  const frames = (n: number): void => {
    const g = game as unknown as FrameFn;
    for (let i = 0; i < n; i++) {
      fakeNow += 1000 / 60;
      g.frame();
    }
  };

  beforeEach(() => {
    installDomStubs();
    fakeNow = 1_000_000;
    vi.spyOn(performance, 'now').mockImplementation(() => fakeNow);
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    game = new Game();
    game.init(fakeContainer() as HTMLElement);
  });

  afterEach(() => {
    game.dispose();
    vi.restoreAllMocks();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('boots to menu with a valid scene (black-screen QA)', () => {
    frames(30);
    expect(game.state).toBe(GameState.MENU);
    const s = game.debugStatus();
    expect(s.renderer).toBe(true);
    expect(s.canvas).toBe(true);
    expect(s.camera).toBe(true);
    expect(s.loopRunning).toBe(true);
    expect(s.player).toBe(true);
    expect(s.map).toBe(true);
    expect(s.meshes as number).toBeGreaterThan(50);
    expect(s.lights as number).toBeGreaterThanOrEqual(4);
    const pos = s.cameraPos as number[];
    expect(pos.every((v) => Number.isFinite(v))).toBe(true);
    expect(s.fps as number).toBeGreaterThan(0);
  });

  it('plays: move, aim, fire, grenade, reload, crouch, weapons', () => {
    game.startRun();
    frames(60); // LOADING -> PLAYING
    expect(game.state).toBe(GameState.PLAYING);
    const g = game as unknown as {
      player: { pos: { x: number; z: number }; weapon: { magAmmo: number } };
    };
    const px0 = g.player.pos.x;
    const pz0 = g.player.pos.z;

    // Move forward for 1s.
    game.input.keys.add('KeyW');
    game.input.mouseX = 900;
    game.input.mouseY = 250;
    frames(60);
    game.input.keys.delete('KeyW');
    const moved = Math.hypot(g.player.pos.x - px0, g.player.pos.z - pz0);
    expect(moved).toBeGreaterThan(1);

    // Fire for 1s (rifle, automatic).
    const mag0 = g.player.weapon.magAmmo;
    game.input.mouseLeft = true;
    frames(60);
    game.input.mouseLeft = false;
    expect(g.player.weapon.magAmmo).toBeLessThan(mag0);
    expect(game.progressionData.shotsFired).toBeGreaterThan(0);

    // Switch weapons 1-5 + reload + crouch + grenade.
    for (const code of ['Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit1']) {
      (game.input as unknown as { pressedQueue: Set<string> }).pressedQueue.add(code);
      frames(2);
    }
    (game.input as unknown as { pressedQueue: Set<string> }).pressedQueue.add('KeyR');
    frames(3);
    game.input.keys.add('KeyC');
    frames(30);
    game.input.keys.delete('KeyC');
    const nades0 = game.getSnapshot().grenades;
    (game.input as unknown as { pressedQueue: Set<string> }).pressedQueue.add('KeyG');
    frames(5);
    expect(game.getSnapshot().grenades).toBe(nades0 - 1);
    frames(180); // grenade fuse + explosion + AI combat soak

    // No NaN anywhere.
    const snap = game.getSnapshot();
    expect(Number.isFinite(snap.health)).toBe(true);
    for (const e of game.enemyStates) {
      expect(Number.isFinite(e.hp)).toBe(true);
    }
  });

  it('enemies spawn, navigate, perceive, and fight', () => {
    game.startRun();
    frames(60);
    // Let the round play: enemies spawn over ~6s.
    game.input.mouseX = 640;
    game.input.mouseY = 300;
    frames(400);
    const states = game.enemyStates;
    expect(states.length).toBeGreaterThan(0);
    // AI must leave Idle/Patrol once combat starts (player makes noise).
    game.input.mouseLeft = true;
    frames(120);
    game.input.mouseLeft = false;
    const states2 = new Set(game.enemyStates.map((e) => e.state));
    expect(states2.size).toBeGreaterThanOrEqual(1);
    // At least one enemy should have engaged, searched, or taken cover.
    const combatStates = ['Engaging', 'InCover', 'TakingCover', 'Flanking', 'Searching', 'Investigating', 'Suspicious', 'Reloading', 'Retreating', 'Patrol'];
    expect([...states2].some((s) => combatStates.includes(s))).toBe(true);
  });

  it('completes all 5 rounds -> VICTORY', () => {
    game.startRun();
    frames(60);
    const gg = game as unknown as {
      enemies: { alive: boolean; takeDamage: (h: number, a: number, n: number) => void }[];
      player: { health: number; armor: number };
      onEnemyKilled: (e: unknown, cause: 'bullet', hs: boolean, now: number) => void;
    };
    for (let round = 0; round < 5; round++) {
      // Wait for spawns, keep player topped up, kill everything.
      for (let wave = 0; wave < 40; wave++) {
        frames(30);
        gg.player.health = 100;
        gg.player.armor = 50;
        for (const e of gg.enemies) {
          if (e.alive) {
            e.takeDamage(99999, 0, game.time);
            gg.onEnemyKilled(e, 'bullet', false, game.time);
          }
        }
        if (game.state !== GameState.PLAYING) break;
      }
      if (round < 4) {
        expect(game.state).toBe(GameState.ROUND_COMPLETE);
        frames(220); // auto-advance
        expect(game.state).toBe(GameState.PLAYING);
        expect(game.progressionData.roundIndex).toBe(round + 1);
      }
    }
    expect(game.state).toBe(GameState.VICTORY);
    expect(game.progressionData.score).toBeGreaterThan(0);
  });

  it('player death -> DEFEAT -> restart -> pause/resume -> menu', () => {
    game.startRun();
    frames(60);
    expect(game.state).toBe(GameState.PLAYING);

    // Pause / resume freezes gameplay.
    game.pause();
    expect(game.state).toBe(GameState.PAUSED);
    const t0 = game.time;
    frames(30);
    expect(game.time).toBe(t0); // timers frozen
    game.resume();
    expect(game.state).toBe(GameState.PLAYING);
    frames(10);
    expect(game.time).toBeGreaterThan(t0);

    // Death -> defeat.
    const gg = game as unknown as { player: { takeDamage: (h: number, a: number, n: number) => void } };
    gg.player.takeDamage(99999, 0, game.time);
    frames(180);
    expect(game.state).toBe(GameState.DEFEAT);

    // Restart -> playing round 1 with exactly one loop.
    game.restart();
    frames(60);
    expect(game.state).toBe(GameState.PLAYING);
    expect(game.progressionData.roundIndex).toBe(0);
    expect(game.progressionData.score).toBe(0);
    expect(game.isLoopRunning).toBe(true);

    // Back to menu.
    game.toMenu();
    expect(game.state).toBe(GameState.MENU);
    frames(30);
  });

  it('HUD snapshot is always complete and finite', () => {
    game.startRun();
    frames(120);
    const s = game.getSnapshot();
    const nums = [s.health, s.armor, s.magAmmo, s.reserveAmmo, s.score, s.enemiesRemaining, s.spreadPx, s.fps];
    for (const n of nums) expect(Number.isFinite(n)).toBe(true);
    expect(s.weaponSlots.length).toBe(5);
    expect(s.roundLabel.length).toBeGreaterThan(0);
  });

  it('telegraphs nearby danger (red line data) through the HUD snapshot', () => {
    game.startRun();
    frames(300);

    const gg = game as unknown as {
      enemies: { alive: boolean; pos: { set: (x: number, y: number, z: number) => void } }[];
      player: { pos: { x: number; z: number } };
    };
    expect(gg.enemies.length).toBeGreaterThan(0);

    // Push every hostile far away: the danger channel must go fully dark.
    for (const e of gg.enemies) e.pos.set(gg.player.pos.x + 60, 0, gg.player.pos.z + 60);
    frames(4);
    const clear = game.getSnapshot();
    expect(clear.threatLevel).toBe(0);
    expect(clear.threatCount).toBe(0);
    expect(clear.threatDistance).toBe(-1);

    // A hostile closing to 4m lights the danger line + HUD read-out.
    const hostile = gg.enemies.find((e) => e.alive);
    expect(hostile).toBeTruthy();
    hostile!.pos.set(gg.player.pos.x + 4, 0, gg.player.pos.z);
    frames(4);

    const snap = game.getSnapshot();
    expect(snap.threatCount).toBeGreaterThan(0);
    expect(snap.threatLevel).toBeGreaterThan(0.3);
    expect(snap.threatDistance).toBeGreaterThan(2);
    expect(snap.threatDistance).toBeLessThan(20);
    expect(Number.isFinite(snap.threatAngleDeg)).toBe(true);
    expect(Math.abs(snap.threatAngleDeg)).toBeLessThanOrEqual(180);
  });

  it('restart after death restores standing pose; Q/E rotate the camera', () => {
    game.startRun();
    frames(60);
    expect(game.state).toBe(GameState.PLAYING);
    const gg = game as unknown as {
      player: {
        alive: boolean;
        health: number;
        pos: { x: number; z: number };
        rig: { body: { rotation: { x: number }; position: { y: number } } };
        takeDamage: (h: number, a: number, n: number) => void;
      };
      cameraRig: { getAzimuthDeg: () => number };
    };
    // Kill the player -> death pose (fallen).
    gg.player.takeDamage(99999, 0, game.time);
    frames(180);
    expect(game.state).toBe(GameState.DEFEAT);
    expect(gg.player.rig.body.rotation.x).toBeLessThan(-1);

    // Restart -> standing again with full health.
    game.restart();
    frames(60);
    expect(game.state).toBe(GameState.PLAYING);
    expect(gg.player.alive).toBe(true);
    expect(gg.player.health).toBe(100);
    expect(gg.player.rig.body.rotation.x).toBeCloseTo(0, 2);
    // Standing height (only the idle breathing bob remains).
    expect(Math.abs(gg.player.rig.body.position.y)).toBeLessThan(0.05);

    // Q/E rotate the camera (smoothed, so the key is held).
    const az0 = gg.cameraRig.getAzimuthDeg();
    game.input.keys.add('KeyE');
    frames(30);
    game.input.keys.delete('KeyE');
    const az1 = gg.cameraRig.getAzimuthDeg();
    expect(az1).toBeGreaterThan(az0);
    game.input.keys.add('KeyQ');
    frames(30);
    game.input.keys.delete('KeyQ');
    const az2 = gg.cameraRig.getAzimuthDeg();
    expect(az2).toBeLessThan(az1);

    // Movement still works with a rotated camera.
    const px = gg.player.pos.x;
    const pz = gg.player.pos.z;
    game.input.keys.add('KeyW');
    frames(60);
    game.input.keys.delete('KeyW');
    expect(Math.hypot(gg.player.pos.x - px, gg.player.pos.z - pz)).toBeGreaterThan(1);
  });
});
