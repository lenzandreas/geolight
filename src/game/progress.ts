import type { Lang } from '../i18n';
import { store, type KeyValueStore } from '../platform/storage';

export interface LevelProgress {
  stars: number;
  /** Fewest tray pieces used in a solve. */
  bestPieces: number;
}

export interface Settings {
  lang: Lang | null;
  sound: boolean;
  reducedMotion: boolean;
  quality: 'high' | 'low';
}

export interface SaveData {
  version: 1;
  levels: Record<string, LevelProgress>;
  settings: Settings;
}

const KEY = 'geolight.save';

function defaults(): SaveData {
  const prefersReduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  return { version: 1, levels: {}, settings: { lang: null, sound: true, reducedMotion: prefersReduced, quality: 'high' } };
}

export class Progress {
  data: SaveData;
  constructor(private kv: KeyValueStore = store) {
    this.data = defaults();
    const raw = kv.get(KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as SaveData;
        if (parsed.version === 1) this.data = { ...this.data, ...parsed, settings: { ...this.data.settings, ...parsed.settings } };
      } catch {
        /* Corrupt save: start fresh rather than crash. */
      }
    }
  }

  save(): void {
    this.kv.set(KEY, JSON.stringify(this.data));
  }

  level(id: string): LevelProgress | undefined {
    return this.data.levels[id];
  }

  /** Record a solve; keeps the best result. Returns true if it improved. */
  complete(id: string, stars: number, pieces: number): boolean {
    const prev = this.data.levels[id];
    if (prev && prev.stars >= stars && prev.bestPieces <= pieces) return false;
    this.data.levels[id] = { stars: Math.max(stars, prev?.stars ?? 0), bestPieces: Math.min(pieces, prev?.bestPieces ?? Infinity) };
    this.save();
    return true;
  }

  isUnlocked(index: number, ids: string[]): boolean {
    return index === 0 || !!this.data.levels[ids[index - 1]] || !!this.data.levels[ids[index]];
  }

  updateSettings(patch: Partial<Settings>): void {
    this.data.settings = { ...this.data.settings, ...patch };
    this.save();
  }

  resetLevels(): void {
    this.data.levels = {};
    this.save();
  }
}
