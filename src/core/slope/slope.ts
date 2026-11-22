/**
 * computeSlope (PLAN §5, Schritte 5/6): Höhenfeld aus Abläufen je Dachfläche (Gully/Notablauf als
 * Punkt, LES als Strecke, Dachreiter als Randquelle, siehe quellen.ts), Facetten, Grate/Kehlen,
 * Koten, HP/TP, Gefällepfeile, LES-Keile (additiv) und mittlere Gefälledämmdicke (A2b).
 *
 * Facetten: Seite k der Pyramide i gilt dort, wo (1) sie innerhalb der Pyramide i die höchste Ebene
 * ist (Keil, konvex) und (2) keine andere Pyramide j tiefer liegt. Das Gebiet „j liegt tiefer“ ist
 * {L_ik > max_k' L_jk'} = ⋂_k' {L_ik > L_jk'}, also konvex; die Facette ist Dach ∩ Keil minus der
 * Vereinigung dieser konvexen Gebiete (Clipper). Gleichstand koplanarer Seiten geht an den Ablauf
 * mit kleinerem Index. Grate/Kehlen werden exakt (ohne Clipper-Raster) auf den Schnittgeraden der
 * Ebenen bestimmt. Rein und deterministisch.
 */
import { difference, intersection } from "../geometry/clipper";
import { EPS } from "../geometry/eps";
import { pointInPolygon, polygonArea, polygonCentroid } from "../geometry/polygon";
import type { Polygon, Ring, Vec2 } from "../geometry/types";
import { dachPolygon } from "../model/model";
import type { Dachflaeche, ProjectModel, Zone } from "../model/types";
import {
  SEITEN, auswerten, dachachse, differenz, ebeneVon, hoeheAm, quellLaenge, seitenRichtung,
} from "./hoehenfeld";
import { istSplitter, quellenAus } from "./quellen";
import type {
  DachGefaelle, Ebene, Extrempunkt, Facette, Faltlinie, Gefaelledaemmung, Gefaellepfeil,
  Hoehenfeld, Kote, KotenArt, LesKeil, SlopeHinweis, SlopeOptionen, SlopeResult, ZonenGefaelle,
} from "./types";

/** Umrechnung m → mm (Einheit, kein Grenzwert). */
const MM_JE_M = 1000;
/** Flächentoleranz für Zonen-Lageprüfungen in m² (Clipper-Raster). */
const FLAECHEN_TOL = 1e-3;

/** Gradient einer Ebenendifferenz ≈ 0: parallele Ebenen. */
const parallel = (e: Ebene) => Math.hypot(e.a, e.b) <= EPS;

export function computeSlope(m: ProjectModel, opt: SlopeOptionen = {}): SlopeResult {
  const hinweise: SlopeHinweis[] = [];
  const dachflaechen = m.dachflaechen.map((d) => dachGefaelle(d, m.gefaelleStandard, opt, hinweise));
  return { dachflaechen, hinweise };
}

