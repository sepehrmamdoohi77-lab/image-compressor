// Tactical grid A* navigation. Operates on plain grids (no three.js dependency)
// so it is unit-testable and portable (UE5 migration: same data layout).

export interface CellPos {
  cx: number;
  cz: number;
}

export interface PathOptions {
  maxIterations?: number;
  allowDiagonal?: boolean;
  /** Extra cost multiplier for cells adjacent to blocked cells (wall buffer). */
  wallBufferCost?: number;
}

function idx(cx: number, cz: number, size: number): number {
  return cz * size + cx;
}

function inBounds(cx: number, cz: number, size: number): boolean {
  return cx >= 0 && cz >= 0 && cx < size && cz < size;
}

export function isWalkableGrid(grid: Uint8Array, size: number, cx: number, cz: number): boolean {
  if (!inBounds(cx, cz, size)) return false;
  return grid[idx(cx, cz, size)] === 0;
}

function octile(ax: number, az: number, bx: number, bz: number): number {
  const dx = Math.abs(ax - bx);
  const dz = Math.abs(az - bz);
  return Math.max(dx, dz) + 0.41421356 * Math.min(dx, dz);
}

/**
 * A* path over a walkability grid (0 = open, anything else = blocked).
 * Returns cell-center path including start and goal, or null if unreachable.
 */
export function findPath(
  grid: Uint8Array,
  size: number,
  start: CellPos,
  goal: CellPos,
  opts: PathOptions = {},
): CellPos[] | null {
  const maxIterations = opts.maxIterations ?? 3000;
  const allowDiagonal = opts.allowDiagonal ?? true;
  const wallBufferCost = opts.wallBufferCost ?? 0.35;

  if (!inBounds(start.cx, start.cz, size) || !inBounds(goal.cx, goal.cz, size)) return null;
  const sIdx = idx(start.cx, start.cz, size);
  const gIdx = idx(goal.cx, goal.cz, size);
  if (grid[sIdx] !== 0 || grid[gIdx] !== 0) {
    // Allow start==goal on blocked (already there) but not pathing into walls.
    if (!(start.cx === goal.cx && start.cz === goal.cz)) {
      // Try to snap goal to nearest open cell.
      const snapped = nearestOpenCell(grid, size, goal.cx, goal.cz, 4);
      if (!snapped) return null;
      goal = snapped;
    }
  }
  if (start.cx === goal.cx && start.cz === goal.cz) return [{ ...start }];

  const gScore = new Float32Array(size * size).fill(Infinity);
  const cameFrom = new Int32Array(size * size).fill(-1);
  const closed = new Uint8Array(size * size);
  gScore[idx(start.cx, start.cz, size)] = 0;

  // Binary-heap open list keyed by f-score.
  const heap: number[] = [];
  const heapF = new Map<number, number>();
  const push = (cell: number, f: number): void => {
    heapF.set(cell, f);
    heap.push(cell);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((heapF.get(heap[p]) ?? Infinity) <= (heapF.get(heap[i]) ?? Infinity)) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = (): number | undefined => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length > 0 && last !== undefined) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = i * 2 + 2;
        let smallest = i;
        if (l < heap.length && (heapF.get(heap[l]) ?? Infinity) < (heapF.get(heap[smallest]) ?? Infinity)) smallest = l;
        if (r < heap.length && (heapF.get(heap[r]) ?? Infinity) < (heapF.get(heap[smallest]) ?? Infinity)) smallest = r;
        if (smallest === i) break;
        [heap[i], heap[smallest]] = [heap[smallest], heap[i]];
        i = smallest;
      }
    }
    if (top !== undefined) heapF.delete(top);
    return top;
  };

  const DIRS = allowDiagonal
    ? [
        [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
        [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142],
      ]
    : [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1]];

  const target = idx(goal.cx, goal.cz, size);
  push(idx(start.cx, start.cz, size), octile(start.cx, start.cz, goal.cx, goal.cz));
  let iterations = 0;

  while (heap.length > 0) {
    if (++iterations > maxIterations) return null;
    const current = pop();
    if (current === undefined) return null;
    if (current === target) {
      // Reconstruct.
      const path: CellPos[] = [];
      let c: number = current;
      while (c !== -1) {
        path.push({ cx: c % size, cz: Math.floor(c / size) });
        c = cameFrom[c];
      }
      path.reverse();
      return path;
    }
    if (closed[current]) continue;
    closed[current] = 1;
    const ccx = current % size;
    const ccz = Math.floor(current / size);

    for (const [dx, dz, cost] of DIRS) {
      const nx = ccx + dx;
      const nz = ccz + dz;
      if (!inBounds(nx, nz, size)) continue;
      const nIdx = idx(nx, nz, size);
      if (grid[nIdx] !== 0 || closed[nIdx]) continue;
      // Prevent diagonal corner cutting through walls.
      if (dx !== 0 && dz !== 0) {
        if (grid[idx(ccx + dx, ccz, size)] !== 0 || grid[idx(ccx, ccz + dz, size)] !== 0) continue;
      }
      let stepCost = cost;
      // Prefer paths that keep a little distance from walls.
      if (wallBufferCost > 0 && isAdjacentToBlocked(grid, size, nx, nz)) stepCost += wallBufferCost;
      const tentative = gScore[current] + stepCost;
      if (tentative < gScore[nIdx]) {
        cameFrom[nIdx] = current;
        gScore[nIdx] = tentative;
        push(nIdx, tentative + octile(nx, nz, goal.cx, goal.cz));
      }
    }
  }
  return null;
}

