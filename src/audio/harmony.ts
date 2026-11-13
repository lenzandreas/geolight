/**
 * Light as music: which note each ring holds while it is lit. Pure logic (no Web Audio),
 * so it runs in tests. Colour sets the pitch, light received sets the loudness.
 */
import { resolveColor } from '../core/color';
import { getType } from '../core/registry';
import type { TargetStatus } from '../core/rules';
import { param, type Entity } from '../core/types';

export interface Voice {
  id: string;
  /** Pitch in Hz. */
  freq: number;
  /** Loudness, 0..1. */
  level: number;
}

const C4 = 261.63;
/** Two octaves of C major pentatonic, in semitones above C4: any set of these sounds consonant. */
const LADDER = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];

/**
 * Rung of the ladder for each colour, by which channels (R=1, G=2, B=4) it contains.
 * As with light itself, red has the lowest frequency and blue the highest; white is the root.
 */
const RUNG: Record<number, number> = { 7: 0, 1: 2, 3: 3, 2: 4, 6: 5, 4: 6, 5: 7 };

/**
 * Where a ring goes when its rung is taken: first a fifth or so up (three rungs), then an octave
 * (five), and only then the close neighbours, so several rings of one colour form an open chord.
 */
const SPREAD = [0, 3, 5, 8, 2, 4, 7, 1, 6, 9];

/** A ring hums faintly while it fills, and sings at full level once its requirement is met. */
const FILLING_LEVEL = 0.3;

/**
 * One voice per ring, in board order. Every ring keeps its own pitch whatever is lit,
 * so the same solution always sounds the same chord; rings of one colour spread out (see SPREAD).
 */
export function voicesFor(entities: Entity[], statuses: Map<string, TargetStatus>): Voice[] {
  const sink = getType('sink');
  const taken = new Set<number>();
  const out: Voice[] = [];
  for (const e of entities) {
    if (e.type !== 'sink') continue;
    const mask = resolveColor(param(e, sink, 'color'));
    const bits = (mask[0] > 0 ? 1 : 0) | (mask[1] > 0 ? 2 : 0) | (mask[2] > 0 ? 4 : 0);
    let rung = RUNG[bits] ?? 0;
    const base = rung;
    for (const step of SPREAD) {
      rung = (base + step) % LADDER.length;
      if (!taken.has(rung)) break;
    }
    taken.add(rung);
    const s = statuses.get(e.id);
    const level = !s || s.contaminated ? 0 : s.ok ? 1 : FILLING_LEVEL * s.progress * s.progress;
    out.push({ id: e.id, freq: C4 * 2 ** (LADDER[rung] / 12), level });
  }
  return out;
}
