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
