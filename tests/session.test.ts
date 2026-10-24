import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/levels';
import { Session } from '../src/game/session';

const level = LEVELS[0];

describe('session', () => {
  it('places pieces from the tray and respects counts', () => {
    const s = new Session(level);
    const key = s.slots[0].key;
    expect(s.remaining(key)).toBe(1);
    expect(s.place(key, 3, 3)).not.toBeNull();
    expect(s.remaining(key)).toBe(0);
    expect(s.place(key, 4, 3)).toBeNull();
  });

  it('refuses occupied and out-of-grid cells', () => {
    const s = new Session(level);
    const key = s.slots[0].key;
    expect(s.place(key, 0, 1)).toBeNull(); // laser
    expect(s.place(key, 7, 1)).toBeNull(); // wall footprint
    expect(s.place(key, 99, 0)).toBeNull();
  });

  it('snaps rotation and supports undo/redo', () => {
    const s = new Session(level);
    const p = s.place(s.slots[0].key, 5, 1)!;
    s.setAngle(p.id, 131);
    expect(s.get(p.id)!.angle).toBe(135);
    expect(s.won).toBe(true);
    s.undo();
    expect(s.get(p.id)!.angle).toBe(0);
    expect(s.won).toBe(false);
    s.redo();
    expect(s.won).toBe(true);
    s.reset();
    expect(s.pieces.length).toBe(level.entities.length);
    s.undo();
    expect(s.won).toBe(true);
  });

  it('fixed pieces cannot move or rotate', () => {
    const s = new Session(level);
    const laser = s.pieces.find((p) => p.type === 'laser')!;
    expect(s.move(laser.id, 2, 2)).toBe(false);
    expect(s.rotate(laser.id, 1)).toBe(false);
    expect(s.remove(laser.id)).toBe(false);
  });

  it('gives the next unsolved step as a hint', () => {
    const s = new Session(level);
    expect(s.nextHint()).toEqual(level.solution![0]);
  });
});
