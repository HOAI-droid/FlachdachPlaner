/**
 * computeCatchments (PLAN Schritt 7): Einzugsflächen = Zellen des Höhenfelds je Ablauf (Vereinigung
 * seiner Facetten aus computeSlope; diese sind bereits an Kontur und Aufbauten geschnitten).
 * Verbundene Gullys (eine Quelle A–B): Zelle an der Mittelsenkrechten von A–B auf A und B geteilt.
 * Attika: Streifen Länge × Breite (Horizontalprojektion) je Kantenabschnitt, dem Ablauf der dort
 * angrenzenden Zelle zugeschlagen; zählt für die Flächengrenze, nie für Gefälle/Dämmung.
 * Färbung: Greedy in Smallest-Last-Reihenfolge, Nachbarn (gemeinsame Kante) nie gleich.
 * Grenzwerte nur aus dem Regel-Pack. Rein und deterministisch.
 */
import { intersection, union } from "../geometry/clipper";
import { EPS } from "../geometry/eps";
import { pointInPolygon, polygonArea, signedArea } from "../geometry/polygon";
import { distPointSegment } from "../geometry/segment";
import type { Polygon, Ring, Vec2 } from "../geometry/types";
import { konturKante } from "../model/model";
import type { Dachflaeche, ProjectModel } from "../model/types";
import { bewerteEinzugsflaeche } from "../rules/regeln";
import type { DachGefaelle, SlopeResult } from "../slope/types";
import type {
  AttikaAnteil, CatchmentHinweis, CatchmentOptionen, CatchmentResult, Einzugsflaeche,
} from "./types";

/** Anzahl der Flächenfarben (Palette DESIGN.md). */
export const FARBEN_ANZAHL = 12;

/** Lagetoleranz für Kantenbezüge in m (Clipper-Raster 0,1 mm, mit Reserve). */
const TOL = 1e-3;
/** Prüfabstand ins Dachinnere für die Zuordnung eines Attikaabschnitts in m. */
const PROBE = 1e-2;

interface Zelle {
  readonly id: string;
  readonly dachflaecheId: string;
  readonly ablaufId: string;
  readonly polygone: Polygon[];
  readonly dachFlaeche: number;
  readonly attika: AttikaAnteil[];
}

export function computeCatchments(m: ProjectModel, slope: SlopeResult, opt: CatchmentOptionen = {}): CatchmentResult {
  const hinweise: CatchmentHinweis[] = [];
  const zellen: Zelle[] = [];
  for (const d of m.dachflaechen) {
    const g = slope.dachflaechen.find((x) => x.dachflaecheId === d.id);
    const eigene = g ? zellenAus(d, g) : [];
    attikaZuschlagen(d, eigene, hinweise);
    zellen.push(...eigene);
  }
  const nachbarn = nachbarPaare(zellen);
  const farben = faerben(zellen.length, nachbarn, (i) =>
    hinweise.push({ code: "farben-erschoepft", dachflaecheId: zellen[i]!.dachflaecheId, objektId: zellen[i]!.ablaufId,
      meldung: `Mehr als ${FARBEN_ANZAHL - 1} Nachbarn; Farbe wiederholt sich.` }));

  if (opt.regeln && zellen.length > 0 && bewerteEinzugsflaeche(0, opt.regeln) === null) {
    hinweise.push({ code: "regel-fehlt", dachflaecheId: zellen[0]!.dachflaecheId,
      meldung: `Regel „flaeche-je-ablauf“ fehlt im Pack ${opt.regeln.id}; Flächen nicht bewertet.` });
  }
  const flaechen: Einzugsflaeche[] = zellen.map((z, i) => {
    const attikaFlaeche = z.attika.reduce((s, a) => s + a.flaeche, 0);
    const gesamtFlaeche = z.dachFlaeche + attikaFlaeche;
    const bewertung = opt.regeln ? bewerteEinzugsflaeche(gesamtFlaeche, opt.regeln) : null;
    if (bewertung && bewertung.stufe !== "ok" && opt.regeln) {
      const nurDach = bewerteEinzugsflaeche(z.dachFlaeche, opt.regeln)!;
      const grenze = bewertung.stufe === "fehler" ? bewertung.fehlerUeber : bewertung.hinweisAb;
      hinweise.push({
        code: "flaeche-je-ablauf", dachflaecheId: z.dachflaecheId, objektId: z.ablaufId, stufe: bewertung.stufe,
        durchAttika: nurDach.stufe !== bewertung.stufe, regelId: grenze.regelId, quelle: grenze.quelle,
        meldung: `Einzugsfläche ${z.ablaufId}: ${gesamtFlaeche.toFixed(2)} m² (Dach ${z.dachFlaeche.toFixed(2)} + Attika ${attikaFlaeche.toFixed(2)}), Grenze ${grenze.wert} m².`,
      });
    }
    return {
      id: z.id, dachflaecheId: z.dachflaecheId, ablaufId: z.ablaufId, polygone: z.polygone,
      dachFlaeche: z.dachFlaeche, attikaFlaeche, gesamtFlaeche, attika: z.attika, farbe: farben[i]!, bewertung,
    };
  });
  return { flaechen, nachbarn: nachbarn.map(([a, b]) => [zellen[a]!.id, zellen[b]!.id] as const), hinweise };
}

