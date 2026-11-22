/**
 * layoutInsulation (PLAN §5, Schritt 24): Gefälledämmplan je Dachfläche aus dem Höhenfeld.
 *
 * Je Facette ein Raster im Plattenformat: Reihen (Länge L) quer zur Fallrichtung, Spalten (Breite B)
 * ab dem Ablauf (Verlegestart). Reihe m beginnt dort, wo der Gefälleanteil p = h − h_min den Wert
 * m · Δ erreicht (Δ = Plattengefälle · L); Typ = m mod n, Zusatzlagen = ⌊m / n⌋ (Neustart über dem
 * höchsten Typ, Bezeichnung "k+c"). Jede Rasterzelle wird mit der Facette geschnitten (Zuschnitt an
 * Facettengrenzen und Kontur). Stücke an einer Kehle werden Kehlkeile (Katalog, Seite L/R mit Blick
 * zum Ablauf); passt der Kehlwinkel nicht zum Katalog, bleibt das Stück Zuschnitt und es gibt einen
 * Befund. An Graten treffen die Raster benachbarter Abläufe gespiegelt ohne Keil zusammen.
 * Dämmdicke = Grundlage + Zusatzlagen + Platte = d_TP + p (bei Dachgefälle = Plattengefälle).
 * Rein und deterministisch; keine Stückliste.
 */
import { CLIPPER_SCALE, intersection } from "../geometry/clipper";
import { EPS } from "../geometry/eps";
import { pointInPolygon, polygonArea, polygonCentroid } from "../geometry/polygon";
import { distPointSegment } from "../geometry/segment";
import type { Polygon, Ring, Vec2 } from "../geometry/types";
import type { Befund } from "../checks/types";
import { QUELLE_PROGRAMM } from "../checks/types";
import type { Dachflaeche, ProjectModel } from "../model/types";
import { standardDaemmdickeTiefpunkt } from "../rules/regeln";
import type { Kehlkeil } from "../rules/types";
import { auswerten } from "../slope/hoehenfeld";
import { ebeneFacetten } from "../slope/slope";
import type { DachGefaelle, Ebene, Facette, Faltlinie, Hoehenfeld, SlopeResult } from "../slope/types";
import type {
  DaemmplanDach, InsulationLayout, LayoutOptionen, PlateCatalog, Verlegepfeil, Verlegestart, VerlegtePlatte,
} from "./types";

const MM_JE_M = 1000;
const GRAD = 180 / Math.PI;
/** Lagetoleranz für "Kante liegt auf Kehle/Grat" in m (Clipper-Raster 0,1 mm, mit Reserve). */
const LAGE_TOL = 1e-3;
/** Winkeltoleranz Kehle ↔ Katalog in Grad. */
const WINKEL_TOL = 0.5;
/** Kehle praktisch parallel zur Reihe (z. B. LES-Achse): kein Kehlkeil. */
const PARALLEL_GRAD = 1;
/** Standard-Kehlwinkel der Katalogkeile in Grad (L∞-Höhenfeld: 45°-Kehlen). */
export const KEHLWINKEL_STANDARD = 45;

const punkt = (o: Vec2, eu: Vec2, ew: Vec2, u: number, w: number): Vec2 =>
  ({ x: o.x + u * eu.x + w * ew.x, y: o.y + u * eu.y + w * ew.y });
const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y;
const umfang = (r: Ring) => r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]!; return s + Math.hypot(q.x - p.x, q.y - p.y); }, 0);
/** Rundungsrest der Clipper-Operation (Fläche ≈ Umfang · Raster). */
const splitter = (p: Polygon) => polygonArea(p) <= umfang(p.outer) / CLIPPER_SCALE;

/** Aufbereiteter Katalog. */
interface Kat {
  readonly L: number;
  readonly B: number;
  readonly gefaelle: number;
  readonly typen: readonly { readonly typ: string; readonly dickeAnfang: number }[];
  readonly dickeAnfang0: number;
  readonly zusatzlage: number;
  readonly keile: readonly Kehlkeil[];
}

