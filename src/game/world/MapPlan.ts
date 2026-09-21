// Baked top-down plan of the level for the HUD radar. Kept game-side (and
// DOM-safe) so the level geometry never leaks into the UI layer.
export const MAP_CELLS = 44;

/**
 * Bake the level grid into an offscreen canvas: one cell per world unit. This
 * is drawn once and then rotated/translated by the radar each frame.
 * Returns null when no 2D canvas exists (headless tests).
 */
export function bakeLevelLayer(
  isWalkable: (cx: number, cz: number) => boolean,
  cellSize = 7,
): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const px = MAP_CELLS * cellSize;
  const c = document.createElement('canvas');
  c.width = px;
  c.height = px;
  const g = c.getContext('2d');
  if (!g) return null;
  // Ground.
  g.fillStyle = 'rgba(12, 20, 22, 0.72)';
  g.fillRect(0, 0, px, px);
  // Open floor micro-grid so the map reads as a plan, not a blank tile.
  g.strokeStyle = 'rgba(120, 180, 170, 0.06)';
  g.lineWidth = 1;
  for (let i = 1; i < MAP_CELLS; i++) {
    g.beginPath();
    g.moveTo(i * cellSize, 0);
    g.lineTo(i * cellSize, px);
    g.stroke();
    g.beginPath();
    g.moveTo(0, i * cellSize);
    g.lineTo(px, i * cellSize);
    g.stroke();
  }
  // Blocks: solid cells plus a highlight edge so buildings read at a glance.
  g.fillStyle = 'rgba(146, 173, 168, 0.34)';
  g.strokeStyle = 'rgba(196, 226, 219, 0.22)';
  g.lineWidth = 1;
  for (let cz = 0; cz < MAP_CELLS; cz++) {
    for (let cx = 0; cx < MAP_CELLS; cx++) {
      if (isWalkable(cx, cz)) continue;
      g.fillRect(cx * cellSize, cz * cellSize, cellSize, cellSize);
      g.strokeRect(cx * cellSize + 0.5, cz * cellSize + 0.5, cellSize - 1, cellSize - 1);
    }
  }
  return c;
}
