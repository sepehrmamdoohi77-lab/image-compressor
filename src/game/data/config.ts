// ============================================================================
// CENTRAL BALANCE DATA — all tuning lives here (data-driven design).
// Do not scatter balance constants through gameplay code.
// ============================================================================

export type WeaponId = 'rifle' | 'smg' | 'shotgun' | 'dmr' | 'pistol';
export type EnemyArchetype = 'rifleman' | 'assault' | 'heavy' | 'support';
export type HitZone = 'HEAD' | 'TORSO' | 'ARMS' | 'LEGS';
export type FireMode = 'auto' | 'semi';

// --- World scale: 1 unit = 1 meter -------------------------------------------
export const WORLD = {
  SIZE_CELLS: 44,
  CELL: 1,
  WALL_HEIGHT: 3.0,
  DOOR_HEIGHT: 2.0,
  LOW_COVER_HEIGHT: 1.0,
  MID_COVER_HEIGHT: 1.35,
  EYE_HEIGHT: 1.6,
  PLAYER_RADIUS: 0.35,
  PLAYER_HEIGHT: 1.8,
} as const;

// --- Camera ------------------------------------------------------------------
// Low, tight iso angle: hostiles read as silhouettes against the skyline and the
// player can actually see the fight develop across the compound.
export const CAMERA_CONFIG = {
  elevationDeg: 40,
  azimuthDeg: 45,
  distance: 20,
  minDistance: 12,
  maxDistance: 30,
  fov: 38,
  followSmoothing: 7.5,
  lookAhead: 1.6,
  shakeDecay: 2.6,
  maxShakeOffset: 0.45,
  fireKick: 0.05,
  explosionKick: 0.6,
  boundaryMargin: 2.0,
} as const;

// --- Player ------------------------------------------------------------------
export const PLAYER_CONFIG = {
  maxHealth: 100,
  maxArmor: 100,
  startArmor: 50,
  walkSpeed: 4.6,
  runMultiplier: 1.0,
  /** Hold Shift: sprint. Faster, louder, weapon lowered, no aiming. */
  sprintMultiplier: 1.62,
  sprintAccelBonus: 1.35,
  aimMoveMultiplier: 0.55,
  accel: 26,
  decel: 30,
  grenades: 3,
  maxGrenades: 4,
  /** Round resupply: how much armor a fresh round hands back. */
  resupplyArmor: 40,
} as const;

export interface WeaponSound {
  /** Muzzle crack layer frequency (Hz) — sharp, directional snap. */
  crackFreq: number;
  /** Low body/chest thump layer (Hz). */
  bodyFreq: number;
  /** Gas/mechanical noise band center (Hz). */
  noiseFreq: number;
  noiseType: BiquadFilterType;
  /** Main body length (seconds). */
  duration: number;
  /** Slap-back echo/decay tail (seconds) — longer in a walled compound. */
  tail: number;
  /** Mechanical rattle (bolt/shell) amount 0..1. */
  mech: number;
  /** Heavy boom layer (shotgun-class). */
  big: boolean;
}