// ---------- Zellen ----------

/** Halbebene diesseits (vz = −1, Seite `a`) bzw. jenseits (+1) der Mittelsenkrechten von a–b, groß genug für `ps`. */
function halbebene(a: Vec2, b: Vec2, vz: 1 | -1, ps: readonly Polygon[]): Polygon {
  const pts = ps.flatMap((p) => p.outer);
  const r = 2 * Math.max(1, ...pts.map((p) => Math.hypot(p.x - a.x, p.y - a.y)));
  const l = Math.hypot(b.x - a.x, b.y - a.y), u = { x: (b.x - a.x) / l, y: (b.y - a.y) / l }, n = { x: -u.y, y: u.x };
  const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const at = (s: number, t: number) => ({ x: m.x + s * u.x + t * n.x, y: m.y + s * u.y + t * n.y });
  const outer = vz === 1 ? [at(0, -r), at(r, -r), at(r, r), at(0, r)] : [at(0, r), at(-r, r), at(-r, -r), at(0, -r)];
  return { outer, holes: [] };
}

function zellenAus(d: Dachflaeche, g: DachGefaelle): Zelle[] {
  const zelle = (ablaufId: string, polygone: Polygon[]): Zelle => ({
    id: `${d.id}/${ablaufId}`, dachflaecheId: d.id, ablaufId, polygone,
    dachFlaeche: polygone.reduce((s, p) => s + polygonArea(p), 0), attika: [],
  });
  const out: Zelle[] = [];
  for (const q of g.feld.quellen) {
    if (out.some((z) => z.ablaufId === q.ablaufId)) continue;
    const teile = g.facetten.filter((f) => f.ablaufId === q.ablaufId).map((f) => f.polygon);
    const polygone = teile.length > 0 ? union(teile) : [];
    if (q.partnerId === undefined) { out.push(zelle(q.ablaufId, polygone)); continue; }
    out.push(zelle(q.ablaufId, intersection(polygone, [halbebene(q.position, q.bis, -1, polygone)])));
    out.push(zelle(q.partnerId, intersection(polygone, [halbebene(q.position, q.bis, 1, polygone)])));
  }
  return out;
}

const ringe = (p: Polygon): readonly Ring[] => [p.outer, ...p.holes];

function* kanten(ps: readonly Polygon[]): Generator<readonly [Vec2, Vec2]> {
  for (const p of ps) for (const r of ringe(p)) for (let i = 0; i < r.length; i++) yield [r[i]!, r[(i + 1) % r.length]!];
}

