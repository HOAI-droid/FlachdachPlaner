/**
 * Regelprüfung `runChecks` (PLAN Schritt 9). Alle Grenzwerte aus Regel-Packs; fehlt eine benötigte
 * Regel, entsteht einmalig ein Befund „regel-fehlt“ statt einer Zahl. Enthält die Vorgabenprüfung (Schritt 8).
 */
import { EPS } from "../geometry/eps";
import { pointInPolygon } from "../geometry/polygon";
import { dist, distPointSegment } from "../geometry/segment";
import type { Vec2 } from "../geometry/types";
import { computeCatchments } from "../catchment/catchment";
import type { CatchmentResult } from "../catchment/types";
import { dachPolygon, konturKante } from "../model/model";
import type { Dachflaeche, ProjectModel, Regenspende } from "../model/types";
import { bewerteEinzugsflaeche, findeRegelParameter, REGEL_FLAECHE_JE_ABLAUF, type RegelWert } from "../rules/regeln";
import type { AblaufPack, RegelPack, RulePack } from "../rules/types";
import { hoeheDachflaeche } from "../slope/slope";
import type { DachGefaelle, SlopeResult } from "../slope/types";
import { QUELLE_PROGRAMM, type Befund } from "./types";
import { pruefeVorgaben } from "./vorgaben";

export const REGEL_GEFAELLE = "gefaelle-planungsziel";
export const REGEL_ANSCHLUSS = "anschlusshoehe";
export const REGEL_BARRIEREFREI = "barrierefrei-schwelle";
export const REGEL_PFUETZEN = "fdp-pfuetzen";
export const REGEL_PACK_UNGEPRUEFT = "pack-ungeprueft";
export const REGEL_REGEN_MANUELL = "regenspende-manuell";

export interface CheckErgebnisse {
  readonly slope: SlopeResult;
  /** Fehlt sie, wird sie mit dem ersten Regel-Pack berechnet. */
  readonly catchments?: CatchmentResult;
}

export interface CheckOptionen {
  /** Rasterweite der Pfützenprüfung in m (PLAN: 0,1). */
  readonly raster?: number;
  /** Standard-Mindestdämmdicke am Tiefpunkt in mm (aus Dämmplatten-Pack). */
  readonly daemmdickeTiefpunktStandard?: number;
}

const MM = 1000;
const mm = (m: number) => `${(m * MM).toFixed(0)} mm`;
const prozent = (s: number) => `${(s * 100).toFixed(1).replace(".", ",")} %`;
const quelleVon = (w: RegelWert) => (w.fundstelle ? `${w.quelle}, ${w.fundstelle}` : w.quelle);

export function runChecks(m: ProjectModel, r: CheckErgebnisse, packs: readonly RulePack[], opt: CheckOptionen = {}): Befund[] {
  const out: Befund[] = [];
  const fehlend = new Set<string>();
  /** Regelparameter oder null; fehlende Regel wird einmal gemeldet. */
  const regel = (regelId: string, name: string): RegelWert | null => {
    const w = findeRegelParameter(packs, regelId, name);
    if (!w && !fehlend.has(`${regelId}.${name}`)) {
      fehlend.add(`${regelId}.${name}`);
      out.push({
        stufe: "warnung", code: "regel-fehlt", objektId: null, regelId,
        quelle: `Regel-Packs: ${packs.filter((p) => p.typ === "regeln").map((p) => p.id).join(", ") || "keine geladen"}`,
        meldung: `Regel „${regelId}“ (Parameter „${name}“) fehlt im Regel-Pack; Prüfung nicht möglich.`,
      });
    }
    return w;
  };

  out.push(...pruefeVorgaben(m, r.slope, opt.daemmdickeTiefpunktStandard !== undefined
    ? { daemmdickeTiefpunktStandard: opt.daemmdickeTiefpunktStandard } : {}));
  for (const d of m.dachflaechen) {
    const g = r.slope.dachflaechen.find((x) => x.dachflaecheId === d.id);
    if (!g) continue;
    pruefeGefaelle(d, g, regel, out);
    pruefePfuetzen(d, g, opt.raster ?? 0.1, out);
    pruefeAttika(d, g, regel, out);
    pruefeSchwellen(d, g, packs, regel, out);
  }
  pruefeFlaechen(m, r, packs, regel, out);
  pruefePacks(packs, out);
  pruefeRegen(m, packs, out);
  return out;
}

type RegelFn = (regelId: string, name: string) => RegelWert | null;

