/**
 * Maß- und Lückenprüfung des Verlegeplans (PLAN Schritt 25): Plattenfläche = Dachfläche, keine Lücken,
 * keine Überlappungen (Clipper), ganze Platten exakt im Katalogformat, Zuschnitte nicht größer als die
 * Rohplatte, Kehlkeile im Katalog und nicht größer als dort angegeben. Keine Stückliste.
 */
import { difference, union } from "../geometry/clipper";
import { polygonArea } from "../geometry/polygon";
import type { Polygon, Vec2 } from "../geometry/types";
import type { Befund } from "../checks/types";
import { QUELLE_PROGRAMM } from "../checks/types";
import { dachPolygon } from "../model/model";
import type { ProjectModel } from "../model/types";
import type {
  InsulationLayout, PlateCatalog, PruefOptionen, VerlegeplanPruefung, VerlegeplanPruefungDach, VerlegtePlatte,
} from "./types";

/** Standard-Flächentoleranz in m² (Abnahme Schritt 25). */
export const FLAECHEN_TOLERANZ = 0.01;
/** Maßtoleranz ganzer Platten in m (Rechenrundung; ganze Platten sind exakte Rechtecke). */
const MASS_EXAKT = 1e-6;
/** Maßtoleranz von Zuschnitten in m (Clipper-Raster 0,1 mm). */
const MASS_ZUSCHNITT = 1e-3;

const summe = (ps: readonly Polygon[]) => ps.reduce((a, p) => a + polygonArea(p), 0);

/** Ausdehnung eines Polygons in Richtung u und senkrecht dazu. */
function ausdehnung(p: Polygon, u: Vec2): { laenge: number; breite: number } {
  let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
  for (const v of p.outer) {
    const a = v.x * u.x + v.y * u.y, b = -v.x * u.y + v.y * u.x;
    a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b);
  }
  return { laenge: a1 - a0, breite: b1 - b0 };
}

function befund(stufe: Befund["stufe"], code: string, meldung: string, objektId: string, dachflaecheId: string, extra: Partial<Befund> = {}): Befund {
  return { stufe, code, meldung, objektId, dachflaecheId, regelId: `verlegeplan-${code}`, quelle: QUELLE_PROGRAMM, ...extra };
}

function plattenMasse(p: VerlegtePlatte, cat: PlateCatalog, befunde: Befund[]): boolean {
  const { laenge: L, breite: B } = cat.daten.format;
  const m = ausdehnung(p.polygon, p.richtung);
  if (p.art === "kehlkeil") {
    const k = (cat.daten.kehlkeile ?? []).find((e) => e.id === p.kehlkeilId);
    if (!k) {
      befunde.push(befund("fehler", "kehlkeil-unbekannt", `Kehlkeil ${p.bezeichnung} (${p.kehlkeilId ?? "?"}) nicht im Katalog.`, p.id, p.dachflaecheId));
      return false;
    }
    if (m.laenge > k.laenge + MASS_ZUSCHNITT || m.breite > k.breite + MASS_ZUSCHNITT) {
      befunde.push(befund("fehler", "kehlkeil-mass", `Kehlkeil ${p.bezeichnung} größer als im Katalog (${k.laenge} × ${k.breite} m).`, p.id, p.dachflaecheId));
      return false;
    }
    return true;
  }
  if (!p.zuschnitt && p.art === "platte") {
    if (Math.abs(m.laenge - L) > MASS_EXAKT || Math.abs(m.breite - B) > MASS_EXAKT || Math.abs(polygonArea(p.polygon) - L * B) > MASS_EXAKT) {
      befunde.push(befund("fehler", "platte-mass", `Platte ${p.bezeichnung} weicht vom Katalogformat ${L} × ${B} m ab.`, p.id, p.dachflaecheId,
        { wert: m.laenge * m.breite, grenze: L * B }));
      return false;
    }
    return true;
  }
  if (m.laenge > L + MASS_ZUSCHNITT || m.breite > B + MASS_ZUSCHNITT) {
    befunde.push(befund("fehler", "zuschnitt-mass", `Zuschnitt ${p.bezeichnung} größer als die Rohplatte ${L} × ${B} m.`, p.id, p.dachflaecheId));
    return false;
  }
  return true;
}

export function pruefeVerlegeplan(m: ProjectModel, layout: InsulationLayout, cat: PlateCatalog, opt: PruefOptionen = {}): VerlegeplanPruefung {
  const tol = opt.flaechenToleranz ?? FLAECHEN_TOLERANZ;
  const befunde: Befund[] = [];
  const dachflaechen: VerlegeplanPruefungDach[] = [];
  for (const plan of layout.dachflaechen) {
    const d = m.dachflaechen.find((x) => x.id === plan.dachflaecheId);
    if (!d) continue;
    const dach = dachPolygon(d);
    const dachflaeche = polygonArea(dach);
    const polys = plan.platten.map((p) => p.polygon);
    const plattenflaeche = summe(polys);
    const vereinigt = polys.length > 0 ? union(polys) : [];
    const luecken = summe(difference([dach], vereinigt));
    const ueberlappungen = Math.max(0, plattenflaeche - summe(vereinigt));
    const ueberstand = summe(difference(vereinigt, [dach]));
    let ok = true;
    if (Math.abs(plattenflaeche - dachflaeche) > tol) {
      ok = false;
      befunde.push(befund("fehler", "flaeche", `Plattenfläche ${plattenflaeche.toFixed(3)} m² ≠ Dachfläche ${dachflaeche.toFixed(3)} m².`, d.id, d.id,
        { wert: plattenflaeche, grenze: dachflaeche, differenz: plattenflaeche - dachflaeche }));
    }
    if (luecken > tol) { ok = false; befunde.push(befund("fehler", "luecke", `Lücken im Verlegeplan: ${luecken.toFixed(3)} m².`, d.id, d.id, { wert: luecken, grenze: tol })); }
    if (ueberlappungen > tol) {
      ok = false;
      befunde.push(befund("fehler", "ueberlappung", `Überlappende Platten: ${ueberlappungen.toFixed(3)} m².`, d.id, d.id, { wert: ueberlappungen, grenze: tol }));
    }
    if (ueberstand > tol) { ok = false; befunde.push(befund("fehler", "ueberstand", `Platten außerhalb der Dachfläche: ${ueberstand.toFixed(3)} m².`, d.id, d.id, { wert: ueberstand, grenze: tol })); }
    let ganzePlatten = 0, zuschnitte = 0, kehlkeile = 0;
    for (const p of plan.platten) {
      if (!plattenMasse(p, cat, befunde)) ok = false;
      if (p.art === "kehlkeil") kehlkeile++;
      else if (p.zuschnitt) zuschnitte++;
      else ganzePlatten++;
    }
    dachflaechen.push({ dachflaecheId: d.id, dachflaeche, plattenflaeche, luecken, ueberlappungen, ganzePlatten, zuschnitte, kehlkeile, ok });
  }
  return { ok: dachflaechen.every((x) => x.ok) && befunde.every((b) => b.stufe !== "fehler"), dachflaechen, befunde };
}
