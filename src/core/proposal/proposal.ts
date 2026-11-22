/**
 * Vorschlag Abläufe (PLAN Schritt 31): Anzahl und Lage zusätzlicher Gullys je Dachfläche, sodass
 * jede Einzugsfläche unter der Grenze `flaeche-je-ablauf.hinweisAb` des Regel-Packs bleibt und der
 * Hochpunkt die Planungsvorgabe `maxHochpunkt` (Dach/Zone) nicht überschreitet.
 *
 * Verfahren (rein, deterministisch): Für k = kMin, kMin+1, … werden k neue Abläufe auf einem Raster
 * der Dachfläche verteilt (Startlage gleichmäßiges Gitter, danach Lloyd-Iteration über die
 * additiv gewichtete Zuordnung z_i + s · d, wie im Höhenfeld; vorhandene Entwässerungen bleiben fest).
 * Jeder Kandidat wird mit computeSlope/computeCatchments/pruefeVorgaben bewertet; das erste k, das
 * alle Kriterien erfüllt, wird vorgeschlagen. Das Modell wird nicht verändert.
 */
import { EPS } from "../geometry/eps";
import { pointInPolygon, polygonArea } from "../geometry/polygon";
import { dist } from "../geometry/segment";
import type { Polygon, Vec2 } from "../geometry/types";
import { computeCatchments } from "../catchment/catchment";
import { pruefeVorgaben, REGEL_VORGABE_MAX_HP } from "../checks/vorgaben";
import { QUELLE_PROGRAMM, type Befund } from "../checks/types";
import { addPunktablauf, type TypWahl } from "../edit/commands";
import type { Befehl } from "../edit/history";
import { dachPolygon, konturKante } from "../model/model";
import type { Dachflaeche, Entwaesserung, Id, ProjectModel } from "../model/types";
import { bewerteEinzugsflaeche, REGEL_FLAECHE_JE_ABLAUF, regelParameter, type RegelWert } from "../rules/regeln";
import type { RegelPack, RulePack } from "../rules/types";
import { computeSlope } from "../slope/slope";

export const REGEL_VORSCHLAG_ABLAEUFE = "vorschlag-ablaeufe";

export interface AblaufVorschlag {
  readonly dachflaecheId: Id;
  /** Lage in m, auf cm gerundet, innerhalb der Dachfläche (nicht in Aufbauten). */
  readonly position: Vec2;
  /** Kote OK Abdichtung am Ablauf in m. */
  readonly z: number;
}

export interface VorschlagOptionen {
  /** Nur diese Dachfläche; sonst alle. */
  readonly dachflaecheId?: Id;
  /** Kote der neuen Abläufe; sonst kleinste vorhandene Ablaufkote, sonst minTiefpunkt, sonst 0. */
  readonly z?: number;
  /** Höchstzahl zusätzlicher Abläufe je Dachfläche über die Mindestzahl hinaus (Standard 40). */
  readonly maxZusatz?: number;
  /** Rasterpunkte für die Verteilung (Standard 4000). */
  readonly rasterPunkte?: number;
  readonly daemmdickeTiefpunktStandard?: number;
}

export interface VorschlagErgebnis {
  readonly ablaeufe: readonly AblaufVorschlag[];
  readonly befunde: readonly Befund[];
}

const STANDARD_MAX_ZUSATZ = 40;
const STANDARD_RASTER = 4000;
const LLOYD_MAX = 60;
const CM = 100;

export function schlageAblaeufeVor(m: ProjectModel, packs: readonly RulePack[], opt: VorschlagOptionen = {}): VorschlagErgebnis {
  const ablaeufe: AblaufVorschlag[] = [];
  const befunde: Befund[] = [];
  const regeln = packs.find((p): p is RegelPack => p.typ === "regeln" && p.daten.regeln.some((x) => x.id === REGEL_FLAECHE_JE_ABLAUF));
  const grenze = regeln ? regelParameter(regeln, REGEL_FLAECHE_JE_ABLAUF, "hinweisAb") : null;
  const flaechenGrenze = grenze && grenze.einheit === "m2" ? grenze : null;
  for (const d of m.dachflaechen) {
    if (opt.dachflaecheId !== undefined && d.id !== opt.dachflaecheId) continue;
    const r = schlageVorFuerDach(m, d, packs, regeln ?? null, flaechenGrenze, opt);
    ablaeufe.push(...r.ablaeufe);
    befunde.push(...r.befunde);
  }
  return { ablaeufe, befunde };
}

