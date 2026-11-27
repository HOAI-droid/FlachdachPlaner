/**
 * Geodätischer Abstand um reflexe Konturecken (PLAN R5). Bei L-/U-Formen läuft die Luftlinie d(x, E)
 * teils außerhalb der Dachkontur. Maßgebend ist der kürzeste Weg innerhalb der Kontur: Punkte, die E nicht
 * sieht („Tasche“ hinter einer reflexen Ecke c), erreichen E über c, d = d(x, c) + d(c, E) (rekursiv über
 * weitere Ecken). Das gilt für jede Norm, also auch für die Maximumsnorm der Quelle: Jeder Weg in die
 * Tasche kreuzt deren Fenster (Strahl E→c hinter c), und auf diesem Strahl ist d(E, y) = d(E, c) + d(c, y).
 * Am Fenster sind beide Formeln gleich (stetig). Nur die Außenkontur zählt (Aufbauten bleiben wie bisher
 * durchlässig), nur Punktquellen (Strecken: LES, verbundene Gullys, Dachreiter mit Öffnung unverändert).
 * Ergebnis je Quelle: ein Baum von Taschen; slope.ts schaltet nur Taschen zu, die das Feld wirklich ändern.
 */
import { difference, union } from "../geometry/clipper";
import { EPS } from "../geometry/eps";
import { pointInRing, signedArea } from "../geometry/polygon";
import { distPointSegment } from "../geometry/segment";
import type { Polygon, Ring, Vec2 } from "../geometry/types";
import { quellAbstand, quellLaenge } from "./hoehenfeld";
import { istSplitter } from "./quellen";
import type { Hoehenquelle } from "./types";

/** Tasche hinter der reflexen Ecke `ecke`: dort gilt d = weg + d(x, ecke), soweit `sicht`; dahinter `kinder`. */
export interface Tasche {
  readonly ecke: Vec2;
  /** Geodätischer Abstand Ecke–Quelle (m, Maß der Quelle). */
  readonly weg: number;
  /** Ganze Tasche (Fensterseite bis Kontur). */
  readonly flaeche: readonly Polygon[];
  /** Von der Ecke aus sichtbarer Teil der Tasche. */
  readonly sicht: readonly Polygon[];
  readonly kinder: readonly Tasche[];
}

/** Lagetoleranz für „Ecke liegt auf dem Taschenrand“ (Clipper-Raster 0,1 mm, mit Reserve). */
const RAND_TOL = 1e-3;

/** Reflexe Ecken des Rings (Innenwinkel > 180°). */
export function reflexeEcken(r: Ring): Vec2[] {
  const o = Math.sign(signedArea(r));
  if (o === 0) return [];
  const out: Vec2[] = [];
  for (let i = 0; i < r.length; i++) {
    const a = r[(i + r.length - 1) % r.length]!, b = r[i]!, c = r[(i + 1) % r.length]!;
    const k = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (k * o < -EPS * Math.hypot(b.x - a.x, b.y - a.y) * Math.hypot(c.x - b.x, c.y - b.y)) out.push(b);
  }
  return out;
}

/** Strecke a–b verläuft innerhalb des Rings (Rand zählt als innen). */
function sichtbar(a: Vec2, b: Vec2, r: Ring): boolean {
  const kreuz = (p: Vec2, q: Vec2, s: Vec2) => (q.x - p.x) * (s.y - p.y) - (q.y - p.y) * (s.x - p.x);
  const l = Math.hypot(b.x - a.x, b.y - a.y);
  for (let i = 0; i < r.length; i++) {
    const p = r[i]!, q = r[(i + 1) % r.length]!;
    const lk = Math.hypot(q.x - p.x, q.y - p.y);
    const o1 = kreuz(a, b, p) / l, o2 = kreuz(a, b, q) / l, o3 = kreuz(p, q, a) / lk, o4 = kreuz(p, q, b) / lk;
    if (((o1 > EPS && o2 < -EPS) || (o1 < -EPS && o2 > EPS)) && ((o3 > EPS && o4 < -EPS) || (o3 < -EPS && o4 > EPS))) return false;
  }
  // Durchgang durch eine Ecke nach außen: Stichproben entlang der Strecke.
  for (let k = 1; k < 16; k++) {
    const p = { x: a.x + ((b.x - a.x) * k) / 16, y: a.y + ((b.y - a.y) * k) / 16 };
    if (pointInRing(p, r) === "outside") return false;
  }
  return true;
}

