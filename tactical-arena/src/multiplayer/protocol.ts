import { z } from 'zod';

const finite = z.number().finite();
const nonnegative = finite.nonnegative();
const count = z.number().int().nonnegative();
const uuid = z.string().uuid();
const deadline = nonnegative.nullable();
export const phaseSchema = z.enum(['LOBBY', 'COUNTDOWN', 'ACTIVE', 'ENDING', 'RESULTS', 'CLOSED']);
export type Phase = z.infer<typeof phaseSchema>;
export const teamSchema = z.enum(['blue', 'red']);
export type Team = z.infer<typeof teamSchema>;
export const modeSchema = z.enum(['TEAM_DEATHMATCH', 'NETWORK_DRILL']);
export const weaponIdSchema = z.enum(['rifle', 'smg', 'shotgun', 'dmr', 'pistol']);
export type WeaponId = z.infer<typeof weaponIdSchema>;
export const primarySchema = z.enum(['rifle', 'smg', 'shotgun', 'dmr']);
export const cosmeticSchema = z.enum(['olive', 'slate', 'sand']);
export const mapIdSchema = z.enum([
  'outpost',
  'dockyard',
  'refinery',
  'rail-depot',
  'checkpoint',
  'courtyard',
  'scrapyard',
  'barracks',
  'bunker',
  'market',
]);
export type MapId = z.infer<typeof mapIdSchema>;
export const settingsSchema = z
  .object({
    mapId: mapIdSchema.default('outpost'),
    teamSize: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    timeLimitSeconds: z.union([z.literal(120), z.literal(300), z.literal(600)]),
    mode: modeSchema.default('NETWORK_DRILL'),
    scoreLimit: count.min(1).max(100).default(50),
    bots: count.max(7).default(0),
    difficulty: z.enum(['easy', 'normal', 'hard']).default('normal'),
    friendlyFire: z.boolean().default(false),
  })
  .strict();
export type RoomSettings = z.infer<typeof settingsSchema>;
export const matchStatsSchema = z
  .object({
    kills: count,
    deaths: count,
    assists: count,
    score: count,
    shots: count,
    hits: count,
    headshots: count,
    damage: nonnegative,
  })
  .strict();
export type MatchStats = z.infer<typeof matchStatsSchema>;
export const lifetimeSchema = z
  .object({
    kills: count,
    deaths: count,
    assists: count,
    shots: count,
    hits: count,
    headshots: count,
    damage: nonnegative,
    matches: count,
    wins: count,
    losses: count,
    draws: count,
    weaponShots: z.partialRecord(weaponIdSchema, count),
  })
  .strict();
const scoreSchema = z.object({ blue: count, red: count }).strict();
const historySchema = z
  .object({
    matchId: uuid,
    at: nonnegative,
    outcome: z.enum(['win', 'loss', 'draw']),
    scores: scoreSchema,
    stats: matchStatsSchema,
    xpEarned: count,
    levelAfter: count.min(1).max(50),
  })
  .strict();
export const profileSchema = z
  .object({
    id: uuid,
    name: z.string().min(3).max(20),
    createdAt: nonnegative,
    kind: z.literal('guest'),
    level: count.min(1).max(50),
    xp: count,
    levelStartXp: count,
    nextLevelXp: count.nullable(),
    stats: lifetimeSchema,
    favoriteWeapon: weaponIdSchema.nullable(),
    loadout: z
      .object({
        primary: primarySchema,
        secondary: z.literal('pistol'),
        grenade: z.literal('frag'),
        cosmetic: cosmeticSchema,
      })
      .strict(),
    history: z.array(historySchema).max(5),
  })
  .strict();
export type Profile = z.infer<typeof profileSchema>;
const zeroStats = () => ({
  kills: 0,
  deaths: 0,
  assists: 0,
  score: 0,
  shots: 0,
  hits: 0,
  headshots: 0,
  damage: 0,
});
export const playerSchema = z
  .object({
    id: uuid,
    name: z.string().min(3).max(20),
    team: teamSchema,
    connected: z.boolean(),
    ready: z.boolean(),
    status: z.enum([
      'CONNECTED',
      'LOBBY',
      'READY',
      'SPAWNING',
      'ALIVE',
      'DEAD',
      'RESPAWNING',
      'DISCONNECTED',
      'SPECTATING',
    ]),
    latencyMs: count.max(9999).nullable(),
    isBot: z.boolean().default(false),
    primary: primarySchema.default('rifle'),
    cosmetic: cosmeticSchema.default('olive'),
    level: count.min(1).max(50).default(1),
    stats: matchStatsSchema.default(zeroStats),
  })
  .strict();
