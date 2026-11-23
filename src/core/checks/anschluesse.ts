/**
 * Anschlusshöhen (PLAN M9 Schritt 42, A11/A12): Anschlusslinien aus Attika (ganze Kante), Wandanschluss und
 * Türschwelle (Teilstrecken einer Konturkante) sowie Aufbau-Kontur (nur mit `oberkante`).
 *
 * OK fertige Oberfläche (A11) = h(x) (OK Abdichtung, Hauptfeld bzw. Zone) + LES-Keil (wo vorhanden) + Belagdicke
 * (Zone vor Dachfläche, Standard 0). `okFertigMax` ist das exakte Supremum entlang der Linie: Die Linie wird an
 * Zonen- und Keilrändern geteilt; je Teilstück ist das Feld h = min_i max_k L_ik stückweise linear, sein Maximum
 * liegt an den Teilstückenden oder an Schnittpunkten zweier Ebenen L_ik/L_jl (Facettengrenzen). Keil und Belag
 * sind je Teilstück linear bzw. konstant und ändern diese Knickstellen nicht. An Sprüngen (Zonenrand) zählt
 * der höhere einseitige Grenzwert. Sollwerte nur aus dem Regel-Pack (`anschlusshoehe`, barrierefreie Tür:
 * `barrierefrei-schwelle`). Rein und deterministisch.
 */
import { EPS } from "../geometry/eps";
import { pointInPolygon } from "../geometry/polygon";
import { dist, projectOnSegment, segmentIntersection } from "../geometry/segment";
import type { Polygon, Vec2 } from "../geometry/types";
import { belagDickeVon, konturKante, wandanschluesseVon } from "../model/model";
import type { Dachflaeche, Id, ProjectModel, Zone } from "../model/types";
import { findeRegelParameter, type RegelWert } from "../rules/regeln";
import type { RulePack } from "../rules/types";
import { quellLaenge } from "../slope/hoehenfeld";
import { hoeheDachflaeche } from "../slope/slope";
import type { DachGefaelle, Ebene, Hoehenfeld, SlopeResult } from "../slope/types";

const REGEL_ANSCHLUSSHOEHE = "anschlusshoehe";
const REGEL_BARRIEREFREI_SCHWELLE = "barrierefrei-schwelle";

export type AnschlussArt = "attika" | "wand" | "tuer" | "aufbau";

/** Regel und Parameter, aus denen `soll` stammt (auch wenn sie im Pack fehlen). */
export interface SollRegel { readonly regelId: string; readonly parameter: string }

export interface Anschluss {
  readonly objektId: Id;
  readonly dachflaecheId: Id;
  readonly art: AnschlussArt;
  /** Strecke mit der ungünstigsten Stelle (Aufbau: Konturkante mit dem Maximum). */
  readonly von: Vec2;
  readonly bis: Vec2;
  /** Ganze Anschlusslinie (Attika/Wand/Tür: [von, bis]; Aufbau: Kontur, geschlossen gedacht). */
  readonly linie: readonly Vec2[];
  /** Ungünstigste (höchste) Stelle der fertigen Oberfläche auf der Linie. */
  readonly ort: Vec2;
  /** OK fertige Oberfläche max (m). */
  readonly okFertigMax: number;
  /** OK Anschluss (m) oder null, wenn nicht eingegeben. */
  readonly oberkante: number | null;
  /** Anschlusshöhe = oberkante − okFertigMax (m) oder null ohne Oberkante. */
  readonly vorhanden: number | null;
  /** Mindest-Anschlusshöhe aus dem Pack (m) oder null, wenn die Regel fehlt. */
  readonly soll: number | null;
  /** okFertigMax + soll (m) oder null ohne Sollwert. */
  readonly erforderlicheOberkante: number | null;
  readonly regelId: string | null;
  readonly quelle: string | null;
  readonly sollRegel: SollRegel;
}

const quelleVon = (w: RegelWert) => (w.fundstelle ? `${w.quelle}, ${w.fundstelle}` : w.quelle);

