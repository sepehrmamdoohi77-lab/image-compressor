import type { Snapshot, Transform } from './protocol';

export function lerpYaw(a: number, b: number, t: number): number {
  const delta = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + delta * t;
}

/** 100 ms presentation buffer. Never extrapolates a remote actor indefinitely. */
export class InterpolationBuffer {
  private frames: Snapshot[] = [];
  push(snapshot: Snapshot): void {
    const last = this.frames.at(-1);
    if (last && snapshot.roomId === last.roomId && snapshot.seq <= last.seq) return;
    if (last && snapshot.roomId !== last.roomId) this.frames = [];
    this.frames.push(snapshot);
    if (this.frames.length > 16) this.frames.shift();
  }
  sample(serverNow: number): Transform[] {
    const target = serverNow - 100;
    const first = this.frames[0];
    if (!first) return [];
    let previous = first;
    for (const next of this.frames) {
      if (next.serverTimeMs >= target) {
        const t = Math.max(
          0,
          Math.min(
            1,
            (target - previous.serverTimeMs) /
              Math.max(1, next.serverTimeMs - previous.serverTimeMs),
          ),
        );
        return next.players.map((b) => {
          const a = previous.players.find((p) => p.id === b.id) ?? b;
          return {
            ...b,
            x: a.x + (b.x - a.x) * t,
            z: a.z + (b.z - a.z) * t,
            yaw: lerpYaw(a.yaw, b.yaw, t),
            vx: a.vx + (b.vx - a.vx) * t,
            vz: a.vz + (b.vz - a.vz) * t,
          };
        });
      }
      previous = next;
    }
    return previous.players.map((p) => ({ ...p }));
  }
  reset(): void {
    this.frames = [];
  }
}
