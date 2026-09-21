// Shared squad knowledge: approximate, timestamped, decaying.
// Enemies share *approximate* positions — never perfect vision.
import * as THREE from 'three';
import { AI } from '../data/config';

export interface NoiseEvent {
  x: number;
  z: number;
  radius: number;
  at: number;
  kind: 'shot' | 'explosion' | 'footstep';
}

export class SquadAwareness {
  sharedPos = new THREE.Vector3();
  sharedAt = -Infinity;
  sharedConf = 0;
  private noises: NoiseEvent[] = [];

  /** An enemy that sees the player shares approximate info with the squad. */
  report(x: number, z: number, confidence: number, now: number): void {
    const noise = AI.squadShareNoise;
    const nx = x + (Math.random() - 0.5) * 2 * noise;
    const nz = z + (Math.random() - 0.5) * 2 * noise;
    // Only overwrite with fresher / more confident info.
    const current = this.confidence(now);
    const incoming = confidence * AI.squadConfFactor;
    if (incoming > current || now - this.sharedAt > 1.0) {
      this.sharedPos.set(nx, 0, nz);
      this.sharedAt = now;
      this.sharedConf = Math.min(1, incoming);
    }
  }

  confidence(now: number): number {
    const age = now - this.sharedAt;
    if (age < 0) return 0;
    return Math.max(0, this.sharedConf * (1 - age / AI.memoryDuration));
  }

  addNoise(n: NoiseEvent): void {
    this.noises.push(n);
    if (this.noises.length > 24) this.noises.shift();
  }

  /** Noises since timestamp within radius of a listener. */
  noisesSince(since: number, x: number, z: number, hearingRadius: number): NoiseEvent[] {
    const out: NoiseEvent[] = [];
    for (const n of this.noises) {
      if (n.at <= since) continue;
      const dx = n.x - x;
      const dz = n.z - z;
      const r = Math.min(n.radius, hearingRadius);
      if (dx * dx + dz * dz <= r * r) out.push(n);
    }
    return out;
  }

  prune(now: number): void {
    while (this.noises.length > 0 && now - this.noises[0].at > 6) this.noises.shift();
  }

  reset(): void {
    this.sharedAt = -Infinity;
    this.sharedConf = 0;
    this.noises.length = 0;
  }
}