/**
 * OK fertige Oberfläche (m) im Punkt p: h (Zone vor Hauptfeld) + LES-Keil + Belag. Punktweise Referenz zu
 * `computeAnschluesse` (Rand einer Zone bzw. eines Keils zählt zur Zone bzw. zum Keil). NaN ohne Abläufe.
 */
export function okFertigAm(d: Dachflaeche, g: DachGefaelle, p: Vec2): number {
  const zg = g.zonen.find((z) => z.polygone.some((poly) => pointInPolygon(p, poly) !== "outside"));
  const zone = zg ? d.zonen.find((z) => z.id === zg.zoneId) : undefined;
  let keil = 0;
  for (const k of g.les) {
    let best = -Infinity;
    for (const s of k.seiten) {
      if (s.flaechen.some((poly) => pointInPolygon(p, poly) !== "outside")) best = Math.max(best, wert(s.dicke, p));
    }
    if (best > -Infinity) keil += best;
  }
  return hoeheDachflaeche(g, p) + keil + belagDickeVon(d, zone);
}

export function computeAnschluesse(m: ProjectModel, s: SlopeResult, packs: readonly RulePack[]): Anschluss[] {
  const out: Anschluss[] = [];
  const soll = (regelId: string, parameter: string) => {
    const w = findeRegelParameter(packs, regelId, parameter);
    return { w, sollRegel: { regelId, parameter } };
  };
  for (const d of m.dachflaechen) {
    const g = s.dachflaechen.find((x) => x.dachflaecheId === d.id);
    if (!g || g.feld.quellen.length === 0) continue; // ohne Höhenquelle keine Oberfläche
    const sm = new Strecken(d, g);
    const baue = (objektId: Id, art: AnschlussArt, linie: readonly Vec2[], geschlossen: boolean, oberkante: number | undefined,
      r: { w: RegelWert | null; sollRegel: SollRegel }) => {
      let best: { h: number; ort: Vec2; von: Vec2; bis: Vec2 } | null = null;
      const n = geschlossen ? linie.length : linie.length - 1;
      for (let i = 0; i < n; i++) {
        const a = linie[i]!, b = linie[(i + 1) % linie.length]!;
        const x = sm.maximum(a, b);
        if (!best || x.h > best.h) best = { ...x, von: a, bis: b };
      }
      if (!best) return;
      const ok = oberkante ?? null, w = r.w;
      out.push({
        objektId, dachflaecheId: d.id, art, von: best.von, bis: best.bis, linie, ort: best.ort, okFertigMax: best.h,
        oberkante: ok, vorhanden: ok === null ? null : ok - best.h, soll: w?.wert ?? null,
        erforderlicheOberkante: w ? best.h + w.wert : null, regelId: w?.regelId ?? null, quelle: w ? quelleVon(w) : null,
        sollRegel: r.sollRegel,
      });
    };

    for (const a of d.attika) {
      const k = konturKante(d.kontur, a.kante);
      if (k) baue(a.id, "attika", [pt(k[0]), pt(k[1])], false, a.oberkante, soll(REGEL_ANSCHLUSSHOEHE, "attikaMin"));
    }
    for (const wa of wandanschluesseVon(d)) {
      const t = teilstrecke(d, wa.lage.kante, wa.lage.abstand, wa.laenge);
      if (t) baue(wa.id, "wand", t, false, wa.oberkante, soll(REGEL_ANSCHLUSSHOEHE, "wandMin"));
    }
    for (const t of d.tuerschwellen) {
      const st = teilstrecke(d, t.lage.kante, t.lage.abstand, t.breite);
      if (!st) continue;
      const r = t.barrierefrei ? soll(REGEL_BARRIEREFREI_SCHWELLE, "anschlusshoeheMin")
        : soll(REGEL_ANSCHLUSSHOEHE, t.rinne ? "tuerMitRinneMin" : "tuerMin");
      baue(t.id, "tuer", st, false, t.oberkante, r);
    }
    for (const au of d.aufbauten) {
      if (au.oberkante === undefined || au.kontur.length < 2) continue; // R14: ohne OK keine Prüfung
      baue(au.id, "aufbau", au.kontur.map(pt), true, au.oberkante, soll(REGEL_ANSCHLUSSHOEHE, "aufbauMin"));
    }
  }
  return out;
}