// ---------- Mindestgefälle ----------

function pruefeGefaelle(d: Dachflaeche, g: DachGefaelle, regel: RegelFn, out: Befund[]): void {
  const bereiche = [
    { objektId: d.id, name: d.name || d.id, s: g.feld.gefaelle },
    ...g.zonen.map((z) => ({ objektId: z.zoneId, name: d.zonen.find((x) => x.id === z.zoneId)?.name || z.zoneId, s: z.feld.gefaelle })),
  ].filter((b) => b.s > EPS); // 0-%-Zonen: Vorgabenprüfung (Begründung)
  if (bereiche.length === 0) return;
  const w = regel(REGEL_GEFAELLE, "regel");
  if (!w) return;
  for (const b of bereiche) {
    if (b.s < w.wert - EPS) {
      out.push({
        stufe: "warnung", code: "gefaelle-unter-regel", objektId: b.objektId, dachflaecheId: d.id, regelId: w.regelId,
        quelle: quelleVon(w), wert: b.s, grenze: w.wert, differenz: w.wert - b.s,
        meldung: `${b.name}: Gefälle ${prozent(b.s)} unter Planungsziel ${prozent(w.wert)}.`,
      });
    }
  }
}

// ---------- Pfützen ----------

const NACHBARN: readonly (readonly [number, number])[] = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

/**
 * Rasterpunkte (Zellmitten) in der Dachfläche ohne strikt tieferen Nachbarn (8er-Nachbarschaft, nur Punkte
 * in der Dachfläche) und weiter als eine Rasterweite von jedem Ablauf entfernt = Pfütze. Zusammenhängende
 * Punkte bilden einen Befund. 0-%-Zonen sind ausgenommen (eigene Vorgabenprüfung).
 */
function pruefePfuetzen(d: Dachflaeche, g: DachGefaelle, raster: number, out: Befund[]): void {
  if (g.feld.quellen.length === 0 || !(raster > 0)) return;
  const dach = dachPolygon(d);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of d.kontur) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  const nx = Math.max(0, Math.ceil((x1 - x0) / raster)), ny = Math.max(0, Math.ceil((y1 - y0) / raster));
  const h = new Float64Array(nx * ny).fill(Number.NaN);
  const flach = new Uint8Array(nx * ny);
  const punkt = (i: number, j: number): Vec2 => ({ x: x0 + (i + 0.5) * raster, y: y0 + (j + 0.5) * raster });
  const flacheZonen = g.zonen.filter((z) => z.feld.gefaelle <= EPS);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const p = punkt(i, j);
      if (pointInPolygon(p, dach) === "outside") continue;
      h[j * nx + i] = hoeheDachflaeche(g, p);
      if (flacheZonen.some((z) => z.polygone.some((poly) => pointInPolygon(p, poly) !== "outside"))) flach[j * nx + i] = 1;
    }
  }
  const pfuetze = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i, hk = h[k]!;
      if (Number.isNaN(hk) || flach[k]) continue;
      const p = punkt(i, j);
      if (g.feld.quellen.some((q) => distPointSegment(p, q.position, q.bis) <= raster + EPS)) continue;
      const abfluss = NACHBARN.some(([di, dj]) => {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= nx || b >= ny) return false;
        const hn = h[b * nx + a]!;
        return !Number.isNaN(hn) && hn < hk - EPS;
      });
      if (!abfluss) pfuetze[k] = 1;
    }
  }
  // zusammenhängende Pfützenpunkte → je ein Befund
  const besucht = new Uint8Array(nx * ny);
  for (let k0 = 0; k0 < nx * ny; k0++) {
    if (!pfuetze[k0] || besucht[k0]) continue;
    const stapel = [k0];
    besucht[k0] = 1;
    let n = 0, sx = 0, sy = 0, hMin = Infinity;
    while (stapel.length > 0) {
      const k = stapel.pop()!, i = k % nx, j = (k - i) / nx, p = punkt(i, j);
      n++; sx += p.x; sy += p.y; hMin = Math.min(hMin, h[k]!);
      for (const [di, dj] of NACHBARN) {
        const a = i + di, b = j + dj, kn = b * nx + a;
        if (a >= 0 && b >= 0 && a < nx && b < ny && pfuetze[kn] && !besucht[kn]) { besucht[kn] = 1; stapel.push(kn); }
      }
    }
    const flaeche = n * raster * raster;
    out.push({
      stufe: "warnung", code: "pfuetze", objektId: d.id, dachflaecheId: d.id, regelId: REGEL_PFUETZEN,
      quelle: `${QUELLE_PROGRAMM} (Raster ${raster.toFixed(2)} m)`, ort: { x: sx / n, y: sy / n }, wert: flaeche,
      meldung: `${d.name || d.id}: mögliche Pfütze ohne Abfluss, ca. ${flaeche.toFixed(2)} m² bei Kote ${hMin.toFixed(3)} m.`,
    });
  }
}

