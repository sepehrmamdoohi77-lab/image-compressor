// Small math helpers shared by gameplay code. No allocations in hot paths
// where it matters (scalar functions only).

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Frame-rate independent exponential damping factor. */
export function dampFactor(smoothing: number, dt: number): number {
  return 1 - Math.exp(-smoothing * dt);
}

export function angleLerp(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Returns v if finite, otherwise fallback. Guards against NaN propagation. */
export function finiteOr(v: number, fallback: number): number {
  return Number.isFinite(v) ? v : fallback;
}