/**
 * Von a aus sichtbarer Teil von `gebiet` (Hindernisse: Kanten des Rings). Hinter jeder Kante liegt ihr
 * Schattenviereck (Kante, verlängert auf den Strahlen von a durch ihre Enden); Sicht = gebiet ohne Schatten.
 */
function sichtVon(a: Vec2, r: Ring, gebiet: readonly Polygon[], weit: number): Polygon[] {
  const schatten: Polygon[] = [];
  for (let i = 0; i < r.length; i++) {
    const p = r[i]!, q = r[(i + 1) % r.length]!;
    const lp = Math.hypot(p.x - a.x, p.y - a.y), lq = Math.hypot(q.x - a.x, q.y - a.y);
    if (lp <= EPS || lq <= EPS) continue;
    const k = (p.x - a.x) * (q.y - a.y) - (p.y - a.y) * (q.x - a.x);
    if (Math.abs(k) <= EPS * Math.hypot(q.x - p.x, q.y - p.y)) continue; // streifend: kein Schatten
    const pw = { x: p.x + (weit * (p.x - a.x)) / lp, y: p.y + (weit * (p.y - a.y)) / lp };
    const qw = { x: q.x + (weit * (q.x - a.x)) / lq, y: q.y + (weit * (q.y - a.y)) / lq };
    schatten.push({ outer: k > 0 ? [p, q, qw, pw] : [q, p, pw, qw], holes: [] });
  }
  return schatten.length === 0 ? [...gebiet] : difference(gebiet, union(schatten));
}

/** Abstand im Maß der Quelle (Maximumsnorm in deren Achse) zwischen zwei Punkten. */
const abstand = (q: Hoehenquelle, von: Vec2, bis: Vec2) => quellAbstand({ ...q, position: von, bis: von }, bis);

/**
 * Taschenbaum der Punktquelle q in der Kontur r (leer bei Strecken, konvexen Konturen oder wenn q alles sieht).
 * Jede Tasche ist ein zusammenhängendes, von q unsichtbares Gebiet; ihre Ecke ist die nächstgelegene von q
 * sichtbare reflexe Ecke auf ihrem Rand (Fensteranfang).
 */
export function taschenBaum(q: Hoehenquelle, r: Ring): Tasche[] {
  if (quellLaenge(q) > EPS) return [];
  const ecken = reflexeEcken(r);
  if (ecken.length === 0) return [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of r) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  const weit = 4 * Math.hypot(x1 - x0, y1 - y0) + 1;
  const kontur: Polygon[] = [{ outer: r, holes: [] }];

  const taschen = (anker: Vec2, weg: number, gebiet: readonly Polygon[], sicht: readonly Polygon[], tiefe: number): Tasche[] => {
    if (tiefe > ecken.length) return [];
    const out: Tasche[] = [];
    for (const t of difference(gebiet, sicht).filter((p) => !istSplitter(p))) {
      const amRand = (e: Vec2) => [t.outer, ...t.holes].some((ring) =>
        ring.some((v, i) => distPointSegment(e, v, ring[(i + 1) % ring.length]!) <= RAND_TOL));
      let ecke: Vec2 | null = null, best = Infinity;
      for (const e of ecken) {
        const d = Math.hypot(e.x - anker.x, e.y - anker.y);
        if (d <= EPS || d >= best || !amRand(e) || !sichtbar(anker, e, r)) continue;
        ecke = e; best = d;
      }
      if (!ecke) continue; // ohne Fensterecke (Rundungsrest): Tasche bleibt beim Anker
      const w = weg + abstand(q, anker, ecke);
      const s = sichtVon(ecke, r, [t], weit);
      out.push({ ecke, weg: w, flaeche: [t], sicht: s, kinder: taschen(ecke, w, [t], s, tiefe + 1) });
    }
    return out;
  };
  return taschen(q.position, 0, kontur, sichtVon(q.position, r, kontur, weit), 1);
}

/** Alle Taschen des Teilbaums (die Tasche selbst zuerst). */
export function teilbaum(t: Tasche): Tasche[] {
  return [t, ...t.kinder.flatMap(teilbaum)];
}
