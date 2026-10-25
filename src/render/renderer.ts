/**
 * Canvas 2D renderer. Draws only on request (no idle loop) and caches the static
 * background and the beam layer, so a still board costs nothing.
 */
import { power } from '../core/color';
import { centre } from '../core/entities/shapes';
import type { TargetStatus } from '../core/rules';
import type { BeamSegment, TraceResult } from '../core/tracer';
import { getType } from '../core/registry';
import { param, type Entity } from '../core/types';
import { drawWire, getDrawer, roundRect } from './drawers';
import { gateInputs } from '../core/entities';
import { lightColor, rgba, type Theme } from './theme';
import { View } from './view';

export interface RenderState {
  gridW: number;
  gridH: number;
  pieces: Entity[];
  trace: TraceResult;
  statuses: Map<string, TargetStatus>;
  /** Which pieces the player may move (tile drawn) or only rotate (pivot drawn). */
  lockOf: (id: string) => 'tray' | 'free' | 'rotate' | 'fixed';
  selectedId: string | null;
  hoverId: string | null;
  /** A piece being dragged where it can't be dropped. */
  floating: { entity: Entity; valid: boolean } | null;
  hint: Entity | null;
  /** Drop-target cell highlight while dragging. */
  dropCell: { x: number; y: number; valid: boolean } | null;
  time: number;
  /** Seconds since the level was won, or −1. */
  wonFor: number;
}

export type Quality = 'high' | 'low';

const GLOW_DOWNSCALE = 5;
/** Paths emitted weaker than this (fractions of a diffuse source) are drawn as glow only. */
const STRONG_RAY = 0.02;
/** Diffuse light: brightness per unit of power and length (matches the old per-ray strokes). */
const DIFFUSE_GAIN = 18;
/** Diffuse rays are smeared over this width (cells), so their density reads as a smooth glow. */
const DIFFUSE_WIDTH = 0.08;
/** Blur (CSS px) applied when the glow layer is scaled up, so halos fade out instead of stepping. */
const GLOW_BLUR = 3;

export class Renderer {
  readonly view = new View();
  private ctx: CanvasRenderingContext2D;
  private bg = document.createElement('canvas');
  private beams = document.createElement('canvas');
  /** Low-resolution layer: strokes drawn small and upscaled become a soft bloom almost for free. */
  private glow = document.createElement('canvas');
  /** Float accumulation buffer for diffuse light (RGB per glow pixel), reused between redraws. */
  private diffuseBuf = new Float32Array(0);
  private diffuseImg: ImageData | null = null;
  private beamsFor: TraceResult | null = null;
  private dpr = 1;
  private cssW = 1;
  private cssH = 1;
  quality: Quality = 'high';

  constructor(readonly canvas: HTMLCanvasElement, readonly theme: Theme) {
    this.ctx = canvas.getContext('2d')!;
  }

  resize(cssW: number, cssH: number, gridW: number, gridH: number): void {
    this.cssW = Math.max(1, cssW);
    this.cssH = Math.max(1, cssH);
    // Cap the pixel ratio: beyond 2 the glow looks the same but costs much more fill.
    this.dpr = Math.min(window.devicePixelRatio || 1, this.quality === 'high' ? 2 : 1.25);
    const w = Math.round(this.cssW * this.dpr);
    const h = Math.round(this.cssH * this.dpr);
    for (const c of [this.canvas, this.bg, this.beams]) {
      c.width = w;
      c.height = h;
    }
    this.glow.width = Math.ceil(w / GLOW_DOWNSCALE);
    this.glow.height = Math.ceil(h / GLOW_DOWNSCALE);
    this.canvas.style.width = `${this.cssW}px`;
    this.canvas.style.height = `${this.cssH}px`;
    const pad = Math.min(this.cssW, this.cssH) < 500 ? 8 : 24;
    this.view.fit(this.cssW, this.cssH, gridW, gridH, pad);
    this.drawBackground(gridW, gridH);
    this.beamsFor = null;
  }