export interface WeaponDef {
  id: WeaponId;
  name: string;
  category: string;
  /** Per-weapon acoustic signature (each gun must sound like itself). */
  sound: WeaponSound;
  damage: number;
  armorDamageMult: number; // multiplies damage dealt to armor pool
  magSize: number;
  startReserve: number;
  maxReserve: number;
  rpm: number;
  reloadTime: number;
  recoilPitch: number; // radians added per shot (visual + spread)
  recoilYaw: number;
  recoilRecovery: number; // per second
  spreadBase: number; // radians
  spreadMove: number; // added while moving
  spreadShot: number; // added per shot (bloom)
  spreadMax: number;
  spreadAimMult: number; // multiplier while precision aiming
  range: number;
  falloffStart: number;
  falloffEnd: number;
  minDamageMult: number; // damage multiplier at/past falloffEnd
  movePenalty: number; // 0..1 movement slow while firing/aiming this weapon
  fireMode: FireMode;
  pellets: number;
  headshotMult: number;
  kickback: number; // camera kick per shot
  tracerColor: number;
  soundFreq: number;
  soundDuration: number;
  autoRefillReservePerRound: number;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  rifle: {
    id: 'rifle', name: 'AR-7 “Jackal”', category: 'Assault Rifle',
    // Mid crack, dry mechanical rattle, short tail: the workhorse.
    sound: { crackFreq: 265, bodyFreq: 112, noiseFreq: 2100, noiseType: 'bandpass', duration: 0.13, tail: 0.24, mech: 0.5, big: false },
    damage: 24, armorDamageMult: 1.0, magSize: 30, startReserve: 180, maxReserve: 300,
    rpm: 540, reloadTime: 1.9, recoilPitch: 0.011, recoilYaw: 0.006, recoilRecovery: 3.2,
    spreadBase: 0.012, spreadMove: 0.02, spreadShot: 0.004, spreadMax: 0.075, spreadAimMult: 0.45,
    range: 46, falloffStart: 16, falloffEnd: 38, minDamageMult: 0.55,
    movePenalty: 0.12, fireMode: 'auto', pellets: 1, headshotMult: 2.1,
    kickback: 0.045, tracerColor: 0xffd27a, soundFreq: 190, soundDuration: 0.11,
    autoRefillReservePerRound: 90,
  },
  smg: {
    id: 'smg', name: 'VK-9 “Hornet”', category: 'SMG',
    // High, tight buzz — fast decay, lots of rattle, little tail.
    sound: { crackFreq: 430, bodyFreq: 148, noiseFreq: 3400, noiseType: 'bandpass', duration: 0.075, tail: 0.1, mech: 0.75, big: false },
    damage: 15, armorDamageMult: 0.7, magSize: 40, startReserve: 240, maxReserve: 400,
    rpm: 800, reloadTime: 1.6, recoilPitch: 0.008, recoilYaw: 0.007, recoilRecovery: 3.6,
    spreadBase: 0.022, spreadMove: 0.026, spreadShot: 0.0035, spreadMax: 0.095, spreadAimMult: 0.5,
    range: 34, falloffStart: 9, falloffEnd: 26, minDamageMult: 0.4,
    movePenalty: 0.06, fireMode: 'auto', pellets: 1, headshotMult: 1.9,
    kickback: 0.03, tracerColor: 0x9adcff, soundFreq: 260, soundDuration: 0.08,
    autoRefillReservePerRound: 120,
  },
  shotgun: {
    id: 'shotgun', name: 'M500 “Breacher”', category: 'Shotgun',
    // Deep boom + long gas tail: unmistakably a 12-gauge.
    sound: { crackFreq: 118, bodyFreq: 58, noiseFreq: 780, noiseType: 'lowpass', duration: 0.3, tail: 0.42, mech: 0.95, big: true },
    damage: 11, armorDamageMult: 0.8, magSize: 6, startReserve: 42, maxReserve: 60,
    rpm: 70, reloadTime: 2.6, recoilPitch: 0.055, recoilYaw: 0.02, recoilRecovery: 2.2,
    spreadBase: 0.055, spreadMove: 0.03, spreadShot: 0.01, spreadMax: 0.11, spreadAimMult: 0.6,
    range: 22, falloffStart: 6, falloffEnd: 18, minDamageMult: 0.25,
    movePenalty: 0.18, fireMode: 'semi', pellets: 8, headshotMult: 1.7,
    kickback: 0.22, tracerColor: 0xff9a5c, soundFreq: 110, soundDuration: 0.22,
    autoRefillReservePerRound: 18,
  },
  dmr: {
    id: 'dmr', name: 'LR-12 “Longeye”', category: 'DMR',
    // Hard supersonic crack with a long rolling echo across the compound.
    sound: { crackFreq: 205, bodyFreq: 88, noiseFreq: 4300, noiseType: 'highpass', duration: 0.19, tail: 0.6, mech: 0.28, big: false },
    damage: 62, armorDamageMult: 1.6, magSize: 10, startReserve: 60, maxReserve: 100,
    rpm: 170, reloadTime: 2.2, recoilPitch: 0.03, recoilYaw: 0.009, recoilRecovery: 2.8,
    spreadBase: 0.004, spreadMove: 0.028, spreadShot: 0.012, spreadMax: 0.06, spreadAimMult: 0.3,
    range: 60, falloffStart: 26, falloffEnd: 55, minDamageMult: 0.7,
    movePenalty: 0.2, fireMode: 'semi', pellets: 1, headshotMult: 2.5,
    kickback: 0.12, tracerColor: 0xd6ff9a, soundFreq: 140, soundDuration: 0.18,
    autoRefillReservePerRound: 30,
  },
  pistol: {
    id: 'pistol', name: 'P9 “Sidearm”', category: 'Pistol',
    // Bright snappy pop, tight and dry (little low end, no echo).
    sound: { crackFreq: 540, bodyFreq: 172, noiseFreq: 2700, noiseType: 'bandpass', duration: 0.085, tail: 0.12, mech: 0.22, big: false },
    damage: 20, armorDamageMult: 0.9, magSize: 12, startReserve: 84, maxReserve: 144,
    rpm: 320, reloadTime: 1.3, recoilPitch: 0.014, recoilYaw: 0.007, recoilRecovery: 4.0,
    spreadBase: 0.011, spreadMove: 0.018, spreadShot: 0.005, spreadMax: 0.07, spreadAimMult: 0.45,
    range: 30, falloffStart: 10, falloffEnd: 26, minDamageMult: 0.5,
    movePenalty: 0.04, fireMode: 'semi', pellets: 1, headshotMult: 2.0,
    kickback: 0.06, tracerColor: 0xffffff, soundFreq: 320, soundDuration: 0.09,
    autoRefillReservePerRound: 36,
  },
};

