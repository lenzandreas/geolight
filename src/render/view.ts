import type { Vec } from '../core/math';

/**
 * Maps world (cell) coordinates to canvas pixels. In portrait viewports a
 * landscape board is rotated by 90° so cells stay large on phones.
 */
export class View {
  scale = 1;
  ox = 0;
  oy = 0;
  rotated = false;
  gridW = 1;
  gridH = 1;

  fit(width: number, height: number, gridW: number, gridH: number, pad: number): void {
    this.gridW = gridW;
    this.gridH = gridH;
    const aw = Math.max(1, width - pad * 2);
    const ah = Math.max(1, height - pad * 2);
    const sNormal = Math.min(aw / gridW, ah / gridH);
    const sRot = Math.min(aw / gridH, ah / gridW);
    this.rotated = sRot > sNormal * 1.15;
    this.scale = this.rotated ? sRot : sNormal;
    const bw = (this.rotated ? gridH : gridW) * this.scale;
    const bh = (this.rotated ? gridW : gridH) * this.scale;
    this.ox = (width - bw) / 2;
    this.oy = (height - bh) / 2;
  }

  /** Canvas transform for drawing in world units (multiply by device pixel ratio first). */
  apply(ctx: CanvasRenderingContext2D, dpr: number): void {
    const s = this.scale * dpr;
    if (this.rotated) ctx.setTransform(0, s, -s, 0, (this.ox + this.gridH * this.scale) * dpr, this.oy * dpr);
    else ctx.setTransform(s, 0, 0, s, this.ox * dpr, this.oy * dpr);
  }

  toScreen(p: Vec): Vec {
    if (this.rotated) return { x: this.ox + (this.gridH - p.y) * this.scale, y: this.oy + p.x * this.scale };
    return { x: this.ox + p.x * this.scale, y: this.oy + p.y * this.scale };
  }

  toWorld(p: Vec): Vec {
    const x = (p.x - this.ox) / this.scale;
    const y = (p.y - this.oy) / this.scale;
    return this.rotated ? { x: y, y: this.gridH - x } : { x, y };
  }

  /** Screen-space rotation added to world angles (for on-screen gestures). */
  get angleOffset(): number {
    return this.rotated ? 90 : 0;
  }
}