  private drawBackground(gridW: number, gridH: number): void {
    const ctx = this.bg.getContext('2d')!;
    const t = this.theme;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.bg.width, this.bg.height);
    // Board panel and grid dots (the page gradient comes from CSS).
    this.view.apply(ctx, this.dpr);
    roundRect(ctx, -0.12, -0.12, gridW + 0.24, gridH + 0.24, 0.35);
    ctx.fillStyle = t.board;
    ctx.fill();
    ctx.strokeStyle = t.boardEdge;
    ctx.lineWidth = 0.03;
    ctx.stroke();
    ctx.fillStyle = t.gridDot;
    for (let x = 1; x < gridW; x++) {
      for (let y = 1; y < gridH; y++) {
        ctx.beginPath();
        ctx.arc(x, y, 0.025, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private drawBeams(trace: TraceResult): void {
    // Strong beams (lasers) are batched into a handful of paths by quantised colour and
    // brightness. Weak rays (diffuse sources: hundreds of them) are added up in floating point
    // and turned into a glow image in one go: stroking them one by one into an 8-bit canvas
    // rounds every faint stroke differently depending on how it sits on the pixel grid,
    // which showed up as spikes, dark bars and moiré.
    // A path's look is decided by how its source emitted it (a few strong rays vs. many weak
    // ones), so a beam keeps its style after filters or splitters dim it. The first segment
    // of each root is the emitted ray itself.
    type Bucket = { col: [number, number, number]; a: number; path: Path2D };
    const buckets = new Map<string, Bucket>();
    const weak: BeamSegment[] = [];
    const rootPower = new Map<number, number>();
    for (const s of trace.segments) {
      const p = power(s.c);
      if (!rootPower.has(s.root)) rootPower.set(s.root, p);
      if (p <= 0) continue;
      if (rootPower.get(s.root)! < STRONG_RAY) {
        weak.push(s);
        continue;
      }
      const col = lightColor(this.theme, s.c);
      const qc = col.map((v) => Math.round(v / 32) * 32) as [number, number, number];
      // Perceptual curve, so dim beams stay visible.
      const qa = Math.max(1, Math.round(Math.min(1, Math.pow(p, 0.35)) * 32));
      const key = `${qc[0]},${qc[1]},${qc[2]},${qa}`;
      let b = buckets.get(key);
      if (!b) {
        b = { col: qc, a: qa / 32, path: new Path2D() };
        buckets.set(key, b);
      }
      b.path.moveTo(s.a.x, s.a.y);
      b.path.lineTo(s.b.x, s.b.y);
    }
    const stroke = (ctx: CanvasRenderingContext2D, width: number, alpha: number, whiten: number) => {
      ctx.lineWidth = width;
      for (const b of buckets.values()) {
        // Bright cores burn towards white; faint beams keep their colour.
        const c = b.col.map((v) => v + (255 - v) * whiten * b.a);
        ctx.strokeStyle = rgba(c, Math.min(1, alpha * b.a));
        ctx.stroke(b.path);
      }
    };
    const prep = (ctx: CanvasRenderingContext2D, dpr: number) => {
      this.view.apply(ctx, dpr);
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
    };

    const g = this.glow.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.glow.width, this.glow.height);
    if (weak.length) g.putImageData(this.diffuse(weak), 0, 0);
    prep(g, this.dpr / GLOW_DOWNSCALE);
    stroke(g, 0.5, 0.07, 0);
    stroke(g, 0.2, 0.12, 0);

    const ctx = this.beams.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.beams.width, this.beams.height);
    ctx.globalCompositeOperation = 'lighter';
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // Browsers without canvas filters (Safari before 18) ignore this and keep the plain upscale.
    ctx.filter = `blur(${GLOW_BLUR * this.dpr}px)`;
    ctx.drawImage(this.glow, 0, 0, this.beams.width, this.beams.height);
    ctx.filter = 'none';
    prep(ctx, this.dpr);
    if (this.quality === 'high') stroke(ctx, 0.1, 0.12, 0.15);
    stroke(ctx, 0.045, 0.85, 0.6);
    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * Diffuse light as an image at glow resolution: every ray deposits its power along its
   * length into a float buffer (bilinear splats), the buffer is smeared to the ray width,
   * and a soft curve maps the sum to pixels, so crowded rays brighten smoothly.
   */
  private diffuse(segments: BeamSegment[]): ImageData {
    const W = this.glow.width;
    const H = this.glow.height;
    if (this.diffuseBuf.length !== W * H * 3) this.diffuseBuf = new Float32Array(W * H * 3);
    if (!this.diffuseImg || this.diffuseImg.width !== W || this.diffuseImg.height !== H) this.diffuseImg = new ImageData(W, H);
    const buf = this.diffuseBuf;
    buf.fill(0);
    const k = this.dpr / GLOW_DOWNSCALE;
    const s = this.view.scale * k;
    const ox = this.view.ox * k;
    const oy = this.view.oy * k;
    const rot = this.view.rotated;
    const gh = this.view.gridH;
    const width = DIFFUSE_WIDTH * s;
    // Only the touched area is blurred and converted.
    let minX = W;
    let minY = H;
    let maxX = -1;
    let maxY = -1;
    for (const seg of segments) {
      const p = power(seg.c);
      const col = lightColor(this.theme, seg.c);
      // Glow-pixel coordinates of both ends (pixel centres at +0.5).
      const ax = (rot ? ox + (gh - seg.a.y) * s : ox + seg.a.x * s) - 0.5;
      const ay = (rot ? oy + seg.a.x * s : oy + seg.a.y * s) - 0.5;
      const bx = (rot ? ox + (gh - seg.b.y) * s : ox + seg.b.x * s) - 0.5;
      const by = (rot ? oy + seg.b.x * s : oy + seg.b.y * s) - 0.5;
      minX = Math.min(minX, ax, bx);
      maxX = Math.max(maxX, ax, bx);
      minY = Math.min(minY, ay, by);
      maxY = Math.max(maxY, ay, by);
      const len = Math.hypot(bx - ax, by - ay);
      const n = Math.max(1, Math.ceil(len));
      const m = (DIFFUSE_GAIN * p * width * len) / n / 255;
      const cr = col[0] * m;
      const cg = col[1] * m;
      const cb = col[2] * m;
      const dx = (bx - ax) / n;
      const dy = (by - ay) / n;
      let x = ax + dx / 2;
      let y = ay + dy / 2;
      for (let i = 0; i < n; i++, x += dx, y += dy) {
        const x0 = Math.floor(x);
        const y0 = Math.floor(y);
        if (x0 < 0 || y0 < 0 || x0 >= W - 1 || y0 >= H - 1) continue;
        const fx = x - x0;
        const fy = y - y0;
        const o = (y0 * W + x0) * 3;
        const o2 = o + W * 3;
        const w00 = (1 - fx) * (1 - fy);
        const w10 = fx * (1 - fy);
        const w01 = (1 - fx) * fy;
        const w11 = fx * fy;
        buf[o] += cr * w00;
        buf[o + 1] += cg * w00;
        buf[o + 2] += cb * w00;
        buf[o + 3] += cr * w10;
        buf[o + 4] += cg * w10;
        buf[o + 5] += cb * w10;
        buf[o2] += cr * w01;
        buf[o2 + 1] += cg * w01;
        buf[o2 + 2] += cb * w01;
        buf[o2 + 3] += cr * w11;
        buf[o2 + 4] += cg * w11;
        buf[o2 + 5] += cb * w11;
      }
    }
    const img = this.diffuseImg;
    const d = img.data;
    d.fill(0);
    if (maxX < 0) return img;
    const r = Math.max(1, Math.round(width / 2));
    const x0 = Math.max(0, Math.floor(minX) - r - 1);
    const x1 = Math.min(W - 1, Math.ceil(maxX) + r + 1);
    const y0 = Math.max(0, Math.floor(minY) - r - 1);
    const y1 = Math.min(H - 1, Math.ceil(maxY) + r + 1);
    boxBlur(buf, W, x0, x1, y0, y1, r);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * W + x;
        const o = i * 3;
        const cr = toneOf(buf[o]);
        const cg = toneOf(buf[o + 1]);
        const cb = toneOf(buf[o + 2]);
        const a = Math.max(cr, cg, cb);
        if (a <= 0) continue;
        // Un-premultiplied colour + alpha, so drawing it with 'lighter' adds exactly r, g, b.
        d[i * 4] = (cr / a) * 255;
        d[i * 4 + 1] = (cg / a) * 255;
        d[i * 4 + 2] = (cb / a) * 255;
        d[i * 4 + 3] = a * 255;
      }
    }
    return img;
  }


