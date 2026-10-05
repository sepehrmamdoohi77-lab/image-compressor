import type { CombatEvent, Transform } from '../multiplayer/protocol';
import type { Settings } from '../services/Settings';

/** Procedural, real Web Audio with master/SFX/music buses and spatial attenuation. */
export class AudioSystem {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private music: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private drones: OscillatorNode[] = [];
  private footsteps = new Map<string, number>();
  private menuMode = true;
  constructor(private settings: () => Settings) {}
  activate() {
    const AudioCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;
    if (!this.context) {
      this.context = new AudioCtor();
      const c = this.context;
      this.master = c.createGain();
      this.sfx = c.createGain();
      this.music = c.createGain();
      this.master.connect(c.destination);
      this.sfx.connect(this.master);
      this.music.connect(this.master);
      this.noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.apply();
      this.setMenu(this.menuMode);
    }
    if (this.context.state === 'suspended') void this.context.resume().catch(() => {});
  }
  apply() {
    const s = this.settings();
    if (this.master) this.master.gain.value = s.masterVolume;
    if (this.sfx) this.sfx.gain.value = s.sfxVolume;
    if (this.music) this.music.gain.value = s.musicVolume * 0.045;
  }
  setMenu(enabled: boolean) {
    this.menuMode = enabled;
    for (const o of this.drones) {
      try {
        o.stop();
      } catch {
        /* Already stopped. */
      }
      o.disconnect();
    }
    this.drones = [];
    if (!enabled || !this.context || !this.music) return;
    for (const frequency of [55, 82.4, 110.15]) {
      const osc = this.context.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = frequency;
      osc.connect(this.music);
      osc.start();
      this.drones.push(osc);
    }
  }
  private tone(
    freq: number,
    duration: number,
    volume: number,
    type: OscillatorType = 'triangle',
    delay = 0,
  ) {
    const c = this.context;
    if (!c || !this.sfx || c.state !== 'running') return;
    const osc = c.createOscillator(),
      gain = c.createGain(),
      at = c.currentTime + delay;
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * 0.5), at + duration);
    gain.gain.setValueAtTime(Math.max(0.0001, volume), at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    osc.connect(gain);
    gain.connect(this.sfx);
    osc.start(at);
    osc.stop(at + duration + 0.01);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }
  private noiseSound(freq: number, duration: number, volume: number, pan = 0, low = false) {
    const c = this.context;
    if (!c || !this.sfx || !this.noise || c.state !== 'running') return;
    const source = c.createBufferSource(),
      filter = c.createBiquadFilter(),
      gain = c.createGain(),
      panner = c.createStereoPanner();
    source.buffer = this.noise;
    filter.type = low ? 'lowpass' : 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = 0.7;
    const now = c.currentTime;
    gain.gain.setValueAtTime(Math.max(0.0001, volume), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    source.connect(filter);
    filter.connect(gain);
    gain.connect(panner);
    panner.connect(this.sfx);
    source.start(now);
    source.stop(now + duration);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
      panner.disconnect();
    };
  }
  ui() {
    this.tone(700, 0.045, 0.018);
  }
  countdown() {
    this.tone(660, 0.09, 0.07);
  }
  event(message: CombatEvent, ownId: string, own: Transform | null, cameraYaw: number) {
    const e = message.event;
    const position =
      e.kind === 'shot'
        ? e.origin
        : e.kind === 'sound' || e.kind === 'explosion'
          ? e.position
          : null;
    const distance = position && own ? Math.hypot(position.x - own.x, position.z - own.z) : 0;
    const attenuation = 1 / (1 + distance / 8);
    const pan =
      position && own
        ? Math.sin(Math.atan2(position.x - own.x, position.z - own.z) - cameraYaw)
        : 0;
    if (e.kind === 'shot' || e.kind === 'sound') {
      const options = {
        rifle: [1700, 0.12, 0.32, 95],
        smg: [2400, 0.07, 0.24, 140],
        shotgun: [900, 0.25, 0.5, 55],
        dmr: [3400, 0.23, 0.48, 70],
        pistol: [2700, 0.11, 0.23, 180],
      }[e.weaponId]!;
      this.noiseSound(options[0]!, options[1]!, options[2]! * attenuation, pan);
      this.tone(options[3]!, options[1]!, options[2]! * attenuation * 0.25);
      if (e.kind === 'shot' && e.playerId === ownId && this.settings().haptics)
        navigator.vibrate?.(8);
    } else if (e.kind === 'explosion') {
      this.noiseSound(850, 0.65, 0.65 * attenuation, pan, true);
      this.tone(45, 0.45, 0.22 * attenuation);
    } else if (e.kind === 'reload') {
      this.noiseSound(3200, 0.1, 0.05 * attenuation);
      this.tone(210, 0.05, 0.018);
    } else if (e.kind === 'switch') {
      this.noiseSound(2100, 0.1, 0.045 * attenuation);
    } else if (e.kind === 'grenade_throw') {
      this.noiseSound(1500, 0.12, 0.05 * attenuation);
    } else if (e.kind === 'damage' && e.attackerId === ownId && e.damage > 0) {
      this.tone(e.headshot ? 1300 : 950, 0.07, 0.065);
    } else if (e.kind === 'damage' && e.victimId === ownId) {
      this.noiseSound(400, 0.15, 0.06, 0, true);
      if (this.settings().haptics) navigator.vibrate?.(18);
    } else if (e.kind === 'kill' && e.attackerId === ownId && !e.teamkill) {
      this.tone(880, 0.08, 0.075);
      this.tone(1100, 0.08, 0.055, 'sine', 0.08);
    } else if (e.kind === 'round_end') {
      for (const [i, note] of [220, 330, 440].entries())
        this.tone(note, 0.18, 0.045, 'sine', i * 0.14);
    }
  }
  tick(poses: Transform[], ownId: string, now: number, cameraYaw: number) {
    const own = poses.find((p) => p.id === ownId);
    if (!own) return;
    const ids = new Set(poses.map((p) => p.id));
    for (const id of this.footsteps.keys()) if (!ids.has(id)) this.footsteps.delete(id);
    for (const p of poses) {
      if (p.movement === 'idle' || (p.combat?.health ?? 100) <= 0) continue;
      const period = p.movement === 'sprint' ? 240 : p.movement === 'crouch' ? 620 : 390;
      if (now - (this.footsteps.get(p.id) ?? 0) < period) continue;
      this.footsteps.set(p.id, now);
      const distance = Math.hypot(p.x - own.x, p.z - own.z);
      if (distance > 20) continue;
      this.noiseSound(
        330,
        0.08,
        (p.id === ownId ? 0.025 : 0.04) / (1 + distance / 7),
        Math.sin(Math.atan2(p.x - own.x, p.z - own.z) - cameraYaw),
        true,
      );
    }
  }
  dispose() {
    this.setMenu(false);
    this.footsteps.clear();
    if (this.context) void this.context.close();
    this.context = null;
  }
}