function dachGefaelle(d: Dachflaeche, s: number, opt: SlopeOptionen, hinweise: SlopeHinweis[]): DachGefaelle {
  const dach = dachPolygon(d);
  const achse = dachachse(d.kontur);
  const q = quellenAus(d, dach, achse, opt.packs ?? [], (h) => hinweise.push({ ...h, dachflaecheId: d.id }));
  const feld: Hoehenfeld = { gefaelle: s, achse, quellen: q.quellen };
  const leer: DachGefaelle = {
    dachflaecheId: d.id, feld, facetten: [], linien: [], koten: [], hochpunkt: null, tiefpunkt: null, pfeile: [], daemmung: null,
    daemmungHaupt: null, zonen: [], les: q.les, dachreiter: q.dachreiter,
  };
  if (q.quellen.length === 0) {
    hinweise.push({ code: "keine-ablaeufe", dachflaecheId: d.id, meldung: "Dachfläche hat keinen Ablauf; kein Gefälle berechnet." });
    return leer;
  }
  if (!(s > 0)) {
    hinweise.push({ code: "gefaelle-null", dachflaecheId: d.id, meldung: "Gefälle ist 0; kein Gefälleplan berechnet." });
    return leer;
  }

  const box = huelle(dach.outer);
  const zonenTeile = zonenPolygone(d, dach, hinweise);
  const haupt = zonenTeile.length > 0
    ? difference([dach], zonenTeile.flatMap((z) => z.polygone)).filter((p) => !istSplitter(p))
    : [dach];
  const facettenHaupt = haupt.length > 0 ? berechneFacetten(haupt, box, feld, "") : [];
  const linien = haupt.flatMap((t) => berechneFaltlinien(t, box, feld));
  const koten = haupt.length > 0 ? berechneKoten(haupt, feld, linien) : [];
  const hpHaupt = extrem(koten, 1), tpHaupt = extrem(koten, -1);
  const daemmungHaupt = tpHaupt && hpHaupt && facettenHaupt.length > 0
    ? mittlereDaemmung(facettenHaupt, q.les, tpHaupt.kote, hpHaupt.kote, d.daemmdickeTiefpunkt, opt.daemmdickeTiefpunktStandard)
    : null;
  const zonen = zonenTeile.map((z) => zonenGefaelle(z.zone, z.polygone, box, feld, d, opt));

  const facetten = [...facettenHaupt, ...zonen.flatMap((z) => z.facetten)];
  const alleKoten = [...koten, ...zonen.flatMap((z) => z.koten)];
  const pfeile: Gefaellepfeil[] = facetten.filter((f) => f.gefaelle > 0).map((f) => ({
    facetteId: f.id, start: innenpunkt(f.polygon), richtung: f.fallrichtung, gefaelle: f.gefaelle,
  }));
  const daemmung = gewichtet([daemmungHaupt, ...zonen.map((z) => z.daemmung)]);
  return {
    ...leer, facetten, linien, koten, hochpunkt: extrem(alleKoten, 1), tiefpunkt: extrem(alleKoten, -1), pfeile,
    daemmung, daemmungHaupt, zonen,
  };
}

// ---------- Zonen/Stufen (Schritt 8) ----------

/** Zonenflächen: Zone ∩ Dach, ohne Anteile früherer Zonen (Überlappung → Hinweis). */
function zonenPolygone(d: Dachflaeche, dach: Polygon, hinweise: SlopeHinweis[]): { zone: Zone; polygone: Polygon[] }[] {
  const out: { zone: Zone; polygone: Polygon[] }[] = [];
  const belegt: Polygon[] = [];
  for (const zone of d.zonen) {
    const roh: Polygon = { outer: zone.kontur, holes: [] };
    let teile = intersection([dach], [roh]).filter((p) => !istSplitter(p));
    const imDachFlaeche = summe(teile);
    if (imDachFlaeche < polygonArea(roh) - FLAECHEN_TOL) {
      hinweise.push({ code: "zone-ausserhalb", dachflaecheId: d.id, objektId: zone.id,
        meldung: `Zone ${zone.name || zone.id} liegt ${teile.length === 0 ? "" : "teilweise "}außerhalb der Dachfläche oder auf Aufbauten.` });
    }
    if (belegt.length > 0 && teile.length > 0) {
      teile = difference(teile, belegt).filter((p) => !istSplitter(p));
      if (summe(teile) < imDachFlaeche - FLAECHEN_TOL) {
        hinweise.push({ code: "zonen-ueberlappen", dachflaecheId: d.id, objektId: zone.id,
          meldung: `Zone ${zone.name || zone.id} überlappt eine frühere Zone; der Überlappungsteil gehört zur früheren Zone.` });
      }
    }
    if (teile.length === 0) continue;
    belegt.push(...teile);
    out.push({ zone, polygone: teile });
  }
  return out;
}

const summe = (ps: readonly Polygon[]) => ps.reduce((a, p) => a + polygonArea(p), 0);