function befund(stufe: Befund["stufe"], code: string, meldung: string, objektId: string | null, dachflaecheId?: string, extra: Partial<Befund> = {}): Befund {
  return { stufe, code, meldung, objektId, ...(dachflaecheId ? { dachflaecheId } : {}), regelId: `daemmplan-${code}`, quelle: QUELLE_PROGRAMM, ...extra };
}

function katalog(cat: PlateCatalog, befunde: Befund[]): Kat | null {
  const d = cat.daten;
  if (!cat.geprueft) {
    befunde.push(befund("hinweis", "katalog-ungeprueft", `Plattenkatalog ungeprüft: ${cat.titel ?? cat.id} (Version ${cat.version})`, cat.id));
  }
  const erste = d.typen[0], letzte = d.typen[d.typen.length - 1];
  if (!erste || !letzte || !(d.format.laenge > 0) || !(d.format.breite > 0) || !(d.gefaelle > 0)) {
    befunde.push(befund("fehler", "katalog-leer", "Plattenkatalog ohne Typen, Format oder Gefälle; kein Dämmplan erzeugt.", cat.id));
    return null;
  }
  const stufe = d.gefaelle * d.format.laenge;
  d.typen.forEach((t) => {
    if (Math.abs(t.dickeEnde - t.dickeAnfang - stufe) > EPS) {
      befunde.push(befund("warnung", "katalog-stufe", `Plattentyp ${t.typ}: Dickenzuwachs passt nicht zu Gefälle × Plattenlänge; gerechnet wird mit dem Plattengefälle.`, cat.id));
    }
  });
  return {
    L: d.format.laenge, B: d.format.breite, gefaelle: d.gefaelle,
    typen: d.typen.map((t) => ({ typ: t.typ, dickeAnfang: t.dickeAnfang })),
    dickeAnfang0: erste.dickeAnfang,
    zusatzlage: d.zusatzlage?.dicke ?? letzte.dickeEnde - erste.dickeAnfang,
    keile: d.kehlkeile ?? [],
  };
}

export function layoutInsulation(m: ProjectModel, s: SlopeResult, cat: PlateCatalog, opt: LayoutOptionen = {}): InsulationLayout {
  const befunde: Befund[] = [];
  const kat = katalog(cat, befunde);
  const dachflaechen: DaemmplanDach[] = [];
  if (kat) {
    for (const g of s.dachflaechen) {
      const d = m.dachflaechen.find((x) => x.id === g.dachflaecheId);
      if (d) dachflaechen.push(dachPlan(d, g, kat, cat, opt, befunde));
    }
  }
  return { katalog: { packId: cat.id, version: cat.version }, dachflaechen, befunde };
}

/** Gruppe = Hauptfläche ("") oder Zone: eigener Tiefpunkt, eigene Grate/Kehlen, eigenes Feld. */
interface Gruppe { readonly hMin: number; readonly linien: readonly Faltlinie[]; readonly feld: Hoehenfeld }

function gruppen(g: DachGefaelle): Map<string, Gruppe> {
  const out = new Map<string, Gruppe>();
  const hMin = (fs: readonly Facette[]) => Math.min(...fs.flatMap((f) => f.polygon.outer.map((v) => auswerten(f.ebene, v))));
  const haupt = g.facetten.filter((f) => f.zoneId === undefined);
  if (haupt.length > 0) out.set("", { hMin: hMin(haupt), linien: g.linien, feld: g.feld });
  for (const z of g.zonen) if (z.facetten.length > 0) out.set(z.zoneId, { hMin: hMin(z.facetten), linien: z.linien, feld: z.feld });
  return out;
}

