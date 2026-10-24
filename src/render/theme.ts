/** Visual tokens for the "soft night" look. A second theme only needs another object of this shape. */
export interface Theme {
  bgTop: string;
  bgBottom: string;
  board: string;
  boardEdge: string;
  gridDot: string;
  wall: string;
  wallEdge: string;
  wallTop: string;
  metal: string;
  metalDark: string;
  mirror: string;
  mirrorBack: string;
  glass: string;
  glassEdge: string;
  sink: string;
  sinkWell: string;
  sensor: string;
  sensorCalm: string;
  accent: string;
  select: string;
  invalid: string;
  /** Display colours for the R, G, B light channels (soft pastels). */
  channels: [[number, number, number], [number, number, number], [number, number, number]];
}

export const NIGHT: Theme = {
  bgTop: '#0d1230',
  bgBottom: '#1a1238',
  board: 'rgba(28, 34, 74, 0.55)',
  boardEdge: 'rgba(140, 150, 255, 0.10)',
  gridDot: 'rgba(170, 180, 255, 0.16)',
  wall: '#20264d',
  wallEdge: 'rgba(150, 160, 255, 0.18)',
  wallTop: '#2a3163',
  metal: '#5a6296',
  metalDark: '#2b3060',
  mirror: '#e9edff',
  mirrorBack: '#6670a8',
  glass: 'rgba(150, 200, 255, 0.16)',
  glassEdge: 'rgba(190, 225, 255, 0.75)',
  sink: '#ffd88f',
  sinkWell: '#141836',
  sensor: '#ff6f91',
  sensorCalm: '#8c7aa8',
  accent: '#a9b8ff',
  select: 'rgba(200, 210, 255, 0.85)',
  invalid: 'rgba(255, 120, 150, 0.8)',
  channels: [
    [255, 118, 140],
    [120, 255, 176],
    [128, 164, 255],
  ],
};

/** Map channel powers to a display colour (normalised so the brightest component is 255). */
export function lightColor(theme: Theme, c: readonly number[]): [number, number, number] {
  const ch = theme.channels;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < 3; i++) {
    r += c[i] * ch[i][0];
    g += c[i] * ch[i][1];
    b += c[i] * ch[i][2];
  }
  const m = Math.max(r, g, b, 1e-9);
  return [(r / m) * 255, (g / m) * 255, (b / m) * 255];
}

export const rgba = (c: readonly number[], a: number): string => `rgba(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0}, ${a.toFixed(3)})`;

/** Mask colour (e.g. a red sink) as a display colour. */
export function maskColor(theme: Theme, mask: readonly number[]): [number, number, number] {
  return mask[0] && mask[1] && mask[2] ? [255, 236, 190] : lightColor(theme, mask);
}