function zonenGefaelle(zone: Zone, polygone: Polygon[], box: Vec2[], haupt: Hoehenfeld, d: Dachflaeche, opt: SlopeOptionen): ZonenGefaelle {
  const feld: Hoehenfeld = {
    gefaelle: zone.gefaelle ?? haupt.gefaelle, achse: haupt.achse,
    quellen: haupt.quellen.map((q) => ({ ...q, z: q.z + zone.hoehenversatz })),
  };
  const flaeche = summe(polygone);
  let facetten: Facette[], linien: Faltlinie[], koten: Kote[];
  if (feld.gefaelle > EPS) {
    facetten = berechneFacetten(polygone, box, feld, `${zone.id}:`).map((f) => ({ ...f, zoneId: zone.id }));
    linien = polygone.flatMap((t) => berechneFaltlinien(t, box, feld));
    koten = berechneKoten(polygone, feld, linien);
  } else {
    // 0-%-Zone: waagerecht auf der Kote des tiefsten Ablaufs (+ Versatz); dem tiefsten Ablauf zugeordnet.
    const tiefste = feld.quellen.reduce((b, q) => (q.z < b.z ? q : b));
    const ebene: Ebene = { a: 0, b: 0, c: tiefste.z };
    facetten = polygone.map((polygon, n) => ({
      id: `${zone.id}:${tiefste.ablaufId}/0/${n}`, ablaufId: tiefste.ablaufId, zoneId: zone.id, seite: 0, polygon,
      flaeche: polygonArea(polygon), ebene, gefaelle: 0, fallrichtung: { x: 0, y: 0 },
    }));
    linien = [];
    koten = berechneKoten(polygone, feld, linien);
  }
  const hochpunkt = extrem(koten, 1), tiefpunkt = extrem(koten, -1);
  const daemmung = hochpunkt && tiefpunkt
    ? mittlereDaemmung(facetten, [], tiefpunkt.kote, hochpunkt.kote, d.daemmdickeTiefpunkt, opt.daemmdickeTiefpunktStandard)
    : null;
  return { zoneId: zone.id, versatz: zone.hoehenversatz, feld, polygone, flaeche, facetten, linien, koten, hochpunkt, tiefpunkt, daemmung };
}

/** Flächengewichtetes Zusammenführen getrennt gemittelter Teilflächen (A2b). */
function gewichtet(teile: readonly (Gefaelledaemmung | null)[]): Gefaelledaemmung | null {
  const t = teile.filter((x): x is Gefaelledaemmung => x !== null && x.flaeche > 0);
  if (t.length === 0) return null;
  if (t.length === 1) return t[0]!;
  const flaeche = t.reduce((a, x) => a + x.flaeche, 0);
  return {
    mittel: t.reduce((a, x) => a + x.flaeche * x.mittel, 0) / flaeche,
    min: Math.min(...t.map((x) => x.min)),
    max: Math.max(...t.map((x) => x.max)),
    tiefpunktDicke: t[0]!.tiefpunktDicke,
    tiefpunktVorgegeben: t[0]!.tiefpunktVorgegeben,
    flaeche,
  };
}

/**
 * Höhe (OK Abdichtung, m) im Punkt p der Dachfläche: in einer Zone deren Feld (inkl. Versatz),
 * sonst das Hauptfeld. Auf einem Zonenrand gilt die Zone. NaN ohne Abläufe.
 */
export function hoeheDachflaeche(g: DachGefaelle, p: Vec2): number {
  for (const z of g.zonen) {
    if (z.polygone.some((poly) => pointInPolygon(p, poly) !== "outside")) return hoeheAm(z.feld, p);
  }
  return hoeheAm(g.feld, p);
}

// ---------- Facetten ----------

/** Achsparalleles Rechteck um den Ring, um seine Ausdehnung vergrößert (Halbebenen-Zuschnitt). */
function huelle(r: Ring): Vec2[] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of r) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  const rand = Math.max(x1 - x0, y1 - y0);
  return [{ x: x0 - rand, y: y0 - rand }, { x: x1 + rand, y: y0 - rand }, { x: x1 + rand, y: y1 + rand }, { x: x0 - rand, y: y1 + rand }];
}