// ---------- Fläche je Ablauf (Grenzen hinweisAb/fehlerUeber aus Pack) ----------

function pruefeFlaechen(m: ProjectModel, r: CheckErgebnisse, packs: readonly RulePack[], regel: RegelFn, out: Befund[]): void {
  const pack = packs.find((p): p is RegelPack => p.typ === "regeln" && p.daten.regeln.some((x) => x.id === REGEL_FLAECHE_JE_ABLAUF));
  const c = r.catchments ?? computeCatchments(m, r.slope, pack ? { regeln: pack } : {});
  if (c.flaechen.length === 0) return;
  if (!pack) { regel(REGEL_FLAECHE_JE_ABLAUF, "hinweisAb"); return; }
  for (const f of c.flaechen) {
    const b = bewerteEinzugsflaeche(f.gesamtFlaeche, pack);
    if (!b) { regel(REGEL_FLAECHE_JE_ABLAUF, "fehlerUeber"); return; }
    if (b.stufe === "ok") continue;
    const grenze = b.stufe === "fehler" ? b.fehlerUeber : b.hinweisAb;
    out.push({
      stufe: b.stufe, code: `flaeche-je-ablauf-${b.stufe}`, objektId: f.ablaufId, dachflaecheId: f.dachflaecheId,
      regelId: REGEL_FLAECHE_JE_ABLAUF, quelle: quelleVon(grenze), wert: f.gesamtFlaeche, grenze: grenze.wert,
      differenz: f.gesamtFlaeche - grenze.wert,
      meldung: b.stufe === "fehler"
        ? `Ablauf ${f.ablaufId}: Einzugsfläche ${f.gesamtFlaeche.toFixed(1)} m² über ${grenze.wert} m²; weiteren Ablauf vorsehen.`
        : `Ablauf ${f.ablaufId}: Einzugsfläche ${f.gesamtFlaeche.toFixed(1)} m² ab ${grenze.wert} m²; Ablaufleistung prüfen.`,
    });
  }
}

// ---------- Anschlusshöhen ----------

/** Größte Höhe der Dachfläche entlang a–b (Abtastung 1 cm, Fehler ≤ s · 5 mm). */
function maxHoeheAuf(g: DachGefaelle, a: Vec2, b: Vec2): number {
  const n = Math.max(1, Math.ceil(dist(a, b) / 0.01));
  let h = -Infinity;
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    h = Math.max(h, hoeheDachflaeche(g, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) }));
  }
  return h;
}

function pruefeAttika(d: Dachflaeche, g: DachGefaelle, regel: RegelFn, out: Befund[]): void {
  if (d.attika.length === 0 || g.feld.quellen.length === 0) return;
  const w = regel(REGEL_ANSCHLUSS, "attikaMin");
  if (!w) return;
  for (const a of d.attika) {
    const k = konturKante(d.kontur, a.kante);
    if (!k) continue;
    if (a.oberkante === undefined) {
      out.push({ stufe: "hinweis", code: "attika-oberkante-fehlt", objektId: a.id, dachflaecheId: d.id, regelId: w.regelId,
        quelle: quelleVon(w), meldung: `Attika ${a.id}: Oberkante fehlt; Anschlusshöhe nicht prüfbar.` });
      continue;
    }
    const hMax = maxHoeheAuf(g, k[0], k[1]), vorhanden = a.oberkante - hMax;
    if (vorhanden < w.wert - EPS) {
      out.push({
        stufe: "fehler", code: "anschlusshoehe-attika", objektId: a.id, dachflaecheId: d.id, regelId: w.regelId, quelle: quelleVon(w),
        wert: vorhanden, grenze: w.wert, differenz: w.wert - vorhanden,
        meldung: `Attika ${a.id}: Anschlusshöhe ${mm(vorhanden)} unter ${mm(w.wert)} (Fehlbetrag ${mm(w.wert - vorhanden)}).`,
      });
    }
  }
}