/** Ein Befehl (ein Undo-Schritt), der alle Vorschläge als Gullys hinzufügt. */
export function ablaeufeHinzufuegen(vorschlaege: readonly AblaufVorschlag[], typ: TypWahl | null = null): Befehl {
  return {
    label: "Abläufe vorschlagen",
    anwenden: (m) => vorschlaege.reduce((acc, v) => addPunktablauf(v.dachflaecheId, "gully", v.position, v.z, typ).anwenden(acc), m),
  };
}

// ---------- je Dachfläche ----------

interface Bewertung { readonly ok: boolean; readonly flaecheOk: boolean; readonly hpOk: boolean; readonly maxFlaeche: number }

function schlageVorFuerDach(
  m: ProjectModel, d: Dachflaeche, packs: readonly RulePack[], regeln: RegelPack | null,
  grenze: RegelWert | null, opt: VorschlagOptionen,
): VorschlagErgebnis {
  const name = d.name || d.id;
  const basis = { dachflaecheId: d.id, objektId: d.id };
  const maxHp = hoechsteVorgabeHp(d);
  if (!grenze && maxHp === undefined) {
    return { ablaeufe: [], befunde: [{ ...basis, stufe: "hinweis", code: "vorschlag-kein-kriterium", regelId: REGEL_FLAECHE_JE_ABLAUF,
      quelle: regeln?.quelle ?? QUELLE_PROGRAMM,
      meldung: `${name}: Regel „${REGEL_FLAECHE_JE_ABLAUF}“ fehlt und kein max. Hochpunkt vorgegeben; kein Ablaufvorschlag möglich.` }] };
  }
  const z = opt.z ?? (d.entwaesserung.length > 0 ? Math.min(...d.entwaesserung.map((e) => e.z)) : d.vorgaben.minTiefpunkt ?? 0);
  const poly = dachPolygon(d);
  const raster = rasterPunkte(poly, opt.rasterPunkte ?? STANDARD_RASTER);
  if (raster.length === 0) return { ablaeufe: [], befunde: [] };

  const bewerte = (kand: ProjectModel): Bewertung => {
    const slope = computeSlope(kand, { packs, ...(opt.daemmdickeTiefpunktStandard !== undefined ? { daemmdickeTiefpunktStandard: opt.daemmdickeTiefpunktStandard } : {}) });
    let maxFlaeche = 0, flaecheOk = true;
    if (grenze && regeln) {
      const c = computeCatchments(kand, slope, { regeln });
      for (const f of c.flaechen) {
        if (f.dachflaecheId !== d.id) continue;
        maxFlaeche = Math.max(maxFlaeche, f.gesamtFlaeche);
        if (bewerteEinzugsflaeche(f.gesamtFlaeche, regeln)?.stufe !== "ok") flaecheOk = false;
      }
    }
    const hpOk = maxHp === undefined
      || !pruefeVorgaben(kand, slope).some((b) => b.code === REGEL_VORGABE_MAX_HP && b.dachflaecheId === d.id);
    return { ok: flaecheOk && hpOk, flaecheOk, hpOk, maxFlaeche };
  };

  const vorhanden = d.entwaesserung.length;
  if (vorhanden > 0 && bewerte(m).ok) {
    return { ablaeufe: [], befunde: [{ ...basis, stufe: "hinweis", code: "vorschlag-nicht-noetig", regelId: REGEL_VORSCHLAG_ABLAEUFE,
      quelle: QUELLE_PROGRAMM, meldung: `${name}: vorhandene Abläufe genügen; kein weiterer Ablauf nötig.` }] };
  }
  if (maxHp !== undefined && maxHp < z - EPS) {
    return { ablaeufe: [], befunde: [{ ...basis, stufe: "warnung", code: "vorschlag-ziel-nicht-erreicht", regelId: REGEL_VORGABE_MAX_HP,
      quelle: `Planungsvorgabe Dachfläche „${name}“`, wert: z, grenze: maxHp, differenz: z - maxHp,
      meldung: `${name}: Ablaufkote liegt über dem max. Hochpunkt; kein Vorschlag möglich.` }] };
  }

  const flaeche = polygonArea(poly);
  const kMin = Math.max(1, grenze ? Math.floor(flaeche / grenze.wert) + 1 - vorhanden : 1);
  const kMax = kMin + (opt.maxZusatz ?? STANDARD_MAX_ZUSATZ);
  const fest = festePunkte(d);
  const s = m.gefaelleStandard > EPS ? m.gefaelleStandard : 1;
  let letzte: Bewertung | null = null;
  for (let k = kMin; k <= kMax; k++) {
    const pos = verteile(poly, raster, fest, k, s, z);
    const vorschlaege = pos.map((p): AblaufVorschlag => ({ dachflaecheId: d.id, position: p, z }));
    const kand = ablaeufeHinzufuegen(vorschlaege).anwenden(m);
    letzte = bewerte(kand);
    if (letzte.ok) {
      return { ablaeufe: vorschlaege, befunde: [{ ...basis, stufe: "hinweis", code: "vorschlag-ablaeufe", regelId: REGEL_VORSCHLAG_ABLAEUFE,
        quelle: grenze ? grenze.quelle : QUELLE_PROGRAMM, wert: k,
        ...(grenze ? { grenze: grenze.wert } : {}),
        meldung: `${name}: ${k} zusätzliche${k === 1 ? "r" : ""} Ablauf${k === 1 ? "" : "e"} vorgeschlagen`
          + (grenze ? `; größte Einzugsfläche ${letzte.maxFlaeche.toFixed(1)} m² unter ${grenze.wert} m².` : ".") }] };
    }
  }
  const grund = letzte && !letzte.hpOk ? "max. Hochpunkt" : "Fläche je Ablauf";
  return { ablaeufe: [], befunde: [{ ...basis, stufe: "warnung", code: "vorschlag-ziel-nicht-erreicht",
    regelId: letzte && !letzte.hpOk ? REGEL_VORGABE_MAX_HP : REGEL_FLAECHE_JE_ABLAUF,
    quelle: grenze && (!letzte || letzte.hpOk) ? grenze.quelle : `Planungsvorgabe Dachfläche „${name}“`,
    meldung: `${name}: mit bis zu ${kMax} zusätzlichen Abläufen nicht erreichbar (${grund}); Ablauflage manuell planen.` }] };
}