export type PlayerInfo = z.infer<typeof playerSchema>;
export const killSchema = z
  .object({
    id: count,
    atMs: nonnegative,
    attackerId: uuid.nullable(),
    attacker: z.string().max(20),
    victimId: uuid,
    victim: z.string().max(20),
    weaponId: z.union([weaponIdSchema, z.literal('grenade')]),
    headshot: z.boolean(),
    teamkill: z.boolean(),
  })
  .strict();
const resultPlayerSchema = z
  .object({
    id: uuid,
    name: z.string().max(20),
    team: teamSchema,
    isBot: z.boolean(),
    eligible: z.boolean(),
    stats: matchStatsSchema,
    weaponShots: z.partialRecord(weaponIdSchema, count),
    outcome: z.enum(['win', 'loss', 'draw']),
    xpPlanned: count,
    xpEarned: count.nullable(),
    levelBefore: count.min(1).max(50),
    levelAfter: count.min(1).max(50),
  })
  .strict();
export const resultSchema = z
  .object({
    winner: z.union([teamSchema, z.literal('draw')]),
    reason: z.enum(['score_limit', 'time_limit', 'forfeit']),
    scores: scoreSchema,
    practice: z.boolean(),
    endedAtMs: nonnegative,
    persistence: z.enum(['saving', 'saved', 'error', 'not_required']),
    error: z.string().max(400).nullable(),
    players: z.array(resultPlayerSchema).max(32),
  })
  .strict();
export const roomSchema = z
  .object({
    id: uuid,
    code: z.string().regex(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/),
    ownerId: uuid,
    settings: settingsSchema,
    mapId: mapIdSchema,
    mode: modeSchema,
    combatEnabled: z.boolean(),
    publicRoom: z.boolean().default(false),
    phase: phaseSchema,
    phaseEndsAtMs: deadline,
    matchId: uuid.nullable(),
    revision: count,
    players: z.array(playerSchema).max(8),
    scores: scoreSchema.default({ blue: 0, red: 0 }),
    killfeed: z.array(killSchema).max(6).default([]),
    results: resultSchema.nullable().default(null),
  })
  .strict()
  .refine((r) => new Set(r.players.map((p) => p.id)).size === r.players.length);
export type RoomState = z.infer<typeof roomSchema>;
export const combatSchema = z
  .object({
    health: finite.min(0).max(100),
    armor: finite.min(0).max(65),
    slot: z.union([z.literal(1), z.literal(2)]),
    weaponId: weaponIdSchema,
    weaponState: z.enum([
      'HOLSTERED',
      'EQUIPPED',
      'AIMING',
      'FIRING',
      'RELOADING',
      'SWITCHING',
      'DISABLED',
    ]),
    magazine: count.max(100),
    reserve: count.max(500),
    reloadEndsAtMs: deadline,
    reloadStartedAtMs: deadline,
    readyAtMs: nonnegative,
    ads: z.boolean(),
    crouch: z.boolean(),
    recoil: finite.min(0).max(0.2),
    bloom: finite.min(0).max(0.2),
    grenades: count.max(2),
    protectedUntilMs: nonnegative,
    respawnAtMs: deadline,
    throwUntilMs: nonnegative,
    deathAtMs: deadline,
  })
  .strict();
export type CombatState = z.infer<typeof combatSchema>;
export const transformSchema = z
  .object({
    id: uuid,
    x: finite.min(-22).max(22),
    z: finite.min(-22).max(22),
    yaw: finite.min(-3.142).max(3.142),
    pitch: finite.min(-0.501).max(0.501).default(0),
    vx: finite.min(-6).max(6),
    vz: finite.min(-6).max(6),
    movement: z.enum(['idle', 'walk', 'sprint', 'crouch']),
    ackSeq: z.number().int().min(-1),
    combat: combatSchema.optional(),
  })
  .strict();
export type Transform = z.infer<typeof transformSchema>;
const point = z
  .object({
    x: finite.min(-150).max(150),
    y: finite.min(-100).max(100),
    z: finite.min(-150).max(150),
  })
  .strict();
export const grenadeSchema = z
  .object({
    id: uuid,
    ownerId: uuid,
    x: finite.min(-22).max(22),
    y: finite.min(0).max(20),
    z: finite.min(-22).max(22),
    fuseAtMs: nonnegative,
    target: point.nullable().default(null),
    landed: z.boolean().default(false),
    blocked: z.boolean().default(false),
  })
  .strict();
export type GrenadeState = z.infer<typeof grenadeSchema>;
export const contactSchema = z
  .object({
    id: uuid,
    team: teamSchema,
    x: finite.min(-22).max(22),
    z: finite.min(-22).max(22),
    yaw: finite.min(-3.142).max(3.142),
    seenAtMs: nonnegative,
    state: z.enum(['visible', 'team', 'last']),
  })
  .strict();
