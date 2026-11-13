/**
 * Visuals per entity type, in world units (1 = one cell). Kept apart from the
 * physics so a different art style (or a WebGL renderer) can replace it.
 */
import { resolveColor } from '../core/color';
import { PHOTOCELL_SIZE, POLARIZER_RADIUS, HEATER_DEPTH, HEATER_LENGTH, SCREEN_DEPTH, SCREEN_PIXEL, screenRun, WARM_FAR, SHADOW_FACTOR, SLIT_THICKNESS, THIN_LEN } from '../core/entities';
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
  /**
   * Sinks: this sink's requirement as a share of the largest one on the board
   * (1 = the hungriest). Left out when every sink needs the same.
   */
  demand?: number;
  /** Gates: currently open. */
  open?: boolean;
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

/** Warm "powered" colour shared by photocells, their wires and gates, so the link reads at a glance. */
export const POWER: [number, number, number] = [255, 200, 120];

registerDrawer('gate', (e, { ctx, theme, open }) => {
  const w = param<number>(e, getType('gate'), 'w');
  const h = param<number>(e, getType('gate'), 'h');
  const inset = 0.04;
  roundRect(ctx, e.x + inset, e.y + inset, w - inset * 2, h - inset * 2, 0.14);
  if (open) {
    // Only a faint dashed outline remains where the gate was.
    ctx.strokeStyle = rgba(POWER, 0.35);
    ctx.lineWidth = 0.025;
    ctx.setLineDash([0.07, 0.07]);
    ctx.stroke();
    ctx.setLineDash([]);
    return;
  }
  ctx.fillStyle = theme.wall;
  ctx.fill();
  ctx.strokeStyle = rgba(POWER, 0.45);
  ctx.lineWidth = 0.03;
  ctx.stroke();
  // Diagonal hazard stripes mark it as something that can open.
  ctx.save();
  roundRect(ctx, e.x + inset, e.y + inset, w - inset * 2, h - inset * 2, 0.14);
  ctx.clip();
  ctx.strokeStyle = rgba(POWER, 0.16);
  ctx.lineWidth = 0.09;
  ctx.beginPath();
  for (let k = -h; k < w + h; k += 0.32) {
    ctx.moveTo(e.x + k, e.y);
    ctx.lineTo(e.x + k + h, e.y + h);
  }
  ctx.stroke();
  ctx.restore();
});

registerDrawer('photocell', (e, { ctx, theme, status }) => {
  const c = centre(e);
  const s = PHOTOCELL_SIZE;
  const on = (status?.progress ?? 0) > 0.995;
  if (on) softGlow(ctx, c.x, c.y, 0.7, POWER, 0.45);
  local(e, ctx, () => {
    roundRect(ctx, -s / 2, -s / 2, s, s, 0.05);
    ctx.fillStyle = theme.sinkWell;
    ctx.fill();
    ctx.strokeStyle = on ? rgba(POWER, 0.95) : theme.wallEdge;
    ctx.lineWidth = 0.03;
    ctx.stroke();
    // Solar-cell grid, filling with colour as light arrives.
    const p = status?.progress ?? 0;
    ctx.fillStyle = rgba(POWER, 0.12 + 0.55 * p);
    const q = s / 2 - 0.05;
    for (const [x, y] of [[-q, -q], [0.01, -q], [-q, 0.01], [0.01, 0.01]]) {
      ctx.fillRect(x, y, q - 0.01, q - 0.01);
    }
  });
});

/** Dotted wire from a photocell to the gate it opens. */
export function drawWire(ctx: CanvasRenderingContext2D, from: { x: number; y: number }, to: { x: number; y: number }, on: boolean): void {
  ctx.strokeStyle = rgba(POWER, on ? 0.45 : 0.16);
  ctx.lineWidth = 0.025;
  ctx.lineCap = 'round';
  ctx.setLineDash([0.01, 0.09]);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineCap = 'butt';
}

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
  const pol = param<number | null>(e, getType('laser'), 'pol');
  if (pol !== null && pol !== undefined) {
    const c = centre(e);
    polStripes(ctx, c.x + Math.cos((e.angle * Math.PI) / 180) * 0.04, c.y + Math.sin((e.angle * Math.PI) / 180) * 0.04, 0.12, pol, 'rgba(230, 220, 255, 0.85)', 0.02, 0.06);
  }
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

