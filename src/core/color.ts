/**
 * Light colour is modelled as power per spectral channel (R, G, B).
 * The total power of a ray is the sum of its channels. A white source of power 1
 * is [1/3, 1/3, 1/3]; a red source of power 1 is [1, 0, 0].
 *
 * Three channels keep the engine cheap. Should finer spectra be needed later, only
 * this module and the dispersive interactions have to change.
 */
export type RGB = [number, number, number];

export const CHANNELS = 3;

export const rgb = (r: number, g: number, b: number): RGB => [r, g, b];
export const black = (): RGB => [0, 0, 0];

export const power = (c: RGB): number => c[0] + c[1] + c[2];

export const scaleRGB = (c: RGB, s: number): RGB => [c[0] * s, c[1] * s, c[2] * s];
export const mulRGB = (a: RGB, b: RGB): RGB => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
export const addInto = (acc: RGB, c: RGB): void => {
  acc[0] += c[0];
  acc[1] += c[1];
  acc[2] += c[2];
};
export const dotRGB = (a: RGB, b: RGB): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Number of channels carrying meaningful power. */
export function activeChannels(c: RGB, eps = 1e-9): number {
  return (c[0] > eps ? 1 : 0) + (c[1] > eps ? 1 : 0) + (c[2] > eps ? 1 : 0);
}

/** Named colours usable in level files. Values are channel masks (spectral content). */
export const NAMED_COLORS: Record<string, RGB> = {
  white: [1, 1, 1],
  red: [1, 0, 0],
  green: [0, 1, 0],
  blue: [0, 0, 1],
  yellow: [1, 1, 0],
  cyan: [0, 1, 1],
  magenta: [1, 0, 1],
};

/** Resolve a level colour value (name or tuple) into a channel mask. */
export function resolveColor(value: unknown, fallback: RGB = [1, 1, 1]): RGB {
  if (typeof value === 'string' && NAMED_COLORS[value]) return [...NAMED_COLORS[value]] as RGB;
  if (Array.isArray(value) && value.length === 3 && value.every((v) => typeof v === 'number')) {
    return [value[0], value[1], value[2]];
  }
  return [...fallback] as RGB;
}

/** Turn a channel mask into an emitted spectrum of the given total power. */
export function spectrum(mask: RGB, totalPower: number): RGB {
  const p = power(mask);
  return p > 0 ? scaleRGB(mask, totalPower / p) : black();
}