/** Konvexes Polygon auf die Halbebene e(p) ≥ 0 zuschneiden (Sutherland–Hodgman). */
function halbebene(poly: readonly Vec2[], e: Ebene): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!, q = poly[(i + 1) % poly.length]!;
    const fp = auswerten(e, p), fq = auswerten(e, q);
    if (fp >= 0) out.push(p);
    if ((fp >= 0) !== (fq >= 0)) {
      const t = fp / (fp - fq);
      out.push({ x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y) });
    }
  }
  return out;
}

function berechneFacetten(dach: readonly Polygon[], box: Vec2[], f: Hoehenfeld, prefix: string): Facette[] {
  const out: Facette[] = [];
  f.quellen.forEach((quelle, i) => {
    for (const k of SEITEN) {
      const L = ebeneVon(f, i, k);
      let keil: Vec2[] = box;
      for (const k2 of SEITEN) if (k2 !== k) keil = halbebene(keil, differenz(L, ebeneVon(f, i, k2)));
      if (keil.length < 3) continue;
      let teile = intersection(dach, [{ outer: keil, holes: [] }]);
      const tiefer: Polygon[] = [];
      f.quellen.forEach((_, j) => {
        if (j === i) return;
        let c: Vec2[] = box;
        for (const k2 of SEITEN) {
          const dlt = differenz(L, ebeneVon(f, j, k2));
          if (parallel(dlt)) {
            // Parallele Ebenen: konstanter Abstand dlt.c. Koplanar → Gleichstand an den kleineren Index.
            const verliert = dlt.c > EPS || (Math.abs(dlt.c) <= EPS && j < i);
            if (!verliert) { c = []; break; }
          } else c = halbebene(c, dlt);
          if (c.length < 3) break;
        }
        if (c.length >= 3) tiefer.push({ outer: c, holes: [] });
      });
      if (tiefer.length > 0 && teile.length > 0) teile = difference(teile, tiefer);
      const g = seitenRichtung(quelle.achse, k);
      teile.filter((p) => !istSplitter(p)).forEach((polygon, n) => {
        out.push({
          id: `${prefix}${quelle.ablaufId}/${k}/${n}`, ablaufId: quelle.ablaufId, seite: k, polygon,
          flaeche: polygonArea(polygon), ebene: L, gefaelle: f.gefaelle, fallrichtung: { x: -g.x, y: -g.y },
        });
      });
    }
  });
  return out;
}

// ---------- Grate und Kehlen (exakt auf den Schnittgeraden) ----------

type Intervalle = [number, number][];

/**
 * Lineare Funktion entlang der Geraden, f(t) = f0 + f1·t, als vorzeichenbehafteter Abstand (m)
 * zur Nullgeraden; parallele Ebenen (Gradient 0) werden als konstanter Höhenunterschied (Zahl) geführt.
 */
type Lin1 = readonly [number, number];

/**
 * Behält t mit f(t) ≥ 0. Liegt f an beiden Intervallenden innerhalb −EPS, bleibt das Intervall
 * ganz (Gerade fällt mit der Grenze zusammen); sonst wird an der exakten Nullstelle geschnitten.
 */
function mindestens(iv: Intervalle, [f0, f1]: Lin1): Intervalle {
  return iv.flatMap(([a, b]): Intervalle => {
    const fa = f0 + f1 * a, fb = f0 + f1 * b;
    if (fa >= -EPS && fb >= -EPS) return [[a, b]];
    if (fa < -EPS && fb < -EPS) return [];
    const t = -f0 / f1;
    const [lo, hi] = fa > fb ? [a, Math.min(b, t)] : [Math.max(a, t), b];
    return lo < hi ? [[lo, hi]] : [];
  });
}

/**
 * Entfernt je Intervall den Teil, in dem alle Funktionen > 0 sind (dort liegt eine andere Pyramide
 * tiefer). Eine Zahl = parallele Ebene mit konstantem Höhenunterschied.
 */
