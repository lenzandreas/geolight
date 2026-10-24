/**
 * Procedural, soft sound effects via Web Audio: no audio files, a few bytes of code.
 * The context is created lazily on the first user gesture (browser autoplay rules).
 */
type Cue = 'pick' | 'place' | 'rotate' | 'remove' | 'lit' | 'unlit' | 'alarm' | 'win' | 'click';

// Pentatonic notes keep everything consonant, whatever order cues arrive in.
const NOTES = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.51];

class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  enabled = true;
  private lastRotate = 0;

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
