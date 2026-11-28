/**
 * Vorgabenprüfung (PLAN Schritt 8): max. Hochpunkt, min. Tiefpunkt, Mindestdämmdicke am Tiefpunkt
 * (gegen OK Rohdecke), 0-%-Zonen mit Begründung. Je Bereich (Hauptfläche, Zone) gilt die eigene
 * Vorgabe der Zone, sonst die der Dachfläche. Ablauf-Koten z gehen direkt ein (Tiefpunkt der
 * Hauptfläche = Ablaufkote). Grenzen stammen aus dem Projekt (Planungsvorgaben), nie aus dem Code.
 */
import { EPS } from "../geometry/eps";
import type { Dachflaeche, Hoehenvorgaben, ProjectModel, Zone } from "../model/types";
import type { DachGefaelle, Extrempunkt, SlopeResult } from "../slope/types";
import type { Befund } from "./types";

const MM_JE_M = 1000;
const mm = (m: number) => `${(m * MM_JE_M).toFixed(0)} mm`;
const kote = (m: number) => `${m >= 0 ? "+" : ""}${m.toFixed(3)} m`;

export const REGEL_VORGABE_MAX_HP = "vorgabe-max-hochpunkt";
export const REGEL_VORGABE_MIN_TP = "vorgabe-min-tiefpunkt";
export const REGEL_VORGABE_DAEMMDICKE_TP = "vorgabe-daemmdicke-tiefpunkt";
export const REGEL_VORGABE_ZONE_GEFAELLE = "vorgabe-zone-ohne-gefaelle";

export interface VorgabenOptionen {
  /** Standard-Mindestdämmdicke am Tiefpunkt in mm (aus Pack), wenn die Dachfläche keine vorgibt. */
  readonly daemmdickeTiefpunktStandard?: number;
}

interface Bereich {
  readonly objektId: string;
  readonly name: string;
  readonly vorgaben: Hoehenvorgaben;
  readonly hochpunkt: Extrempunkt | null;
  readonly tiefpunkt: Extrempunkt | null;
  readonly zone?: Zone;
}

export function pruefeVorgaben(m: ProjectModel, slope: SlopeResult, opt: VorgabenOptionen = {}): Befund[] {
  const out: Befund[] = [];
  for (const d of m.dachflaechen) {
    const g = slope.dachflaechen.find((x) => x.dachflaecheId === d.id);
    if (g) pruefeDach(d, g, opt, out);
  }
  return out;
}

function quelleVon(b: Bereich) {
  return `Planungsvorgabe ${b.zone ? "Zone" : "Dachfläche"} „${b.name}“`;
}

/** Wirksame Vorgabe: Zone vor Dachfläche, je Feld. */
const wirksam = (dach: Hoehenvorgaben, zone?: Hoehenvorgaben): Hoehenvorgaben => ({ ...dach, ...zone });

