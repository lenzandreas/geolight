import { describe, expect, it } from 'vitest';
import { voicesFor } from '../src/audio/harmony';
import '../src/core/entities';
import { evaluate } from '../src/core/rules';
import { trace } from '../src/core/tracer';
import type { Entity } from '../src/core/types';
import { Campaign } from '../src/game/campaign';
import { Progress } from '../src/game/progress';
import { LEVELS, WORLDS } from '../src/levels';
import { openPages, PAGES } from '../src/notebook/pages';
import type { KeyValueStore } from '../src/platform/storage';

const memory = (): KeyValueStore => {
  const m = new Map<string, string>();
  return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v), remove: (k) => void m.delete(k) };
};

const entity = (type: string, x: number, y: number, params: Record<string, unknown> = {}, angle = 0): Entity => ({ id: `${type}-${x}-${y}`, type, x, y, angle, params });

describe('notebook', () => {
  it('has exactly one page for every piece a world introduces', () => {
    const introduced = WORLDS.map((w) => w.object).filter(Boolean).sort();
    expect(PAGES.map((p) => p.piece).sort()).toEqual(introduced);
  });

  it('writes every page in English and German', () => {
    for (const p of PAGES) for (const text of [p.law, p.text, p.wild]) expect(text.en && text.de, p.piece).toBeTruthy();
  });

  it('draws scenes that fit their board and light every ring in them', () => {
    for (const p of PAGES) {
      const entities = p.scene.entities.map((e, i) => ({ id: `e${i}`, type: e.type, x: e.x, y: e.y, angle: e.angle ?? 0, params: e.params ?? {} }));
      for (const e of entities) expect(e.x >= 0 && e.y >= 0 && e.x < p.scene.w && e.y < p.scene.h, p.piece).toBe(true);
      const result = trace(entities, { width: p.scene.w, height: p.scene.h });
      for (const s of evaluate(entities, result).targets) expect(s.ok, `${p.piece}: ${s.id}`).toBe(true);
    }
  });

  it('opens a page when the world of its piece opens', () => {
    const solved = new Set<string>();
    const campaign = new Campaign(WORLDS, LEVELS, (id) => solved.has(id));
    const open = () => openPages(WORLDS, (w) => campaign.worldOpen(w)).map((p) => p.piece);
    expect(open()).toEqual(['mirror']);
    for (const id of WORLDS[0].levels.slice(0, 4)) solved.add(id);
    expect(open()).toEqual(['mirror', 'splitter']);
  });

  it('remembers which pages were read, until progress is reset', () => {
    const kv = memory();
    const p = new Progress(kv);
    expect(p.pageSeen('mirror')).toBe(false);
    p.markPageSeen('mirror');
    expect(new Progress(kv).pageSeen('mirror')).toBe(true);
    p.resetLevels();
    expect(new Progress(kv).pageSeen('mirror')).toBe(false);
  });

  it('loads a save written before the notebook existed', () => {
    const kv = memory();
    kv.set('geolight.save', JSON.stringify({ version: 1, levels: { a: { stars: 3, bestPieces: 1 } }, settings: { lang: 'de', sound: false, reducedMotion: false, quality: 'high' } }));
    const p = new Progress(kv);
    expect(p.pageSeen('mirror')).toBe(false);
    expect(p.data.settings.music).toBe(true);
    expect(p.data.settings.sound).toBe(false);
    expect(p.level('a')?.stars).toBe(3);
  });
});

describe('light as music', () => {
  const statuses = (entities: Entity[]) => new Map(evaluate(entities, trace(entities, { width: 8, height: 4 })).targets.map((s) => [s.id, s]));

  it('gives a lit ring a full note and a dark ring silence', () => {
    const lit = entity('sink', 6, 1);
    const dark = entity('sink', 6, 3);
    const board = [entity('laser', 0, 1), lit, dark];
    const voices = voicesFor(board, statuses(board));
    expect(voices.map((v) => v.id)).toEqual([lit.id, dark.id]);
    expect(voices[0].level).toBe(1);
    expect(voices[1].level).toBe(0);
  });

  it('hums quietly while a ring is still filling', () => {
    const ring = entity('sink', 6, 1, { required: 2 });
    const board = [entity('laser', 0, 1), ring];
    const [voice] = voicesFor(board, statuses(board));
    expect(voice.level).toBeGreaterThan(0);
    expect(voice.level).toBeLessThan(0.3);
  });

  it('orders pitches like light: red lowest, blue highest, and no two rings share one', () => {
    const board = ['blue', 'red', 'green', 'red', 'white'].map((color, i) => entity('sink', i, 0, { color }));
    const f = voicesFor(board, new Map()).map((v) => v.freq);
    const [blue, red, green, red2, white] = f;
    expect(white).toBeLessThan(red);
    expect(red).toBeLessThan(green);
    expect(green).toBeLessThan(blue);
    expect(new Set(f).size).toBe(5);
    expect(red2).not.toBe(red);
  });

  it('keeps a ring on the same pitch whatever else is lit', () => {
    const board = [entity('laser', 0, 1), entity('sink', 6, 1), entity('sink', 6, 3, { color: 'red' })];
    const dark = voicesFor(board, new Map()).map((v) => v.freq);
    expect(voicesFor(board, statuses(board)).map((v) => v.freq)).toEqual(dark);
  });
});
