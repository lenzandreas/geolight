/**
 * Reusable surface behaviours. Entity types compose these; new optical effects
 * (polarisers, diffraction gratings, portals...) are new functions here.
 */
import { mulRGB, scaleRGB, type RGB } from './color';
import { dot, normalize, perp, reflect, sub, type Vec } from './math';
import type { Entity, Hit, Interaction, Surface } from './types';

export const absorb: Interaction = () => {};

/** Unit normal of a segment surface (precomputed when available). */
export function surfaceNormal(s: Surface): Vec {
  if (s.normal) return s.normal;
  if (s.shape.kind === 'segment') return normalize(perp(sub(s.shape.b, s.shape.a)));
  throw new Error('surfaceNormal on non-flat surface');
}

/** Perfect two-sided mirror, optionally losing some power. */
export function mirror(reflectance = 1): Interaction {
  return (ray, hit, ctx) => {
    const n = surfaceNormal(hit.surface);
    ctx.emit(ray, hit.point, normalize(reflect(ray.d, n)), scaleRGB(ray.c, reflectance));
  };
}

/** Half-silvered mirror: part is reflected, the rest passes straight through. */
export function splitter(reflectRatio = 0.5): Interaction {
  return (ray, hit, ctx) => {
    const n = surfaceNormal(hit.surface);
    ctx.emit(ray, hit.point, normalize(reflect(ray.d, n)), scaleRGB(ray.c, reflectRatio));
    ctx.emit(ray, hit.point, ray.d, scaleRGB(ray.c, 1 - reflectRatio));
  };
}

/** Coloured filter: passes only the channels in `mask` (values 0..1 act as transmission). */
export function filter(mask: RGB): Interaction {
  return (ray, hit, ctx) => {
    ctx.emit(ray, hit.point, ray.d, mulRGB(ray.c, mask));
  };
}

/**
 * Ideal thin optic on a segment: rays crossing at offset h from the centre change
 * slope by −h/f (paraxial lens equation), so parallel light meets at distance f.
 * `reflective` turns it into an ideal curved mirror (concave for f > 0).
 * `frontOnly` makes the back side absorb (a mirror's dark backing).
 */
export function thinOptic(centre: Vec, tangent: Vec, normal: Vec, f: number, reflective: boolean, frontOnly: boolean): Interaction {
  return (ray, hit, ctx) => {
    const dn = dot(ray.d, normal);
    // The front faces +normal, so light from the front travels against it (dn < 0).
    if (frontOnly && dn > 0) return;
    const dt = dot(ray.d, tangent);
    const h = dot(sub(hit.point, centre), tangent);
    const absDn = Math.abs(dn) || 1e-9;
    const slope = dt / absDn - h / f;
    // Continue on the same side (lens) or bounce back (mirror) along the normal.
    const side = reflective ? -Math.sign(dn) : Math.sign(dn);
    const d = normalize({ x: normal.x * side + tangent.x * slope, y: normal.y * side + tangent.y * slope });
    ctx.emit(ray, hit.point, d, ray.c);
  };
}

/**
 * Refraction at the boundary of a closed transparent body. The surface normal must
 * point outward. `n` gives the refractive index per channel; if the channels differ
 * (dispersion) multi-channel rays are split into one ray per channel.
 */
export function refract(n: RGB): Interaction {
  const dispersive = n[0] !== n[1] || n[1] !== n[2];
  return (ray, hit, ctx) => {
    const outward = surfaceNormal(hit.surface);
    const c = ray.c;
    if (!dispersive) {
      refractOne(ray, hit, ctx, outward, n[1], c);
      return;
    }
    for (let ch = 0; ch < 3; ch++) {
      if (c[ch] <= 0) continue;
      const single: RGB = [0, 0, 0];
      single[ch] = c[ch];
      refractOne(ray, hit, ctx, outward, n[ch], single);
    }
  };
}