function pruefeDach(d: Dachflaeche, g: DachGefaelle, opt: VorgabenOptionen, out: Befund[]): void {
  const dachName = d.name || d.id;
  const extremeHaupt = hauptExtreme(g);
  const bereiche: Bereich[] = [
    { objektId: d.id, name: dachName, vorgaben: d.vorgaben, ...extremeHaupt },
    ...g.zonen.map((zg): Bereich => {
      const zone = d.zonen.find((z) => z.id === zg.zoneId)!;
      return { objektId: zone.id, name: zone.name || zone.id, vorgaben: wirksam(d.vorgaben, zone.vorgaben),
        hochpunkt: zg.hochpunkt, tiefpunkt: zg.tiefpunkt, zone };
    }),
  ];
  const dtpMm = d.daemmdickeTiefpunkt ?? opt.daemmdickeTiefpunktStandard;
  const basis = { dachflaecheId: d.id };

  for (const b of bereiche) {
    const v = b.vorgaben;
    // max. Hochpunkt
    if (v.maxHochpunkt !== undefined && b.hochpunkt && b.hochpunkt.kote > v.maxHochpunkt + EPS) {
      const diff = b.hochpunkt.kote - v.maxHochpunkt;
      out.push({
        ...basis, stufe: "fehler", code: REGEL_VORGABE_MAX_HP, objektId: b.objektId, regelId: REGEL_VORGABE_MAX_HP,
        quelle: quelleVon(b), ...(b.hochpunkt.orte[0] ? { ort: b.hochpunkt.orte[0] } : {}),
        wert: b.hochpunkt.kote, grenze: v.maxHochpunkt, differenz: diff,
        meldung: `${b.name}: Hochpunkt ${kote(b.hochpunkt.kote)} überschreitet max. Hochpunkt ${kote(v.maxHochpunkt)} um ${mm(diff)}.`,
      });
    }
    // min. Tiefpunkt: Hauptfläche je Ablaufkote z (ohne Notabläufe: kein Tiefpunkt der Gefälleplanung), Zone über ihren Tiefpunkt (Ablaufkoten + Versatz)
    const tiefpunkte: { objektId: string; name: string; kote: number; ort?: { x: number; y: number } }[] = b.zone
      ? (b.tiefpunkt ? [{ objektId: b.objektId, name: b.name, kote: b.tiefpunkt.kote, ...(b.tiefpunkt.orte[0] ? { ort: b.tiefpunkt.orte[0] } : {}) }] : [])
      : d.entwaesserung.filter((e) => e.art !== "notablauf" && g.dachreiter.find((x) => x.ablaufId === e.id)?.masse?.art !== "not").map((e) => ({ objektId: e.id, name: `${dachName}, Ablauf ${e.name || e.id}`, kote: e.z,
          ...(ablaufOrt(g, e.id) ? { ort: ablaufOrt(g, e.id)! } : {}) }));
    for (const t of tiefpunkte) {
      if (v.minTiefpunkt !== undefined && t.kote < v.minTiefpunkt - EPS) {
        const diff = v.minTiefpunkt - t.kote;
        out.push({
          ...basis, stufe: "fehler", code: REGEL_VORGABE_MIN_TP, objektId: t.objektId, regelId: REGEL_VORGABE_MIN_TP,
          quelle: quelleVon(b), ...(t.ort ? { ort: t.ort } : {}), wert: t.kote, grenze: v.minTiefpunkt, differenz: diff,
          meldung: `${t.name}: Tiefpunkt ${kote(t.kote)} liegt ${mm(diff)} unter min. Tiefpunkt ${kote(v.minTiefpunkt)}.`,
        });
      }
      // Mindestdämmdicke am Tiefpunkt: z − OK Rohdecke ≥ d_TP
      if (v.okRohdecke !== undefined) {
        if (dtpMm === undefined) continue; // einmal je Dachfläche gemeldet (unten)
        const vorhanden = t.kote - v.okRohdecke, noetig = dtpMm / MM_JE_M;
        if (vorhanden < noetig - EPS) {
          out.push({
            ...basis, stufe: "fehler", code: REGEL_VORGABE_DAEMMDICKE_TP, objektId: t.objektId, regelId: REGEL_VORGABE_DAEMMDICKE_TP,
            quelle: quelleVon(b), ...(t.ort ? { ort: t.ort } : {}), wert: vorhanden, grenze: noetig, differenz: noetig - vorhanden,
            meldung: `${t.name}: Aufbauhöhe am Tiefpunkt ${mm(vorhanden)} (Kote ${kote(t.kote)} − OK Rohdecke ${kote(v.okRohdecke)}) `
              + `unter Mindestdämmdicke ${mm(noetig)}, Fehlbetrag ${mm(noetig - vorhanden)}.`,
          });
        }
      }
    }
    // 0-%-Zone
    const z = b.zone;
    if (z && z.gefaelle !== undefined && z.gefaelle <= EPS) {
      const begruendet = typeof z.begruendung === "string" && z.begruendung.trim() !== "";
      out.push({
        ...basis, stufe: begruendet ? "hinweis" : "fehler", code: REGEL_VORGABE_ZONE_GEFAELLE, objektId: z.id,
        regelId: REGEL_VORGABE_ZONE_GEFAELLE, quelle: quelleVon(b),
        meldung: begruendet
          ? `Zone „${b.name}“ ohne Gefälle (0 %), Begründung: ${z.begruendung!.trim()}`
          : `Zone „${b.name}“ ohne Gefälle (0 %) braucht eine Begründung.`,
      });
    }
  }

  const brauchtDtp = bereiche.some((b) => b.vorgaben.okRohdecke !== undefined);
  if (brauchtDtp && dtpMm === undefined) {
    out.push({
      ...basis, stufe: "warnung", code: "daemmdicke-tiefpunkt-fehlt", objektId: d.id, regelId: REGEL_VORGABE_DAEMMDICKE_TP,
      quelle: `Planungsvorgabe Dachfläche „${dachName}“`,
      meldung: `${dachName}: Mindestdämmdicke am Tiefpunkt weder vorgegeben noch aus Pack bekannt; Aufbauhöhe nicht prüfbar.`,
    });
  }
}

/** HP/TP der Hauptfläche (ohne Zonen) aus deren Koten. */
function hauptExtreme(g: DachGefaelle): { hochpunkt: Extrempunkt | null; tiefpunkt: Extrempunkt | null } {
  if (g.koten.length === 0) return { hochpunkt: null, tiefpunkt: null };
  const ext = (vz: 1 | -1): Extrempunkt => {
    const k = vz * Math.max(...g.koten.map((x) => vz * x.kote));
    return { kote: k, orte: g.koten.filter((x) => Math.abs(x.kote - k) <= EPS).map((x) => x.position) };
  };
  return { hochpunkt: ext(1), tiefpunkt: ext(-1) };
}

function ablaufOrt(g: DachGefaelle, id: string) {
  const q = g.feld.quellen.find((x) => x.ablaufId === id || x.partnerId === id);
  return q && (q.partnerId === id ? q.bis : q.position);
}

/**
 * Koten, die gegen eine Höhenvorgabe verstoßen (max. Hochpunkt überschritten / min. Tiefpunkt unterschritten):
 * Prädikat „Kote (m) → Verstoß?“ für die rote Markierung in 2D und PDF. Verglichen wird der gemeldete Wert (Toleranz 0,05 mm).
 */
export function verletzteKoten(befunde: readonly Befund[]): (kote: number) => boolean {
  const werte = befunde.filter((b) => (b.regelId === REGEL_VORGABE_MAX_HP || b.regelId === REGEL_VORGABE_MIN_TP) && b.wert !== undefined).map((b) => b.wert as number);
  return (k) => werte.some((w) => Math.abs(w - k) < 5e-5);
}