/**
 * A screen is a frame with one square tile per pixel. The outline of a tile is the silhouette
 * to cast: dashed for a pixel that must stay dark, solid (in its colour) for one that wants
 * light. The fill is the light that actually falls on it, and a wrongly lit tile turns red.
 */
registerDrawer('screen', (e, { ctx, theme, time, status }) => {
  const t = getType('screen');
  const pattern = param<string>(e, t, 'pattern');
  const need = param<number>(e, t, 'need') / 3;
  const limit = param<number>(e, t, 'limit');
  const run = screenRun(e);
  const c = centre(e);
  const n = pattern.length;
  const d = SCREEN_DEPTH / 2;
  const x0 = c.x - (run.x ? 0.5 : d);
  const y0 = c.y - (run.y ? 0.5 : d);
  roundRect(ctx, x0, y0, run.x ? n : SCREEN_DEPTH, run.y ? n : SCREEN_DEPTH, 0.1);
  ctx.fillStyle = theme.wall;
  ctx.fill();
  ctx.strokeStyle = theme.wallEdge;
  ctx.lineWidth = 0.025;
  ctx.stroke();
  const h = SCREEN_PIXEL / 2;
  for (let i = 0; i < n; i++) {
    const px = c.x + run.x * i;
    const py = c.y + run.y * i;
    const p = status?.pixels?.[i];
    const want = p?.want ?? [0, 0, 0];
    const wantsLight = want[0] + want[1] + want[2] > 0;
    const got = p?.got ?? [0, 0, 0];
    const brightest = Math.max(got[0], got[1], got[2]);
    const level = Math.min(1, brightest / Math.max(need, 1e-9));
    // Light below the limit counts as shadow, so it is drawn as shadow.
    const lit = brightest > limit;
    const wrong = !!p && !p.ok && lit && (!wantsLight || level >= 1);
    if (lit && p?.ok) softGlow(ctx, px, py, 0.5 * (1 + Math.sin(time * 2.2 + i) * 0.04), lightColor(theme, got), 0.35);
    roundRect(ctx, px - h, py - h, SCREEN_PIXEL, SCREEN_PIXEL, 0.07);
    ctx.fillStyle = theme.sinkWell;
    ctx.fill();
    if (lit) {
      ctx.fillStyle = rgba(lightColor(theme, got), 0.15 + 0.8 * level);
      ctx.fill();
    }
    ctx.lineWidth = wrong ? 0.045 : 0.03;
    if (wrong) ctx.strokeStyle = theme.sensor;
    else if (wantsLight) ctx.strokeStyle = rgba(maskColor(theme, want), p?.ok ? 1 : 0.7);
    else ctx.strokeStyle = 'rgba(170, 180, 255, 0.45)';
    if (!wantsLight && !wrong) ctx.setLineDash([0.06, 0.06]);
    ctx.stroke();
    ctx.setLineDash([]);
    // A coloured pixel shows its colour as a dot until the right light covers it.
    if (wantsLight && !(want[0] && want[1] && want[2]) && !p?.ok) {
      ctx.beginPath();
      ctx.arc(px, py, 0.06, 0, Math.PI * 2);
      ctx.fillStyle = rgba(maskColor(theme, want), 0.9);
      ctx.fill();
    }
  }
});