function ohneWoAllePositiv(iv: Intervalle, fs: readonly (Lin1 | number)[]): Intervalle {
  return iv.flatMap(([a, b]): Intervalle => {
    let lo = a, hi = b;
    for (const f of fs) {
      if (typeof f === "number") { if (f > EPS) continue; return [[a, b]]; }
      const [f0, f1] = f;
      const fa = f0 + f1 * a, fb = f0 + f1 * b;
      if (fa > EPS && fb > EPS) continue;
      if (fa <= EPS && fb <= EPS) return [[a, b]];
      const t = -f0 / f1;
      if (fa > fb) hi = Math.min(hi, t); else lo = Math.max(lo, t);
    }
    return ohne([[a, b]], lo, hi);
  });
}

/** Entfernt das offene Intervall (lo, hi). */
function ohne(iv: Intervalle, lo: number, hi: number): Intervalle {
  if (!(lo < hi)) return iv;
  return iv.flatMap(([a, b]): Intervalle => {
    const r: Intervalle = [];
    if (a < Math.min(b, lo)) r.push([a, Math.min(b, lo)]);
    if (Math.max(a, hi) < b) r.push([Math.max(a, hi), b]);
    return r;
  });
}

/** Parameterbereiche der Geraden p0 + t·dir im Inneren des Dachs. */
function imDach(dach: Polygon, p0: Vec2, dir: Vec2): Intervalle {
  const n = { x: -dir.y, y: dir.x };
  const ts: number[] = [];
  for (const r of [dach.outer, ...dach.holes]) {
    for (let i = 0; i < r.length; i++) {
      const p = r[i]!, q = r[(i + 1) % r.length]!;
      const sp = n.x * (p.x - p0.x) + n.y * (p.y - p0.y), sq = n.x * (q.x - p0.x) + n.y * (q.y - p0.y);
      const tp = dir.x * (p.x - p0.x) + dir.y * (p.y - p0.y), tq = dir.x * (q.x - p0.x) + dir.y * (q.y - p0.y);
      if (Math.abs(sp) <= EPS) ts.push(tp);
      if ((sp > EPS && sq < -EPS) || (sp < -EPS && sq > EPS)) ts.push(tp + ((tq - tp) * sp) / (sp - sq));
    }
  }
  ts.sort((a, b) => a - b);
  const iv: Intervalle = [];
  for (let i = 0; i + 1 < ts.length; i++) {
    const a = ts[i]!, b = ts[i + 1]!;
    if (b - a <= EPS) continue;
    const mitte = (a + b) / 2;
    if (pointInPolygon({ x: p0.x + mitte * dir.x, y: p0.y + mitte * dir.y }, dach) !== "inside") continue;
    const letztes = iv[iv.length - 1];
    if (letztes && a - letztes[1] <= EPS) letztes[1] = b;
    else iv.push([a, b]);
  }
  return iv;
}

/** Teilstücke behalten, an denen das Höhenfeld wirklich knickt (sonst steigt die Fläche einfach weiter an). */
function nurKnicke(f: Hoehenfeld, p0: Vec2, dir: Vec2, iv: Intervalle): Intervalle {
  const d = 0.02, N = 24;
  const knick = (t: number) => {
    const p = { x: p0.x + t * dir.x, y: p0.y + t * dir.y };
    const h = (s: number) => hoeheAm(f, { x: p.x - s * dir.y, y: p.y + s * dir.x });
    return Math.abs(h(d) + h(-d) - 2 * h(0)) > 1e-6;
  };
  const out: Intervalle = [];
  for (const [a, b] of iv) {
    let start: number | null = null;
    for (let i = 0; i < N; i++) {
      const t0 = a + ((b - a) * i) / N, t1 = a + ((b - a) * (i + 1)) / N;
      if (knick((t0 + t1) / 2)) { if (start === null) start = t0; }
      else if (start !== null) { out.push([start, t0]); start = null; }
    }
    if (start !== null) out.push([start, b]);
  }
  return out;
}