function randAbstand(p: Vec2, ps: readonly Polygon[]): number {
  let best = Infinity;
  for (const [a, b] of kanten(ps)) best = Math.min(best, distPointSegment(p, a, b));
  return best;
}

// ---------- Attika ----------

/**
 * Jede Attikakante wird an den Zellgrenzen (Zellecken auf der Kante) in Abschnitte geteilt; jeder
 * Abschnitt geht an die Zelle, die einen Punkt knapp innerhalb seiner Mitte enthält (sonst an die
 * nächstgelegene Zelle). Fläche = Abschnittslänge × Breite.
 */
function attikaZuschlagen(d: Dachflaeche, zellen: Zelle[], hinweise: CatchmentHinweis[]): void {
  if (d.attika.length === 0) return;
  const innenLinks = signedArea(d.kontur) > 0;
  const mitFlaeche = zellen.filter((z) => z.dachFlaeche > 0);
  for (const a of d.attika) {
    const k = konturKante(d.kontur, a.kante);
    if (!k) {
      hinweise.push({ code: "attika-kante-fehlt", dachflaecheId: d.id, objektId: a.id, meldung: `Attika ${a.id}: Kante ${a.kante} fehlt in der Kontur.` });
      continue;
    }
    const [p, q] = k;
    const laenge = Math.hypot(q.x - p.x, q.y - p.y);
    if (!(laenge > EPS) || !(a.breite > 0)) continue;
    if (mitFlaeche.length === 0) {
      hinweise.push({ code: "attika-ohne-ablauf", dachflaecheId: d.id, objektId: a.id,
        meldung: `Attika ${a.id}: keine angrenzende Einzugsfläche; ${(laenge * a.breite).toFixed(2)} m² nicht zugeordnet.` });
      continue;
    }
    const u = { x: (q.x - p.x) / laenge, y: (q.y - p.y) / laenge };
    const innen = innenLinks ? { x: -u.y, y: u.x } : { x: u.y, y: -u.x };
    const ts = [0, laenge];
    for (const z of mitFlaeche) {
      for (const pg of z.polygone) for (const r of ringe(pg)) for (const v of r) {
        if (distPointSegment(v, p, q) > TOL) continue;
        const t = (v.x - p.x) * u.x + (v.y - p.y) * u.y;
        if (t > TOL && t < laenge - TOL) ts.push(t);
      }
    }
    ts.sort((x, y) => x - y);
    const grenzen = ts.filter((t, i) => i === 0 || t - ts[i - 1]! > TOL);
    if (laenge - grenzen[grenzen.length - 1]! <= TOL) grenzen[grenzen.length - 1] = laenge;
    else grenzen.push(laenge);
    for (let i = 0; i + 1 < grenzen.length; i++) {
      const t0 = grenzen[i]!, t1 = grenzen[i + 1]!;
      const tm = (t0 + t1) / 2;
      const mitte = { x: p.x + tm * u.x, y: p.y + tm * u.y };
      const tief = Math.min(PROBE, (t1 - t0) / 4);
      const probe = { x: mitte.x + tief * innen.x, y: mitte.y + tief * innen.y };
      const ziel = mitFlaeche.find((z) => z.polygone.some((pg) => pointInPolygon(probe, pg) === "inside"))
        ?? naechste(mitFlaeche, mitte);
      const von = { x: p.x + t0 * u.x, y: p.y + t0 * u.y }, bis = { x: p.x + t1 * u.x, y: p.y + t1 * u.y };
      const letzter = ziel.attika[ziel.attika.length - 1];
      if (letzter && letzter.attikaId === a.id && Math.hypot(letzter.bis.x - von.x, letzter.bis.y - von.y) <= EPS) {
        const l = letzter.laenge + (t1 - t0);
        ziel.attika[ziel.attika.length - 1] = { ...letzter, bis, laenge: l, flaeche: l * a.breite };
      } else {
        ziel.attika.push({ attikaId: a.id, von, bis, laenge: t1 - t0, breite: a.breite, flaeche: (t1 - t0) * a.breite });
      }
    }
  }
}