registerDrawer('sink', (e, { ctx, theme, time, status, demand }) => {
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
  // Track and progress arc. When sinks need different amounts the band is a "tank":
  // its thickness grows inwards with the requirement, the outer edge stays put.
  const band = demand === undefined ? 0.06 : Math.max(0.03, 0.13 * demand);
  const rb = r + 0.03 - band / 2;
  const top = -Math.PI / 2;
  ctx.lineWidth = band;
  ctx.strokeStyle = rgba(col, demand === undefined ? 0.38 : 0.3);
  ctx.beginPath();
  ctx.arc(c.x, c.y, rb, 0, Math.PI * 2);
  ctx.stroke();
  if (progress > 0.001) {
    ctx.strokeStyle = rgba(col, ok ? 1 : 0.85);
    ctx.lineCap = band > 0.07 ? 'butt' : 'round';
    ctx.beginPath();
    ctx.arc(c.x, c.y, rb, top, top + Math.PI * 2 * progress);
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
  const pol = param<number | null>(e, t, 'pol');
  if (pol !== null && pol !== undefined) {
    // A bar across the ring shows the accepted polarization axis.
    const a = (pol * Math.PI) / 180;
    ctx.strokeStyle = rgba(col, 0.85);
    ctx.lineWidth = 0.035;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(c.x - Math.cos(a) * (r + 0.12), c.y - Math.sin(a) * (r + 0.12));
    ctx.lineTo(c.x - Math.cos(a) * (r + 0.02), c.y - Math.sin(a) * (r + 0.02));
    ctx.moveTo(c.x + Math.cos(a) * (r + 0.02), c.y + Math.sin(a) * (r + 0.02));
    ctx.lineTo(c.x + Math.cos(a) * (r + 0.12), c.y + Math.sin(a) * (r + 0.12));
    ctx.stroke();
    ctx.lineCap = 'butt';
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

registerDrawer('grating', (e, { ctx, theme }) => {
  local(e, ctx, () => {
    // A thin glass plate with fine rulings and a faint rainbow sheen along it.
    roundRect(ctx, -0.05, -H, 0.1, THIN_LEN, 0.04);
    const g = ctx.createLinearGradient(0, -H, 0, H);
    theme.channels.forEach((c, i) => g.addColorStop(i / 2, rgba(c, 0.35)));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = theme.glassEdge;
    ctx.lineWidth = 0.02;
    ctx.stroke();
    ctx.strokeStyle = rgba([235, 240, 255], 0.55);
    ctx.lineWidth = 0.012;
    ctx.beginPath();
    for (let y = -H + 0.06; y < H - 0.03; y += 0.055) {
      ctx.moveTo(-0.035, y);
      ctx.lineTo(0.035, y);
    }
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

/** Short parallel strokes along a polarization axis, clipped to a circle. */
function polStripes(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, axis: number, color: string, width: number, gap: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.translate(x, y);
  ctx.rotate((axis * Math.PI) / 180);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  for (let o = -r + gap / 2; o < r; o += gap) {
    ctx.moveTo(-r, o);
    ctx.lineTo(r, o);
  }
  ctx.stroke();
  ctx.restore();
}

registerDrawer('polarizer', (e, { ctx, theme }) => {
  const c = centre(e);
  const r = POLARIZER_RADIUS;
  ctx.beginPath();
  ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(170, 150, 230, 0.18)';
  ctx.fill();
  polStripes(ctx, c.x, c.y, r, e.angle, 'rgba(220, 210, 255, 0.55)', 0.022, 0.095);
  ctx.beginPath();
  ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
  ctx.strokeStyle = theme.glassEdge;
  ctx.lineWidth = 0.03;
  ctx.stroke();
  // Axis notches on the rim, so the orientation reads even at a glance.
  ctx.strokeStyle = theme.mirror;
  ctx.lineWidth = 0.04;
  ctx.lineCap = 'round';
  const a = (e.angle * Math.PI) / 180;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(c.x + Math.cos(a) * s * (r - 0.07), c.y + Math.sin(a) * s * (r - 0.07));
    ctx.lineTo(c.x + Math.cos(a) * s * (r + 0.05), c.y + Math.sin(a) * s * (r + 0.05));
    ctx.stroke();
  }
  ctx.lineCap = 'butt';
});

/** A hot plate with its warm air: the haze shows exactly where light gets bent. */
registerDrawer('heater', (e, { ctx, theme, time }) => {
  local(e, ctx, () => {
    const d = HEATER_DEPTH / 2;
    // Warm air, fading with distance from the plate.
    const haze = ctx.createLinearGradient(d, 0, WARM_FAR, 0);
    haze.addColorStop(0, 'rgba(255, 150, 95, 0.20)');
    haze.addColorStop(0.6, 'rgba(255, 150, 95, 0.07)');
    haze.addColorStop(1, 'rgba(255, 150, 95, 0)');
    ctx.fillStyle = haze;
    ctx.fillRect(d, -0.5, WARM_FAR - d, 1);
    // Shimmer: a few wavy lines drifting away from the plate.
    ctx.lineWidth = 0.018;
    ctx.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      const x = d + 0.12 + ((i * 0.33 + time * 0.12) % 1.32);
      const fade = 1 - (x - d) / (WARM_FAR - d);
      ctx.strokeStyle = `rgba(255, 190, 140, ${(0.3 * fade).toFixed(3)})`;
      ctx.beginPath();
      for (let k = 0; k <= 12; k++) {
        const y = -0.44 + (0.88 * k) / 12;
        const wx = x + 0.03 * Math.sin(k * 1.3 + i * 2.1 + time * 1.4);
        if (k) ctx.lineTo(wx, y);
        else ctx.moveTo(wx, y);
      }
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
    // The plate: dark metal with a glowing face.
    roundRect(ctx, -d, -HEATER_LENGTH / 2, HEATER_DEPTH, HEATER_LENGTH, 0.05);
    ctx.fillStyle = theme.metalDark;
    ctx.fill();
    ctx.strokeStyle = theme.metal;
    ctx.lineWidth = 0.02;
    ctx.stroke();
    softGlow(ctx, d, 0, 0.3, [255, 140, 80], 0.25);
    ctx.strokeStyle = 'rgba(255, 160, 100, 0.95)';
    ctx.lineWidth = 0.05;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(d, -HEATER_LENGTH / 2 + 0.06);
    ctx.lineTo(d, HEATER_LENGTH / 2 - 0.06);
    ctx.stroke();
    ctx.lineCap = 'butt';
  });
});

registerDrawer('blackHole', (e, { ctx, time }) => {
  const t = getType('blackHole');
  const c = centre(e);
  const rs = param<number>(e, t, 'rs');
  const reach = param<number>(e, t, 'reach');
  const shadow = SHADOW_FACTOR * rs;
  // The reach of its pull: a faint lensing haze and a dotted rim.
  const haze = ctx.createRadialGradient(c.x, c.y, shadow, c.x, c.y, reach);
  haze.addColorStop(0, 'rgba(150, 120, 255, 0.10)');
  haze.addColorStop(1, 'rgba(150, 120, 255, 0)');
  ctx.fillStyle = haze;
  ctx.beginPath();
  ctx.arc(c.x, c.y, reach, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(170, 150, 255, 0.12)';
  ctx.lineWidth = 0.02;
  ctx.setLineDash([0.02, 0.1]);
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineCap = 'butt';
  // Glowing photon ring, brighter on one slowly turning side (like a spinning disc).
  softGlow(ctx, c.x, c.y, shadow * 1.7, [255, 190, 130], 0.35);
  const spin = time * 0.6;
  for (let i = 0; i < 24; i++) {
    const a0 = spin + (i / 24) * Math.PI * 2;
    const bright = 0.35 + 0.55 * (0.5 + 0.5 * Math.cos(a0 - spin - 0.6));
    ctx.strokeStyle = `rgba(255, ${190 + 50 * bright | 0}, ${130 + 90 * bright | 0}, ${bright.toFixed(3)})`;
    ctx.lineWidth = 0.05;
    ctx.beginPath();
    ctx.arc(c.x, c.y, shadow + 0.02, a0, a0 + (Math.PI * 2) / 24 + 0.01);
    ctx.stroke();
  }
  // The shadow: everything inside is gone.
  ctx.beginPath();
  ctx.arc(c.x, c.y, shadow, 0, Math.PI * 2);
  ctx.fillStyle = '#03040b';
  ctx.fill();
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
