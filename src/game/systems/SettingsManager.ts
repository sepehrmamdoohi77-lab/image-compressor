// localStorage settings with corruption-safe validation.
import { CAMERA_CONFIG, SETTINGS_DEFAULTS, type SettingsData } from '../data/config';
import { clamp } from '../utils/math';

const STORAGE_KEY = 'breachline.settings.v1';

function num(v: unknown, fallback: number, min: number, max: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? clamp(v, min, max) : fallback;
}

/** Pure validator: any input -> guaranteed-valid settings. Unit-tested. */
export function validateSettings(raw: unknown): SettingsData {
  const d = SETTINGS_DEFAULTS;
  if (typeof raw !== 'object' || raw === null) return { ...d };
  const r = raw as Record<string, unknown>;
  const quality = r.quality === 'low' || r.quality === 'medium' || r.quality === 'high' ? r.quality : d.quality;
  return {
    master: num(r.master, d.master, 0, 1),
    sfx: num(r.sfx, d.sfx, 0, 1),
    music: num(r.music, d.music, 0, 1),
    ui: num(r.ui, d.ui, 0, 1),
    sensitivity: num(r.sensitivity, d.sensitivity, 0.2, 3),
    quality,
    cameraDistance: num(r.cameraDistance, d.cameraDistance, CAMERA_CONFIG.minDistance, CAMERA_CONFIG.maxDistance),
    invertY: typeof r.invertY === 'boolean' ? r.invertY : d.invertY,
  };
}

export class SettingsManager {
  data: SettingsData = { ...SETTINGS_DEFAULTS };

  load(): SettingsData {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        this.data = { ...SETTINGS_DEFAULTS };
        return this.data;
      }
      this.data = validateSettings(JSON.parse(raw) as unknown);
    } catch (err) {
      console.warn('[Settings] corrupted storage, recovering defaults:', err);
      this.data = { ...SETTINGS_DEFAULTS };
      this.save();
    }
    return this.data;
  }

  save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch (err) {
      console.warn('[Settings] save failed:', err);
    }
  }

  update(patch: Partial<SettingsData>): SettingsData {
    this.data = validateSettings({ ...this.data, ...patch });
    this.save();
    return this.data;
  }

  reset(): SettingsData {
    this.data = { ...SETTINGS_DEFAULTS };
    this.save();
    return this.data;
  }
}