function refractOne(
  ray: Parameters<Interaction>[0],
  hit: Hit,
  ctx: Parameters<Interaction>[2],
  outward: Vec,
  index: number,
  c: RGB,
): void {
  const entering = dot(ray.d, outward) < 0;
  const nrm = entering ? outward : { x: -outward.x, y: -outward.y };
  const eta = entering ? 1 / index : index;
  const cosi = -dot(nrm, ray.d);
  const k = 1 - eta * eta * (1 - cosi * cosi);
  if (k < 0) {
    // Total internal reflection.
    ctx.emit(ray, hit.point, normalize(reflect(ray.d, nrm)), c);
    return;
  }
  const a = eta * cosi - Math.sqrt(k);
  ctx.emit(ray, hit.point, normalize({ x: ray.d.x * eta + nrm.x * a, y: ray.d.y * eta + nrm.y * a }), c);
}

/** Share of light a polarizer with axis `axis` lets through (Malus's law; half for unpolarized light). */
export function malus(pol: number | null | undefined, axis: number): number {
  if (pol === null || pol === undefined) return 0.5;
  const d = ((pol - axis) * Math.PI) / 180;
  return Math.cos(d) ** 2;
}

/**
 * Polarizing disc: light crosses the whole disc (any direction), leaving polarized
 * along `axis` with the power Malus's law allows.
 */
export function polarize(centre: Vec, axis: number): Interaction {
  return (ray, hit, ctx) => {
    // Exit point: the far intersection of the ray with the disc.
    const mx = hit.point.x - centre.x;
    const my = hit.point.y - centre.y;
    const b = mx * ray.d.x + my * ray.d.y;
    const chord = Math.max(0, -2 * b);
    const exit = { x: hit.point.x + ray.d.x * chord, y: hit.point.y + ray.d.y * chord };
    const k = malus(ray.pol, axis);
    if (k < 1e-6) return;
    ctx.emit(ray, exit, ray.d, scaleRGB(ray.c, k), axis);
  };
}

/** Wavelength in nanometres that stands for each light channel (red, green, blue). */
export const WAVELENGTH: RGB = [650, 530, 450];

/**
 * Transmission diffraction grating with `spacing` nanometres between lines. Light
 * leaves in three orders: straight on (m = 0, all colours together) and to either side
 * (m = ±1), where each colour follows the grating equation sin θ = sin θᵢ + m·λ/spacing,
 * so red turns the most. Each order carries a third of the light; an order that can't
 * exist (|sin θ| > 1) gives its share to the straight beam, so no light is lost.
 */
export function grating(spacing: number): Interaction {
  return (ray, hit, ctx) => {
    const n = surfaceNormal(hit.surface);
    const t = { x: -n.y, y: n.x };
    const side = Math.sign(dot(ray.d, n)) || 1;
    const along = dot(ray.d, t);
    const straight: RGB = [ray.c[0] / 3, ray.c[1] / 3, ray.c[2] / 3];
    for (let ch = 0; ch < 3; ch++) {
      if (ray.c[ch] <= 0) continue;
      for (const m of [-1, 1]) {
        const s = along + (m * WAVELENGTH[ch]) / spacing;
        if (Math.abs(s) >= 1) {
          straight[ch] += ray.c[ch] / 3;
          continue;
        }
        const c: RGB = [0, 0, 0];
        c[ch] = ray.c[ch] / 3;
        const k = Math.sqrt(1 - s * s) * side;
        ctx.emit(ray, hit.point, { x: n.x * k + t.x * s, y: n.y * k + t.y * s }, c);
      }
    }
    ctx.emit(ray, hit.point, ray.d, straight);
  };
}

/** Absorbs and reports light to the owning entity (sinks, sensors, solar cells...). */
export function receiver(entity: Entity): Interaction {
  return (ray, _hit, ctx) => ctx.receive(entity, ray.c, ray);
}