function berechneFaltlinien(dach: Polygon, box: Vec2[], f: Hoehenfeld): Faltlinie[] {
  const mitte = { x: (box[0]!.x + box[2]!.x) / 2, y: (box[0]!.y + box[2]!.y) / 2 };
  const ebenen = f.quellen.flatMap((_, i) => SEITEN.map((k) => ({ i, k, L: ebeneVon(f, i, k) })));
  const out: Faltlinie[] = [];
  for (let x = 0; x < ebenen.length; x++) {
    for (let y = x + 1; y < ebenen.length; y++) {
      const A = ebenen[x]!, B = ebenen[y]!;
      // Parallele Ebenen schneiden sich nicht; gegenüberliegende Seiten einer Punktpyramide nur im Ablauf
      // (bei einer Strecke treffen sich die Seiten 1/3 in der Kehle entlang der Strecke).
      const dlt = differenz(A.L, B.L);
      if (parallel(dlt)) continue;
      if (A.i === B.i && (A.k - B.k) % 2 === 0 && quellLaenge(f.quellen[A.i]!) <= EPS) continue;
      const norm = Math.hypot(dlt.a, dlt.b);
      const dir = { x: -dlt.b / norm, y: dlt.a / norm };
      const w = auswerten(dlt, mitte) / (norm * norm);
      const p0 = { x: mitte.x - w * dlt.a, y: mitte.y - w * dlt.b };
      const entlang = (e: Ebene): Lin1 | number => {
        const n = Math.hypot(e.a, e.b);
        return n <= EPS ? auswerten(e, p0) : [auswerten(e, p0) / n, (e.a * dir.x + e.b * dir.y) / n];
      };

      let iv = imDach(dach, p0, dir);
      // Auf der Geraden muss A in Pyramide A und B in Pyramide B die höchste Seite sein
      // (die Grenze A = B selbst ist die Gerade und entfällt) …
      for (const [P, Q] of [[A, B], [B, A]] as const) {
        for (const k2 of SEITEN) {
          if (k2 === P.k || (P.i === Q.i && k2 === Q.k)) continue;
          const g = entlang(differenz(P.L, ebeneVon(f, P.i, k2)));
          if (typeof g !== "number") iv = mindestens(iv, g);
          else if (g < -EPS) iv = [];
        }
      }
      // … und keine dritte Pyramide darf tiefer liegen.
      f.quellen.forEach((_, j) => {
        if (j === A.i || j === B.i || iv.length === 0) return;
        iv = ohneWoAllePositiv(iv, SEITEN.map((k2) => entlang(differenz(A.L, ebeneVon(f, j, k2)))));
      });
      iv = nurKnicke(f, p0, dir, iv);
      for (const [a, b] of iv) {
        if (b - a <= EPS) continue;
        const von = { x: p0.x + a * dir.x, y: p0.y + a * dir.y }, bis = { x: p0.x + b * dir.x, y: p0.y + b * dir.y };
        const art = A.i === B.i ? "kehle" : "grat";
        const gleich = (l: Faltlinie) => l.art === art &&
          ((nah(l.von, von) && nah(l.bis, bis)) || (nah(l.von, bis) && nah(l.bis, von)));
        if (!out.some(gleich)) out.push({ art, von, bis, ablaufIds: [f.quellen[A.i]!.ablaufId, f.quellen[B.i]!.ablaufId] });
      }
    }
  }
  return out;
}

// ---------- Koten, HP/TP ----------

const nah = (p: Vec2, q: Vec2) => Math.hypot(p.x - q.x, p.y - q.y) <= EPS;
const RANG: Record<KotenArt, number> = { ablauf: 0, ecke: 1, grat: 2, kehle: 3 };

function berechneKoten(teile: readonly Polygon[], f: Hoehenfeld, linien: readonly Faltlinie[]): Kote[] {
  const out: Kote[] = [];
  const add = (p: Vec2, art: KotenArt) => {
    const i = out.findIndex((k) => nah(k.position, p));
    if (i >= 0) {
      if (RANG[art] < RANG[out[i]!.art]) out[i] = { ...out[i]!, art };
      return;
    }
    out.push({ position: { x: p.x, y: p.y }, kote: hoeheAm(f, p), art });
  };
  const drin = (p: Vec2) => teile.some((t) => pointInPolygon(p, t) !== "outside");
  for (const q of f.quellen) for (const p of [q.position, q.bis]) if (drin(p)) add(p, "ablauf");
  for (const t of teile) for (const r of [t.outer, ...t.holes]) for (const p of r) add(p, "ecke");
  for (const l of linien) { add(l.von, l.art); add(l.bis, l.art); }
  return out;
}

