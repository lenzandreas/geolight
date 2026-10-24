import type { Entity, EntityType } from './types';

const types = new Map<string, EntityType>();

export function registerType(t: EntityType): void {
  if (types.has(t.id)) throw new Error(`Entity type "${t.id}" registered twice`);
  types.set(t.id, t);
}

export function getType(id: string): EntityType {
  const t = types.get(id);
  if (!t) throw new Error(`Unknown entity type "${id}"`);
  return t;
}

export function hasType(id: string): boolean {
  return types.has(id);
}

export function allTypes(): EntityType[] {
  return [...types.values()];
}

/** Grid cells an entity occupies. */
export function footprint(e: Entity): Array<[number, number]> {
  const t = getType(e.type);
  return t.footprint ? t.footprint(e) : [[Math.round(e.x), Math.round(e.y)]];
}