export const WEAPON_ORDER: WeaponId[] = ['rifle', 'smg', 'shotgun', 'dmr', 'pistol'];

// --- Damage / armor -----------------------------------------------------------
export const DAMAGE = {
  zoneMult: { HEAD: 2.2, TORSO: 1.0, ARMS: 0.75, LEGS: 0.65 } as Record<HitZone, number>,
  // Armor mitigation: reduction = armor / (armor + armorK). Keeps TTK fair.
  armorK: 60,
  armorAbsorb: 0.65, // fraction of mitigated damage taken by armor pool
  grenadeDamage: 110,
  grenadeRadius: 5.5,
  grenadeFalloffPower: 1.35,
  grenadeFuse: 2.1,
  grenadeThrowSpeed: 12.5,
  friendlyFireMult: 1.0,
} as const;

// --- Enemies ------------------------------------------------------------------
export interface EnemyDef {
  archetype: EnemyArchetype;
  name: string;
  health: number;
  armor: number;
  speed: number;
  weaponId: WeaponId;
  accuracy: number; // 0..1 baseline hit quality
  aggression: number; // 0..1 push / flank tendency
  preferredMin: number;
  preferredMax: number;
  reactionTime: number;
  burstSize: number;
  burstPause: number;
  visionRange: number;
  visionFovDeg: number;
  hearingRadius: number;
  scoreValue: number;
  tint: number; // uniform accent
  scale: number;
}

export const ENEMIES: Record<EnemyArchetype, EnemyDef> = {
  rifleman: {
    archetype: 'rifleman', name: 'Hostile Rifleman',
    health: 70, armor: 10, speed: 3.4, weaponId: 'rifle',
    accuracy: 0.5, aggression: 0.45, preferredMin: 9, preferredMax: 20,
    reactionTime: 0.65, burstSize: 4, burstPause: 0.9,
    visionRange: 26, visionFovDeg: 110, hearingRadius: 16, scoreValue: 100,
    tint: 0x8a2f2b, scale: 1.0,
  },
  assault: {
    archetype: 'assault', name: 'Assault Runner',
    health: 55, armor: 0, speed: 4.6, weaponId: 'smg',
    accuracy: 0.42, aggression: 0.85, preferredMin: 4, preferredMax: 11,
    reactionTime: 0.45, burstSize: 7, burstPause: 0.7,
    visionRange: 23, visionFovDeg: 120, hearingRadius: 18, scoreValue: 120,
    tint: 0xb06a1e, scale: 0.97,
  },
  heavy: {
    archetype: 'heavy', name: 'Heavy Gunner',
    health: 160, armor: 45, speed: 2.5, weaponId: 'shotgun',
    accuracy: 0.55, aggression: 0.6, preferredMin: 5, preferredMax: 13,
    reactionTime: 0.8, burstSize: 2, burstPause: 1.3,
    visionRange: 22, visionFovDeg: 95, hearingRadius: 13, scoreValue: 200,
    tint: 0x4a4f5a, scale: 1.12,
  },
  support: {
    archetype: 'support', name: 'Support Marksman',
    health: 60, armor: 15, speed: 3.0, weaponId: 'dmr',
    accuracy: 0.68, aggression: 0.3, preferredMin: 15, preferredMax: 27,
    reactionTime: 0.9, burstSize: 1, burstPause: 1.6,
    visionRange: 32, visionFovDeg: 90, hearingRadius: 14, scoreValue: 150,
    tint: 0x2f6b5a, scale: 1.0,
  },
};