/** Kleinster vorgegebener max. Hochpunkt (Dach oder Zone); undefined ohne Vorgabe. */
function hoechsteVorgabeHp(d: Dachflaeche): number | undefined {
  const werte = [d.vorgaben.maxHochpunkt, ...d.zonen.map((zo) => zo.vorgaben?.maxHochpunkt)].filter((x): x is number => x !== undefined);
  return werte.length > 0 ? Math.min(...werte) : undefined;
}

// ---------- Verteilung ----------

interface FesterPunkt { readonly p: Vec2; readonly z: number }

function festePunkte(d: Dachflaeche): FesterPunkt[] {
  return d.entwaesserung.flatMap((e: Entwaesserung): FesterPunkt[] => {
    switch (e.art) {
      case "gully": case "notablauf": return [{ p: e.position, z: e.z }];
      case "les": return [{ p: { x: (e.von.x + e.bis.x) / 2, y: (e.von.y + e.bis.y) / 2 }, z: e.z }];
      case "dachreiter": {
        const k = konturKante(d.kontur, e.lage.kante);
        if (!k) return [];
        const l = dist(k[0], k[1]), t = l > EPS ? Math.min(1, Math.max(0, e.lage.abstand / l)) : 0;
        return [{ p: { x: k[0].x + t * (k[1].x - k[0].x), y: k[0].y + t * (k[1].y - k[0].y) }, z: e.z }];
      }
    }
  });
}

function bbox(poly: Polygon) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of poly.outer) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  return { x0, y0, x1, y1 };
}