function dachPlan(d: Dachflaeche, g: DachGefaelle, kat: Kat, cat: PlateCatalog, opt: LayoutOptionen, befunde: Befund[]): DaemmplanDach {
  const dtpMm = g.daemmung?.tiefpunktDicke ?? d.daemmdickeTiefpunkt ?? opt.daemmdickeTiefpunktStandard ?? standardDaemmdickeTiefpunkt(cat) ?? 0;
  const tiefpunktDicke = dtpMm / MM_JE_M;
  let grundlage = tiefpunktDicke - kat.dickeAnfang0;
  if (grundlage < -EPS) {
    befunde.push(befund("warnung", "tiefpunktdicke-unter-typ1",
      `Mindestdämmdicke am Tiefpunkt (${dtpMm} mm) ist kleiner als die Anfangsdicke von Typ ${kat.typen[0]!.typ}; Platten beginnen mit Typ ${kat.typen[0]!.typ}.`,
      d.id, d.id, { wert: tiefpunktDicke, grenze: kat.dickeAnfang0, differenz: kat.dickeAnfang0 - tiefpunktDicke }));
  }
  grundlage = Math.max(0, grundlage);

  const gr = gruppen(g);
  const platten: VerlegtePlatte[] = [];
  const pfeile: Verlegepfeil[] = [];
  const verlegestarts: Verlegestart[] = [];
  const gemeldet = new Set<string>();
  let gefaelleAbweichend = false;
  for (const f of ebeneFacetten(g.facetten)) {
    const grp = gr.get(f.zoneId ?? "");
    if (!grp) continue;
    if (f.gefaelle > EPS && Math.abs(f.gefaelle - kat.gefaelle) > EPS) gefaelleAbweichend = true;
    const r = facettePlan(d.id, f, grp, kat, grundlage, befunde, gemeldet);
    platten.push(...r.platten);
    pfeile.push(...r.pfeile);
    verlegestarts.push(r.start);
  }
  if (gefaelleAbweichend) {
    befunde.push(befund("warnung", "gefaelle-abweichend",
      `${d.name || d.id}: Dachgefälle weicht vom Plattengefälle (${kat.gefaelle * 100} %) ab; Plattendicken folgen dem Plattengefälle, nicht dem Höhenfeld.`, d.id, d.id));
  }
  const tp = g.tiefpunkt;
  return {
    dachflaecheId: d.id, platten, pfeile, verlegestarts,
    n0: tp && tp.orte[0] ? { position: tp.orte[0], kote: tp.kote } : null,
    tiefpunktDicke, grundlage, zusatzlageDicke: kat.zusatzlage,
  };
}

/** Kehle/Grat, auf der eine Kante des Stücks liegt (Index in `linien`), sonst −1. */
function anLinie(p: Polygon, linien: readonly Faltlinie[], art: Faltlinie["art"]): number {
  const r = p.outer;
  for (let i = 0; i < r.length; i++) {
    const a = r[i]!, b = r[(i + 1) % r.length]!;
    if (Math.hypot(b.x - a.x, b.y - a.y) <= LAGE_TOL) continue;
    const k = linien.findIndex((l) => l.art === art && distPointSegment(a, l.von, l.bis) <= LAGE_TOL && distPointSegment(b, l.von, l.bis) <= LAGE_TOL);
    if (k >= 0) return k;
  }
  return -1;
}

function innen(p: Polygon): Vec2 {
  const c = polygonCentroid(p);
  if (pointInPolygon(c, p) === "inside") return c;
  const r = p.outer;
  return { x: r.reduce((s, v) => s + v.x, 0) / r.length, y: r.reduce((s, v) => s + v.y, 0) / r.length };
}