// --- Difficulty / rounds -------------------------------------------------------
export interface RoundDef {
  enemies: EnemyArchetype[];
  accuracyMult: number;
  aggressionMult: number;
  healthMult: number;
  spawnInterval: number;
  maxConcurrent: number;
  label: string;
  briefing: string;
}

export const ROUNDS: RoundDef[] = [
  {
    label: 'ROUND 1 — CONTACT',
    briefing: 'Hostile rifle squad in the compound. Sweep and clear.',
    enemies: ['rifleman', 'rifleman', 'rifleman', 'assault'],
    accuracyMult: 0.8, aggressionMult: 0.8, healthMult: 0.9,
    spawnInterval: 1.2, maxConcurrent: 4,
  },
  {
    label: 'ROUND 2 — PRESSURE',
    briefing: 'More runners inbound. Watch the flanks and keep moving.',
    enemies: ['rifleman', 'rifleman', 'assault', 'assault', 'assault', 'support'],
    accuracyMult: 0.9, aggressionMult: 0.9, healthMult: 0.95,
    spawnInterval: 1.0, maxConcurrent: 5,
  },
  {
    label: 'ROUND 3 — MIXED FORCE',
    briefing: 'Mixed enemy force with marksman support. Use cover.',
    enemies: ['rifleman', 'rifleman', 'assault', 'assault', 'support', 'heavy', 'rifleman'],
    accuracyMult: 1.0, aggressionMult: 1.0, healthMult: 1.0,
    spawnInterval: 0.9, maxConcurrent: 6,
  },
  {
    label: 'ROUND 4 — HEAVY RESISTANCE',
    briefing: 'Heavy gunners holding the plaza. Grenades are your friend (G).',
    enemies: ['heavy', 'rifleman', 'assault', 'support', 'heavy', 'rifleman', 'assault', 'support'],
    accuracyMult: 1.05, aggressionMult: 1.1, healthMult: 1.05,
    spawnInterval: 0.8, maxConcurrent: 6,
  },
  {
    label: 'ROUND 5 — FINAL STAND',
    briefing: 'Everything they have left. Hold the line. Finish it.',
    enemies: ['heavy', 'heavy', 'assault', 'assault', 'assault', 'support', 'support', 'rifleman', 'rifleman', 'rifleman'],
    accuracyMult: 1.12, aggressionMult: 1.2, healthMult: 1.1,
    spawnInterval: 0.6, maxConcurrent: 7,
  },
];

export const SCORING = {
  headshotBonus: 50,
  grenadeBonus: 75,
  multikillWindow: 3.0,
  multikillBonus: [0, 0, 100, 200, 350, 500],
  roundClearBonus: [0, 250, 350, 500, 700, 1000],
  accuracyBonusThreshold: 0.5,
  accuracyBonus: 300,
  noDamageBonus: 500,
} as const;

