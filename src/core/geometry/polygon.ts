import { EPS } from "./eps";
import { distPointSegment } from "./segment";
import type { Polygon, Ring, Vec2 } from "./types";

/** Signierte Fläche (Shoelace) in m²; > 0 bei Orientierung gegen den Uhrzeigersinn. */
export function signedArea(ring: Ring): number {
  const n = ring.length;
  if (n < 3) return 0;
  // Bezug auf den ersten Punkt verringert Auslöschung bei großen Koordinaten.
  const o = ring[0]!;
  let s = 0;
  for (let i = 1; i < n - 1; i++) {
    const a = ring[i]!;
    const b = ring[i + 1]!;
    s += (a.x - o.x) * (b.y - o.y) - (b.x - o.x) * (a.y - o.y);
  }
  return s / 2;
}

/** Betrag der Fläche eines Rings in m². */
export function ringArea(ring: Ring): number {
  return Math.abs(signedArea(ring));
}

/** Fläche eines Polygons mit Löchern in m² (|außen| − Σ|Loch|). */
export function polygonArea(p: Polygon): number {
  let a = ringArea(p.outer);
  for (const h of p.holes) a -= ringArea(h);
  return a;
}

/** Orientierung: 1 = gegen den Uhrzeigersinn, −1 = im Uhrzeigersinn, 0 = entartet (|A| ≤ EPS). */
export function orientation(ring: Ring): -1 | 0 | 1 {
  const a = signedArea(ring);
  if (Math.abs(a) <= EPS) return 0;
  return a > 0 ? 1 : -1;
}

/** Ring mit gewünschter Orientierung (1 = CCW, −1 = CW); entartete Ringe unverändert. */
export function withOrientation(ring: Ring, dir: 1 | -1): Ring {
  const o = orientation(ring);
  return o === 0 || o === dir ? ring : [...ring].reverse();
}

export type PointLocation = "inside" | "outside" | "boundary";

/**
 * Lage eines Punkts zu einem Ring. Rand ist definiert: Abstand zu einer Kante ≤ EPS → "boundary".
 * Innen/außen per Strahlverfahren (halboffene Kanten, daher eindeutig auch an Ecken).
 */
export function pointInRing(p: Vec2, ring: Ring): PointLocation {
  const n = ring.length;
  if (n === 0) return "outside";
  for (let i = 0; i < n; i++) {
    if (distPointSegment(p, ring[i]!, ring[(i + 1) % n]!) <= EPS) return "boundary";
  }
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a.y > p.y !== b.y > p.y) {
      const x = a.x + ((p.y - a.y) * (b.x - a.x)) / (b.y - a.y);
      if (p.x < x) inside = !inside;
    }
  }
  return inside ? "inside" : "outside";
}

/** Lage eines Punkts zu einem Polygon mit Löchern (Lochrand zählt als Rand, Lochinneres als außen). */
export function pointInPolygon(p: Vec2, poly: Polygon): PointLocation {
  const o = pointInRing(p, poly.outer);
  if (o !== "inside") return o;
  for (const h of poly.holes) {
    const l = pointInRing(p, h);
    if (l === "boundary") return "boundary";
    if (l === "inside") return "outside";
  }
  return "inside";
}

/** Flächenschwerpunkt eines Rings; bei entarteter Fläche Mittel der Eckpunkte. */
export function ringCentroid(ring: Ring): Vec2 {
  const c = areaMoments(ring);
  if (Math.abs(c.a) <= EPS) return vertexMean(ring);
  return { x: c.mx / c.a, y: c.my / c.a };
}

/** Flächenschwerpunkt eines Polygons mit Löchern; bei entarteter Fläche Mittel der Außenecken. */
export function polygonCentroid(p: Polygon): Vec2 {
  const rings = [withOrientation(p.outer, 1), ...p.holes.map((h) => withOrientation(h, -1))];
  let a = 0, mx = 0, my = 0;
  for (const r of rings) {
    const m = areaMoments(r);
    a += m.a; mx += m.mx; my += m.my;
  }
  if (Math.abs(a) <= EPS) return vertexMean(p.outer);
  return { x: mx / a, y: my / a };
}

/** Signierte Fläche a und erste Momente (mx = ∫x dA, my = ∫y dA), relativ zum Ursprung. */
function areaMoments(ring: Ring): { a: number; mx: number; my: number } {
  const n = ring.length;
  if (n < 3) return { a: 0, mx: 0, my: 0 };
  // Lokaler Bezugspunkt für numerische Stabilität, danach zurückverschoben.
  const o = ring[0]!;
  let a = 0, cx = 0, cy = 0;
  for (let i = 1; i < n - 1; i++) {
    const p = ring[i]!, q = ring[i + 1]!;
    const px = p.x - o.x, py = p.y - o.y, qx = q.x - o.x, qy = q.y - o.y;
    const cr = px * qy - qx * py;
    a += cr;
    cx += (px + qx) * cr;
    cy += (py + qy) * cr;
  }
  a /= 2;
  return { a, mx: cx / 6 + o.x * a, my: cy / 6 + o.y * a };
}

function vertexMean(ring: Ring): Vec2 {
  if (ring.length === 0) return { x: 0, y: 0 };
  let x = 0, y = 0;
  for (const p of ring) { x += p.x; y += p.y; }
  return { x: x / ring.length, y: y / ring.length };
}