/** Überflutungskante einer Notentwässerung (z + Wehr-/Einlaufhöhe aus Pack) oder null, wenn Pack-Daten fehlen. */
interface Notkante { readonly id: string; readonly kante: number | null }

function pruefeSchwellen(d: Dachflaeche, g: DachGefaelle, packs: readonly RulePack[], regel: RegelFn, out: Befund[]): void {
  if (d.tuerschwellen.length === 0 || g.feld.quellen.length === 0) return;
  // Haupt- und Notentwässerung trennen (Dachreiter-Art aus Pack, unbekannt = Haupt)
  const haupt: { a: Vec2; b: Vec2 }[] = [];
  const not: Notkante[] = [];
  for (const e of d.entwaesserung) {
    if (e.art === "gully") haupt.push({ a: e.position, b: e.position });
    else if (e.art === "les") haupt.push({ a: e.von, b: e.bis });
    else if (e.art === "notablauf") {
      const eintrag = e.typ ? packs.find((p): p is AblaufPack => p.typ === "ablaeufe" && p.id === e.typ!.packId)
        ?.daten.eintraege.find((x) => x.id === e.typ!.eintragId) : undefined;
      not.push({ id: e.id, kante: eintrag?.wehrhoehe !== undefined ? e.z + eintrag.wehrhoehe : null });
    } else {
      const lage = g.dachreiter.find((x) => x.ablaufId === e.id);
      if (lage?.masse?.art === "not") {
        not.push({ id: e.id, kante: lage.masse.einlaufhoehe !== undefined ? e.z + lage.masse.einlaufhoehe : null });
      } else if (lage) haupt.push({ a: lage.von, b: lage.bis });
    }
  }

  for (const t of d.tuerschwellen) {
    const k = konturKante(d.kontur, t.lage.kante);
    if (!k) continue;
    const len = dist(k[0], k[1]);
    if (!(len > EPS)) continue;
    const u = { x: (k[1].x - k[0].x) / len, y: (k[1].y - k[0].y) / len };
    const s0 = Math.max(0, t.lage.abstand), s1 = Math.min(len, t.lage.abstand + t.breite);
    const a = { x: k[0].x + u.x * s0, y: k[0].y + u.y * s0 }, b = { x: k[0].x + u.x * s1, y: k[0].y + u.y * s1 };
    const ort = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const name = `Türschwelle ${t.name || t.id}`;
    const basis = { objektId: t.id, dachflaecheId: d.id, ort };

    // Anschlusshöhe: barrierefrei nach Regel barrierefrei-schwelle, sonst Regel anschlusshoehe
    const w = t.barrierefrei ? regel(REGEL_BARRIEREFREI, "anschlusshoeheMin") : regel(REGEL_ANSCHLUSS, "tuerMin");
    if (w && t.oberkante === undefined) {
      out.push({ ...basis, stufe: "hinweis", code: "schwelle-oberkante-fehlt", regelId: w.regelId, quelle: quelleVon(w),
        meldung: `${name}: Oberkante fehlt; Anschlusshöhe nicht prüfbar.` });
    } else if (w && t.oberkante !== undefined) {
      const vorhanden = t.oberkante - maxHoeheAuf(g, a, b);
      if (vorhanden < w.wert - EPS) {
        out.push({ ...basis, stufe: "fehler", code: "anschlusshoehe-tuer", regelId: w.regelId, quelle: quelleVon(w),
          wert: vorhanden, grenze: w.wert, differenz: w.wert - vorhanden,
          meldung: `${name}: Anschlusshöhe ${mm(vorhanden)} unter ${mm(w.wert)} (Fehlbetrag ${mm(w.wert - vorhanden)}).` });
      }
    }
    if (!t.barrierefrei) continue;

    // Abstand zur Hauptentwässerung
    const wa = regel(REGEL_BARRIEREFREI, "maxAbstandEntwaesserung");
    if (wa) {
      const abstand = haupt.length === 0 ? Infinity : Math.min(...haupt.map((e) => segmentAbstand(a, b, e.a, e.b)));
      if (abstand > wa.wert + EPS) {
        out.push({ ...basis, stufe: "fehler", code: "barrierefrei-abstand", regelId: wa.regelId, quelle: quelleVon(wa),
          ...(Number.isFinite(abstand) ? { wert: abstand, differenz: abstand - wa.wert } : {}), grenze: wa.wert,
          meldung: Number.isFinite(abstand)
            ? `${name} (barrierefrei): Abstand zur Entwässerung ${abstand.toFixed(2)} m über ${wa.wert.toFixed(2)} m.`
            : `${name} (barrierefrei): keine Hauptentwässerung auf der Dachfläche.` });
      }
    }
    // Überflutungskante der Notentwässerung unter OK Schwelle (Annahme: OK Schwelle = OK FFB)
    const wu = regel(REGEL_BARRIEREFREI, "ueberflutungskanteUnterOkFk");
    if (!wu) continue;
    if (t.oberkante === undefined) continue; // oben bereits gemeldet bzw. Regel fehlt
    if (not.length === 0) {
      out.push({ ...basis, stufe: "fehler", code: "barrierefrei-keine-notentwaesserung", regelId: wu.regelId, quelle: quelleVon(wu),
        meldung: `${name} (barrierefrei): keine Notentwässerung auf der Dachfläche; Überflutungskante nicht nachweisbar.` });
      continue;
    }
    const unbekannt = not.filter((n) => n.kante === null);
    for (const n of unbekannt) {
      out.push({ ...basis, stufe: "warnung", code: "notentwaesserung-kante-unbekannt", objektId: n.id, regelId: wu.regelId,
        quelle: quelleVon(wu),
        meldung: `${name}: Überflutungskante von ${n.id} unbekannt (Produkt bzw. Wehr-/Einlaufhöhe fehlt im Pack).` });
    }
    const bekannt = not.filter((n): n is { id: string; kante: number } => n.kante !== null);
    if (bekannt.length === 0) continue;
    const kante = Math.max(...bekannt.map((n) => n.kante)); // ungünstigste (höchste) Überflutungskante
    const vorhanden = t.oberkante - kante;
    if (vorhanden < wu.wert - EPS) {
      out.push({ ...basis, stufe: "fehler", code: "barrierefrei-ueberflutungskante", regelId: wu.regelId, quelle: quelleVon(wu),
        wert: vorhanden, grenze: wu.wert, differenz: wu.wert - vorhanden,
        meldung: `${name} (barrierefrei): Überflutungskante ${kante.toFixed(3)} m nur ${mm(vorhanden)} unter OK Schwelle, `
          + `gefordert ${mm(wu.wert)}.` });
    }
  }
}