// --- AI ------------------------------------------------------------------------
export const AI = {
  memoryDuration: 7.0,
  suspicionDuration: 4.0,
  decisionInterval: 0.55,
  perceptionInterval: 0.18,
  coverSearchRadius: 20,
  flankAngleDeg: 55,
  retreatHealthFrac: 0.28,
  moveRepathInterval: 1.4,
  separationRadius: 1.2,
  aimErrorBase: 0.055, // radians of error at accuracy 0
  aimErrorMoveTarget: 0.05,
  aimErrorMoveSelf: 0.035,
  hearingMemoryConf: 0.45,
  squadShareRadius: 30,
  squadShareNoise: 3.5,
  squadConfFactor: 0.6,

  // --- Enemy shooting fallibility ---------------------------------------------
  // Hostiles should miss sometimes — a perfect volley feels robotic. Misses are
  // deliberate near-misses (the round cracks past the player) rather than pure
  // random cone scatter, so they read as "close" instead of "broken".
  missChanceBase: 0.08, // at max accuracy
  missChanceAccuracyScale: 0.3, // extra chance as accuracy drops
  missChanceMoving: 0.1, // bonus when the player is running
  missChanceDistance: 0.07, // bonus at max weapon range
  missChanceSuppressed: 0.08, // bonus right after the shooter is hit / re-acquiring
  /** Lateral offset (m) applied to a deliberate miss — near misses stay close. */
  missLateral: 1.0,
  /** Vertical offset (m) applied to a deliberate miss. */
  missVertical: 0.45,
  /** A round passing closer than this is a "near miss": whiz + shake. */
  nearMissRadius: 1.8,

  // --- Cover behaviour ----------------------------------------------------------
  // Hostiles fight from cover like soldiers: hide, lean out on one side to shoot,
  // duck back, relocate when flanked or suppressed, and never re-use the same
  // sandbag forever.
  coverPeekMin: 1.2, // seconds exposed per peek
  coverPeekMax: 2.4,
  coverHideMin: 1.0, // seconds tucked in before the next peek
  coverHideMax: 2.0,
  coverLean: 0.42, // peak body lean (radians) while exposing
  coverLeanDamp: 6.5, // how fast the lean eases in/out (per second)
  coverRelocateAfter: 7.5, // leave cover after this long even if still safe
  coverRelocateDamage: 0.35, // health fraction lost while in cover -> relocate
  coverReuseCooldown: 16, // seconds before an abandoned point is attractive again
  coverReusePenalty: 45, // score penalty while the cooldown runs
  coverFlankRecheck: 1.1, // seconds between "am I still covered?" checks
  suppressedHoldChance: 0.75, // chance to stay tucked when freshly hit in cover
  coverAdvanceChance: 0.3, // chance to advance to the NEXT cover on a peek
} as const;

/**
 * Field pickups: random resupply crates that appear out in the compound. The
 * player walks over one to use it (fraction of MAX health, never wasted at full).
 */
export const PICKUPS = {
  /** Fraction of max health restored by one medkit. */
  healthFraction: 0.3,
  /** Most health kits on the map at the same time. */
  maxActive: 2,
  /** Seconds between spawn attempts (randomised inside the range). */
  spawnEveryMin: 11,
  spawnEveryMax: 18,
  /** How long a kit waits to be found before it disappears. */
  lifetime: 34,
  /** Pickup radius (m) around the player. */
  radius: 1.35,
  /** Kits never spawn closer than this to the player (no free heals in your face). */
  minDistanceFromPlayer: 9,
  /** Medkit visual: bob amplitude/rate + beacon ring. */
  bobAmplitude: 0.12,
  spinRate: 0.9,
} as const;

/** Minimap radar (HUD, top-right). */
export const RADAR = {
  /** World units across the radar face (metres). */
  spanMeters: 52,
  /** Blips fade in from this range and are brightest at zero. */
  blipRange: 26,
  /** Health kits are shown as green crosses. */
  showPickups: true,
} as const;

/** Readability aid: "danger" telegraphed when hostiles close in on the player. */
export const THREATS = {
  /** Hostiles inside this radius get a red danger line on the ground. */
  radius: 21,
  /** Hard cap on simultaneous ground indicators. */
  maxIndicators: 6,
  /** Enemies closer than this drive the HUD danger edge to full intensity. */
  hudCloseRadius: 8,
  /** Distance at which the HUD danger edge starts to appear. */
  hudFarRadius: 26,
  /** Aware hostiles (they know where you are) read as a stronger threat. */
  awareBoost: 1.4,
  /** Danger pulse frequency (Hz). */
  pulseHz: 2.4,
  /** Ring pulse radius range at the hostile's feet. */
  ringMin: 0.45,
  ringMax: 1.1,
} as const;

// --- Audio ----------------------------------------------------------------------
export const AUDIO_DEFAULTS = {
  master: 0.8,
  sfx: 0.9,
  music: 0.4,
  ui: 0.8,
} as const;

export interface SettingsData {
  master: number;
  sfx: number;
  music: number;
  ui: number;
  sensitivity: number;
  quality: 'low' | 'medium' | 'high';
  cameraDistance: number;
  invertY: boolean;
}

export const SETTINGS_DEFAULTS: SettingsData = {
  master: 0.8,
  sfx: 0.9,
  music: 0.4,
  ui: 0.8,
  sensitivity: 1.0,
  quality: 'high',
  cameraDistance: CAMERA_CONFIG.distance,
  invertY: false,
};