function isAdjacentToBlocked(grid: Uint8Array, size: number, cx: number, cz: number): boolean {
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dz === 0) continue;
      const nx = cx + dx;
      const nz = cz + dz;
      if (!inBounds(nx, nz, size) || grid[idx(nx, nz, size)] !== 0) return true;
    }
  }
  return false;
}

/** Grid line-of-sight (supercover DDA). Treats any non-zero cell as blocking. */
export function gridLosClear(grid: Uint8Array, size: number, ax: number, az: number, bx: number, bz: number): boolean {
  const dx = bx - ax;
  const dz = bz - az;
  const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) * 2) || 1;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const cx = Math.floor(ax + dx * t);
    const cz = Math.floor(az + dz * t);
    if (!inBounds(cx, cz, size)) return false;
    // Skip endpoints (actor cells may be marked occupied, not blocked — but be lenient).
    if (i === 0 || i === steps) continue;
    if (grid[idx(cx, cz, size)] !== 0) return false;
  }
  return true;
}

/** Remove redundant waypoints while preserving grid LOS. */
export function smoothPath(grid: Uint8Array, size: number, path: CellPos[]): CellPos[] {
  if (path.length <= 2) return path.slice();
  const out: CellPos[] = [path[0]];
  let anchor = 0;
  for (let i = 2; i < path.length; i++) {
    const a = path[anchor];
    const b = path[i];
    if (!gridLosClear(grid, size, a.cx, a.cz, b.cx, b.cz)) {
      out.push(path[i - 1]);
      anchor = i - 1;
    }
  }
  out.push(path[path.length - 1]);
  return out;
}

export function nearestOpenCell(
  grid: Uint8Array,
  size: number,
  cx: number,
  cz: number,
  maxRadius: number,
): CellPos | null {
  if (isWalkableGrid(grid, size, cx, cz)) return { cx, cz };
  for (let r = 1; r <= maxRadius; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        if (isWalkableGrid(grid, size, cx + dx, cz + dz)) return { cx: cx + dx, cz: cz + dz };
      }
    }
  }
  return null;
}

/** Flood fill count of reachable open cells from a start cell (connectivity QA). */
export function floodFillReachable(grid: Uint8Array, size: number, start: CellPos): Set<number> {
  const reached = new Set<number>();
  if (!isWalkableGrid(grid, size, start.cx, start.cz)) return reached;
  const stack: number[] = [idx(start.cx, start.cz, size)];
  reached.add(stack[0]);
  while (stack.length > 0) {
    const c = stack.pop() as number;
    const ccx = c % size;
    const ccz = Math.floor(c / size);
    const neighbors = [
      [1, 0], [-1, 0], [0, 1], [0, -1],
    ];
    for (const [dx, dz] of neighbors) {
      const nx = ccx + dx;
      const nz = ccz + dz;
      if (!isWalkableGrid(grid, size, nx, nz)) continue;
      const n = idx(nx, nz, size);
      if (!reached.has(n)) {
        reached.add(n);
        stack.push(n);
      }
    }
  }
  return reached;
}
