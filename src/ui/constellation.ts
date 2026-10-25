/**
 * Star layouts for worlds. Each world gets its own stable "constellation":
 * a meandering chain of points generated from its id, so it never changes
 * between visits but needs no hand-placed coordinates.
 */
export interface Point {
  x: number;
  y: number;
}

function seeded(text: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * `n` points in [0,1]², connected in order, kept apart by a minimum distance and
 * stretched to fill the box. `aspect` is height / width of the target area.
 */
export function constellation(id: string, n: number, aspect = 1): Point[] {
  const random = seeded(`constellation:${id}`);
  const minDist = 1.05 / Math.sqrt(n + 1);
  for (let attempt = 0; attempt < 200; attempt++) {
    const pts: Point[] = [{ x: 0, y: random() * aspect }];
    let heading = (random() - 0.5) * 1.2;
    let ok = true;
    for (let i = 1; i < n && ok; i++) {
      ok = false;
      for (let tries = 0; tries < 40; tries++) {
        const turn = heading + (random() - 0.5) * 2.2;
        const step = minDist * (1.05 + random() * 0.6);
        const p = { x: pts[i - 1].x + Math.cos(turn) * step, y: pts[i - 1].y + Math.sin(turn) * step * aspect };
        if (p.y < 0 || p.y > aspect) continue;
        if (pts.some((q) => Math.hypot(q.x - p.x, (q.y - p.y) / aspect) < minDist)) continue;
        pts.push(p);
        heading = turn * 0.6;
        ok = true;
        break;
      }
    }
    if (ok) return normalise(pts);
  }
  // Fallback: a gentle zig-zag.
  return normalise(Array.from({ length: n }, (_, i) => ({ x: i, y: i % 2 ? 1 : 0 })));
}

function normalise(pts: Point[]): Point[] {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return pts.map((p) => ({ x: x1 > x0 ? (p.x - x0) / (x1 - x0) : 0.5, y: y1 > y0 ? (p.y - y0) / (y1 - y0) : 0.5 }));
}

export interface SkyLayout {
  /** Star centres in pixels inside a box of `width` × `height`. */
  points: Point[];
  width: number;
  height: number;
}

/**
 * Readable star layout for a world view: stars snake through a grid sized to the
 * available space (row by row, alternating direction, so neighbours stay close and
 * lines never cross), each nudged by a stable random offset so it still looks like
 * a constellation. Cells are at least `minCell` wide/tall, so labels never collide;
 * if the space is too small the layout grows taller (the view scrolls).
 */
export function skyLayout(id: string, n: number, availW: number, availH: number, minCell = { w: 124, h: 116 }): SkyLayout {
  const random = seeded(`sky:${id}`);
  const maxCols = Math.max(1, Math.floor(availW / minCell.w));
  // Pick the column count whose cells come closest to square, within the limits.
  let best = { cols: 1, score: Infinity };
  for (let cols = 1; cols <= Math.min(maxCols, n); cols++) {
    const rows = Math.ceil(n / cols);
    const cw = availW / cols;
    const ch = Math.max(minCell.h, availH / rows);
    const score = Math.abs(Math.log(cw / ch)) + (rows * minCell.h > availH ? 1 : 0);
    if (score < best.score) best = { cols, score };
  }
  const cols = best.cols;
  const rows = Math.ceil(n / cols);
  const width = availW;
  const height = Math.max(availH, rows * minCell.h);
  const cw = width / cols;
  const ch = height / rows;
  const points: Point[] = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols);
    const inRow = Math.min(cols, n - row * cols);
    let col = i % cols;
    if (row % 2 === 1) col = inRow - 1 - col;
    // Centre a short last row.
    const offset = (cols - inRow) / 2;
    const jx = (random() - 0.5) * 0.36;
    const jy = (random() - 0.5) * 0.3;
    points.push({ x: (col + offset + 0.5 + jx) * cw, y: (row + 0.42 + jy) * ch });
  }
  return { points, width, height };
}