const pt = (p: Vec2): Vec2 => ({ x: p.x, y: p.y });
const wert = (e: Ebene, p: Vec2) => e.a * p.x + e.b * p.y + e.c;

/** Teilstrecke [abstand, abstand + laenge] einer Konturkante, auf die Kante begrenzt; null wenn leer. */
function teilstrecke(d: Dachflaeche, kante: Id, abstand: number, laenge: number): [Vec2, Vec2] | null {
  const k = konturKante(d.kontur, kante);
  if (!k) return null;
  const len = dist(k[0], k[1]);
  if (!(len > EPS)) return null;
  const u = { x: (k[1].x - k[0].x) / len, y: (k[1].y - k[0].y) / len };
  const s0 = Math.max(0, abstand), s1 = Math.min(len, abstand + laenge);
  if (!(s1 - s0 > EPS)) return null;
  return [{ x: k[0].x + u.x * s0, y: k[0].y + u.y * s0 }, { x: k[0].x + u.x * s1, y: k[0].y + u.y * s1 }];
}

/** Gerade a + b·t über dem Streckenparameter t ∈ [0, 1]. */
interface Lin { readonly a: number; readonly b: number }
const T_TOL = 1e-12;

/** Exakte Maximumsuche der fertigen Oberfläche auf Strecken einer Dachfläche. */
class Strecken {
  private readonly zonen: { readonly zg: DachGefaelle["zonen"][number]; readonly belag: number }[];
  private readonly belagDach: number;
  /** Alle Ränder, an denen die Oberfläche springen oder die Formel wechseln kann. */
  private readonly raender: readonly Polygon[];

  constructor(d: Dachflaeche, private readonly g: DachGefaelle) {
    this.zonen = g.zonen.map((zg) => ({ zg, belag: belagDickeVon(d, d.zonen.find((z: Zone) => z.id === zg.zoneId)) }));
    this.belagDach = belagDickeVon(d);
    this.raender = [...g.zonen.flatMap((z) => z.polygone), ...g.les.flatMap((k) => k.seiten.flatMap((s) => s.flaechen))];
  }

  maximum(a: Vec2, b: Vec2): { h: number; ort: Vec2 } {
    const e = { x: b.x - a.x, y: b.y - a.y };
    const at = (t: number): Vec2 => ({ x: a.x + t * e.x, y: a.y + t * e.y });
    const ts = this.teilung(a, b);
    let best = { h: -Infinity, t: 0 };
    for (let i = 0; i + 1 < ts.length; i++) {
      const t0 = ts[i]!, t1 = ts[i + 1]!;
      const mitte = at((t0 + t1) / 2);
      // Bereich des Teilstücks: Zone (erste, die die Mitte enthält) oder Hauptfeld
      const z = this.zonen.find((x) => x.zg.polygone.some((poly) => pointInPolygon(mitte, poly) !== "outside"));
      const feld = z ? z.zg.feld : this.g.feld;
      // Zusatz (linear in t): Belag + Keilebenen, die die Mitte enthalten
      let za = z ? z.belag : this.belagDach, zb = 0;
      for (const k of this.g.les) {
        let wahl: Ebene | null = null, wm = -Infinity;
        for (const s of k.seiten) {
          if (!s.flaechen.some((poly) => pointInPolygon(mitte, poly) !== "outside")) continue;
          const w = wert(s.dicke, mitte);
          if (w > wm) { wm = w; wahl = s.dicke; }
        }
        if (wahl) { za += wert(wahl, a); zb += wahl.a * e.x + wahl.b * e.y; }
      }
      const x = feldMaximum(feld, a, e, t0, t1);
      // Zusatz ist linear: Kandidaten genügen, Endpunkte sind darin enthalten
      for (const t of x) {
        const h = x.wert(t) + za + zb * t;
        if (h > best.h + T_TOL) best = { h, t };
      }
    }
    return { h: best.h, ort: at(best.t) };
  }