function naechste(zellen: readonly Zelle[], p: Vec2): Zelle {
  let best = zellen[0]!, d = Infinity;
  for (const z of zellen) {
    const dz = randAbstand(p, z.polygone);
    if (dz < d) { d = dz; best = z; }
  }
  return best;
}

// ---------- Nachbarschaft und Färbung ----------

/** Überdeckungslänge zweier (nahezu) kollinearer Strecken; 0, wenn nicht kollinear. */
function gemeinsameLaenge(a: Vec2, b: Vec2, c: Vec2, e: Vec2): number {
  const l = Math.hypot(b.x - a.x, b.y - a.y);
  if (l <= TOL) return 0;
  const u = { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
  const quer = (p: Vec2) => Math.abs((p.x - a.x) * u.y - (p.y - a.y) * u.x);
  if (quer(c) > TOL || quer(e) > TOL) return 0;
  const tc = (c.x - a.x) * u.x + (c.y - a.y) * u.y, te = (e.x - a.x) * u.x + (e.y - a.y) * u.y;
  return Math.max(0, Math.min(l, Math.max(tc, te)) - Math.max(0, Math.min(tc, te)));
}

function huelle(ps: readonly Polygon[]): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of ps) for (const v of p.outer) { x0 = Math.min(x0, v.x); y0 = Math.min(y0, v.y); x1 = Math.max(x1, v.x); y1 = Math.max(y1, v.y); }
  return [x0, y0, x1, y1];
}

/** Benachbart = gemeinsame Randstrecke länger als TOL (reiner Eckkontakt zählt nicht). */
function nachbarPaare(zellen: readonly Zelle[]): [number, number][] {
  const boxen = zellen.map((z) => huelle(z.polygone));
  const out: [number, number][] = [];
  for (let i = 0; i < zellen.length; i++) {
    for (let j = i + 1; j < zellen.length; j++) {
      const [a0, b0, a1, b1] = boxen[i]!, [c0, d0, c1, d1] = boxen[j]!;
      if (a0 > c1 + TOL || c0 > a1 + TOL || b0 > d1 + TOL || d0 > b1 + TOL) continue;
      let summe = 0;
      outer: for (const [a, b] of kanten(zellen[i]!.polygone)) {
        for (const [c, e] of kanten(zellen[j]!.polygone)) {
          summe += gemeinsameLaenge(a, b, c, e);
          if (summe > TOL) break outer;
        }
      }
      if (summe > TOL) out.push([i, j]);
    }
  }
  return out;
}

/** Greedy-Färbung in Smallest-Last-Reihenfolge (planare Graphen: höchstens 6 Farben). */
function faerben(n: number, paare: readonly [number, number][], erschoepft: (i: number) => void): number[] {
  const adj: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
  for (const [a, b] of paare) { adj[a]!.add(b); adj[b]!.add(a); }
  const grad = adj.map((s) => s.size);
  const entfernt = new Array<boolean>(n).fill(false);
  const reihe: number[] = [];
  for (let k = 0; k < n; k++) {
    let v = -1;
    for (let i = 0; i < n; i++) if (!entfernt[i] && (v < 0 || grad[i]! < grad[v]!)) v = i;
    entfernt[v] = true;
    reihe.push(v);
    for (const w of adj[v]!) if (!entfernt[w]) grad[w]!--;
  }
  const farbe = new Array<number>(n).fill(-1);
  for (const v of reihe.reverse()) {
    const belegt = new Set<number>();
    for (const w of adj[v]!) if (farbe[w]! >= 0) belegt.add(farbe[w]!);
    let c = 0;
    while (c < FARBEN_ANZAHL && belegt.has(c)) c++;
    if (c === FARBEN_ANZAHL) { erschoepft(v); c = v % FARBEN_ANZAHL; }
    farbe[v] = c;
  }
  return farbe;
}
