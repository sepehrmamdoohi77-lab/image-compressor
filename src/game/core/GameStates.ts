// Explicit global game states. Every system respects the current state.

export enum GameState {
  MENU = 'MENU',
  LOADING = 'LOADING',
  PLAYING = 'PLAYING',
  PAUSED = 'PAUSED',
  ROUND_COMPLETE = 'ROUND_COMPLETE',
  VICTORY = 'VICTORY',
  DEFEAT = 'DEFEAT',
}

export interface HudSnapshot {
  state: GameState;
  health: number;
  maxHealth: number;
  armor: number;
  maxArmor: number;
  magAmmo: number;
  reserveAmmo: number;
  reloading: boolean;
  weaponId: string;
  weaponName: string;
  weaponSlots: { id: string; name: string; mag: number; reserve: number }[];
  grenades: number;
  score: number;
  kills: number;
  headshots: number;
  shotsFired: number;
  shotsHit: number;
  roundIndex: number;
  roundLabel: string;
  enemiesRemaining: number;
  enemiesTotal: number;
  aiming: boolean;
  spreadPx: number;
  hitmarker: number; // timestamp ms of last hit, 0 = none
  hitmarkerHeadshot: boolean;
  killstreak: number;
  damageFlash: number; // 0..1 recent damage intensity
  lowAmmo: boolean;
  fps: number;
  /** 0..1 proximity danger (nearest hostile closing in). */
  threatLevel: number;
  /** Bearing of the nearest hostile on screen: 0 = ahead, +90 = right. */
  threatAngleDeg: number;
  /** Hostiles currently inside the danger radius. */
  threatCount: number;
  /** Distance to the nearest hostile in metres (-1 = none nearby). */
  threatDistance: number;
}
