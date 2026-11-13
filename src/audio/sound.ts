/**
 * Procedural, soft sound effects via Web Audio: no audio files, a few bytes of code.
 * The context is created lazily on the first user gesture (browser autoplay rules).
 */
import type { Voice } from './harmony';

type Cue = 'pick' | 'place' | 'rotate' | 'remove' | 'lit' | 'unlit' | 'alarm' | 'win' | 'click';

// Pentatonic notes keep everything consonant, whatever order cues arrive in (and with the held notes).
const NOTES = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.51];

/** Loudness of one held note at full level, before the master gain. */
const HELD_GAIN = 0.2;
/** Held notes fade out after this long without a change, so a board left alone falls silent. */
const REST_AFTER_MS = 45000;
/** A silent held note is torn down after this long (it may be wanted again while a piece is dragged). */
const DROP_AFTER_MS = 4000;

interface Held {
  oscs: OscillatorNode[];
  gain: GainNode;
  level: number;
  drop: number;
}

class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  enabled = true;
  /** Rings hold a note while they are lit. */
  music = true;
  private lastRotate = 0;
  private wanted: Voice[] = [];
  private held = new Map<string, Held>();
  private restTimer = 0;
  private resting = false;

  constructor() {
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => this.applyHeld());
  }

  private ensure(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.22;
      // A short feedback delay gives a gentle sense of space.
      const delay = this.ctx.createDelay(1);
      delay.delayTime.value = 0.18;
      const fb = this.ctx.createGain();
      fb.gain.value = 0.25;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2400;
      this.master.connect(lp);
      lp.connect(this.ctx.destination);
      lp.connect(delay);
      delay.connect(fb);
      fb.connect(delay);
      delay.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** Call from a user gesture to unlock audio on iOS/Safari. */
  unlock(): void {
    this.ensure();
    this.applyHeld();
  }

  /**
   * Hold these notes until told otherwise (pass [] to stop). Cheap to call every frame:
   * only changes reach the audio graph. Notes start once audio is unlocked by a gesture.
   */
  sustain(voices: Voice[]): void {
    const changed = voices.length !== this.wanted.length || voices.some((v, i) => v.id !== this.wanted[i].id || Math.abs(v.level - this.wanted[i].level) > 0.004);
    // Compare with the notes last applied, so a slow swell of tiny steps still adds up.
    if (!changed) return;
    this.wanted = voices;
    this.resting = false;
    clearTimeout(this.restTimer);
    if (voices.some((v) => v.level > 0)) {
      this.restTimer = window.setTimeout(() => {
        this.resting = true;
        this.applyHeld();
      }, REST_AFTER_MS);
    }
    this.applyHeld();
  }

  /** Bring the audio graph in line with the wanted notes and the settings. */
  applyHeld(): void {
    const ctx = this.ctx;
    // Never create the context here: it has to wait for a user gesture.
    if (!ctx || !this.master) return;
    const audible = this.enabled && this.music && !this.resting && !document.hidden;
    const voices = audible ? this.wanted : [];
    // Share the headroom, so a chord of six is not six times as loud as one note.
    const share = HELD_GAIN / Math.sqrt(Math.max(1, voices.filter((v) => v.level > 0.5).length));
    const now = ctx.currentTime;
    const seen = new Set<string>();
    for (const v of voices) {
      seen.add(v.id);
      let h = this.held.get(v.id);
      if (!h && v.level <= 0) continue;
      if (!h) {
        const gain = ctx.createGain();
        gain.gain.value = 0;
        gain.connect(this.master);
        // Two sines a few cents apart shimmer slowly; a quiet octave adds a little air.
        const oscs = ([[1, -4, 0.5], [1, 4, 0.5], [2, 0, 0.16]] as const).map(([mult, cents, amp]) => {
          const osc = ctx.createOscillator();
          osc.frequency.value = v.freq * mult;
          osc.detune.value = cents;
          const g = ctx.createGain();
          g.gain.value = amp;
          osc.connect(g);
          g.connect(gain);
          osc.start();
          return osc;
        });
        h = { oscs, gain, level: 0, drop: 0 };
        this.held.set(v.id, h);
      }
      this.setHeld(v.id, h, v.level * share, now);
    }
    for (const [id, h] of this.held) if (!seen.has(id)) this.setHeld(id, h, 0, now);
  }

  private setHeld(id: string, h: Held, level: number, now: number): void {
    if (Math.abs(level - h.level) < 1e-4) return;
    // Swell in quickly enough to feel connected to the beam; let go slowly.
    h.gain.gain.setTargetAtTime(level, now, level > h.level ? 0.18 : 0.45);
    h.level = level;
    clearTimeout(h.drop);
    if (level > 0) return;
    h.drop = window.setTimeout(() => {
      for (const o of h.oscs) o.stop();
      h.gain.disconnect();
      this.held.delete(id);
    }, DROP_AFTER_MS);
  }

  private tone(freq: number, start: number, dur: number, vol: number, type: OscillatorType = 'sine'): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const t = ctx.currentTime + start;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this.master!);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  play(cue: Cue, variant = 0): void {
    const ctx = this.ensure();
    if (!ctx) return;
    switch (cue) {
      case 'click':
        this.tone(NOTES[4], 0, 0.08, 0.15, 'triangle');
        break;
      case 'pick':
        this.tone(NOTES[2], 0, 0.12, 0.25, 'triangle');
        break;
      case 'place':
        this.tone(NOTES[0], 0, 0.18, 0.3, 'triangle');
        this.tone(NOTES[0] / 2, 0, 0.2, 0.2);
        break;
      case 'remove':
        this.tone(NOTES[3], 0, 0.1, 0.18, 'triangle');
        this.tone(NOTES[1], 0.06, 0.14, 0.18, 'triangle');
        break;
      case 'rotate': {
        const now = performance.now();
        if (now - this.lastRotate < 40) return; // Rate-limit while scrolling.
        this.lastRotate = now;
        this.tone(NOTES[5 + (variant & 1)], 0, 0.05, 0.08, 'sine');
        break;
      }
      case 'lit':
        this.tone(NOTES[(variant % 4) + 3], 0, 0.6, 0.22);
        this.tone(NOTES[(variant % 4) + 3] * 1.5, 0.04, 0.5, 0.08);
        break;
      case 'unlit':
        this.tone(NOTES[1], 0, 0.25, 0.08);
        break;
      case 'alarm':
        this.tone(311.13, 0, 0.18, 0.18, 'triangle');
        this.tone(293.66, 0.12, 0.22, 0.16, 'triangle');
        break;
      case 'win':
        [0, 2, 4, 5, 7].forEach((n, i) => this.tone(NOTES[n], i * 0.11, 0.9, 0.22));
        this.tone(NOTES[0] / 2, 0, 1.6, 0.15);
        break;
    }
  }
}

export const sound = new SoundEngine();
