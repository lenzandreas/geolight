import { describe, expect, it } from 'vitest';
import { registerBuiltins } from '../src/core/entities';
import { trace } from '../src/core/tracer';
import { evaluate } from '../src/core/rules';
import type { Entity } from '../src/core/types';

registerBuiltins();

let n = 0;
const ent = (type: string, x: number, y: number, angle = 0, params: Record<string, unknown> = {}): Entity => ({ id: `${type}${n++}`, type, x, y, angle, params });
const opts = { width: 12, height: 8 };

describe('tracer', () => {
  it('a laser straight into a sink delivers its full power', () => {
    const sink = ent('sink', 8, 3);
    const r = trace([ent('laser', 1, 3, 0), sink], opts);
    expect(r.received.get(sink.id)![0]).toBeCloseTo(1 / 3);
    expect(evaluate([sink], r).won).toBe(true);
  });

  it('a 45° mirror turns the beam by 90°', () => {
    const sink = ent('sink', 5, 7);
    // Beam travels +x, mirror normal at 135° faces back-down: reflect into +y.
    const r = trace([ent('laser', 1, 3, 0), ent('mirror', 5, 3, 135), sink], opts);
    expect(r.received.has(sink.id)).toBe(true);
  });

  it('mirror symmetry: angle and angle+180 behave the same', () => {
    const sink = ent('sink', 5, 7);
    const r = trace([ent('laser', 1, 3, 0), ent('mirror', 5, 3, 315), sink], opts);
    expect(r.received.has(sink.id)).toBe(true);
  });

  it('a splitter halves the beam', () => {
    const a = ent('sink', 9, 3);
    const b = ent('sink', 5, 7);
    const r = trace([ent('laser', 1, 3, 0), ent('splitter', 5, 3, 135), a, b], opts);
    const pa = r.received.get(a.id)!.reduce((s, v) => s + v, 0);
    const pb = r.received.get(b.id)!.reduce((s, v) => s + v, 0);
    expect(pa).toBeCloseTo(0.5);
    expect(pb).toBeCloseTo(0.5);
  });

  it('a filter passes only its colour', () => {
    const sink = ent('sink', 9, 3, 0, { color: 'red', strict: true, required: 0.3 });
    const r = trace([ent('laser', 1, 3, 0), ent('filter', 5, 3, 0, { color: 'red' }), sink], opts);
    const c = r.received.get(sink.id)!;
    expect(c[0]).toBeCloseTo(1 / 3);
    expect(c[1]).toBe(0);
    expect(evaluate([sink], r).won).toBe(true);
  });

  it('a convex lens focuses parallel sunlight to a point at distance f', () => {
    const sun = ent('sun', 1, 3, 0, { width: 0.8, rays: 21 });
    const lens = ent('lens', 4, 3, 0, { f: 3 });
    const r = trace([sun, lens], opts);
    // Segments leaving the lens all pass near the focal point (7.5, 3.5).
    const after = r.segments.filter((s) => Math.abs(s.a.x - 4.5) < 1e-3);
    expect(after.length).toBe(21);
    for (const s of after) {
      const t = (7.5 - s.a.x) / (s.b.x - s.a.x);
      const y = s.a.y + t * (s.b.y - s.a.y);
      expect(Math.abs(y - 3.5)).toBeLessThan(1e-6);
    }
  });

  it('a prism splits white light into three colours heading different ways', () => {
    const r = trace([ent('laser', 1, 3, 0), ent('prism', 5, 3, 45)], opts);
    // Final segments reach the border; one per channel, each in its own direction.
    const exits = r.segments.filter((s) => s.b.x >= 11.99 || s.b.y >= 7.99 || s.b.y <= 0.01);
    expect(exits.length).toBe(3);
    const dirs = exits.map((s) => Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x));
    expect(new Set(dirs.map((d) => Math.round((d * 180) / Math.PI))).size).toBe(3);
    expect(exits.map((s) => s.c.findIndex((v) => v > 0)).sort()).toEqual([0, 1, 2]);
  });

  it('a bulb emits its full power and walls absorb it', () => {
    const r = trace([ent('bulb', 5, 3)], opts);
    expect(r.emitted).toBeCloseTo(1);
    expect(r.truncated).toBe(false);
  });

  it('two facing mirrors do not loop forever', () => {
    const r = trace([ent('laser', 1, 3, 0), ent('mirror', 6, 3, 0), ent('mirror', 3, 3, 0)], opts);
    expect(r.segments.length).toBeLessThan(100);
  });

  it('a slit only lets light through its opening', () => {
    const sink = ent('sink', 9, 3);
    const laser = ent('laser', 1, 3, 0);
    expect(trace([laser, ent('slit', 5, 3, 0, { gap: 0.1 }), sink], opts).received.has(sink.id)).toBe(true);
    // Opening shifted away from the beam: blocked.
    expect(trace([laser, ent('slit', 5, 3, 0, { gap: 0.1, offset: 0.2 }), sink], opts).received.has(sink.id)).toBe(false);
  });

  it('a tilted glass block shifts a beam sideways', () => {
    const block = ent('block', 4, 3, 30);
    const r = trace([ent('laser', 1, 3, 0), block], opts);
    const last = r.segments[r.segments.length - 1];
    expect(last.b.x).toBeCloseTo(12);
    expect(Math.abs(last.a.y - last.b.y)).toBeLessThan(1e-9);
    expect(Math.abs(last.b.y - 3.5)).toBeGreaterThan(0.1);
  });

  it('a mixing sink needs every colour of its mask', () => {
    const sink = ent('sink', 9, 3, 0, { color: 'yellow', each: true, required: 0.6 });
    const red = ent('laser', 1, 3, 0, { color: 'red', power: 0.5 });
    expect(evaluate([sink], trace([red, sink], opts)).won).toBe(false);
    const green = ent('laser', 9, 6, 270, { color: 'green', power: 0.5 });
    expect(evaluate([sink], trace([red, green, sink], opts)).won).toBe(true);
  });

  it('sensors fail the level when lit', () => {
    const sink = ent('sink', 9, 3);
    const sensor = ent('sensor', 5, 3);
    const es = [ent('laser', 1, 3, 0), sensor, sink];
    expect(evaluate(es, trace(es, opts)).won).toBe(false);
  });
});