  draw(s: RenderState): void {
    const ctx = this.ctx;
    const t = this.theme;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.bg, 0, 0);

    if (this.beamsFor !== s.trace) {
      this.drawBeams(s.trace);
      this.beamsFor = s.trace;
    }

    this.view.apply(ctx, this.dpr);

    // Drop-cell highlight.
    if (s.dropCell) {
      ctx.fillStyle = s.dropCell.valid ? 'rgba(170, 185, 255, 0.10)' : 'rgba(255, 120, 150, 0.10)';
      roundRect(ctx, s.dropCell.x + 0.06, s.dropCell.y + 0.06, 0.88, 0.88, 0.16);
      ctx.fill();
    }

    // Tiles under player pieces, pivots under rotatable ones.
    for (const e of s.pieces) {
      const lock = s.lockOf(e.id);
      const c = centre(e);
      if (lock === 'tray' || lock === 'free') {
        roundRect(ctx, e.x + 0.08, e.y + 0.08, 0.84, 0.84, 0.2);
        ctx.fillStyle = 'rgba(170, 185, 255, 0.07)';
        ctx.fill();
      } else if (lock === 'rotate') {
        ctx.beginPath();
        ctx.arc(c.x, c.y, 0.44, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(170, 185, 255, 0.18)';
        ctx.lineWidth = 0.02;
        ctx.setLineDash([0.05, 0.07]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Walls first, then the light, then everything else on top of the light.
    const time = s.time;
    // Wires from photocells to the gates they open, under everything else.
    for (const g of s.pieces) {
      if (g.type !== 'gate') continue;
      const gw = param<number>(g, getType('gate'), 'w');
      const gh = param<number>(g, getType('gate'), 'h');
      for (const id of gateInputs(g)) {
        const cell = s.pieces.find((p) => p.id === id);
        if (cell) drawWire(ctx, centre(cell), { x: g.x + gw / 2, y: g.y + gh / 2 }, (s.statuses.get(id)?.progress ?? 0) > 0.995);
      }
    }
    for (const e of s.pieces) if (e.type === 'wall' || e.type === 'gate') getDrawer(e.type)?.(e, { ctx, theme: t, time, open: s.trace.open?.has(e.id) });

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.beams, 0, 0);
    this.view.apply(ctx, this.dpr);

    if (s.hint) {
      ctx.globalAlpha = 0.35 + 0.15 * Math.sin(time * 3);
      getDrawer(s.hint.type)?.(s.hint, { ctx, theme: t, time });
      ctx.globalAlpha = 1;
      const c = centre(s.hint);
      ctx.beginPath();
      ctx.arc(c.x, c.y, 0.5, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 230, 170, 0.55)';
      ctx.lineWidth = 0.03;
      ctx.setLineDash([0.08, 0.08]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const need = (e: Entity) => param<number>(e, getType('sink'), 'required');
    const needs = s.pieces.filter((e) => e.type === 'sink').map(need);
    const hungriest = Math.max(0, ...needs);
    const varied = hungriest > 0 && Math.min(...needs) < hungriest - 1e-9;
    for (const e of s.pieces) {
      if (e.type === 'wall' || e.type === 'gate') continue;
      const demand = e.type === 'sink' && varied ? need(e) / hungriest : undefined;
      getDrawer(e.type)?.(e, { ctx, theme: t, time, status: s.statuses.get(e.id), demand });
    }

    if (s.floating) {
      ctx.globalAlpha = 0.75;
      getDrawer(s.floating.entity.type)?.(s.floating.entity, { ctx, theme: t, time });
      ctx.globalAlpha = 1;
    }

    const sel = s.selectedId ? s.pieces.find((p) => p.id === s.selectedId) : null;
    if (sel) this.drawSelection(sel, s.lockOf(sel.id));
    else if (s.hoverId) {
      const h = s.pieces.find((p) => p.id === s.hoverId);
      if (h) {
        const c = centre(h);
        ctx.beginPath();
        ctx.arc(c.x, c.y, 0.5, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(200, 210, 255, 0.25)';
        ctx.lineWidth = 0.025;
        ctx.stroke();
      }
    }

    if (s.wonFor >= 0) this.drawCelebration(s);
  }

  /** Radius of the rotation handle around a selected piece (world units). */
  static readonly HANDLE_R = 0.72;

  private drawSelection(e: Entity, lock: string): void {
    const ctx = this.ctx;
    const c = centre(e);
    ctx.beginPath();
    ctx.arc(c.x, c.y, 0.5, 0, Math.PI * 2);
    ctx.strokeStyle = this.theme.select;
    ctx.lineWidth = 0.03;
    ctx.stroke();
    if (lock === 'fixed') return;
    // Rotation handle: a knob along the facing direction.
    const a = (e.angle * Math.PI) / 180;
    const hx = c.x + Math.cos(a) * Renderer.HANDLE_R;
    const hy = c.y + Math.sin(a) * Renderer.HANDLE_R;
    ctx.beginPath();
    ctx.moveTo(c.x + Math.cos(a) * 0.5, c.y + Math.sin(a) * 0.5);
    ctx.lineTo(hx, hy);
    ctx.strokeStyle = 'rgba(200, 210, 255, 0.5)';
    ctx.lineWidth = 0.025;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(hx, hy, 0.11, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(30, 36, 80, 0.95)';
    ctx.fill();
    ctx.strokeStyle = this.theme.accent;
    ctx.lineWidth = 0.03;
    ctx.stroke();
    // Little curved arrows on the knob.
    ctx.beginPath();
    ctx.arc(hx, hy, 0.055, a + 0.6, a + 0.6 + Math.PI * 1.3);
    ctx.stroke();
  }

  private drawCelebration(s: RenderState): void {
    const ctx = this.ctx;
    const t = s.wonFor;
    for (const e of s.pieces) {
      if (e.type !== 'sink') continue;
      const c = centre(e);
      for (let i = 0; i < 3; i++) {
        const k = (t * 0.7 - i * 0.22) % 1.6;
        if (k < 0 || k > 1) continue;
        ctx.beginPath();
        ctx.arc(c.x, c.y, 0.35 + k * 2.4, 0, Math.PI * 2);
        ctx.strokeStyle = rgba([255, 230, 180], 0.35 * (1 - k));
        ctx.lineWidth = 0.05 * (1 - k) + 0.01;
        ctx.stroke();
      }
    }
  }
}

/** 1 − e^(−x), tabulated: linear for faint light, saturating smoothly where rays crowd together. */
const TONE_STEPS = 256;
const TONE_MAX = 8;
const TONE = Float32Array.from({ length: TONE_STEPS * TONE_MAX + 2 }, (_, i) => 1 - Math.exp(-i / TONE_STEPS));
function toneOf(x: number): number {
  if (x <= 0) return 0;
  const f = x * TONE_STEPS;
  if (f >= TONE_STEPS * TONE_MAX) return 1 - Math.exp(-x);
  const i = f | 0;
  return TONE[i] + (TONE[i + 1] - TONE[i]) * (f - i);
}

/** In-place box blur (radius r) of an interleaved RGB float image, limited to a rectangle; separable running sums. */
function boxBlur(buf: Float32Array, W: number, x0: number, x1: number, y0: number, y1: number, r: number): void {
  const tmp = new Float32Array(Math.max(x1 - x0, y1 - y0) * 3 + 3);
  const span = 2 * r + 1;
  const pass = (from: number, to: number, len: number, index: (line: number, i: number) => number) => {
    for (let line = from; line <= to; line++) {
      let sr = 0;
      let sg = 0;
      let sb = 0;
      for (let i = 0; i <= r && i < len; i++) {
        const o = index(line, i);
        sr += buf[o];
        sg += buf[o + 1];
        sb += buf[o + 2];
      }
      for (let i = 0; i < len; i++) {
        tmp[i * 3] = sr / span;
        tmp[i * 3 + 1] = sg / span;
        tmp[i * 3 + 2] = sb / span;
        const add = i + r + 1;
        const drop = i - r;
        if (add < len) {
          const o = index(line, add);
          sr += buf[o];
          sg += buf[o + 1];
          sb += buf[o + 2];
        }
        if (drop >= 0) {
          const o = index(line, drop);
          sr -= buf[o];
          sg -= buf[o + 1];
          sb -= buf[o + 2];
        }
      }
      for (let i = 0; i < len; i++) {
        const o = index(line, i);
        buf[o] = tmp[i * 3];
        buf[o + 1] = tmp[i * 3 + 1];
        buf[o + 2] = tmp[i * 3 + 2];
      }
    }
  };
  pass(y0, y1, x1 - x0 + 1, (y, x) => (y * W + x0 + x) * 3);
  pass(x0, x1, y1 - y0 + 1, (x, y) => ((y0 + y) * W + x) * 3);
}
