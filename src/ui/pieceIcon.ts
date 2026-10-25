import type { Entity } from '../core/types';
import { getDrawer } from '../render/drawers';
import type { Theme } from '../render/theme';

/** Default facing for new pieces, chosen so they visibly do something when dropped. */
export const DEFAULT_ANGLE: Record<string, number> = { mirror: 45, splitter: 45, curvedMirror: 180, prism: 0, grating: 0 };

/** Render a piece into a small canvas for the tray, reusing the board drawers. */
export function pieceIcon(type: string, params: Record<string, unknown>, theme: Theme, size = 44): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  c.width = c.height = Math.round(size * dpr);
  c.style.width = c.style.height = `${size}px`;
  const ctx = c.getContext('2d')!;
  const s = size * dpr * 0.82;
  ctx.setTransform(s, 0, 0, s, (size * dpr - s) / 2, (size * dpr - s) / 2);
  const e: Entity = { id: 'icon', type, x: 0, y: 0, angle: DEFAULT_ANGLE[type] ?? 0, params };
  getDrawer(type)?.(e, { ctx, theme, time: 0 });
  return c;
}

/** Translation key for a piece name. */
export function pieceNameKey(type: string, params: Record<string, unknown>): string {
  if (type === 'lens' && typeof params.f === 'number' && params.f < 0) return 'piece_lensConcave';
  return `piece_${type}`;
}