  /** Sortierte Parameter 0 … 1 mit allen Schnitten der Strecke mit Zonen- und Keilrändern. */
  private teilung(a: Vec2, b: Vec2): number[] {
    const ts = [0, 1];
    const len = dist(a, b);
    for (const poly of this.raender) {
      for (const ring of [poly.outer, ...poly.holes]) {
        for (let i = 0; i < ring.length; i++) {
          const c = ring[i]!, dd = ring[(i + 1) % ring.length]!;
          const s = segmentIntersection(a, b, c, dd);
          if (s.kind === "point") ts.push(s.t);
          else if (s.kind === "overlap" && len > EPS) ts.push(projectOnSegment(s.from, a, b), projectOnSegment(s.to, a, b));
        }
      }
    }
    const sortiert = ts.map((t) => Math.min(1, Math.max(0, t))).sort((x, y) => x - y);
    const out: number[] = [];
    for (const t of sortiert) if (out.length === 0 || t - out[out.length - 1]! > T_TOL) out.push(t);
    if (out[out.length - 1]! < 1) out.push(1);
    return out;
  }
}

/** Kandidaten-Parameter für das Maximum von h = min_i max_k L_ik auf [t0, t1] samt Auswertung. */
interface Kandidaten extends Iterable<number> { wert(t: number): number }

function feldMaximum(f: Hoehenfeld, a: Vec2, e: Vec2, t0: number, t1: number): Kandidaten {
  // Je Quelle vier Geraden (Pyramidenseiten) über t
  const quellen: Lin[][] = f.quellen.map((q) => {
    const dx = a.x - q.position.x, dy = a.y - q.position.y, ax = q.achse;
    const tt0 = dx * ax.x + dy * ax.y, tt1 = e.x * ax.x + e.y * ax.y;
    const v0 = -dx * ax.y + dy * ax.x, v1 = -e.x * ax.y + e.y * ax.x;
    const s = f.gefaelle, L = quellLaenge(q);
    return [
      { a: q.z + s * (tt0 - L), b: s * tt1 }, { a: q.z + s * v0, b: s * v1 },
      { a: q.z - s * tt0, b: -s * tt1 }, { a: q.z - s * v0, b: -s * v1 },
    ];
  });
  const g = (ls: readonly Lin[], t: number) => { let h = -Infinity; for (const l of ls) h = Math.max(h, l.a + l.b * t); return h; };
  const schnitte = (ls: readonly Lin[], ms: readonly Lin[], out: number[]) => {
    for (const l of ls) for (const m of ms) {
      const db = l.b - m.b;
      if (Math.abs(db) <= T_TOL) continue;
      const t = (m.a - l.a) / db;
      if (t > t0 && t < t1) out.push(t);
    }
  };
  // Eigene Knicke je Quelle; Quellen, die nie das Minimum bilden können, entfallen (g_j ≥ m_j > U ≥ h)
  const eigene = quellen.map((ls) => { const k = [t0, t1]; schnitte(ls, ls, k); return k; });
  let U = Infinity;
  for (const ls of quellen) U = Math.min(U, Math.max(g(ls, t0), g(ls, t1))); // g konvex: Max an den Enden
  const aktiv: number[] = [];
  quellen.forEach((ls, i) => { if (Math.min(...eigene[i]!.map((t) => g(ls, t))) <= U + T_TOL) aktiv.push(i); });
  const ts: number[] = [t0, t1];
  for (const i of aktiv) ts.push(...eigene[i]!);
  for (let x = 0; x < aktiv.length; x++) for (let y = x + 1; y < aktiv.length; y++) schnitte(quellen[aktiv[x]!]!, quellen[aktiv[y]!]!, ts);
  ts.sort((p, q) => p - q);
  const wertFn = (t: number) => { let h = Infinity; for (const i of aktiv) h = Math.min(h, g(quellen[i]!, t)); return h; };
  return { [Symbol.iterator]: () => ts[Symbol.iterator](), wert: wertFn };
}
