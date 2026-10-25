/**
 * Canvas 2D renderer. Draws only on request (no idle loop) and caches the static
 * background and the beam layer, so a still board costs nothing.
 */
import { power } from '../core/color';
import { centre } from '../core/entities/shapes';
import type { TargetStatus } from '../core/rules';
import type { TraceResult } from '../core/tracer';
import { getType } from '../core/registry';
import { param, type Entity } from '../core/types';
import { getDrawer, roundRect } from './drawers';
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
const WEAK_LAYERS = 24;
/** Blur (CSS px) applied when the glow layer is scaled up, so halos fade out instead of stepping. */
const GLOW_BLUR = 3;

export class Renderer {
  readonly view = new View();
  private ctx: CanvasRenderingContext2D;
  private bg = document.createElement('canvas');
  private beams = document.createElement('canvas');
  /** Low-resolution layer: strokes drawn small and upscaled become a soft bloom almost for free. */
  private glow = document.createElement('canvas');
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
    // Batch segments by quantised colour and brightness: a handful of paths, not thousands of strokes.
    // Weak rays (diffuse sources: hundreds of them) are drawn only as soft bloom, so their
    // density reads as a smooth glow instead of hatching.
    type Bucket = { col: [number, number, number]; a: number; strong: boolean; path: Path2D };
    const buckets = new Map<string, Bucket>();
    // Overlapping parts of one stroke don't add up, so weak rays are spread over interleaved
    // paths: where rays crowd together (near a bulb, at a focus) they visibly brighten.
    // Interleave by emitted ray, so neighbouring rays always land in different paths no matter
    // how many bounces each one takes.
    // A path's look is decided by how its source emitted it (a few strong rays vs. many weak
    // ones), so a beam keeps its style after filters or splitters dim it. The first segment
    // of each root is the emitted ray itself.
    const rootPower = new Map<number, number>();
    for (const s of trace.segments) {
      const p = power(s.c);
      if (!rootPower.has(s.root)) rootPower.set(s.root, p);
      if (p <= 0) continue;
      const strong = rootPower.get(s.root)! >= STRONG_RAY;
      const col = lightColor(this.theme, s.c);
      const qc = col.map((v) => Math.round(v / 32) * 32) as [number, number, number];
      // Strong beams: perceptual curve. Weak rays: linear, so ray density sets the brightness.
      const a = strong ? Math.min(1, Math.pow(p, 0.35)) : Math.min(1, p * 18);
      const qa = Math.max(1, Math.round(a * 32));
      const key = `${qc[0]},${qc[1]},${qc[2]},${qa},${strong ? 's' : s.root % WEAK_LAYERS}`;
      let b = buckets.get(key);
      if (!b) {
        b = { col: qc, a: qa / 32, strong, path: new Path2D() };
        buckets.set(key, b);
      }
      b.path.moveTo(s.a.x, s.a.y);
      b.path.lineTo(s.b.x, s.b.y);
    }
    const stroke = (ctx: CanvasRenderingContext2D, which: 'strong' | 'weak', width: number, alpha: number, whiten: number) => {
      ctx.lineWidth = width;
      for (const b of buckets.values()) {
        if (b.strong !== (which === 'strong')) continue;
        // Bright cores burn towards white; faint beams keep their colour.
        const c = b.col.map((v) => v + (255 - v) * whiten * b.a);
        ctx.strokeStyle = rgba(c, Math.min(1, alpha * b.a));
        ctx.stroke(b.path);
      }
    };
    const prep = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, dpr: number) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      this.view.apply(ctx, dpr);
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
    };

    const g = this.glow.getContext('2d')!;
    prep(g, this.glow, this.dpr / GLOW_DOWNSCALE);
    stroke(g, 'strong', 0.5, 0.07, 0);
    stroke(g, 'strong', 0.2, 0.12, 0);
    stroke(g, 'weak', 0.08, 1, 0.25);

    const ctx = this.beams.getContext('2d')!;
    prep(ctx, this.beams, this.dpr);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // Browsers without canvas filters (Safari before 18) ignore this and keep the plain upscale.
    ctx.filter = `blur(${GLOW_BLUR * this.dpr}px)`;
    ctx.drawImage(this.glow, 0, 0, this.beams.width, this.beams.height);
    ctx.filter = 'none';
    this.view.apply(ctx, this.dpr);
    if (this.quality === 'high') stroke(ctx, 'strong', 0.1, 0.12, 0.15);
    stroke(ctx, 'strong', 0.045, 0.85, 0.6);
    ctx.globalCompositeOperation = 'source-over';
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
    for (const e of s.pieces) if (e.type === 'wall') getDrawer('wall')?.(e, { ctx, theme: t, time });

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
      if (e.type === 'wall') continue;
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
