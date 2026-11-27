/**
 * 3D-Netz (PLAN Schritt 27): Dachfläche aus den Facetten des Höhenfelds und Dämmplatten als Blöcke.
 * Rein geometrisch, Einheiten m; z nach oben, Überhöhung nur auf z (Basis = Tiefpunkt-Kote der Dachfläche).
 */
import { pointInPolygon, type Polygon, type Vec2 } from "../geometry/index";
import type { InsulationLayout } from "../layout/index";
import { hoeheDachflaeche, type DachGefaelle, type SlopeResult } from "../slope/index";

export interface Vec3 { readonly x: number; readonly y: number; readonly z: number }
export type FlaechenArt = "dach" | "platte" | "seite";
export interface Flaeche3 {
  readonly art: FlaechenArt;
  readonly outer: readonly Vec3[];
  readonly holes: readonly (readonly Vec3[])[];
  /** Index des Ablaufs innerhalb der Dachfläche (Farbe) bzw. −1. */
  readonly gruppe: number;
  readonly dachflaecheId: string;
  /** Nur Platten: Bezeichnung und Zusatzlagen. */
  readonly bezeichnung?: string;
  readonly zusatzlagen?: number;
  /** Nur Platten: Dämmdicke in der Plattenmitte (Einheit wie im Plan) – für die Tönung. */
  readonly dicke?: number;
  /** Nur Dach: je Kante des Außenrings true, wenn dahinter eine Facette derselben Ebene liegt (kein Knick, keine Linie). */
  readonly stumm?: readonly boolean[];
}

const hoch = (v: Vec2, z: number, ue: number, z0: number): Vec3 => ({ x: v.x, y: v.y, z: z0 + (z - z0) * ue });

function ringe(p: Polygon, z: (v: Vec2) => number, ue: number, z0: number) {
  return { outer: p.outer.map((v) => hoch(v, z(v), ue, z0)), holes: p.holes.map((r) => r.map((v) => hoch(v, z(v), ue, z0))) };
}

/** Dachoberfläche: je Facette eine ebene Fläche. */
export function meshDach(slope: SlopeResult, ueberhoehung = 1): Flaeche3[] {
  const out: Flaeche3[] = [];
  for (const g of slope.dachflaechen) {
    const z0 = g.tiefpunkt?.kote ?? 0;
    const ids = [...new Set(g.facetten.map((f) => f.ablaufId))];
    for (const f of g.facetten) {
      const e = f.ebene;
      const gleich = g.facetten.filter((o) => o !== f && o.zoneId === f.zoneId && Math.abs(o.ebene.a - e.a) <= 1e-9 && Math.abs(o.ebene.b - e.b) <= 1e-9 && Math.abs(o.ebene.c - e.c) <= 1e-9);
      const stumm = f.polygon.outer.map((a, i) => {
        const b = f.polygon.outer[(i + 1) % f.polygon.outer.length]!;
        const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        return gleich.some((o) => pointInPolygon(m, o.polygon) === "boundary");
      });
      out.push({ art: "dach", stumm, ...ringe(f.polygon, (v) => e.a * v.x + e.b * v.y + e.c, ueberhoehung, z0), gruppe: ids.indexOf(f.ablaufId), dachflaecheId: g.dachflaecheId });
    }
  }
  return out;
}

/** Basishöhe der Dämmung (flache Rohdecke): Oberfläche − Dicke, über die Platten der Dachfläche gemittelt. */
export function daemmBasis(g: DachGefaelle, plan: InsulationLayout["dachflaechen"][number]): number {
  let s = 0, n = 0;
  for (const p of plan.platten) {
    const v = p.polygon.outer[0]!;
    s += hoeheDachflaeche(g, v) - (p.dicke.a * v.x + p.dicke.b * v.y + p.dicke.c);
    n++;
  }
  return n > 0 ? s / n : 0;
}

function dickeMitte(p: { polygon: Polygon; dicke: { a: number; b: number; c: number } }): number {
  const o = p.polygon.outer, x = o.reduce((a, v) => a + v.x, 0) / o.length, y = o.reduce((a, v) => a + v.y, 0) / o.length;
  return p.dicke.a * x + p.dicke.b * y + p.dicke.c;
}

/** Dämmplatten als Blöcke: Oberseite in der Dickenebene, Seitenflächen bis zur flachen Basis. */
export function meshDaemmung(slope: SlopeResult, plan: InsulationLayout, ueberhoehung = 1): Flaeche3[] {
  const out: Flaeche3[] = [];
  for (const d of plan.dachflaechen) {
    const g = slope.dachflaechen.find((x) => x.dachflaecheId === d.dachflaecheId);
    if (!g) continue;
    const z0 = g.tiefpunkt?.kote ?? 0, basis = daemmBasis(g, d);
    for (const p of d.platten) {
      const top = (v: Vec2) => basis + p.dicke.a * v.x + p.dicke.b * v.y + p.dicke.c;
      const r = ringe(p.polygon, top, ueberhoehung, z0);
      const meta = { dachflaecheId: d.dachflaecheId, gruppe: -1, bezeichnung: p.bezeichnung, zusatzlagen: p.zusatzlagen, dicke: dickeMitte(p) };
      out.push({ art: "platte", ...r, ...meta });
      for (const ring of [p.polygon.outer, ...p.polygon.holes]) {
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
          out.push({ art: "seite", outer: [hoch(a, basis, ueberhoehung, z0), hoch(b, basis, ueberhoehung, z0), hoch(b, top(b), ueberhoehung, z0), hoch(a, top(a), ueberhoehung, z0)], holes: [], ...meta });
        }
      }
    }
  }
  return out;
}
