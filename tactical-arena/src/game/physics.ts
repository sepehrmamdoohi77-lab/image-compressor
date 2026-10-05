import type { GameConfig, InputIntent, Transform } from '../multiplayer/protocol';

/** Mirrors the authoritative Python ground-plane collision kernel. Prediction only. */
export function move(
  x: number,
  z: number,
  dx: number,
  dz: number,
  config: GameConfig,
): [number, number] {
  const radius = config.movement.radius,
    limit = config.map.size / 2 - radius;
  const overlaps = (px: number, pz: number, o: GameConfig['map']['obstacles'][number]) =>
    Math.abs(px - o.x) < o.w / 2 + radius - 1e-9 && Math.abs(pz - o.z) < o.d / 2 + radius - 1e-9;
  let nx = Math.max(-limit, Math.min(limit, x + dx));
  for (const o of config.map.obstacles)
    if (overlaps(nx, z, o)) nx = dx > 0 ? o.x - o.w / 2 - radius : o.x + o.w / 2 + radius;
  let nz = Math.max(-limit, Math.min(limit, z + dz));
  for (const o of config.map.obstacles)
    if (overlaps(nx, nz, o)) nz = dz > 0 ? o.z - o.d / 2 - radius : o.z + o.d / 2 + radius;
  return [nx, nz];
}

interface PendingInput {
  seq: number;
  intent: InputIntent;
  dt: number;
}
export class LocalPrediction {
  pose: Transform | null = null;
  private pending: PendingInput[] = [];
  private originalObstacles: GameConfig['map']['obstacles'];
  private others: Transform[] = [];
  constructor(private config: GameConfig) {
    this.originalObstacles = [...config.map.obstacles];
  }
  world(destroyed: string[], peers: Transform[], ownId: string): void {
    const removed = new Set(destroyed);
    this.config = {
      ...this.config,
      map: {
        ...this.config.map,
        obstacles: this.originalObstacles.filter((o) => !removed.has(o.id)),
      },
    };
    this.others = peers.filter((p) => p.id !== ownId && (p.combat?.health ?? 100) > 0);
  }
  accept(authoritative: Transform): void {
    this.pending = this.pending.filter((p) => p.seq > authoritative.ackSeq);
    this.pose = { ...authoritative };
    for (const input of this.pending) this.integrate(input.intent, input.dt);
  }
  step(seq: number, intent: InputIntent, dt: number): void {
    if (!this.pose) return;
    this.pending.push({ seq, intent, dt });
    if (this.pending.length > 90) this.pending.shift();
    this.integrate(intent, dt);
  }
  private integrate(intent: InputIntent, dt: number): void {
    if (!this.pose || (this.pose.combat?.health ?? 100) <= 0 || dt <= 0) return;
    const magnitude = Math.max(1, Math.hypot(intent.moveX, intent.moveZ));
    const modifier = this.pose.combat
      ? intent.crouch
        ? this.config.movement.crouchFactor
        : intent.ads && !intent.sprint
          ? this.config.movement.adsFactor
          : 1
      : 1;
    const speed =
      modifier *
      (intent.sprint && !intent.crouch
        ? this.config.movement.sprintSpeed
        : this.config.movement.walkSpeed);
    const dx = (intent.moveX / magnitude) * speed * dt,
      dz = (intent.moveZ / magnitude) * speed * dt;
    let [x, z] = move(this.pose.x, this.pose.z, dx, dz, this.config);
    if (this.pose.combat) {
      for (const other of this.others) {
        const ox = x - other.x,
          oz = z - other.z,
          d = Math.hypot(ox, oz),
          minimum = this.config.movement.radius * 2;
        if (d < minimum && d > 0.001) {
          [x, z] = move(x, z, (ox / d) * (minimum - d), (oz / d) * (minimum - d), this.config);
        }
      }
    }
    const vx = (x - this.pose.x) / dt,
      vz = (z - this.pose.z) / dt;
    this.pose = {
      ...this.pose,
      x,
      z,
      yaw: intent.aim,
      pitch: intent.pitch ?? this.pose.pitch,
      combat: this.pose.combat
        ? {
            ...this.pose.combat,
            crouch: intent.crouch ?? false,
            ads: !!intent.ads && !intent.sprint,
          }
        : undefined,
      vx,
      vz,
      movement:
        Math.hypot(vx, vz) > 0.05
          ? intent.crouch
            ? 'crouch'
            : intent.sprint
              ? 'sprint'
              : 'walk'
          : 'idle',
    };
  }
  reset(): void {
    this.pose = null;
    this.pending = [];
  }
}