function facettePlan(
  dachId: string, f: Facette, grp: Gruppe, kat: Kat, grundlage: number, befunde: Befund[], gemeldet: Set<string>,
): { platten: VerlegtePlatte[]; pfeile: Verlegepfeil[]; start: Verlegestart } {
  const q = grp.feld.quellen.find((x) => x.ablaufId === f.ablaufId)!;
  const flach = !(f.gefaelle > EPS);
  // Rasterursprung: Ansatzpunkt der Pyramidenseite (Seite 0 am Streckenende, sonst am Ablauf).
  const O = f.seite === 0 && !flach ? q.bis : q.position;
  const eu: Vec2 = flach ? grp.feld.achse : { x: -f.fallrichtung.x, y: -f.fallrichtung.y };
  const ew: Vec2 = { x: -eu.y, y: eu.x };
  const start: Verlegestart = { facetteId: f.id, ablaufId: f.ablaufId, punkt: { ...O }, reihenrichtung: eu, spaltenrichtung: ew };
  // Reihe 0 beginnt bei p = 0 (Gefälleanteil über Tiefpunkt); p wächst bergauf mit dem Facettengefälle.
  const u0 = flach ? 0 : -(auswerten(f.ebene, O) - grp.hMin) / f.gefaelle;
  let uMin = Infinity, uMax = -Infinity, wMin = Infinity, wMax = -Infinity;
  for (const r of [f.polygon.outer, ...f.polygon.holes]) {
    for (const v of r) {
      const u = dot({ x: v.x - O.x, y: v.y - O.y }, eu), w = dot({ x: v.x - O.x, y: v.y - O.y }, ew);
      uMin = Math.min(uMin, u); uMax = Math.max(uMax, u); wMin = Math.min(wMin, w); wMax = Math.max(wMax, w);
    }
  }
  const { L, B } = kat;
  const n = kat.typen.length;
  const tol = 1e-9;
  const mLo = Math.max(0, Math.floor((uMin - u0) / L + tol)), mHi = Math.ceil((uMax - u0) / L - tol) - 1;
  const jLo = Math.floor(wMin / B + tol), jHi = Math.ceil(wMax / B - tol) - 1;
  const platten: VerlegtePlatte[] = [];
  const pfeile: Verlegepfeil[] = [];
  const oU = dot(O, eu);

  for (let mm = mLo; mm <= mHi; mm++) {
    const ua = u0 + mm * L, ub = ua + L;
    const c = Math.floor(mm / n), k = mm % n;
    const typ = kat.typen[k]!;
    // Gesamtdicke im Stück: Grundlage + Zusatzlagen + Platte (Anfangsdicke + Plattengefälle · Abstand).
    const basis = flach ? grundlage + kat.dickeAnfang0 : grundlage + c * kat.zusatzlage + typ.dickeAnfang;
    const gp = flach ? 0 : kat.gefaelle;
    const dicke: Ebene = { a: gp * eu.x, b: gp * eu.y, c: basis - gp * (oU + ua) };
    let groesste: { flaeche: number; p: Vec2 } | null = null;
    for (let j = jLo; j <= jHi; j++) {
      const wa = j * B, wb = wa + B;
      const zelle: Ring = [punkt(O, eu, ew, ua, wa), punkt(O, eu, ew, ub, wa), punkt(O, eu, ew, ub, wb), punkt(O, eu, ew, ua, wb)];
      const stuecke = intersection([f.polygon], [{ outer: zelle, holes: [] }]).filter((p) => !splitter(p));
      for (const [idx, st] of stuecke.entries()) {
        const flaeche = polygonArea(st);
        const ganz = stuecke.length === 1 && st.holes.length === 0 && Math.abs(flaeche - L * B) <= 2 * umfang(st.outer) / CLIPPER_SCALE;
        const polygon: Polygon = ganz ? { outer: zelle, holes: [] } : st;
        let su0 = Infinity, su1 = -Infinity, sw0 = Infinity, sw1 = -Infinity;
        for (const v of polygon.outer) {
          const u = dot({ x: v.x - O.x, y: v.y - O.y }, eu), w = dot({ x: v.x - O.x, y: v.y - O.y }, ew);
          su0 = Math.min(su0, u); su1 = Math.max(su1, u); sw0 = Math.min(sw0, w); sw1 = Math.max(sw1, w);
        }
        const id = `${f.id}/${mm}/${j}${stuecke.length > 1 ? `/${idx}` : ""}`;
        const zusatz = c > 0 ? `+${c}` : "";
        let art: VerlegtePlatte["art"] = flach ? "flach" : "platte";
        let bezeichnung = flach ? "F" : `${typ.typ}${zusatz}`;
        let keil: { id: string; seite: "L" | "R"; voll: number } | null = null;
        if (!flach && !ganz) {
          const ki = anLinie(polygon, grp.linien, "kehle");
          if (ki >= 0) keil = kehlkeil(dachId, f, grp, ki, polygon, typ.typ, kat, befunde, gemeldet);
        }
        if (keil) {
          art = "kehlkeil";
          bezeichnung = `K${typ.typ}${zusatz} ${keil.seite}`;
        }
        const voll = keil ? keil.voll : L * B;
        platten.push({
          id, dachflaecheId: dachId, facetteId: f.id, ...(f.zoneId !== undefined ? { zoneId: f.zoneId } : {}), ablaufId: f.ablaufId,
          art, typ: flach ? null : typ.typ, zusatzlagen: flach ? 0 : c,
          ...(keil ? { kehlkeilId: keil.id, seite: keil.seite } : {}),
          bezeichnung, reihe: mm, spalte: j,
          zuschnitt: !ganz && flaeche < voll - 2 * umfang(polygon.outer) / CLIPPER_SCALE,
          gratschnitt: !ganz && anLinie(polygon, grp.linien, "grat") >= 0,
          polygon, flaeche: ganz ? L * B : flaeche, rohplatte: zelle,
          laenge: su1 - su0, breite: sw1 - sw0,
          richtung: eu, dicke,
        });
        if (!groesste || flaeche > groesste.flaeche + EPS) groesste = { flaeche, p: innen(polygon) };
      }
    }
    if (groesste && !flach) pfeile.push({ facetteId: f.id, reihe: mm, start: groesste.p, richtung: { x: -eu.x, y: -eu.y } });
  }
  return { platten, pfeile, start };
}