/** Abstand zweier Strecken (0 bei Schnitt nicht nötig: Schwelle liegt auf dem Rand, Abläufe im Dach). */
function segmentAbstand(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number {
  return Math.min(distPointSegment(a, c, d), distPointSegment(b, c, d), distPointSegment(c, a, b), distPointSegment(d, a, b));
}

// ---------- Packs, Regenspende ----------

function pruefePacks(packs: readonly RulePack[], out: Befund[]): void {
  for (const p of packs) {
    if (p.geprueft) continue;
    out.push({ stufe: "hinweis", code: "pack-ungeprueft", objektId: p.id, regelId: REGEL_PACK_UNGEPRUEFT, quelle: p.quelle,
      meldung: `Regelwerk/Herstellerdaten ungeprüft: ${p.titel ?? p.id} (Version ${p.version}); Werte vor Ausführung gegen Original prüfen.` });
  }
}

function pruefeRegen(m: ProjectModel, packs: readonly RulePack[], out: Befund[]): void {
  const kostra = packs.find((p) => p.typ === "regenspenden");
  const quelle = `Nutzereingabe${kostra ? ` (überschreibt ${kostra.quelle})` : ""}`;
  const eintraege: [string, Regenspende][] = [["r(5,5)", m.standort.regen.r5_5], ["r(5,100)", m.standort.regen.r5_100]];
  for (const [name, r] of eintraege) {
    if (r.manuellWert === undefined) continue;
    const diff = r.packWert !== null && r.packWert > 0 ? (r.manuellWert - r.packWert) / r.packWert : null;
    out.push({
      stufe: "hinweis", code: "regenspende-manuell", objektId: null, regelId: REGEL_REGEN_MANUELL, quelle, wert: r.manuellWert,
      ...(r.packWert !== null ? { grenze: r.packWert, differenz: r.manuellWert - r.packWert } : {}),
      meldung: `Regenspende ${name} manuell ${r.manuellWert} l/(s·ha)`
        + (diff !== null ? ` statt ${r.packWert} l/(s·ha) aus Pack (${diff >= 0 ? "+" : ""}${(diff * 100).toFixed(1)} %).` : ` (kein Pack-Wert).`),
    });
  }
}
