/**
 * Adapter zu clipper2-ts (Clipper2-Port, robuste Boolesche Operationen und Offset).
 * Hinweis: clipper2-js 1.2.4 war vorgesehen, ist aber defekt (PolyTree wirft intern) und zieht
 * Angular-Peer-Abhängigkeiten nach; clipper2-ts ist derselbe Algorithmus ohne Abhängigkeiten.
 * Koordinaten werden mit CLIPPER_SCALE auf Ganzzahlen gerundet (Raster 0,1 mm).
 * Bei 1 km Ausdehnung bleiben Koordinaten < 1e7 und Kreuzprodukte < 1e14, also exakt in double.
 */
import {
  Clipper64, ClipperOffset, ClipType, EndType, FillRule, JoinType, PolyTree64,
  type Path64, type Paths64, type PolyPath64,
} from "clipper2-ts";
import { withOrientation } from "./polygon";
import type { Polygon, Ring, Vec2 } from "./types";

/** Skalierung m → Clipper-Ganzzahl (1 Einheit = 0,1 mm). */
export const CLIPPER_SCALE = 1e4;

export type OffsetJoin = "miter" | "square" | "round";

export interface OffsetOptions {
  /** Eckverbindung; Standard "miter" (scharfe Ecken, wie Bauteilkanten). */
  readonly join?: OffsetJoin;
  /** Gehrungsgrenze als Vielfaches von |delta|; Standard 4 (ab ~29° Innenwinkel wird gekappt). */
  readonly miterLimit?: number;
  /** Max. Sehnenabweichung bei "round" in m; Standard 1 mm. */
  readonly arcTolerance?: number;
}

/** Vereinigung aller Polygone (a ∪ b). */
export function union(a: readonly Polygon[], b: readonly Polygon[] = []): Polygon[] {
  return boolean(ClipType.Union, a, b);
}

/** Differenz a \ b. */
export function difference(a: readonly Polygon[], b: readonly Polygon[]): Polygon[] {
  return boolean(ClipType.Difference, a, b);
}

/** Schnitt a ∩ b. */
export function intersection(a: readonly Polygon[], b: readonly Polygon[]): Polygon[] {
  return boolean(ClipType.Intersection, a, b);
}

/**
 * Parallelversatz um delta m: delta > 0 vergrößert (nach außen), delta < 0 verkleinert (nach innen).
 * Löcher verhalten sich gegenläufig (werden bei delta > 0 kleiner). Ergebnis ist vereinigt.
 */
export function offset(polys: readonly Polygon[], delta: number, opts: OffsetOptions = {}): Polygon[] {
  const join = opts.join ?? "miter";
  const co = new ClipperOffset(opts.miterLimit ?? 4, (opts.arcTolerance ?? 1e-3) * CLIPPER_SCALE);
  co.addPaths(toPaths(polys), JOIN[join], EndType.Polygon);
  const out: Paths64 = [];
  co.execute(delta * CLIPPER_SCALE, out);
  // Über Union in Polygonbaum überführen (Löcher zuordnen, Überlappungen auflösen).
  return fromTree(run(ClipType.Union, out, [], FillRule.Positive));
}

const JOIN: Record<OffsetJoin, JoinType> = {
  miter: JoinType.Miter, square: JoinType.Square, round: JoinType.Round,
};

function boolean(ct: ClipType, a: readonly Polygon[], b: readonly Polygon[]): Polygon[] {
  return fromTree(run(ct, toPaths(a), toPaths(b), FillRule.NonZero));
}

function run(ct: ClipType, subj: Paths64, clip: Paths64, fr: FillRule): PolyTree64 {
  const c = new Clipper64();
  c.addSubject(subj);
  if (clip.length > 0) c.addClip(clip);
  const tree = new PolyTree64();
  if (!c.execute(ct, fr, tree)) throw new Error("Clipper-Operation fehlgeschlagen");
  return tree;
}

/** Außenringe positiv, Löcher negativ orientieren, damit NonZero eindeutig ist. */
function toPaths(polys: readonly Polygon[]): Paths64 {
  const ps: Paths64 = [];
  for (const p of polys) {
    ps.push(toPath(withOrientation(p.outer, 1)));
    for (const h of p.holes) ps.push(toPath(withOrientation(h, -1)));
  }
  return ps;
}

function toPath(r: Ring): Path64 {
  return r.map((v) => ({ x: Math.round(v.x * CLIPPER_SCALE), y: Math.round(v.y * CLIPPER_SCALE) }));
}

function toRing(path: Path64): Vec2[] {
  return path.map((p) => ({ x: p.x / CLIPPER_SCALE, y: p.y / CLIPPER_SCALE }));
}

/** Polygonbaum → flache Liste (Inseln in Löchern werden eigene Polygone). */
function fromTree(tree: PolyTree64): Polygon[] {
  const out: Polygon[] = [];
  const visitOuter = (node: PolyPath64): void => {
    const holes: Ring[] = [];
    if (node.polygon) out.push({ outer: withOrientation(toRing(node.polygon), 1), holes });
    for (let i = 0; i < node.count; i++) {
      const h = node.child(i);
      if (h.polygon) holes.push(withOrientation(toRing(h.polygon), -1));
      for (let j = 0; j < h.count; j++) visitOuter(h.child(j));
    }
  };
  for (let i = 0; i < tree.count; i++) visitOuter(tree.child(i));
  return out;
}