export type RadarContact = z.infer<typeof contactSchema>;
export const snapshotSchema = z
  .object({
    type: z.literal('snapshot'),
    roomId: uuid,
    seq: count,
    eventSeq: count.default(0),
    serverTimeMs: nonnegative,
    phase: phaseSchema,
    phaseEndsAtMs: deadline,
    players: z.array(transformSchema).max(8),
    scores: scoreSchema.default({ blue: 0, red: 0 }),
    destroyed: z.array(z.string().max(20)).max(80).default([]),
    grenades: z.array(grenadeSchema).max(20).default([]),
    contacts: z.array(contactSchema).max(8).default([]),
  })
  .strict()
  .refine((s) => new Set(s.players.map((p) => p.id)).size === s.players.length);
export type Snapshot = z.infer<typeof snapshotSchema>;
const combatEventPayload = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('shot'),
      playerId: uuid,
      weaponId: weaponIdSchema,
      origin: point,
      ends: z.array(point).min(1).max(8),
      impacts: z.array(z.enum(['blood', 'protected', 'concrete', 'air'])).max(8),
    })
    .strict(),
  z
    .object({
      kind: z.literal('damage'),
      attackerId: uuid.nullable(),
      victimId: uuid,
      damage: nonnegative,
      health: finite.min(0).max(100),
      armor: finite.min(0).max(65),
      headshot: z.boolean(),
      bearing: finite.min(-3.142).max(3.142),
    })
    .strict(),
  killSchema.extend({ kind: z.literal('kill') }).strict(),
  z
    .object({
      kind: z.literal('reload'),
      playerId: uuid,
      weaponId: weaponIdSchema,
      endsAtMs: nonnegative,
    })
    .strict(),
  z
    .object({
      kind: z.literal('switch'),
      playerId: uuid,
      weaponId: weaponIdSchema,
      readyAtMs: nonnegative,
    })
    .strict(),
  z.object({ kind: z.literal('respawn'), playerId: uuid }).strict(),
  z.object({ kind: z.literal('grenade_throw'), playerId: uuid, grenade: grenadeSchema }).strict(),
  z
    .object({
      kind: z.literal('explosion'),
      playerId: uuid,
      position: point,
      radius: finite.positive().max(10),
    })
    .strict(),
  z.object({ kind: z.literal('cover_destroyed'), coverId: z.string().max(20) }).strict(),
  z.object({ kind: z.literal('sound'), weaponId: weaponIdSchema, position: point }).strict(),
  z
    .object({
      kind: z.literal('round_end'),
      winner: z.union([teamSchema, z.literal('draw')]),
      reason: z.enum(['score_limit', 'time_limit', 'forfeit']),
    })
    .strict(),
]);
export const eventSchema = z
  .object({
    type: z.literal('combat_event'),
    roomId: uuid,
    seq: count,
    serverTimeMs: nonnegative,
    event: combatEventPayload,
  })
  .strict();
export type CombatEvent = z.infer<typeof eventSchema>;
export const messageSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('welcome'),
      playerId: uuid,
      protocolVersion: z.literal(3),
      serverTimeMs: nonnegative,
    })
    .strict(),
  z
    .object({
      type: z.literal('room_state'),
      room: roomSchema.nullable(),
      serverTimeMs: nonnegative,
    })
    .strict(),
  snapshotSchema,
  eventSchema,
  z.object({ type: z.literal('profile_update'), profile: profileSchema }).strict(),
  z
    .object({ type: z.literal('ack'), requestId: z.string().max(40), action: z.string().max(30) })
    .strict(),
  z
    .object({
      type: z.literal('error'),
      code: z.string().max(40),
      message: z.string().max(400),
      requestId: z.string().max(40).nullable().optional(),
    })
    .strict(),
  z.object({ type: z.literal('ping'), nonce: z.string().max(40) }).strict(),
  z.object({ type: z.literal('room_closed'), message: z.string().max(400) }).strict(),
]);
export type ServerMessage = z.infer<typeof messageSchema>;
export const obstacleSchema = z
  .object({
    id: z.string().max(20),
    kind: z.enum(['building', 'container', 'wall', 'vehicle', 'crate', 'barrier', 'sandbags']),
    x: finite.min(-22).max(22),
    z: finite.min(-22).max(22),
    w: finite.positive().max(20),
    d: finite.positive().max(20),
    h: finite.positive().max(10),
    tone: z.enum(['sand', 'gray', 'olive']),
  })
  .strict();
