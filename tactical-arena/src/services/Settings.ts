import { z } from 'zod';
const schema = z.object({
  version: z.literal(2),
  quality: z.enum(['low', 'balanced', 'high']),
  zoom: z.number().min(11).max(22),
  rotationSpeed: z.number().min(0.4).max(2),
  touchScale: z.number().min(0.85).max(1.3),
  gamepadDeadzone: z.number().min(0.1).max(0.3),
  fpsTarget: z.union([z.literal(30), z.literal(60)]),
  masterVolume: z.number().min(0).max(1),
  sfxVolume: z.number().min(0).max(1),
  musicVolume: z.number().min(0).max(1),
  cameraShake: z.boolean(),
  hitMarkers: z.boolean(),
  damageIndicators: z.boolean(),
  haptics: z.boolean(),
  touchAutoFire: z.boolean(),
  crosshair: z.enum(['classic', 'dot']),
  aimSensitivity: z.number().min(0.4).max(2),
});
export type Settings = z.infer<typeof schema>;
export const defaults: Settings = {
  version: 2,
  quality: 'balanced',
  zoom: 16,
  rotationSpeed: 1,
  touchScale: 1,
  gamepadDeadzone: 0.18,
  fpsTarget: 60,
  masterVolume: 0.8,
  sfxVolume: 0.8,
  musicVolume: 0.2,
  cameraShake: true,
  hitMarkers: true,
  damageIndicators: true,
  haptics: false,
  touchAutoFire: true,
  crosshair: 'classic',
  aimSensitivity: 1,
};
const KEY = 'tactical-arena.settings.v1';
export class SettingsStore {
  value: Settings = { ...defaults };
  constructor() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
      if (raw && typeof raw === 'object') {
        const parsed = schema.safeParse({ ...defaults, ...raw, version: 2 });
        if (parsed.success) this.value = parsed.data;
      }
    } catch {
      /* Safe defaults, no fake persistence. */
    }
  }
  save(next: Partial<Settings>): boolean {
    const parsed = schema.safeParse({ ...this.value, ...next, version: 2 });
    if (!parsed.success) return false;
    this.value = parsed.data;
    try {
      localStorage.setItem(KEY, JSON.stringify(this.value));
      return true;
    } catch {
      return false;
    }
  }
}