/** Zellmittelpunkte eines Gitters (≈ n Zellen) innerhalb der Dachfläche, zeilenweise. */
function rasterPunkte(poly: Polygon, n: number): Vec2[] {
  const a = polygonArea(poly);
  if (!(a > EPS)) return [];
  const h = Math.sqrt(a / Math.max(1, n));
  const b = bbox(poly);
  const out: Vec2[] = [];
  for (let y = b.y0 + h / 2; y < b.y1; y += h) {
    for (let x = b.x0 + h / 2; x < b.x1; x += h) {
      const p = { x, y };
      if (pointInPolygon(p, poly) === "inside") out.push(p);
    }
  }
  return out;
}

/** Nächster Rasterpunkt (kleinster Index bei Gleichstand), optional ohne bereits belegte. */
function naechster(raster: readonly Vec2[], p: Vec2, belegt?: ReadonlySet<number>, nur?: readonly number[]): number {
  let best = -1, bd = Infinity;
  const idx = nur ?? raster.map((_, i) => i);
  for (const i of idx) {
    if (belegt?.has(i)) continue;
    const q = raster[i]!, dd = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    if (dd < bd - EPS) { bd = dd; best = i; }
  }
  return best;
}

/** Startlage: k Punkte auf einem Gitter mit Seitenverhältnis der Dachfläche, auf Rasterpunkte gezogen. */
function startlage(poly: Polygon, raster: readonly Vec2[], k: number): Vec2[] {
  const b = bbox(poly), w = b.x1 - b.x0, h = b.y1 - b.y0;
  const spalten = Math.max(1, Math.min(k, Math.round(Math.sqrt((k * w) / Math.max(h, EPS)))));
  const zeilen = Math.ceil(k / spalten);
  const out: Vec2[] = [];
  const belegt = new Set<number>();
  for (let r = 0; r < zeilen; r++) {
    const n = Math.floor(k / zeilen) + (r < k % zeilen ? 1 : 0);
    for (let c = 0; c < n; c++) {
      const p = { x: b.x0 + ((c + 0.5) * w) / n, y: b.y0 + ((r + 0.5) * h) / zeilen };
      const i = naechster(raster, p, belegt);
      if (i < 0) continue;
      belegt.add(i);
      out.push(raster[i]!);
    }
  }
  return out;
}

/** Lloyd-Iteration; feste Punkte nehmen an der Zuordnung teil, werden aber nicht verschoben. */
function verteile(poly: Polygon, raster: readonly Vec2[], fest: readonly FesterPunkt[], k: number, s: number, z: number): Vec2[] {
  let pos = startlage(poly, raster, k);
  for (let it = 0; it < LLOYD_MAX; it++) {
    const zellen: number[][] = pos.map(() => []);
    raster.forEach((q, i) => {
      let best = -1, bh = Infinity;
      for (let j = 0; j < fest.length; j++) {
        const hh = fest[j]!.z + s * dist(q, fest[j]!.p);
        if (hh < bh - EPS) { bh = hh; best = -1; }
      }
      for (let j = 0; j < pos.length; j++) {
        const hh = z + s * dist(q, pos[j]!);
        if (hh < bh - EPS) { bh = hh; best = j; }
      }
      if (best >= 0) zellen[best]!.push(i);
    });
    let bewegt = 0;
    const neu = pos.map((p, j) => {
      const zelle = zellen[j]!;
      if (zelle.length === 0) return p;
      let sx = 0, sy = 0;
      for (const i of zelle) { sx += raster[i]!.x; sy += raster[i]!.y; }
      let c = { x: sx / zelle.length, y: sy / zelle.length };
      if (pointInPolygon(c, poly) !== "inside") c = raster[naechster(raster, c, undefined, zelle)]!;
      bewegt = Math.max(bewegt, dist(c, p));
      return c;
    });
    pos = neu;
    if (bewegt < 1e-6) break;
  }
  return pos.map((p) => {
    const g = { x: Math.round(p.x * CM) / CM, y: Math.round(p.y * CM) / CM };
    return pointInPolygon(g, poly) === "inside" ? g : p;
  });
}