export type Obstacle = z.infer<typeof obstacleSchema>;
export const weaponSchema = z
  .object({
    id: weaponIdSchema,
    name: z.string().max(40),
    label: z.string().max(20),
    class: z.string().max(20),
    damage: finite.positive(),
    headMultiplier: finite.positive(),
    limbMultiplier: finite.positive(),
    roundsPerSecond: finite.positive().max(30),
    magazineSize: count.min(1).max(100),
    reserveAmmo: count.max(500),
    reloadSeconds: finite.positive().max(10),
    hipSpread: nonnegative,
    adsSpread: nonnegative,
    movementPenalty: finite.positive(),
    recoilPitch: nonnegative,
    recoilYaw: nonnegative,
    recoilReturn: finite.positive(),
    range: finite.positive().max(100),
    falloffStart: nonnegative,
    falloffMinimum: finite.min(0).max(1),
    adsSeconds: finite.positive(),
    switchSeconds: finite.positive(),
    pellets: count.min(1).max(8),
    fireMode: z.enum(['auto', 'semi']),
    tracer: z.enum(['amber', 'white', 'scatter']),
  })
  .strict();
export type WeaponData = z.infer<typeof weaponSchema>;
const mapPoint = z.object({ x: finite, z: finite }).strict();
export const mapSchema = z
  .object({
    id: mapIdSchema,
    name: z.string().max(40),
    sector: z.string().max(10),
    size: z.literal(44),
    description: z.string().max(400),
    theme: z
      .object({
        sky: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        ground: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        road: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        metal: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        trim: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      })
      .strict()
      .optional(),
    spawns: z
      .object({ blue: z.array(mapPoint).min(1).max(4), red: z.array(mapPoint).min(1).max(4) })
      .strict(),
    obstacles: z.array(obstacleSchema).max(80),
  })
  .strict();
export type MapData = z.infer<typeof mapSchema>;
export const configSchema = z
  .object({
    protocolVersion: z.literal(3),
    stage: count.min(1).max(14),
    mode: modeSchema,
    combatEnabled: z.boolean(),
    supportedModes: z.array(modeSchema).max(2).default(['TEAM_DEATHMATCH', 'NETWORK_DRILL']),
    botsSupported: z.boolean().default(false),
    tickHz: count.min(10).max(60),
    snapshotHz: count.min(5).max(30),
    maxPlayers: z.literal(8),
    reconnectGraceSeconds: finite.positive(),
    movement: z
      .object({
        radius: finite.positive(),
        walkSpeed: finite.positive(),
        sprintSpeed: finite.positive(),
        inputTimeoutSeconds: finite.positive(),
        crouchFactor: finite.positive().default(0.45),
        adsFactor: finite.positive().default(0.65),
      })
      .strict(),
    defaultSettings: settingsSchema,
    weapons: z.array(weaponSchema).max(5).default([]),
    grenade: z
      .object({
        fuseSeconds: finite.positive(),
        radius: finite.positive(),
        damage: finite.positive(),
        gravity: finite.positive(),
        throwSpeed: finite.positive(),
        quantity: count,
        maxRange: finite.positive().default(32),
        landingHeight: finite.positive().default(0.09),
        boundaryMargin: finite.positive().default(0.2),
      })
      .strict()
      .optional(),
    combat: z
      .object({
        health: finite.positive(),
        armor: finite.positive(),
        respawnSeconds: finite.positive(),
        protectionSeconds: finite.positive(),
        visionRange: finite.positive(),
      })
      .strict()
      .optional(),
    map: mapSchema,
    maps: z.array(mapSchema).max(10).default([]),
  })
  .strict();
export type GameConfig = z.infer<typeof configSchema>;
export const healthSchema = z
  .object({
    status: z.enum(['available', 'starting', 'unavailable']),
    transport: z.literal('WebSocket'),
    authority: z.literal('dedicated-server'),
    stage: count.min(1).max(14),
    combatEnabled: z.boolean(),
    rooms: count,
    connections: count,
    maxConnections: count.min(1),
  })
  .strict();
export type Health = z.infer<typeof healthSchema>;
export interface InputIntent {
  moveX: number;
  moveZ: number;
  aim: number;
  sprint: boolean;
  pitch?: number;
  trigger?: boolean;
  ads?: boolean;
  crouch?: boolean;
}
export type ConnectionStatus =
  'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
export type Action =
  | 'create_room'
  | 'quick_play'
  | 'join_room'
  | 'ready'
  | 'start'
  | 'return_lobby'
  | 'leave'
  | 'reload'
  | 'switch_weapon'
  | 'grenade'
  | 'retry_results';
