// Web Audio synthesized SFX: no external assets, positional volume/pan,
// separate Master/SFX/Music/UI buses. Created lazily on user gesture.
import { AUDIO_DEFAULTS, type WeaponId, type WeaponSound } from '../data/config';
import { clamp } from '../utils/math';

export interface VolumeSettings {
  master: number;
  sfx: number;
  music: number;
  ui: number;
}

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private uiBus: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private ambientNodes: AudioNode[] = [];
  private volumes: VolumeSettings = { ...AUDIO_DEFAULTS };
  private lastFootstep = 0;

  /** Must be called from a user gesture. Safe to call repeatedly. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.sfxBus = this.ctx.createGain();
      this.musicBus = this.ctx.createGain();
      this.uiBus = this.ctx.createGain();
      this.sfxBus.connect(this.master);
      this.musicBus.connect(this.master);
      this.uiBus.connect(this.master);
      this.master.connect(this.ctx.destination);
      this.applyVolumes();
      // Shared 2s noise buffer.
      const len = this.ctx.sampleRate * 2;
      this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch (err) {
      console.error('[Audio] failed to initialize:', err);
      this.ctx = null;
    }
  }

  get ready(): boolean {
    return this.ctx !== null;
  }

  setVolumes(v: VolumeSettings): void {
    this.volumes = { ...v };
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx || !this.master || !this.sfxBus || !this.musicBus || !this.uiBus) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(clamp(this.volumes.master, 0, 1), t, 0.02);
    this.sfxBus.gain.setTargetAtTime(clamp(this.volumes.sfx, 0, 1), t, 0.02);
    this.musicBus.gain.setTargetAtTime(clamp(this.volumes.music, 0, 1), t, 0.02);
    this.uiBus.gain.setTargetAtTime(clamp(this.volumes.ui, 0, 1), t, 0.02);
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  // --- primitives ---------------------------------------------------------------
  private noise(
    bus: GainNode | null, duration: number, filterFreq: number,
    type: BiquadFilterType, volume: number, pan = 0, when = 0,
  ): void {
    if (!this.ctx || !bus || !this.noiseBuffer || volume <= 0.001) return;
    const t = this.ctx.currentTime + when;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    filter.Q.value = 0.8;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    const panner = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    if (panner) {
      panner.pan.value = clamp(pan, -1, 1);
      src.connect(filter).connect(gain).connect(panner).connect(bus);
    } else {
      src.connect(filter).connect(gain).connect(bus);
    }
    src.start(t, Math.random() * 1.5);
    src.stop(t + duration + 0.05);
  }

  private tone(
    bus: GainNode | null, freq: number, freqEnd: number, duration: number,
    type: OscillatorType, volume: number, pan = 0, when = 0,
  ): void {
    if (!this.ctx || !bus || volume <= 0.001) return;
    const t = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (freqEnd !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t + duration);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    const panner = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    if (panner) {
      panner.pan.value = clamp(pan, -1, 1);
      osc.connect(gain).connect(panner).connect(bus);
    } else {
      osc.connect(gain).connect(bus);
    }
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  // --- game sounds ---------------------------------------------------------------
  /**
   * Layered gunshot from a weapon's own acoustic profile: supersonic crack +
   * low body thump + gas noise + mechanical action + compound echo tail.
   * distance01: 0 = at player, 1 = max audible.
   */
  playShot(sound: WeaponSound, distance01: number, pan = 0): void {
    const atten = 1 - clamp(distance01, 0, 1) * 0.85;
    const v = (sound.big ? 0.85 : 0.55) * atten;
    // 1. Crack — the directional snap that identifies the weapon.
    this.tone(this.sfxBus, sound.crackFreq * 2.3, sound.crackFreq * 0.72, sound.duration * 0.6, 'square', v * 0.34, pan);
    // 2. Body — chest thump (pitch is the weapon's "weight").
    this.tone(this.sfxBus, sound.bodyFreq, sound.bodyFreq * 0.55, sound.duration, 'sine', v * 0.6, pan);
    // 3. Gas / muzzle blast noise.
    this.noise(this.sfxBus, sound.duration + 0.04, sound.noiseFreq, sound.noiseType, v * 0.85, pan);
    if (sound.big) this.tone(this.sfxBus, sound.bodyFreq * 0.72, 26, sound.duration * 1.1, 'sine', v * 0.8, pan);
    // 4. Action rattle (bolt / shell / charging handle).
    if (sound.mech > 0.05) {
      this.noise(this.sfxBus, 0.06, 2800, 'highpass', v * 0.2 * sound.mech, pan, sound.duration * 0.45);
    }
    // 5. Echo off the compound walls (only audible up close).
    if (sound.tail > 0.05 && distance01 < 0.9) {
      this.noise(this.sfxBus, sound.tail, Math.max(320, sound.noiseFreq * 0.45), 'lowpass', v * 0.28, pan, sound.duration * 0.7);
    }
  }

  /** Weapon-specific reload foley: magazine-fed vs pump vs bolt. */
  playReload(weaponId: WeaponId): void {
    switch (weaponId) {
      case 'shotgun':
        this.noise(this.sfxBus, 0.12, 1800, 'bandpass', 0.4); // pump back
        this.noise(this.sfxBus, 0.14, 1100, 'bandpass', 0.44, 0, 0.22); // pump forward
        this.tone(this.sfxBus, 210, 150, 0.09, 'square', 0.2, 0, 0.36);
        this.noise(this.sfxBus, 0.1, 2400, 'bandpass', 0.28, 0, 0.52); // shell seats
        break;
      case 'dmr':
        this.tone(this.sfxBus, 300, 190, 0.1, 'square', 0.22); // bolt up
        this.noise(this.sfxBus, 0.09, 2300, 'bandpass', 0.32, 0, 0.2);
        this.noise(this.sfxBus, 0.08, 2700, 'bandpass', 0.34, 0, 0.42); // bolt home
        break;
      default:
        this.noise(this.sfxBus, 0.06, 2600, 'bandpass', 0.3); // mag release
        this.noise(this.sfxBus, 0.08, 1400, 'bandpass', 0.38, 0, 0.22); // mag seats
        this.tone(this.sfxBus, 340, 190, 0.08, 'square', 0.2, 0, 0.4); // charging handle
        break;
    }
  }

  /** Bullet whiz-by: the round cracked past the player's head. */
  playNearMiss(pan: number, closeness: number, distance01 = 0): void {
    const v = 0.42 * clamp(closeness, 0, 1) * (1 - clamp(distance01, 0, 1) * 0.5);
    this.tone(this.sfxBus, 2450, 760, 0.085, 'sine', v * 0.4, pan);
    this.noise(this.sfxBus, 0.08, 4200, 'highpass', v * 0.5, pan);
    this.noise(this.sfxBus, 0.17, 1100, 'bandpass', v * 0.22, pan, 0.03);
  }

  playDryFire(): void {
    this.tone(this.sfxBus, 1400, 900, 0.05, 'square', 0.16);
  }

  playFootstep(running: boolean, distance01 = 0): void {
    const now = performance.now();
    if (now - this.lastFootstep < (running ? 300 : 420)) return;
    this.lastFootstep = now;
    const v = 0.12 * (1 - clamp(distance01, 0, 1) * 0.8);
    this.noise(this.sfxBus, 0.07, running ? 900 : 700, 'lowpass', v);
  }

  playImpact(distance01: number, metal = false): void {
    const v = 0.22 * (1 - clamp(distance01, 0, 1) * 0.8);
    this.noise(this.sfxBus, 0.09, metal ? 3200 : 1400, metal ? 'highpass' : 'bandpass', v);
  }

  playExplosion(distance01: number): void {
    const v = 0.9 * (1 - clamp(distance01, 0, 1) * 0.75);
    this.noise(this.sfxBus, 1.1, 900, 'lowpass', v);
    this.tone(this.sfxBus, 110, 28, 0.9, 'sine', v * 0.9);
    this.noise(this.sfxBus, 0.25, 4000, 'highpass', v * 0.35);
  }

  playGrenadeBounce(distance01: number): void {
    const v = 0.2 * (1 - clamp(distance01, 0, 1) * 0.8);
    this.tone(this.sfxBus, 700, 500, 0.06, 'triangle', v);
  }

  playPin(): void {
    this.tone(this.sfxBus, 1800, 1200, 0.05, 'square', 0.2);
  }

  playHitmarker(headshot: boolean): void {
    this.tone(this.sfxBus, headshot ? 1320 : 990, headshot ? 1320 : 990, 0.06, 'square', 0.22);
    if (headshot) this.tone(this.sfxBus, 1760, 1760, 0.07, 'square', 0.2, 0, 0.05);
  }

  /** Medkit pickup: bright two-note confirmation + strap/velcro rustle. */
  playPickup(): void {
    this.tone(this.sfxBus, 660, 990, 0.09, 'triangle', 0.26);
    this.tone(this.sfxBus, 990, 1320, 0.1, 'triangle', 0.2, 0, 0.08);
    this.noise(this.sfxBus, 0.12, 2600, 'bandpass', 0.16, 0, 0.02);
  }

  playKill(): void {
    this.tone(this.sfxBus, 520, 780, 0.12, 'triangle', 0.3);
  }

  playHurt(): void {
    this.noise(this.sfxBus, 0.18, 500, 'lowpass', 0.5);
    this.tone(this.sfxBus, 160, 90, 0.2, 'sawtooth', 0.25);
  }

  playEnemyAlert(distance01: number): void {
    const v = 0.2 * (1 - clamp(distance01, 0, 1) * 0.7);
    this.tone(this.sfxBus, 240, 330, 0.14, 'sawtooth', v);
  }

  playEnemyDeath(distance01: number): void {
    const v = 0.3 * (1 - clamp(distance01, 0, 1) * 0.75);
    this.noise(this.sfxBus, 0.25, 600, 'lowpass', v);
  }

  playUI(): void {
    this.tone(this.uiBus, 660, 660, 0.06, 'sine', 0.25);
  }

  playUICancel(): void {
    this.tone(this.uiBus, 440, 330, 0.08, 'sine', 0.25);
  }

  playRoundWin(): void {
    const seq = [392, 523, 659, 784];
    seq.forEach((f, i) => this.tone(this.uiBus, f, f, 0.22, 'triangle', 0.3, 0, i * 0.12));
  }

  playRoundLose(): void {
    const seq = [330, 262, 196, 147];
    seq.forEach((f, i) => this.tone(this.uiBus, f, f * 0.97, 0.28, 'triangle', 0.3, 0, i * 0.16));
  }

  // --- ambient --------------------------------------------------------------------
  startAmbient(): void {
    if (!this.ctx || !this.musicBus || !this.noiseBuffer || this.ambientNodes.length > 0) return;
    try {
      // Low wind bed + slow drone.
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.loop = true;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 320;
      const gain = this.ctx.createGain();
      gain.gain.value = 0.05;
      src.connect(filter).connect(gain).connect(this.musicBus);
      src.start();
      const drone = this.ctx.createOscillator();
      drone.type = 'sine';
      drone.frequency.value = 55;
      const droneGain = this.ctx.createGain();
      droneGain.gain.value = 0.035;
      drone.connect(droneGain).connect(this.musicBus);
      drone.start();
      // Slow swell LFO.
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = 0.08;
      const lfoGain = this.ctx.createGain();
      lfoGain.gain.value = 0.02;
      lfo.connect(lfoGain).connect(gain.gain);
      lfo.start();
      this.ambientNodes = [src, drone, lfo];
    } catch (err) {
      console.error('[Audio] ambient failed:', err);
    }
  }

  stopAmbient(): void {
    for (const n of this.ambientNodes) {
      try {
        (n as OscillatorNode).stop?.();
      } catch {
        /* already stopped */
      }
      n.disconnect();
    }
    this.ambientNodes = [];
  }

  dispose(): void {
    this.stopAmbient();
    if (this.ctx) void this.ctx.close().catch(() => undefined);
    this.ctx = null;
  }
}
