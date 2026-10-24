/**
 * Visuals per entity type, in world units (1 = one cell). Kept apart from the
 * physics so a different art style (or a WebGL renderer) can replace it.
 */
import { resolveColor } from '../core/color';
import { SLIT_THICKNESS, THIN_LEN } from '../core/entities';
import { centre, regularPolygon, rotatedRect } from '../core/entities/shapes';
import { getType } from '../core/registry';
import type { TargetStatus } from '../core/rules';
import { param, type Entity } from '../core/types';
import { lightColor, maskColor, rgba, type Theme } from './theme';

export interface DrawContext {
  ctx: CanvasRenderingContext2D;
  theme: Theme;
  /** Seconds, for gentle idle animation (0 when motion is reduced). */
  time: number;
  status?: TargetStatus;
}

export type Drawer = (e: Entity, d: DrawContext) => void;

const drawers = new Map<string, Drawer>();
export const registerDrawer = (type: string, fn: Drawer): void => void drawers.set(type, fn);
export const getDrawer = (type: string): Drawer | undefined => drawers.get(type);

function poly(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[]): void {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  // Fallback for older Safari.
  r = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Run `fn` in the entity's local frame: origin at its centre, +x along its facing. */
function local(e: Entity, ctx: CanvasRenderingContext2D, fn: () => void): void {
  const c = centre(e);
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate((e.angle * Math.PI) / 180);
  fn();
  ctx.restore();
}

function softGlow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: readonly number[], a: number): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(color, a));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/* ---------- Structure ---------- */

registerDrawer('wall', (e, { ctx, theme }) => {
  const w = param<number>(e, getType('wall'), 'w');
  const h = param<number>(e, getType('wall'), 'h');
  const inset = 0.04;
  roundRect(ctx, e.x + inset, e.y + inset, w - inset * 2, h - inset * 2, 0.14);
  const g = ctx.createLinearGradient(e.x, e.y, e.x, e.y + h);
  g.addColorStop(0, theme.wallTop);
  g.addColorStop(1, theme.wall);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = theme.wallEdge;
  ctx.lineWidth = 0.025;
  ctx.stroke();
});

registerDrawer('slit', (e, { ctx, theme }) => {
  const t = getType('slit');
  const gap = param<number>(e, t, 'gap');
  const offset = param<number>(e, t, 'offset');
  const th = SLIT_THICKNESS;
  local(e, ctx, () => {
    // Local frame: +x is the direction light passes, the barrier runs along y.
    const bar = (from: number, to: number) => {
      if (to - from < 1e-6) return;
      roundRect(ctx, -th / 2, from, th, to - from, 0.05);
      ctx.fillStyle = theme.wallTop;
      ctx.fill();
      ctx.strokeStyle = theme.wallEdge;
      ctx.lineWidth = 0.02;
      ctx.stroke();
    };
    bar(-0.5, offset - gap / 2);
    bar(offset + gap / 2, 0.5);
    // Soft markers on the lips of the opening, so the gap reads even when it is tiny.
    ctx.fillStyle = 'rgba(200, 210, 255, 0.55)';
    for (const y of [offset - gap / 2, offset + gap / 2]) {
      ctx.beginPath();
      ctx.arc(0, y, 0.025, 0, Math.PI * 2);
      ctx.fill();
    }
  });
});

/* ---------- Sources ---------- */

registerDrawer('laser', (e, { ctx, theme }) => {
  const col = lightColor(theme, resolveColor(param(e, getType('laser'), 'color')));
  local(e, ctx, () => {
    roundRect(ctx, -0.31, -0.21, 0.62, 0.42, 0.12);
    const g = ctx.createLinearGradient(0, -0.21, 0, 0.21);
    g.addColorStop(0, theme.metal);
    g.addColorStop(1, theme.metalDark);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 0.02;
    ctx.stroke();
    // Status light and nozzle.
    ctx.fillStyle = rgba(col, 0.9);
    ctx.beginPath();
    ctx.arc(-0.14, 0, 0.045, 0, Math.PI * 2);
    ctx.fill();
    roundRect(ctx, 0.22, -0.09, 0.14, 0.18, 0.05);
    ctx.fillStyle = theme.metalDark;
    ctx.fill();
    softGlow(ctx, 0.34, 0, 0.22, col, 0.55);
  });
});

registerDrawer('bulb', (e, { ctx, theme, time }) => {
  const col = lightColor(theme, resolveColor(param(e, getType('bulb'), 'color')));
  const c = centre(e);
  const pulse = 1 + Math.sin(time * 1.6) * 0.04;
  softGlow(ctx, c.x, c.y, 0.75 * pulse, col, 0.35);
  softGlow(ctx, c.x, c.y, 0.3, [255, 255, 255], 0.6);
  ctx.beginPath();
  ctx.arc(c.x, c.y, 0.18, 0, Math.PI * 2);
  ctx.fillStyle = rgba(col, 0.95);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 0.025;
  ctx.stroke();
});