/**
 * Kehlkeil für ein Stück an Kehle `ki`: Winkel Kehle ↔ Reihe aus der Geometrie, Seite mit Blick die
 * Kehle hinab. Parallel zur Reihe → kein Keil (null). Kein passender Katalogkeil → Befund, null.
 */
function kehlkeil(
  dachId: string, f: Facette, grp: Gruppe, ki: number, p: Polygon, typ: string, kat: Kat, befunde: Befund[], gemeldet: Set<string>,
): { id: string; seite: "L" | "R"; voll: number } | null {
  const l = grp.linien[ki]!;
  const ha = auswerten(f.ebene, l.von), hb = auswerten(f.ebene, l.bis);
  const [hoch, tief] = ha >= hb ? [l.von, l.bis] : [l.bis, l.von];
  const dx = tief.x - hoch.x, dy = tief.y - hoch.y;
  const len = Math.hypot(dx, dy);
  const reihe = { x: -f.fallrichtung.y, y: f.fallrichtung.x };
  const cos = Math.abs(dx * reihe.x + dy * reihe.y) / len;
  const winkel = Math.acos(Math.min(1, cos)) * GRAD; // 0° = parallel zur Reihe, 90° = in Fallrichtung
  if (winkel < PARALLEL_GRAD || winkel > 90 - PARALLEL_GRAD) return null;
  const c = innen(p);
  const seite: "L" | "R" = dx * (c.y - hoch.y) - dy * (c.x - hoch.x) > 0 ? "L" : "R";
  const k = kat.keile.find((e) => e.typ === typ && e.seite === seite && Math.abs((e.winkel ?? KEHLWINKEL_STANDARD) - winkel) <= WINKEL_TOL);
  if (k) return { id: k.id, seite, voll: (k.laenge * k.breite) / 2 };
  const schluessel = `${f.id}|${ki}|${typ}|${seite}`;
  if (!gemeldet.has(schluessel)) {
    gemeldet.add(schluessel);
    const mitte = { x: (l.von.x + l.bis.x) / 2, y: (l.von.y + l.bis.y) / 2 };
    befunde.push(befund("warnung", "kehlkeil-nicht-im-katalog",
      `Kehlkeil nicht im Katalog: Typ ${typ} ${seite}, Kehlwinkel ${winkel.toFixed(1)}° (Katalog ${KEHLWINKEL_STANDARD}°); Stück als Zuschnitt geplant.`,
      f.ablaufId, dachId, { ort: mitte, wert: winkel, grenze: KEHLWINKEL_STANDARD }));
  }
  return null;
}
