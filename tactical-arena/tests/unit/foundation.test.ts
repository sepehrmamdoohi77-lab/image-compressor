import { describe, expect, it } from 'vitest';
import map from '../../../arena_server/data/outpost.json';
import {
  configSchema,
  messageSchema,
  type Snapshot,
  type Transform,
} from '../../src/multiplayer/protocol';
import { InterpolationBuffer } from '../../src/multiplayer/Interpolation';
import { LocalPrediction, move } from '../../src/game/physics';
import { SettingsStore, defaults } from '../../src/services/Settings';

const config = configSchema.parse({
  protocolVersion: 3,
  stage: 1,
  mode: 'NETWORK_DRILL',
  combatEnabled: false,
  tickHz: 30,
  snapshotHz: 15,
  maxPlayers: 8,
  reconnectGraceSeconds: 20,
  movement: { radius: 0.34, walkSpeed: 3.8, sprintSpeed: 5.8, inputTimeoutSeconds: 0.3 },
  defaultSettings: { teamSize: 4, timeLimitSeconds: 600 },
  map,
});
const id = '00000000-0000-4000-8000-000000000001';
const roomId = '00000000-0000-4000-8000-000000000002';
const pose = (x = 0, yaw = 0): Transform => ({
  id,
  x,
  z: 18,
  yaw,
  vx: 0,
  vz: 0,
  movement: 'idle',
  ackSeq: -1,
});
const snapshot = (seq: number, time: number, x: number, yaw = 0): Snapshot => ({
  type: 'snapshot',
  roomId,
  seq,
  serverTimeMs: time,
  phase: 'ACTIVE',
  phaseEndsAtMs: 10000,
  players: [pose(x, yaw)],
});

describe('shared movement and prediction', () => {
  it('uses the same wall contact as the Python authority and never tunnels', () => {
    let x = -4,
      z = 18;
    for (let i = 0; i < 300; i++) [x, z] = move(x, z, 0, -5.8 / 30, config);
    expect(z).toBeCloseTo(15.14, 9);
    expect(x).toBe(-4);
  });
  it('reports idle presentation when a solid wall blocks movement', () => {
    const prediction = new LocalPrediction(config);
    prediction.accept({ ...pose(-4), z: 15.14 });
    prediction.step(1, { moveX: 0, moveZ: -1, aim: 0, sprint: false }, 1 / 30);
    expect(prediction.pose!.movement).toBe('idle');
    expect(prediction.pose!.vz).toBe(0);
  });
  it('clamps to world bounds using the capsule radius', () => {
    expect(move(-21.6, 21.6, -0.2, 0.2, config)).toEqual([-21.66, 21.66]);
  });
  it('normalizes diagonal prediction and distinguishes sprint speed', () => {
    const prediction = new LocalPrediction(config);
    prediction.accept(pose());
    prediction.step(1, { moveX: 1, moveZ: 1, aim: 0.5, sprint: false }, 1 / 30);
    expect(Math.hypot(prediction.pose!.x, prediction.pose!.z - 18)).toBeCloseTo(3.8 / 30);
    prediction.reset();
    prediction.accept(pose());
    prediction.step(2, { moveX: 1, moveZ: 0, aim: 0.5, sprint: true }, 1 / 30);
    expect(prediction.pose!.x).toBeCloseTo(5.8 / 30);
  });
  it('discards acknowledged inputs and replays only unacknowledged intent', () => {
    const prediction = new LocalPrediction(config);
    prediction.accept(pose());
    const intent = { moveX: 1, moveZ: 0, aim: 0, sprint: false };
    prediction.step(1, intent, 1 / 30);
    prediction.step(2, intent, 1 / 30);
    prediction.accept({ ...pose(3.8 / 30), ackSeq: 1 });
    expect(prediction.pose!.x).toBeCloseTo((2 * 3.8) / 30);
    prediction.accept({ ...pose((2 * 3.8) / 30), ackSeq: 2 });
    expect(prediction.pose!.x).toBeCloseTo((2 * 3.8) / 30);
  });
});

describe('remote interpolation', () => {
  it('interpolates positions behind a real 100ms buffer', () => {
    const buffer = new InterpolationBuffer();
    buffer.push(snapshot(1, 1000, 0));
    buffer.push(snapshot(2, 1100, 3));
    expect(buffer.sample(1150)[0]!.x).toBeCloseTo(1.5);
  });
  it('takes the short rotation path across pi', () => {
    const buffer = new InterpolationBuffer();
    buffer.push(snapshot(1, 1000, 0, 3.1));
    buffer.push(snapshot(2, 1100, 0, -3.1));
    expect(Math.abs(buffer.sample(1150)[0]!.yaw)).toBeCloseTo(Math.PI);
  });
  it('does not mutate authority frames or extrapolate endlessly', () => {
    const buffer = new InterpolationBuffer();
    buffer.push(snapshot(1, 1000, 3));
    buffer.sample(5000)[0]!.x = 999;
    expect(buffer.sample(5000)[0]!.x).toBe(3);
  });
  it('drops stale snapshots and clears history when the room changes', () => {
    const buffer = new InterpolationBuffer();
    buffer.push(snapshot(2, 1100, 3));
    buffer.push(snapshot(1, 1000, 999));
    expect(buffer.sample(2000)[0]!.x).toBe(3);
    buffer.push({ ...snapshot(1, 2000, 5), roomId: '00000000-0000-4000-8000-000000000003' });
    expect(buffer.sample(2050)[0]!.x).toBe(5);
  });
});

describe('untrusted state and preferences', () => {
  it('rejects impossible transforms before rendering', () => {
    expect(messageSchema.safeParse({ ...snapshot(1, 1000, 999) }).success).toBe(false);
    expect(
      messageSchema.safeParse({ ...snapshot(1, 1000, 1), players: [{ ...pose(), x: NaN }] })
        .success,
    ).toBe(false);
  });
  it('handles unavailable browser storage and invalid preferences safely', () => {
    const store = new SettingsStore();
    expect(store.value).toEqual(defaults);
    expect(store.save({ zoom: NaN })).toBe(false);
    expect(store.value.zoom).toBe(defaults.zoom);
    expect(store.save({ quality: 'low' })).toBe(false); // Node has no browser storage.
    expect(store.value.quality).toBe('low'); // A valid preference still applies for the session.
  });
});
