import { EPS } from "./eps";
import type { Vec2 } from "./types";

/** Kreuzprodukt (b − a) × (c − a); > 0 wenn c links von a→b liegt. */
export function cross(a: Vec2, b: Vec2, c: Vec2): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/** Euklidischer Abstand in m. */
export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Parameter t ∈ [0,1] des nächsten Punkts auf Segment a–b (0 bei entartetem Segment). */
export function projectOnSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 <= EPS * EPS) return 0;
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** Nächster Punkt auf Segment a–b zu p. */
export function closestPointOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const t = projectOnSegment(p, a, b);
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
}

/** Abstand Punkt–Segment in m. */
export function distPointSegment(p: Vec2, a: Vec2, b: Vec2): number {
  return dist(p, closestPointOnSegment(p, a, b));
}

export type SegmentIntersection =
  | { readonly kind: "none" }
  /** Einzelner Schnittpunkt; t auf a–b, u auf c–d (je ∈ [0,1]). */
  | { readonly kind: "point"; readonly point: Vec2; readonly t: number; readonly u: number }
  /** Kollineare Überlappung von `from` bis `to` (in Richtung a→b). */
  | { readonly kind: "overlap"; readonly from: Vec2; readonly to: Vec2 };

/**
 * Schnitt der Segmente a–b und c–d mit Toleranz EPS (Berührung an Endpunkten zählt als Schnitt).
 * Deterministisch; parallele Segmente mit Abstand > EPS schneiden sich nicht.
 */
export function segmentIntersection(a: Vec2, b: Vec2, c: Vec2, d: Vec2): SegmentIntersection {
  const rx = b.x - a.x, ry = b.y - a.y;
  const sx = d.x - c.x, sy = d.y - c.y;
  const rl = Math.hypot(rx, ry), sl = Math.hypot(sx, sy);
  const den = rx * sy - ry * sx;

  // Parallel/kollinear (auch entartete Segmente): Sinus des Winkels ≈ 0.
  if (rl <= EPS || sl <= EPS || Math.abs(den) <= EPS * rl * sl) {
    return parallelCase(a, b, c, d, rl, sl);
  }
  const qx = c.x - a.x, qy = c.y - a.y;
  let t = (qx * sy - qy * sx) / den;
  let u = (qx * ry - qy * rx) / den;
  // Toleranz in Längeneinheiten auf die Parameter übertragen.
  const et = EPS / rl, eu = EPS / sl;
  if (t < -et || t > 1 + et || u < -eu || u > 1 + eu) return { kind: "none" };
  t = clamp01(t); u = clamp01(u);
  return { kind: "point", point: { x: a.x + t * rx, y: a.y + t * ry }, t, u };
}

function parallelCase(a: Vec2, b: Vec2, c: Vec2, d: Vec2, rl: number, sl: number): SegmentIntersection {
  if (rl <= EPS && sl <= EPS) {
    return dist(a, c) <= EPS ? { kind: "point", point: a, t: 0, u: 0 } : { kind: "none" };
  }
  if (rl <= EPS) {
    return distPointSegment(a, c, d) <= EPS
      ? { kind: "point", point: a, t: 0, u: projectOnSegment(a, c, d) } : { kind: "none" };
  }
  if (sl <= EPS) {
    return distPointSegment(c, a, b) <= EPS
      ? { kind: "point", point: c, t: projectOnSegment(c, a, b), u: 0 } : { kind: "none" };
  }
  // Abstand der Trägergeraden.
  if (Math.abs(cross(a, b, c)) / rl > EPS) return { kind: "none" };
  const rx = b.x - a.x, ry = b.y - a.y, l2 = rl * rl;
  const tc = ((c.x - a.x) * rx + (c.y - a.y) * ry) / l2;
  const td = ((d.x - a.x) * rx + (d.y - a.y) * ry) / l2;
  const lo = Math.max(0, Math.min(tc, td));
  const hi = Math.min(1, Math.max(tc, td));
  const e = EPS / rl;
  if (hi < lo - e) return { kind: "none" };
  const at = (t: number): Vec2 => ({ x: a.x + t * rx, y: a.y + t * ry });
  if (hi - lo <= e) {
    const t = clamp01((lo + hi) / 2);
    const p = at(t);
    return { kind: "point", point: p, t, u: projectOnSegment(p, c, d) };
  }
  return { kind: "overlap", from: at(lo), to: at(hi) };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