/**
 * Extremwert (1 = Hochpunkt, −1 = Tiefpunkt) über die Koten. Das Feld ist stückweise linear,
 * die Extreme liegen daher an Ecken, Abläufen oder Enden von Grat-/Kehllinien.
 */
function extrem(koten: readonly Kote[], vz: 1 | -1): Extrempunkt | null {
  if (koten.length === 0) return null;
  const kote = vz * Math.max(...koten.map((k) => vz * k.kote));
  return { kote, orte: koten.filter((k) => Math.abs(k.kote - kote) <= EPS).map((k) => k.position) };
}

// ---------- Mittlere Gefälledämmdicke (A2b) ----------

/**
 * d_m = d_TP + (1/A)·∫(h − h_min + Keil) dA. Höhenfeld und Keildicke sind je Facette bzw. Keilseite
 * linear, also auf jedem Schnittstück Facette ∩ Keilseite: Integral = Fläche · Wert im Schwerpunkt,
 * Maximum an einer Ecke.
 */
function mittlereDaemmung(
  facetten: readonly Facette[], keile: readonly LesKeil[], hMin: number, hMax: number,
  vorgabe: number | undefined, standard: number | undefined,
): Gefaelledaemmung | null {
  let flaeche = 0, integral = 0, groesste = hMax - hMin;
  for (const f of facetten) {
    flaeche += f.flaeche;
    integral += f.flaeche * (auswerten(f.ebene, polygonCentroid(f.polygon)) - hMin);
  }
  if (!(flaeche > 0)) return null;
  for (const k of keile) {
    for (const s of k.seiten) {
      if (s.flaechen.length === 0) continue;
      for (const f of facetten) {
        for (const p of intersection([f.polygon], s.flaechen)) {
          if (istSplitter(p)) continue;
          integral += polygonArea(p) * auswerten(s.dicke, polygonCentroid(p));
          for (const r of [p.outer, ...p.holes]) {
            for (const v of r) groesste = Math.max(groesste, auswerten(f.ebene, v) - hMin + auswerten(s.dicke, v));
          }
        }
      }
    }
  }
  const dtp = vorgabe ?? standard ?? 0;
  return {
    mittel: dtp + (MM_JE_M * integral) / flaeche,
    min: dtp,
    max: dtp + MM_JE_M * groesste,
    tiefpunktDicke: dtp,
    tiefpunktVorgegeben: vorgabe !== undefined,
    flaeche,
  };
}

// ---------- Pfeil-Ansatzpunkt ----------

/** Punkt im Inneren: Schwerpunkt, sonst Mitte des breitesten Abschnitts der Waagerechten durch ihn. */
function innenpunkt(p: Polygon): Vec2 {
  const c = polygonCentroid(p);
  if (pointInPolygon(c, p) === "inside") return c;
  const xs: number[] = [];
  for (const r of [p.outer, ...p.holes]) {
    for (let i = 0; i < r.length; i++) {
      const a = r[i]!, b = r[(i + 1) % r.length]!;
      if ((a.y > c.y) !== (b.y > c.y)) xs.push(a.x + ((c.y - a.y) * (b.x - a.x)) / (b.y - a.y));
    }
  }
  xs.sort((a, b) => a - b);
  let best: Vec2 = p.outer[0]!, breite = 0;
  for (let i = 0; i + 1 < xs.length; i += 2) {
    const w = xs[i + 1]! - xs[i]!;
    if (w > breite) { breite = w; best = { x: (xs[i]! + xs[i + 1]!) / 2, y: c.y }; }
  }
  return best;
}
