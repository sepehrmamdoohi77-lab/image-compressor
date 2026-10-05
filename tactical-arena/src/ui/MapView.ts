import type { GameConfig, Transform, RadarContact } from '../multiplayer/protocol';

export function mapMarkup(config: GameConfig, className = ''): string {
  const shapes = config.map.obstacles
    .map(
      (o) =>
        `<rect x="${o.x - o.w / 2}" y="${o.z - o.d / 2}" width="${o.w}" height="${o.d}" class="map-obstacle ${o.kind}"/>`,
    )
    .join('');
  return `<svg class="map-view ${className}" viewBox="-24 -24 48 48" role="img" aria-label="${config.map.name} layout: Blue and Red staging, physical cover and routes">
    <rect class="map-ground" x="-22" y="-22" width="44" height="44"/>
    <path class="map-route" d="M-13 -19v38M0 -19v38M13 -19v38"/>
    ${shapes}<path class="map-spawn blue" d="M-5 18H5"/><path class="map-spawn red" d="M-5 -18H5"/>
    <text x="0" y="20.8" class="map-team-label blue">B</text><text x="0" y="-19.6" class="map-team-label red">R</text>
  </svg>`;
}
export class MiniMap {
  private context: CanvasRenderingContext2D;
  constructor(
    private canvas: HTMLCanvasElement,
    private config: GameConfig,
  ) {
    this.context = canvas.getContext('2d')!;
  }
  draw(
    poses: Transform[],
    ownId: string,
    teams: Map<string, string>,
    contacts: RadarContact[] = [],
    now = 0,
    destroyed: string[] = [],
    combat = this.config.combatEnabled,
  ): void {
    const ctx = this.context,
      size = this.canvas.width;
    const scale = size / 48,
      coord = (v: number) => (v + 24) * scale;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#18201ddd';
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = '#6d786966';
    ctx.lineWidth = 1;
    ctx.strokeRect(coord(-22), coord(-22), 44 * scale, 44 * scale);
    ctx.fillStyle = '#82908377';
    const removed = new Set(destroyed);
    for (const o of this.config.map.obstacles)
      if (!removed.has(o.id))
        ctx.fillRect(coord(o.x - o.w / 2), coord(o.z - o.d / 2), o.w * scale, o.d * scale);
    const ownTeam = teams.get(ownId);
    const mark = (
      x: number,
      z: number,
      yaw: number,
      color: string,
      hostile: boolean,
      local: boolean,
      alpha = 1,
    ) => {
      const px = coord(x),
        py = coord(z),
        r = local ? 4.8 : hostile ? 4.5 : 3.8;
      ctx.globalAlpha = alpha;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(-yaw);
      ctx.fillStyle = color;
      ctx.strokeStyle = '#111a16';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      if (local || hostile) {
        ctx.moveTo(0, r + 1);
        ctx.lineTo(r, -r);
        ctx.lineTo(-r, -r);
        ctx.closePath();
      } else ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = 1;
    };
    for (const p of poses) {
      const local = p.id === ownId,
        hostile = teams.get(p.id) !== ownTeam;
      if (!hostile || !combat)
        mark(
          p.x,
          p.z,
          p.yaw,
          local ? '#ffe2a3' : hostile ? '#ef836c' : '#86bcf0',
          hostile,
          local,
          (p.combat?.health ?? 100) > 0 ? 1 : 0.3,
        );
    }
    for (const c of contacts) {
      const age = Math.max(0, (now - c.seenAtMs) / 5000);
      mark(
        c.x,
        c.z,
        c.yaw,
        c.state === 'visible' ? '#ef836c' : '#efa782',
        true,
        false,
        c.state === 'last' ? Math.max(0.18, 1 - age) * 0.55 : 0.8,
      );
      if (c.state === 'last') {
        ctx.font = '8px monospace';
        ctx.fillStyle = '#e0af8d';
        ctx.fillText('?', coord(c.x) + 4, coord(c.z) - 4);
      }
    }
    ctx.font = 'bold 9px monospace';
    ctx.fillStyle = '#a7bed2';
    ctx.fillText('N', size / 2 - 3, 10);
  }
}