registerDrawer('sun', (e, { ctx, theme }) => {
  const w = param<number>(e, getType('sun'), 'width');
  const col = lightColor(theme, resolveColor(param(e, getType('sun'), 'color')));
  local(e, ctx, () => {
    const g = ctx.createLinearGradient(-0.2, 0, 0.4, 0);
    g.addColorStop(0, rgba([255, 230, 170], 0.0));
    g.addColorStop(0.4, rgba([255, 230, 170], 0.5));
    g.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = g;
    ctx.fillRect(-0.2, -w / 2 - 0.05, 0.6, w + 0.1);
    roundRect(ctx, -0.22, -w / 2 - 0.08, 0.12, w + 0.16, 0.05);
    ctx.fillStyle = theme.metal;
    ctx.fill();
  });
});

/* ---------- Targets ---------- */

registerDrawer('sink', (e, { ctx, theme, time, status }) => {
  const t = getType('sink');
  const c = centre(e);
  const r = param<number>(e, t, 'radius');
  const mask = resolveColor(param(e, t, 'color'));
  const col = maskColor(theme, mask);
  const tinted = !(mask[0] && mask[1] && mask[2]);
  const progress = status?.progress ?? 0;
  const ok = status?.ok ?? false;
  if (ok) softGlow(ctx, c.x, c.y, r * 2.6 * (1 + Math.sin(time * 2.2) * 0.05), col, 0.55);
  else softGlow(ctx, c.x, c.y, r * 2, col, 0.08 + 0.25 * progress);
  // Well.
  ctx.beginPath();
  ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
  ctx.fillStyle = theme.sinkWell;
  ctx.fill();
  // Track and progress arc.
  ctx.lineWidth = 0.06;
  ctx.strokeStyle = rgba(col, 0.38);
  ctx.beginPath();
  ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
  ctx.stroke();
  if (progress > 0.001) {
    ctx.strokeStyle = rgba(col, ok ? 1 : 0.85);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
    ctx.stroke();
    ctx.lineCap = 'butt';
  }
  // Core fills as light arrives.
  softGlow(ctx, c.x, c.y, r * 0.75, ok ? [255, 255, 255] : col, 0.15 + 0.7 * progress);
  if (tinted) {
    ctx.beginPath();
    ctx.arc(c.x, c.y, r * 0.28, 0, Math.PI * 2);
    ctx.fillStyle = rgba(col, 0.9);
    ctx.fill();
  }
  if (status?.contaminated) {
    ctx.strokeStyle = rgba([255, 140, 160], 0.9);
    ctx.lineWidth = 0.035;
    ctx.setLineDash([0.06, 0.06]);
    ctx.beginPath();
    ctx.arc(c.x, c.y, r + 0.09, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
});

registerDrawer('sensor', (e, { ctx, theme, time, status }) => {
  const c = centre(e);
  const alarm = status ? !status.ok : false;
  const col: [number, number, number] = alarm ? [255, 111, 145] : [150, 130, 185];
  if (alarm) softGlow(ctx, c.x, c.y, 0.8 * (1 + Math.sin(time * 9) * 0.08), col, 0.5);
  // Almond eye.
  ctx.beginPath();
  ctx.moveTo(c.x - 0.34, c.y);
  ctx.quadraticCurveTo(c.x, c.y - 0.34, c.x + 0.34, c.y);
  ctx.quadraticCurveTo(c.x, c.y + 0.34, c.x - 0.34, c.y);
  ctx.fillStyle = theme.sinkWell;
  ctx.fill();
  ctx.strokeStyle = alarm ? theme.sensor : theme.sensorCalm;
  ctx.lineWidth = 0.04;
  ctx.stroke();
  // Sleeping: closed lid line. Awake: open pupil.
  if (alarm) {
    ctx.beginPath();
    ctx.arc(c.x, c.y, 0.11, 0, Math.PI * 2);
    ctx.fillStyle = theme.sensor;
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(c.x - 0.18, c.y + 0.02);
    ctx.quadraticCurveTo(c.x, c.y + 0.1, c.x + 0.18, c.y + 0.02);
    ctx.strokeStyle = theme.sensorCalm;
    ctx.lineWidth = 0.03;
    ctx.stroke();
  }
});

/* ---------- Optics ---------- */

const H = THIN_LEN / 2;

registerDrawer('mirror', (e, { ctx, theme }) => {
  local(e, ctx, () => {
    roundRect(ctx, -0.05, -H, 0.1, THIN_LEN, 0.05);
    ctx.fillStyle = theme.mirrorBack;
    ctx.fill();
    const g = ctx.createLinearGradient(0, -H, 0, H);
    g.addColorStop(0, 'rgba(255,255,255,0.65)');
    g.addColorStop(0.5, theme.mirror);
    g.addColorStop(1, 'rgba(255,255,255,0.65)');
    roundRect(ctx, -0.022, -H + 0.02, 0.044, THIN_LEN - 0.04, 0.022);
    ctx.fillStyle = g;
    ctx.fill();
  });
});

registerDrawer('splitter', (e, { ctx, theme }) => {
  local(e, ctx, () => {
    roundRect(ctx, -0.045, -H, 0.09, THIN_LEN, 0.045);
    ctx.fillStyle = theme.glass;
    ctx.fill();
    ctx.strokeStyle = theme.glassEdge;
    ctx.lineWidth = 0.02;
    ctx.stroke();
    ctx.setLineDash([0.07, 0.05]);
    ctx.strokeStyle = theme.mirror;
    ctx.lineWidth = 0.025;
    ctx.beginPath();
    ctx.moveTo(0, -H + 0.04);
    ctx.lineTo(0, H - 0.04);
    ctx.stroke();
    ctx.setLineDash([]);
  });
});

registerDrawer('filter', (e, { ctx, theme }) => {
  const col = lightColor(theme, resolveColor(param(e, getType('filter'), 'color')));
  local(e, ctx, () => {
    roundRect(ctx, -0.06, -H, 0.12, THIN_LEN, 0.05);
    ctx.fillStyle = rgba(col, 0.38);
    ctx.fill();
    ctx.strokeStyle = rgba(col, 0.9);
    ctx.lineWidth = 0.022;
    ctx.stroke();
  });
});

registerDrawer('lens', (e, { ctx, theme }) => {
  const f = param<number>(e, getType('lens'), 'f');
  local(e, ctx, () => {
    ctx.beginPath();
    if (f > 0) {
      // Biconvex: thickness shows strength.
      const bulge = Math.min(0.2, 0.32 / Math.abs(f));
      ctx.moveTo(0, -H);
      ctx.quadraticCurveTo(bulge * 2, 0, 0, H);
      ctx.quadraticCurveTo(-bulge * 2, 0, 0, -H);
    } else {
      const w = 0.1;
      const dip = Math.min(0.08, 0.16 / Math.abs(f));
      ctx.moveTo(-w, -H);
      ctx.lineTo(w, -H);
      ctx.quadraticCurveTo(w - dip * 2, 0, w, H);
      ctx.lineTo(-w, H);
      ctx.quadraticCurveTo(-w + dip * 2, 0, -w, -H);
    }
    ctx.closePath();
    ctx.fillStyle = theme.glass;
    ctx.fill();
    ctx.strokeStyle = theme.glassEdge;
    ctx.lineWidth = 0.022;
    ctx.stroke();
  });
});

registerDrawer('curvedMirror', (e, { ctx, theme }) => {
  local(e, ctx, () => {
    // Front faces +x; the reflective surface curves towards the back.
    ctx.beginPath();
    ctx.moveTo(0.04, -H);
    ctx.quadraticCurveTo(-0.16, 0, 0.04, H);
    ctx.lineTo(-0.06, H);
    ctx.quadraticCurveTo(-0.26, 0, -0.06, -H);
    ctx.closePath();
    ctx.fillStyle = theme.mirrorBack;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0.04, -H + 0.02);
    ctx.quadraticCurveTo(-0.16, 0, 0.04, H - 0.02);
    ctx.strokeStyle = theme.mirror;
    ctx.lineWidth = 0.035;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.lineCap = 'butt';
  });
});

registerDrawer('prism', (e, { ctx, theme }) => {
  const pts = regularPolygon(e, 3, param<number>(e, getType('prism'), 'radius'));
  poly(ctx, pts);
  const c = centre(e);
  const g = ctx.createLinearGradient(pts[0].x, pts[0].y, (pts[1].x + pts[2].x) / 2, (pts[1].y + pts[2].y) / 2);
  g.addColorStop(0, 'rgba(255,150,170,0.22)');
  g.addColorStop(0.5, 'rgba(150,255,190,0.16)');
  g.addColorStop(1, 'rgba(150,170,255,0.24)');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = theme.glassEdge;
  ctx.lineWidth = 0.025;
  ctx.lineJoin = 'round';
  ctx.stroke();
  softGlow(ctx, c.x, c.y, 0.2, [255, 255, 255], 0.12);
});

registerDrawer('block', (e, { ctx, theme }) => {
  const s = param<number>(e, getType('block'), 'size');
  poly(ctx, rotatedRect(e, s, s));
  ctx.fillStyle = theme.glass;
  ctx.fill();
  ctx.strokeStyle = theme.glassEdge;
  ctx.lineWidth = 0.022;
  ctx.lineJoin = 'round';
  ctx.stroke();
});

registerDrawer('blocker', (e, { ctx, theme }) => {
  const s = param<number>(e, getType('blocker'), 'size');
  poly(ctx, rotatedRect(e, s, s));
  ctx.fillStyle = theme.metalDark;
  ctx.fill();
  ctx.strokeStyle = theme.wallEdge;
  ctx.lineWidth = 0.025;
  ctx.stroke();
});
