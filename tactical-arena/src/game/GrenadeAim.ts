import * as THREE from 'three';
import type { GameConfig, Transform, Obstacle } from '../multiplayer/protocol';

type Point = { x: number; y: number; z: number };
export interface GrenadePreview {
  valid: boolean;
  reason: 'clear' | 'blocked' | 'range' | 'outside';
  distance: number;
  points: Point[];
  target: { x: number; z: number };
}

/** Segment / expanded map-volume intersection, matching the authority's swept frag radius. */
function intersection(a: Point, b: Point, obstacles: Obstacle[], radius = 0): number | null {
  let nearest: number | null = null;
  for (const o of obstacles) {
    const low = [o.x - o.w / 2 - radius, -radius, o.z - o.d / 2 - radius],
      high = [o.x + o.w / 2 + radius, o.h + radius, o.z + o.d / 2 + radius];
    const from = [a.x, a.y, a.z],
      to = [b.x, b.y, b.z];
    let near = 0,
      far = 1,
      hit = true;
    for (let axis = 0; axis < 3; axis++) {
      const d = to[axis]! - from[axis]!;
      if (Math.abs(d) < 1e-10) {
        if (from[axis]! < low[axis]! || from[axis]! > high[axis]!) {
          hit = false;
          break;
        }
        continue;
      }
      let u = (low[axis]! - from[axis]!) / d,
        v = (high[axis]! - from[axis]!) / d;
      if (u > v) [u, v] = [v, u];
      near = Math.max(near, u);
      far = Math.min(far, v);
      if (near > far) {
        hit = false;
        break;
      }
    }
    if (hit && near >= 0 && near <= 1 && (nearest === null || near < nearest)) nearest = near;
  }
  return nearest;
}

/** Advisory only: server reconstructs the launch and validates the requested ground target. */
export function grenadePreview(
  config: GameConfig,
  pose: Transform,
  target: { x: number; z: number },
  destroyed: string[] = [],
): GrenadePreview {
  const distance = Math.hypot(target.x - pose.x, target.z - pose.z),
    limit = config.map.size / 2 - (config.grenade?.boundaryMargin ?? 0.2);
  const result: GrenadePreview = { valid: true, reason: 'clear', distance, points: [], target };
  if (
    !Number.isFinite(target.x) ||
    !Number.isFinite(target.z) ||
    Math.abs(target.x) > limit ||
    Math.abs(target.z) > limit
  ) {
    result.valid = false;
    result.reason = 'outside';
    return result;
  }
  if (distance > (config.grenade?.maxRange ?? 32)) {
    result.valid = false;
    result.reason = 'range';
    return result;
  }
  const removed = new Set(destroyed),
    obstacles = config.map.obstacles.filter((o) => !removed.has(o.id));
  const n = config.map.size / 2 + 0.05;
  for (const [i, x, z, w, d] of [
    [0, -n, 0, 0.3, 44.4],
    [1, n, 0, 0.3, 44.4],
    [2, 0, -n, 44.4, 0.3],
    [3, 0, n, 44.4, 0.3],
  ])
    obstacles.push({
      id: `boundary-${i}`,
      kind: 'wall',
      x: x!,
      z: z!,
      w: w!,
      d: d!,
      h: 1.9,
      tone: 'gray',
    });
  const yaw = Math.atan2(target.x - pose.x, target.z - pose.z),
    dx = Math.sin(yaw),
    dz = Math.cos(yaw);
  const chest = { x: pose.x, y: pose.combat?.crouch ? 0.85 : 1.2, z: pose.z };
  const hand = { x: chest.x + dx * 0.55, y: chest.y, z: chest.z + dz * 0.55 };
  const obstruction = intersection(chest, hand, obstacles);
  const extension = obstruction === null ? 0.5 : Math.max(0.05, obstruction * 0.55 - 0.08);
  let point = { x: chest.x + dx * extension, y: chest.y, z: chest.z + dz * extension };
  const gravity = config.grenade?.gravity ?? 9.8,
    landing = config.grenade?.landingHeight ?? 0.09,
    hz = config.tickHz;
  const ticks = Math.max(
      24,
      Math.ceil(Math.min(2.2, 0.95 + Math.hypot(target.x - point.x, target.z - point.z) / 25) * hz),
    ),
    dt = 1 / hz,
    duration = ticks * dt;
  const vx = (target.x - point.x) / duration,
    vz = (target.z - point.z) / duration;
  let vy = (landing - point.y + (gravity * dt * dt * ticks * (ticks + 1)) / 2) / duration;
  result.points.push({ ...point });
  for (let i = 0; i < ticks; i++) {
    vy -= gravity * dt;
    const next = { x: point.x + vx * dt, y: point.y + vy * dt, z: point.z + vz * dt };
    const hit = intersection(point, next, obstacles, 0.08);
    if (hit !== null) {
      result.reason = 'blocked';
      result.points.push({
        x: point.x + (next.x - point.x) * hit,
        y: point.y + (next.y - point.y) * hit,
        z: point.z + (next.z - point.z) * hit,
      });
      break;
    }
    point = next;
    if (i % 2 === 0 || i === ticks - 1)
      result.points.push({ ...point, y: Math.max(landing, point.y) });
  }
  return result;
}

export class GrenadeAim {
  readonly group = new THREE.Group();
  private geometry = new THREE.BufferGeometry();
  private material = new THREE.LineBasicMaterial({
    color: '#d8c598',
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
  });
  private positions = new THREE.BufferAttribute(new Float32Array(96 * 3), 3);
  private line: THREE.Line;
  private ringGeometry = new THREE.RingGeometry(0.43, 0.49, 40);
  private ringMaterial = new THREE.MeshBasicMaterial({
    color: '#d8c598',
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  private marker = new THREE.Mesh(this.ringGeometry, this.ringMaterial);
  constructor(private config: GameConfig) {
    this.geometry.setAttribute('position', this.positions);
    this.line = new THREE.Line(this.geometry, this.material);
    this.line.frustumCulled = false;
    this.marker.rotation.x = -Math.PI / 2;
    this.group.add(this.line, this.marker);
    this.group.visible = false;
    this.group.name = 'grenade-target-preview';
  }
  update(
    pose: Transform | null,
    target: { x: number; z: number } | null,
    destroyed: string[],
    enabled: boolean,
  ): GrenadePreview | null {
    this.group.visible = !!(
      enabled &&
      pose?.combat &&
      pose.combat.health > 0 &&
      pose.combat.grenades > 0 &&
      target
    );
    if (!this.group.visible || !pose || !target) return null;
    const preview = grenadePreview(this.config, pose, target, destroyed);
    const color =
      preview.reason === 'clear' ? '#d8c598' : preview.reason === 'blocked' ? '#e5a17c' : '#ee7768';
    this.material.color.set(color);
    this.ringMaterial.color.set(color);
    this.marker.position.set(target.x, 0.025, target.z);
    preview.points.forEach((p, i) => this.positions.setXYZ(i, p.x, p.y, p.z));
    this.positions.needsUpdate = true;
    this.geometry.setDrawRange(0, preview.points.length);
    return preview;
  }
  dispose(): void {
    this.group.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
    this.ringGeometry.dispose();
    this.ringMaterial.dispose();
  }
}
