// Radar minimap (top-right). Renders on a 2D canvas each frame from the HUD
// snapshot: level geometry as a baked background layer, then ping rings, health
// kits, and — only while the danger line is active — hostile blips with a
// bearing wedge. No three.js here: cheap, crisp, and independent of the 3D pass.
import { RADAR, THREATS } from '../game/data/config';
import { MAP_CELLS } from '../game/world/MapPlan';

export interface RadarBlip {
  x: number;
  z: number;
  /** 0..1 threat weight (drives opacity/size). */
  weight: number;
}

export interface RadarPickup {
  x: number;
  z: number;
}

export interface RadarInput {
  playerX: number;
  playerZ: number;
  /** Player facing in world radians (0 = +Z). */
  yaw: number;
  /** 0..1 danger-line level. Blips only render above zero. */
  threatLevel: number;
  /** Camera-screen bearing of the nearest threat, degrees (0 = up). */
  threatAngleDeg: number;
  blips: RadarBlip[];
  pickups: RadarPickup[];
  enemiesAlive: number;
}

/**
 * World -> radar canvas projection (pure). Canvas is y-down; the player sits at
 * the centre and "up" is the player's facing. Exported for tests.
 */
export function radarProject(
  wx: number, wz: number,
  px: number, pz: number,
  yaw: number,
  size: number,
  spanMeters: number,
): [number, number] {
  const dx = wx - px;
  const dz = wz - pz;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const scale = size / spanMeters;
  const half = size / 2;
  const right = dx * cos - dz * sin;
  const fwd = dx * sin + dz * cos;
  return [half + right * scale, half - fwd * scale];
}

/** True when a DOM is available (radar is skipped in headless tests). */
export function canBake(): boolean {
  return typeof document !== 'undefined';
}

export class Radar {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private levelLayer: HTMLCanvasElement | null = null;
  private size: number;

  constructor(canvas: HTMLCanvasElement | null, size = 158) {
    this.size = size;
    this.canvas = canvas ?? document.createElement('canvas');
    this.canvas.width = size;
    this.canvas.height = size;
    this.ctx = this.canvas.getContext('2d');
  }

  setLevelLayer(layer: HTMLCanvasElement | null): void {
    this.levelLayer = layer;
  }

  private project(wx: number, wz: number, px: number, pz: number, yaw: number): [number, number] {
    return radarProject(wx, wz, px, pz, yaw, this.size, RADAR.spanMeters);
  }

  render(input: RadarInput): void {
    const g = this.ctx;
    if (!g) return;
    const s = this.size;
    const half = s / 2;
    const scale = s / RADAR.spanMeters;
    const yaw = input.yaw;

    g.clearRect(0, 0, s, s);
    // Clip to a circle.
    g.save();
    g.beginPath();
    g.arc(half, half, half - 1, 0, Math.PI * 2);
    g.clip();

    // Baker background: dark ground.
    g.fillStyle = 'rgba(10, 16, 18, 0.86)';
    g.fillRect(0, 0, s, s);

    // Level layer, drawn rotated about the player. Draw the whole baked map by
    // translating its centre to the player's projected position.
    if (this.levelLayer) {
      // Draw the baked plan rotated about the player: one baked cell = 1 world unit.
      g.save();
      g.translate(half, half);
      g.scale(scale, scale);
      g.rotate(yaw);
      g.translate(-input.playerX, -input.playerZ);
      g.globalAlpha = 0.92;
      g.drawImage(this.levelLayer, -MAP_CELLS / 2, -MAP_CELLS / 2, MAP_CELLS, MAP_CELLS);
      g.restore();
    }

    // Range rings.
    g.strokeStyle = 'rgba(120, 220, 200, 0.14)';
    g.lineWidth = 1;
    for (const r of [RADAR.blipRange * 0.5, RADAR.blipRange]) {
      g.beginPath();
      g.arc(half, half, r * scale, 0, Math.PI * 2);
      g.stroke();
    }
    // Cardinal ticks (rotated with the player).
    g.strokeStyle = 'rgba(150, 230, 210, 0.3)';
    for (let i = 0; i < 4; i++) {
      const a = yaw + (i * Math.PI) / 2;
      g.beginPath();
      g.moveTo(half + Math.sin(a) * (half - 8), half - Math.cos(a) * (half - 8));
      g.lineTo(half + Math.sin(a) * (half - 2), half - Math.cos(a) * (half - 2));
      g.stroke();
    }

    // Health kits.
    if (RADAR.showPickups) {
      g.fillStyle = 'rgba(99, 214, 122, 0.95)';
      for (const p of input.pickups) {
        const [x, y] = radarProject(p.x, p.z, input.playerX, input.playerZ, yaw, s, RADAR.spanMeters);
        if (Math.hypot(x - half, y - half) > half - 4) continue;
        g.fillRect(x - 2.5, y - 1, 5, 2);
        g.fillRect(x - 1, y - 2.5, 2, 5);
      }
    }

    // Hostile blips — only while the danger line is up.
    if (input.threatLevel > 0.001) {
      for (const b of input.blips) {
        const d = Math.hypot(b.x - input.playerX, b.z - input.playerZ);
        if (d > RADAR.blipRange) continue;
        const [x, y] = radarProject(b.x, b.z, input.playerX, input.playerZ, yaw, s, RADAR.spanMeters);
        const fade = 1 - d / RADAR.blipRange;
        const alpha = (0.35 + 0.65 * fade) * Math.min(1, 0.4 + input.threatLevel);
        g.fillStyle = `rgba(255, 84, 70, ${alpha.toFixed(3)})`;
        g.beginPath();
        g.arc(x, y, 3.2 + fade * 1.2, 0, Math.PI * 2);
        g.fill();
        // Ping halo.
        const ping = (performance.now() / 900) % 1;
        g.strokeStyle = `rgba(255, 120, 100, ${(1 - ping) * alpha * 0.7})`;
        g.lineWidth = 1.4;
        g.beginPath();
        g.arc(x, y, 3.5 + ping * 8, 0, Math.PI * 2);
        g.stroke();
      }
      // Bearing wedge for the nearest threat (matches the red danger angle).
      const a = (input.threatAngleDeg * Math.PI) / 180;
      g.save();
      g.translate(half, half);
      g.rotate(a);
      const grad = g.createLinearGradient(0, 0, 0, -half);
      grad.addColorStop(0, 'rgba(255, 80, 64, 0)');
      grad.addColorStop(1, `rgba(255, 80, 64, ${(0.16 + 0.34 * input.threatLevel).toFixed(3)})`);
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(-half * 0.5, -half);
      g.lineTo(half * 0.5, -half);
      g.closePath();
      g.fill();
      g.restore();
    }

    // Player arrow (always centered, pointing up).
    g.fillStyle = 'rgba(210, 245, 235, 0.95)';
    g.beginPath();
    g.moveTo(half, half - 7);
    g.lineTo(half - 5, half + 5);
    g.lineTo(half, half + 2.5);
    g.lineTo(half + 5, half + 5);
    g.closePath();
    g.fill();

    g.restore();

    // Frame.
    g.strokeStyle = 'rgba(150, 230, 210, 0.35)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(half, half, half - 1.5, 0, Math.PI * 2);
    g.stroke();
  }

  /** Radar face radius used by the HUD to place it. */
  static spanLabel(): string {
    return `±${Math.round(RADAR.spanMeters / 2)}m`;
  }

  static nearLabel(): string {
    return `DANGER ${Math.round(THREATS.hudCloseRadius)}–${Math.round(THREATS.hudFarRadius)}m`;
  }
}
