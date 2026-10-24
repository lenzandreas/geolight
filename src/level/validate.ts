import { hasType } from '../core/registry';
import { LEVEL_SCHEMA, type LevelDef } from './schema';

export class LevelError extends Error {}

/** Check a parsed level file, migrating older schema versions when they appear. */
export function parseLevel(raw: unknown): LevelDef {
  const l = raw as LevelDef;
  const fail = (msg: string): never => {
    throw new LevelError(`Level ${l?.id ?? '?'}: ${msg}`);
  };
  if (!l || typeof l !== 'object') fail('not an object');
  if (l.schema !== LEVEL_SCHEMA) fail(`unsupported schema ${l.schema}`);
  if (typeof l.id !== 'string') fail('missing id');
  if (!l.name?.en) fail('missing English name');
  if (!(l.grid?.w > 0 && l.grid?.h > 0)) fail('invalid grid');
  if (!Array.isArray(l.entities)) fail('entities must be an array');
  if (!Array.isArray(l.inventory)) fail('inventory must be an array');
  const ids = new Set<string>();
  l.entities.forEach((e, i) => {
    if (!hasType(e.type)) fail(`entity ${i}: unknown type ${e.type}`);
    if (e.x < 0 || e.y < 0 || e.x >= l.grid.w || e.y >= l.grid.h) fail(`entity ${i} outside grid`);
    if (e.id) {
      if (ids.has(e.id)) fail(`duplicate id ${e.id}`);
      ids.add(e.id);
    }
  });
  for (const item of l.inventory) if (!hasType(item.type)) fail(`unknown inventory type ${item.type}`);
  return l;
}
