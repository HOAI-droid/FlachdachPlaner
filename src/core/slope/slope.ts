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
import { difference, intersection, offset, union } from "../geometry/clipper";
import { EPS } from "../geometry/eps";
import { pointInPolygon, polygonArea, polygonCentroid } from "../geometry/polygon";
import { distPointSegment } from "../geometry/segment";
import type { Polygon, Ring, Vec2 } from "../geometry/types";
import { dachPolygon } from "../model/model";
import type { Dachflaeche, ProjectModel, Zone } from "../model/types";
import {
  LAGE_TOL, SEITEN, achseEingerastet, aktiveEbene, auswerten, dachachse, differenz, ebeneDer, hoeheAm, quellAbstand, quellLaenge, quellenAngeglichen,
  seitenRichtung, teilquellen, type Teilquelle,
} from "./hoehenfeld";
import { taschenBaum, teilbaum, type Tasche } from "./geodaetisch";
import { istSplitter, quellenAus } from "./quellen";
import type {
  DachGefaelle, Ebene, Extrempunkt, Facette, Faltlinie, Gefaelledaemmung, Gefaellepfeil,
  Hoehenfeld, Hoehenquelle, Kote, KotenArt, LesKeil, SlopeHinweis, SlopeOptionen, SlopeResult, Umweg, ZonenGefaelle,
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
  // Lagetoleranz (LAGE_TOL): Achse einrasten, fast fluchtende Punktabläufe angleichen (gegen Scheinkehlen).
  const achse = achseEingerastet(d.kontur, dachachse(d.kontur));
  const q = quellenAus(d, dach, achse, opt.packs ?? [], (h) => hinweise.push({ ...h, dachflaecheId: d.id }));
  const basis: Hoehenfeld = { gefaelle: s, achse, quellen: quellenAngeglichen(q.quellen, achse) };
  let feld = basis;
  const leer = (): DachGefaelle => ({
    dachflaecheId: d.id, feld, facetten: [], linien: [], koten: [], hochpunkt: null, tiefpunkt: null, pfeile: [], daemmung: null,
    daemmungHaupt: null, zonen: [], les: q.les, dachreiter: q.dachreiter,
  });
  if (q.quellen.length === 0) {
    const nurNot = d.entwaesserung.length > 0 && d.entwaesserung.every((e) => e.art === "notablauf");
    hinweise.push({ code: "keine-ablaeufe", dachflaecheId: d.id, meldung: nurNot
      ? "Dachfläche hat nur Notabläufe (zählen nicht für das Gefälle); kein Gefälle berechnet."
      : "Dachfläche hat keinen Ablauf; kein Gefälle berechnet." });
    return leer();
  }
  if (!(s > 0)) {
    hinweise.push({ code: "gefaelle-null", dachflaecheId: d.id, meldung: "Gefälle ist 0; kein Gefälleplan berechnet." });
    return leer();
  }

  const box = huelle(dach.outer);
  const zonenTeile = zonenPolygone(d, dach, hinweise);
  const haupt = zonenTeile.length > 0
    ? difference([dach], zonenTeile.flatMap((z) => z.polygone)).filter((p) => !istSplitter(p))
    : [dach];
  // R5: Taschen hinter reflexen Konturecken je Punktquelle (leer bei konvexer Kontur).
  const baeume = basis.quellen.map((x) => taschenBaum(x, d.kontur));
  let facettenHaupt: Facette[] = [];
  if (haupt.length > 0) ({ feld, facetten: facettenHaupt } = geodaetisch(basis, baeume, d.kontur, haupt, box, ""));
  const linien = ergaenzeKnicke(haupt.flatMap((t) => berechneFaltlinien(t, box, feld)), facettenHaupt, dach);
  const koten = haupt.length > 0 ? berechneKoten(haupt, feld, linien, facettenHaupt) : [];
  const hpHaupt = extrem(koten, 1), tpHaupt = extrem(koten, -1);
  const daemmungHaupt = tpHaupt && hpHaupt && facettenHaupt.length > 0
    ? mittlereDaemmung(facettenHaupt, q.les, tpHaupt.kote, hpHaupt.kote, d.daemmdickeTiefpunkt, opt.daemmdickeTiefpunktStandard)
    : null;
  const zonen = zonenTeile.map((z) => zonenGefaelle(z.zone, z.polygone, box, basis, baeume, d, opt));

  const facetten = [...facettenHaupt, ...zonen.flatMap((z) => z.facetten)];
  const alleKoten = [...koten, ...zonen.flatMap((z) => z.koten)];
  const pfeile: Gefaellepfeil[] = facetten.filter((f) => f.gefaelle > 0).map((f) => ({
    facetteId: f.id, start: innenpunkt(f.polygon), richtung: f.fallrichtung, gefaelle: f.gefaelle,
  }));
  const daemmung = gewichtet([daemmungHaupt, ...zonen.map((z) => z.daemmung)]);
  return {
    ...leer(), facetten, linien, koten, hochpunkt: extrem(alleKoten, 1), tiefpunkt: extrem(alleKoten, -1), pfeile,
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

function zonenGefaelle(
  zone: Zone, polygone: Polygon[], box: Vec2[], haupt: Hoehenfeld, baeume: readonly Tasche[][], d: Dachflaeche, opt: SlopeOptionen,
): ZonenGefaelle {
  let feld: Hoehenfeld = {
    gefaelle: zone.gefaelle ?? haupt.gefaelle, achse: haupt.achse,
    quellen: haupt.quellen.map((q) => ({ ...q, z: q.z + zone.hoehenversatz })),
  };
  const flaeche = summe(polygone);
  let facetten: Facette[], linien: Faltlinie[], koten: Kote[];
  if (feld.gefaelle > EPS) {
    let roh: Facette[];
    ({ feld, facetten: roh } = geodaetisch(feld, baeume, d.kontur, polygone, box, `${zone.id}:`));
    facetten = roh.map((f) => ({ ...f, zoneId: zone.id }));
    linien = ergaenzeKnicke(polygone.flatMap((t) => berechneFaltlinien(t, box, feld)), facetten, { outer: [], holes: [] });
    koten = berechneKoten(polygone, feld, linien, facetten);
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

/** Facetten je Teilquelle (ohne Umwege genau die Quellen, R5: Umwege um reflexe Ecken als eigene Pyramiden). */
function facettenMitTeil(dach: readonly Polygon[], box: Vec2[], f: Hoehenfeld, prefix: string): { facette: Facette; teil: Teilquelle }[] {
  const out: { facette: Facette; teil: Teilquelle }[] = [];
  const teile_ = teilquellen(f);
  for (const t of teile_) {
    const quelle = t.q;
    for (const k of SEITEN) {
      const L = ebeneDer(f.gefaelle, quelle, k);
      let keil: Vec2[] = box;
      for (const k2 of SEITEN) if (k2 !== k) keil = halbebene(keil, differenz(L, ebeneDer(f.gefaelle, quelle, k2)));
      if (keil.length < 3) continue;
      let teile = intersection(dach, [{ outer: keil, holes: [] }]);
      if (t.bereich && teile.length > 0) teile = intersection(teile, t.bereich);
      const tiefer: Polygon[] = [];
      const geteilt: Polygon[][] = f.quellen.map(() => []);
      for (const u of teile_) {
        // Teilquellen derselben Quelle haben getrennte Bereiche.
        if (u.i === t.i) continue;
        let c: Vec2[] = box;
        for (const k2 of SEITEN) {
          const dlt = differenz(L, ebeneDer(f.gefaelle, u.q, k2));
          if (parallel(dlt)) {
            // Parallele Ebenen: konstanter Abstand dlt.c. Koplanar → Gleichstand an den kleineren Index.
            if (dlt.c > EPS) continue;
            if (dlt.c < -EPS) { c = []; break; }
            // Gleichstand koplanarer Seiten: j nimmt, was ihm (Luftlinie) näher liegt; bei gleicher Lage entscheidet der Index.
            const pi = quelle.position, pj = u.q.position;
            const bis = { a: 2 * (pj.x - pi.x), b: 2 * (pj.y - pi.y), c: pi.x * pi.x + pi.y * pi.y - pj.x * pj.x - pj.y * pj.y };
            if (parallel(bis)) { if (u.nr < t.nr) continue; c = []; break; }
            c = halbebene(c, bis);
          } else c = halbebene(c, dlt);
          if (c.length < 3) break;
        }
        if (c.length < 3) continue;
        const gebiet: Polygon = { outer: c, holes: [] };
        if (u.bereich) geteilt[u.i]!.push(...intersection([gebiet], u.bereich));
        else tiefer.push(gebiet);
      }
      // Stücke einer Quelle aus mehreren Bereichen: Haarrisse an den Fenstern (Clipper-Raster) schließen.
      for (const g of geteilt) if (g.length > 0) tiefer.push(...schliessen(g));
      if (tiefer.length > 0 && teile.length > 0) teile = difference(teile, tiefer);
      const g = seitenRichtung(quelle.achse, k);
      const kennung = t.umweg < 0 ? `${k}/` : `${k}/u${t.umweg}.`;
      teile.filter((p) => !istSplitter(p)).forEach((polygon, n) => {
        out.push({ teil: t, facette: {
          id: `${prefix}${quelle.ablaufId}/${kennung}${n}`, ablaufId: quelle.ablaufId, seite: k, polygon,
          flaeche: polygonArea(polygon), ebene: L, gefaelle: f.gefaelle, fallrichtung: { x: -g.x, y: -g.y },
        } });
      });
    }
  }
  return out;
}

// ---------- Geodätischer Abstand (R5) ----------

/** Rissbreite (m), die beim Zusammenfügen von Bereichsstücken geschlossen wird (wenige Clipper-Rasterschritte). */
const RISS = 3e-4;

/** Vereinigung mit morphologischem Schließen (Haarrisse < 2·RISS verschwinden, Außenform bleibt). */
function schliessen(ps: readonly Polygon[]): Polygon[] {
  return offset(offset(union(ps), RISS, { join: "miter" }), -RISS, { join: "miter" });
}

/** Höhenabweichung (m), ab der eine Tasche das Feld ändert (darunter: Rundung, Feld bleibt unverändert). */
const TASCHEN_TOL = 1e-4;

/**
 * Feld und Facetten mit geodätischem Abstand um reflexe Konturecken (PLAN R5). Eine Tasche wird nur
 * zugeschaltet, wenn ihre Quelle dort tatsächlich die Höhe bestimmt und der Umweg höher liegt als die
 * Luftlinie; sonst bleibt das Feld (und jedes Ergebnis) identisch zum bisherigen Modell. Iteriert, bis keine
 * Tasche mehr hinzukommt (ein Umweg kann Fläche an eine andere Quelle abgeben, deren Tasche dann zählt).
 */
function geodaetisch(
  basis: Hoehenfeld, baeume: readonly (readonly Tasche[])[], kontur: Ring, flaechen: readonly Polygon[], box: Vec2[], prefix: string,
): { feld: Hoehenfeld; facetten: Facette[] } {
  let feld = basis;
  let fac = facettenMitTeil(flaechen, box, feld, prefix);
  if (baeume.every((b) => b.length === 0)) return { feld, facetten: fac.map((x) => x.facette) };
  const aktiv = baeume.map((b) => b.map(() => false));
  for (let runde = 0; runde <= baeume.flat().length; runde++) {
    let neu = false;
    for (const { facette, teil } of fac) {
      if (teil.umweg >= 0) continue; // Umwege tragen ihren ganzen Teilbaum schon
      const q = teil.q;
      baeume[teil.i]!.forEach((T, n) => {
        if (aktiv[teil.i]![n] || !teilbaum(T).some((N) => hoeher(facette, N, q, feld.gefaelle))) return;
        aktiv[teil.i]![n] = true;
        neu = true;
      });
    }
    if (!neu) break;
    feld = mitTaschen(basis, baeume, aktiv, kontur);
    fac = facettenMitTeil(flaechen, box, feld, prefix);
  }
  return { feld, facetten: fac.map((x) => x.facette) };
}

/** Liegt der Umweg über die Ecke von N irgendwo in Facette ∩ Sicht(N) höher als die Facette? (konvex → Ecken genügen) */
function hoeher(f: Facette, N: Tasche, q: Hoehenquelle, s: number): boolean {
  const ecke: Hoehenquelle = { ...q, position: N.ecke, bis: N.ecke };
  for (const stueck of intersection([f.polygon], N.sicht)) {
    if (istSplitter(stueck)) continue;
    for (const r of [stueck.outer, ...stueck.holes]) {
      for (const v of r) if (q.z + s * (N.weg + quellAbstand(ecke, v)) - auswerten(f.ebene, v) > TASCHEN_TOL) return true;
    }
  }
  return false;
}

/** Feld mit den aktiven Taschen: Quelle gilt in Kontur ohne ihre Taschen, jede Tasche als Umweg über ihre Ecke. */
function mitTaschen(basis: Hoehenfeld, baeume: readonly (readonly Tasche[])[], aktiv: readonly boolean[][], kontur: Ring): Hoehenfeld {
  const umwege: Umweg[] = [];
  const bereiche = baeume.map((b, i) => {
    const an = b.filter((_, n) => aktiv[i]![n]);
    if (an.length === 0) return null;
    for (const T of an) for (const N of teilbaum(T)) umwege.push({ quelle: i, ecke: N.ecke, weg: N.weg, bereich: N.sicht });
    return difference([{ outer: kontur, holes: [] }], an.flatMap((T) => T.flaeche)).filter((p) => !istSplitter(p));
  });
  return { ...basis, bereiche, umwege };
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

/** Entfernt wie ohneWoAllePositiv, aber nur innerhalb `nur` (Gültigkeitsbereich der dritten Teilquelle, R5). */
function ohneWoAllePositivIn(iv: Intervalle, fs: readonly (Lin1 | number)[], nur: Intervalle): Intervalle {
  const weg = nur.flatMap(([a, b]) => ohne([[a, b]], ...grenzen(ohneWoAllePositiv([[a, b]], fs), a, b)));
  let out = iv;
  for (const [a, b] of weg) out = ohne(out, a, b);
  return out;
}

/** Entfernter Teil (lo, hi) von [a, b], wenn ohneWoAllePositiv genau eine Lücke oder das Ganze entfernt hat. */
function grenzen(rest: Intervalle, a: number, b: number): [number, number] {
  if (rest.length === 0) return [a, b];
  if (rest.length === 2) return [rest[0]![1], rest[1]![0]];
  const [r0, r1] = rest[0]!;
  if (r0 === a && r1 === b) return [b, a]; // nichts entfernt
  return r0 === a ? [r1, b] : [a, r0];
}

/** Schnitt zweier sortierter Intervalllisten. */
function schnitt(p: Intervalle, q: Intervalle): Intervalle {
  const out: Intervalle = [];
  for (const [a, b] of p) for (const [c, d] of q) { const lo = Math.max(a, c), hi = Math.min(b, d); if (hi - lo > EPS) out.push([lo, hi]); }
  return out;
}

/** Lagetoleranz für Gültigkeitsbereiche (Clipper-Raster 0,1 mm, mit Reserve). */
const BEREICH_TOL = 1e-3;

/** Parameterbereiche der Geraden p0 + t·dir in den Polygonen (Rand und Abstand ≤ tol zählen als innen). */
function imGebiet(polys: readonly Polygon[], p0: Vec2, dir: Vec2, tol: number): Intervalle {
  const n = { x: -dir.y, y: dir.x };
  const ringe = polys.flatMap((p) => [p.outer, ...p.holes]);
  const ts: number[] = [];
  for (const r of ringe) {
    for (let i = 0; i < r.length; i++) {
      const p = r[i]!, q = r[(i + 1) % r.length]!;
      const sp = n.x * (p.x - p0.x) + n.y * (p.y - p0.y), sq = n.x * (q.x - p0.x) + n.y * (q.y - p0.y);
      const tp = dir.x * (p.x - p0.x) + dir.y * (p.y - p0.y), tq = dir.x * (q.x - p0.x) + dir.y * (q.y - p0.y);
      if (Math.abs(sp) <= tol + EPS) ts.push(tp);
      if ((sp > EPS && sq < -EPS) || (sp < -EPS && sq > EPS)) ts.push(tp + ((tq - tp) * sp) / (sp - sq));
    }
  }
  ts.sort((a, b) => a - b);
  const drin = (p: Vec2) => polys.some((poly) => pointInPolygon(p, poly) !== "outside") ||
    (tol > 0 && ringe.some((r) => r.some((a, i) => distPointSegment(p, a, r[(i + 1) % r.length]!) <= tol)));
  const iv: Intervalle = [];
  for (let i = 0; i + 1 < ts.length; i++) {
    const a = ts[i]!, b = ts[i + 1]!;
    if (b - a <= EPS || !drin({ x: p0.x + ((a + b) / 2) * dir.x, y: p0.y + ((a + b) / 2) * dir.y })) continue;
    const letztes = iv[iv.length - 1];
    if (letztes && a - letztes[1] <= EPS) letztes[1] = b;
    else iv.push([a, b]);
  }
  return iv;
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
  // Grob: N Abtastzellen mit Querabstand d; Übergänge Knick ↔ kein Knick per Bisektion mit kleinem
  // Querabstand (sonst endet eine Linie bis zu einer Zelle zu früh, Review b; Koten-Dubletten an Kehlen-Ecken).
  const N = 24, d = 0.02, dFein = 1e-5, schritte = 48;
  const knick = (t: number, q: number) => {
    const p = { x: p0.x + t * dir.x, y: p0.y + t * dir.y };
    const h = (s: number) => hoeheAm(f, { x: p.x - s * dir.y, y: p.y + s * dir.x });
    // Schwelle proportional zum Querabstand (Knick ≙ Neigungssprung, 1e-6 bei d = 2 cm wie bisher).
    return Math.abs(h(q) + h(-q) - 2 * h(0)) > 5e-5 * q;
  };
  /** Grenze zwischen tJa (Knick) und tNein (kein Knick). */
  const grenze = (tJa: number, tNein: number) => {
    let ja = tJa, nein = tNein;
    for (let i = 0; i < schritte && Math.abs(nein - ja) > EPS; i++) {
      const m = (ja + nein) / 2;
      if (knick(m, dFein)) ja = m; else nein = m;
    }
    return ja;
  };
  const out: Intervalle = [];
  for (const [a, b] of iv) {
    let start: number | null = null;
    const mitte = (i: number) => a + ((b - a) * (i + 0.5)) / N;
    for (let i = 0; i < N; i++) {
      const k = knick(mitte(i), d);
      if (k && start === null) start = i === 0 ? a : grenze(mitte(i), mitte(i - 1));
      else if (!k && start !== null) { out.push([start, grenze(mitte(i - 1), mitte(i))]); start = null; }
    }
    if (start !== null) out.push([start, b]);
  }
  // Ein Rand des Intervalls liegt meist exakt (Schnitt mit Dach/Ebenen); fast gleiche Enden darauf einrasten.
  return out.map(([s, e]) => [s - a0(iv, s) <= 1e-6 ? a0(iv, s) : s, b0(iv, e) - e <= 1e-6 ? b0(iv, e) : e] as [number, number]);
}

/**
 * Entfernt Teilstücke ohne Knick im Rahmen der Lagetoleranz: Liegt im Abstand LAGE_TOL beiderseits der
 * Linie dieselbe Neigung (parallele Ebenen), ist sie nur Rand eines Streifens schmaler als LAGE_TOL, dessen
 * Höhenversatz höchstens s · √2 · LAGE_TOL beträgt (z. B. Abläufe knapp über LAGE_TOL versetzt: Grat und
 * Kehle wenige cm nebeneinander, Scheingrat zur Dachecke). Danach verbleibende Reststücke ≤ LAGE_TOL entfallen.
 */
function ohneStreifen(f: Hoehenfeld, p0: Vec2, dir: Vec2, iv: Intervalle): Intervalle {
  const N = 24, schritte = 48, q = LAGE_TOL;
  const gleicheEbene = (e: Ebene, g: Ebene) => { const d = differenz(e, g); return parallel(d) && Math.abs(d.c) <= EPS; };
  /** Grenze zwischen den Ebenen e und g verläuft parallel zur Linie (Streifen statt Kreuzung/Einmündung). */
  const laengs = (e: Ebene, g: Ebene) => {
    const d = differenz(e, g);
    return Math.abs(d.a * dir.x + d.b * dir.y) <= EPS * Math.hypot(d.a, d.b);
  };
  const echt = (t: number) => {
    const p = { x: p0.x + t * dir.x, y: p0.y + t * dir.y };
    const bei = (s: number) => aktiveEbene(f, { x: p.x - s * dir.y, y: p.y + s * dir.x })!;
    const [s1, s2, n1, n2] = [bei(q), bei(-q), bei(KOTEN_GLEICH), bei(-KOTEN_GLEICH)];
    // Streifen: außen parallele, aber verschiedene Ebenen; jeder Ebenenwechsel innerhalb q läuft längs der Linie.
    if (!parallel(differenz(s1, s2)) || gleicheEbene(s1, s2)) return true;
    return !([[n1, s1], [n2, s2]] as const).every(([n, s]) => gleicheEbene(n, s) || laengs(n, s));
  };
  const grenze = (tJa: number, tNein: number) => {
    let ja = tJa, nein = tNein;
    for (let i = 0; i < schritte && Math.abs(nein - ja) > EPS; i++) {
      const m = (ja + nein) / 2;
      if (echt(m)) ja = m; else nein = m;
    }
    return ja;
  };
  const out: Intervalle = [];
  for (const [a, b] of iv) {
    const teile: Intervalle = [];
    let start: number | null = null;
    const n = Math.max(N, Math.ceil((b - a) / q));
    const pos = (i: number) => a + ((b - a) * i) / n;
    for (let i = 0; i <= n; i++) {
      const k = echt(pos(i));
      if (k && start === null) start = i === 0 ? a : grenze(pos(i), pos(i - 1));
      else if (!k && start !== null) { teile.push([start, grenze(pos(i - 1), pos(i))]); start = null; }
    }
    if (start !== null) teile.push([start, b]);
    const ganz = teile.length === 1 && teile[0]![0] === a && teile[0]![1] === b;
    out.push(...(ganz ? teile : teile.filter(([s, e]) => e - s > LAGE_TOL)));
  }
  return out;
}

/** Anfang/Ende des Ausgangsintervalls, das t enthält. */
const a0 = (iv: Intervalle, t: number) => iv.find(([a, b]) => t >= a - 1e-6 && t <= b + 1e-6)?.[0] ?? t;
const b0 = (iv: Intervalle, t: number) => iv.find(([a, b]) => t >= a - 1e-6 && t <= b + 1e-6)?.[1] ?? t;

function berechneFaltlinien(dach: Polygon, box: Vec2[], f: Hoehenfeld): Faltlinie[] {
  const mitte = { x: (box[0]!.x + box[2]!.x) / 2, y: (box[0]!.y + box[2]!.y) / 2 };
  const ebenen = teilquellen(f).flatMap((t) => SEITEN.map((k) => ({ t, i: t.i, nr: t.nr, k, L: ebeneDer(f.gefaelle, t.q, k) })));
  // Ein Streifen (ohneStreifen) setzt eine parallele Ebene voraus, deren Versatz höchstens der Höhenänderung
  // über LAGE_TOL entspricht (Breite ≤ LAGE_TOL, Neigungsunterschied ≤ 2 s); sonst entfällt die Abtastung.
  const streifenMoeglich = (L: Ebene) => ebenen.some((E) => {
    const d = differenz(E.L, L);
    return parallel(d) && Math.abs(d.c) > EPS && Math.abs(d.c) <= 2 * f.gefaelle * LAGE_TOL;
  });
  const out: Faltlinie[] = [];
  for (let x = 0; x < ebenen.length; x++) {
    for (let y = x + 1; y < ebenen.length; y++) {
      const A = ebenen[x]!, B = ebenen[y]!;
      // Parallele Ebenen schneiden sich nicht; gegenüberliegende Seiten einer Punktpyramide nur im Ablauf
      // (bei einer Strecke treffen sich die Seiten 1/3 in der Kehle entlang der Strecke).
      const dlt = differenz(A.L, B.L);
      if (parallel(dlt)) continue;
      if (A.nr === B.nr && (A.k - B.k) % 2 === 0 && quellLaenge(A.t.q) <= EPS) continue;
      // Teilquellen derselben Quelle mit getrennten Bereichen berühren sich nur am Fenster (dort stetig).
      if (A.i === B.i && A.nr !== B.nr && !(A.t.bereich && B.t.bereich)) continue;
      const norm = Math.hypot(dlt.a, dlt.b);
      const dir = { x: -dlt.b / norm, y: dlt.a / norm };
      const w = auswerten(dlt, mitte) / (norm * norm);
      const p0 = { x: mitte.x - w * dlt.a, y: mitte.y - w * dlt.b };
      const entlang = (e: Ebene): Lin1 | number => {
        const n = Math.hypot(e.a, e.b);
        return n <= EPS ? auswerten(e, p0) : [auswerten(e, p0) / n, (e.a * dir.x + e.b * dir.y) / n];
      };

      let iv = imDach(dach, p0, dir);
      for (const b of [A.t.bereich, B.t.bereich]) if (b && iv.length > 0) iv = schnitt(iv, imGebiet(b, p0, dir, BEREICH_TOL));
      // Auf der Geraden muss A in Pyramide A und B in Pyramide B die höchste Seite sein
      // (die Grenze A = B selbst ist die Gerade und entfällt) …
      for (const [P, Q] of [[A, B], [B, A]] as const) {
        for (const k2 of SEITEN) {
          if (k2 === P.k || (P.nr === Q.nr && k2 === Q.k)) continue;
          const g = entlang(differenz(P.L, ebeneDer(f.gefaelle, P.t.q, k2)));
          if (typeof g !== "number") iv = mindestens(iv, g);
          else if (g < -EPS) iv = [];
        }
      }
      // … und keine dritte Pyramide darf tiefer liegen.
      for (const u of teilquellen(f)) {
        if (u.i === A.i || u.i === B.i || iv.length === 0) continue;
        const fs = SEITEN.map((k2) => entlang(differenz(A.L, ebeneDer(f.gefaelle, u.q, k2))));
        iv = u.bereich ? ohneWoAllePositivIn(iv, fs, imGebiet(u.bereich, p0, dir, 0)) : ohneWoAllePositiv(iv, fs);
      }
      iv = nurKnicke(f, p0, dir, iv);
      if (iv.length > 0 && (streifenMoeglich(A.L) || streifenMoeglich(B.L))) iv = ohneStreifen(f, p0, dir, iv);
      for (const [a, b] of iv) {
        if (b - a <= EPS) continue;
        const von = { x: p0.x + a * dir.x, y: p0.y + a * dir.y }, bis = { x: p0.x + b * dir.x, y: p0.y + b * dir.y };
        const art = A.i === B.i ? "kehle" : "grat";
        const gleich = (l: Faltlinie) => l.art === art &&
          ((nah(l.von, von) && nah(l.bis, bis)) || (nah(l.von, bis) && nah(l.bis, von)));
        if (!out.some(gleich)) out.push({ art, von, bis, ablaufIds: [A.t.q.ablaufId, B.t.q.ablaufId] });
      }
    }
  }
  // Linien, die im Rahmen der Lagetoleranz auf einer Konturkante liegen, sind keine eigene Faltlinie.
  const kanten = [dach.outer, ...dach.holes].flatMap((r) => r.map((p, i) => [p, r[(i + 1) % r.length]!] as const));
  return out.filter((l) => !kanten.some(([p, q]) => distPointSegment(l.von, p, q) <= LAGE_TOL && distPointSegment(l.bis, p, q) <= LAGE_TOL));
}

/**
 * Jede Facettenkante zwischen zwei verschieden geneigten Facetten ist ein Knick. Fehlt sie in den abgetasteten
 * Faltlinien (z. B. Kehlen einer Punktquelle neben einer zweiten Quelle), wird sie ergänzt, damit 2D-Linien,
 * Koten und 3D-Netz dieselben Knicke zeigen.
 */
function ergaenzeKnicke(linien: Faltlinie[], facetten: readonly Facette[], dach: Polygon): Faltlinie[] {
  if (facetten.length < 2) return linien;
  const gleichEbene = (a: Facette, b: Facette) => Math.abs(a.ebene.a - b.ebene.a) <= 1e-9 && Math.abs(a.ebene.b - b.ebene.b) <= 1e-9 && Math.abs(a.ebene.c - b.ebene.c) <= 1e-9;
  const auf = (q: Vec2, p: Vec2, r: Vec2) => distPointSegment(q, p, r) <= LAGE_TOL;
  const kontur = [dach.outer, ...dach.holes].flatMap((r) => r.map((p, i) => [p, r[(i + 1) % r.length]!] as const));
  const out = [...linien];
  // Schmale Streifen (Lagetoleranz-Reste, Höhenversatz im mm-Bereich) sind keine eigenen Knicke.
  const breit = (f: Facette) => {
    const r = f.polygon.outer; let a = 0, u = 0;
    r.forEach((p, i) => { const q = r[(i + 1) % r.length]!; a += p.x * q.y - q.x * p.y; u += Math.hypot(q.x - p.x, q.y - p.y); });
    return u > 0 && Math.abs(a) / u > 0.1; // 2·Fläche/Umfang = Inkreis-Näherung
  };
  // Mit Streifen (Toleranz-Scheinlinien, vgl. Scheinkehlen-Tests) entscheidet allein die Abtastung.
  if (facetten.some((f) => !breit(f))) return linien;
  const randPunkt = (f: Facette, q: Vec2) => [f.polygon.outer, ...f.polygon.holes].some((r) => r.some((p, i) => auf(q, p, r[(i + 1) % r.length]!)));
  for (const f of facetten) {
    for (const r of [f.polygon.outer, ...f.polygon.holes]) {
      for (let i = 0; i < r.length; i++) {
        const von = r[i]!, bis = r[(i + 1) % r.length]!;
        if (Math.hypot(bis.x - von.x, bis.y - von.y) <= LAGE_TOL) continue;
        const m = { x: (von.x + bis.x) / 2, y: (von.y + bis.y) / 2 };
        const nachbarn = facetten.filter((o) => o !== f && randPunkt(o, m));
        if (nachbarn.length === 0 || nachbarn.every((o) => gleichEbene(o, f))) continue; // Kontur oder kein Knick
        if (kontur.some(([p, q]) => auf(von, p, q) && auf(bis, p, q))) continue;
        if (out.some((l) => auf(m, l.von, l.bis))) continue;
        // Nur Kehlen derselben Quelle: Grate/Teilungen zwischen Abläufen entscheidet die Abtastung (Scheinlinien-Tests).
        const o = !breit(f) ? undefined : nachbarn.find((n) => breit(n) && n.ablaufId === f.ablaufId && Math.hypot(n.ebene.a - f.ebene.a, n.ebene.b - f.ebene.b) > 1e-3 * (Math.hypot(f.ebene.a, f.ebene.b) || 1));
        if (o) out.push({ art: "kehle", von, bis, ablaufIds: [f.ablaufId, o.ablaufId] });
      }
    }
  }
  return out;
}

// ---------- Koten, HP/TP ----------

const nah = (p: Vec2, q: Vec2, tol = EPS) => Math.hypot(p.x - q.x, p.y - q.y) <= tol;
/** Koten näher als 0,1 mm gelten als derselbe Punkt (Faltlinien-Enden aus der Bisektion, Clipper-Raster). */
const KOTEN_GLEICH = 1e-4;
const RANG: Record<KotenArt, number> = { ablauf: 0, ecke: 1, grat: 2, kehle: 3, teilung: 4 };

function berechneKoten(teile: readonly Polygon[], f: Hoehenfeld, linien: readonly Faltlinie[], facetten: readonly Facette[] = []): Kote[] {
  const out: Kote[] = [];
  const add = (p: Vec2, art: KotenArt) => {
    const i = out.findIndex((k) => nah(k.position, p, KOTEN_GLEICH));
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
  for (const p of teilungsEnden(teile, facetten)) add(p, "teilung");
  return out;
}

/** Abstand, bis zu dem ein Facettenpunkt als auf der Kontur gilt (Clipper-Raster 0,1 mm). */
const AUF_KONTUR = 2e-4;

/**
 * Punkte auf der Kontur (außen/Löcher), an denen Facetten verschiedener Abläufe/Seiten aneinanderstoßen:
 * Enden von Grat/Kehle oder einer knickfreien Teilung (z. B. Mittelsenkrechte zweier Abläufe) am Rand.
 */
function teilungsEnden(teile: readonly Polygon[], facetten: readonly Facette[]): Vec2[] {
  const ringe = teile.flatMap((t) => [t.outer, ...t.holes]);
  const aufKontur = (p: Vec2) => ringe.some((r) => r.some((a, i) => distPointSegment(p, a, r[(i + 1) % r.length]!) <= AUF_KONTUR));
  const kandidaten: { p: Vec2; schluessel: string }[] = [];
  for (const fa of facetten) {
    const schluessel = `${fa.ablaufId}/${fa.seite}`;
    for (const r of [fa.polygon.outer, ...fa.polygon.holes]) for (const p of r) if (aufKontur(p)) kandidaten.push({ p, schluessel });
  }
  const out: Vec2[] = [];
  for (const k of kandidaten) {
    if (out.some((q) => nah(q, k.p, AUF_KONTUR))) continue;
    if (kandidaten.some((x) => x.schluessel !== k.schluessel && nah(x.p, k.p, AUF_KONTUR))) out.push(k.p);
  }
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

/**
 * Fasst benachbarte Facetten mit identischer Ebene (gleiche Zone) zu einer zusammen: zwischen ihnen liegt
 * kein Knick, die Grenze ist nur Folge der Ablaufzuordnung (Gleichstandsbereich). Für Darstellung (2D/3D)
 * und Plattenraster; Einzugsflächen bleiben an den Original-Facetten. Metadaten (Id, Ablauf, Seite) vom
 * Teil mit der größten Fläche im Ergebnisstück.
 */
export function ebeneFacetten(facetten: readonly Facette[]): Facette[] {
  const gleich = (a: Ebene, b: Ebene) => Math.abs(a.a - b.a) <= 1e-9 && Math.abs(a.b - b.b) <= 1e-9 && Math.abs(a.c - b.c) <= 1e-9;
  const out: Facette[] = [];
  const rest = [...facetten];
  while (rest.length > 0) {
    const f0 = rest.shift()!;
    const gruppe = [f0];
    for (let i = rest.length - 1; i >= 0; i--) {
      if (rest[i]!.zoneId === f0.zoneId && gleich(rest[i]!.ebene, f0.ebene)) gruppe.unshift(...rest.splice(i, 1));
    }
    if (gruppe.length === 1) { out.push(f0); continue; }
    for (const polygon of union(gruppe.map((f) => f.polygon))) {
      const c = innenpunkt(polygon);
      const traeger = gruppe.find((f) => pointInPolygon(c, f.polygon) !== "outside") ?? gruppe[0]!;
      out.push({ ...traeger, polygon, flaeche: polygonArea(polygon) });
    }
  }
  return out;
}
