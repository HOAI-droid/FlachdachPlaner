/**
 * Notwasserstände (PLAN M9 Schritt 43, A13): je Notelement (Notablauf, Dachreiter mit Pack-Art „not“) die
 * Überflutungskante z + Wehr-/Einlaufhöhe (Nutzerwert `ueberlaufKante` vor Pack-Wert), der Anteil Q_not und die
 * geschätzte Überfallhöhe h_ü: Speier nach Poleni Q = 2/3 · μ · b · √(2g) · h_ü^(3/2) (b = Überlaufbreite aus dem
 * Dachreiter-Pack, μ = `ueberfallbeiwert` aus dem Regel-Pack), Notablauf mit dem Anstauwert `anstauBeiQ` des
 * Produkts. Q_not der Dachfläche = Σ Q · f (f = Sicherheitsbeiwert Not, beides aus `estimateEmergency`) und wird
 * gleichmäßig auf ihre Notelemente verteilt. Wasserstand W = Kante + h_ü.
 * SCHÄTZUNG: kein hydraulischer Nachweis, keine Statik. Fehlen Produktdaten, gibt es keine Zahl (null).
 */
import type { Vec2 } from "../geometry/types";
import { konturKante } from "../model/model";
import type { Id, ProjectModel } from "../model/types";
import { REGEL_NOT_ANSTAU, type EmergencyEstimate } from "../drainage/drainage";
import { findeRegelParameter } from "../rules/regeln";
import type { AblaufPack, RulePack } from "../rules/types";
import type { SlopeResult } from "../slope/types";

/** Vermerk für Anzeige und Export (A13). */
export const VERMERK_SCHAETZUNG = "Schätzung";

/** Erdbeschleunigung in m/s² (physikalische Konstante, kein Sollwert). */
const G = 9.81;
const L_JE_M3 = 1000;

export type NotelementArt = "notablauf" | "speier";

export interface Notwasserstand {
  readonly objektId: Id;
  readonly dachflaecheId: Id;
  readonly art: NotelementArt;
  /** Notablauf: Position; Speier: Mitte der Öffnung auf der Konturkante. */
  readonly ort: Vec2;
  /** Überflutungskante (m) oder null ohne Wehr-/Einlaufhöhe. */
  readonly kante: number | null;
  readonly kanteQuelle: "pack" | "nutzer" | null;
  /** Kante aus dem Pack (z + Wehr-/Einlaufhöhe), bleibt neben dem Nutzerwert sichtbar; null ohne Pack-Wert. */
  readonly kantePack: number | null;
  /** Q_not-Anteil in l/s oder null. */
  readonly qAnteil: number | null;
  /** Geschätzte Überfallhöhe in m oder null ohne Produktdaten. */
  readonly ueberfallhoehe: number | null;
  readonly ueberfallQuelle: "poleni" | "pack" | null;
  /** Notwasserstand W = Kante + h_ü (m) oder null. */
  readonly wasserstand: number | null;
  readonly vermerk: typeof VERMERK_SCHAETZUNG;
}

/** Poleni-Überfallhöhe h_ü (m) für Q (l/s), Breite b (m), Überfallbeiwert μ; null bei b ≤ 0, μ ≤ 0 oder Q < 0. */
export function poleniUeberfallhoehe(q: number, b: number, mu: number): number | null {
  if (!(b > 0) || !(mu > 0) || !(q >= 0)) return null;
  return ((q / L_JE_M3) / ((2 / 3) * mu * b * Math.sqrt(2 * G))) ** (2 / 3);
}

export function computeNotwasserstaende(
  m: ProjectModel, s: SlopeResult, e: readonly EmergencyEstimate[], packs: readonly RulePack[],
): Notwasserstand[] {
  const mu = findeRegelParameter(packs, REGEL_NOT_ANSTAU, "ueberfallbeiwert")?.wert ?? null;
  const out: Notwasserstand[] = [];
  for (const d of m.dachflaechen) {
    const g = s.dachflaechen.find((x) => x.dachflaecheId === d.id);
    type Roh = Omit<Notwasserstand, "qAnteil" | "ueberfallhoehe" | "wasserstand" | "kante" | "kanteQuelle" | "vermerk"> & {
      readonly nutzer: number | undefined; readonly z: number; readonly breite: number | null; readonly anstau: number | null;
    };
    const roh: Roh[] = [];
    for (const el of d.entwaesserung) {
      if (el.art === "notablauf") {
        const eintrag = el.typ ? packs.find((p): p is AblaufPack => p.typ === "ablaeufe" && p.id === el.typ!.packId)
          ?.daten.eintraege.find((x) => x.id === el.typ!.eintragId) : undefined;
        roh.push({
          objektId: el.id, dachflaecheId: d.id, art: "notablauf", ort: { ...el.position }, nutzer: el.ueberlaufKante, z: el.z,
          kantePack: eintrag?.wehrhoehe !== undefined ? el.z + eintrag.wehrhoehe : null,
          breite: null, anstau: eintrag?.anstauBeiQ ?? null, ueberfallQuelle: eintrag?.anstauBeiQ !== undefined ? "pack" : null,
        });
      } else if (el.art === "dachreiter") {
        const lage = g?.dachreiter.find((x) => x.ablaufId === el.id);
        if (lage?.masse?.art !== "not") continue; // Haupt-Dachreiter bzw. unbekanntes Produkt: kein Notelement
        if (!konturKante(d.kontur, el.lage.kante)) continue;
        const b = lage.masse.ueberlaufBreite ?? null;
        roh.push({
          objektId: el.id, dachflaecheId: d.id, art: "speier", ort: { ...lage.mitte }, nutzer: el.ueberlaufKante, z: el.z,
          kantePack: lage.masse.einlaufhoehe !== undefined ? el.z + lage.masse.einlaufhoehe : null,
          breite: b, anstau: null, ueberfallQuelle: b !== null && mu !== null ? "poleni" : null,
        });
      }
    }
    if (roh.length === 0) continue;
    const qNot = qNotDachflaeche(e.filter((x) => x.dachflaecheId === d.id));
    const qAnteil = qNot === null ? null : qNot / roh.length;
    for (const r of roh) {
      const kante = r.nutzer !== undefined ? r.z + r.nutzer : r.kantePack;
      const kanteQuelle = r.nutzer !== undefined ? "nutzer" as const : r.kantePack !== null ? "pack" as const : null;
      const hue = r.art === "notablauf" ? r.anstau
        : qAnteil !== null && r.breite !== null && mu !== null ? poleniUeberfallhoehe(qAnteil, r.breite, mu) : null;
      out.push({
        objektId: r.objektId, dachflaecheId: r.dachflaecheId, art: r.art, ort: r.ort, kante, kanteQuelle, kantePack: r.kantePack,
        qAnteil, ueberfallhoehe: hue, ueberfallQuelle: hue === null ? null : r.ueberfallQuelle,
        wasserstand: kante !== null && hue !== null ? kante + hue : null, vermerk: VERMERK_SCHAETZUNG,
      });
    }
  }
  return out;
}

/** Σ Q · f der Einzugsflächen einer Dachfläche (l/s); null ohne Schätzung oder bei fehlendem Q bzw. f. */
function qNotDachflaeche(e: readonly EmergencyEstimate[]): number | null {
  if (e.length === 0) return null;
  let sum = 0;
  for (const x of e) {
    if (x.q === null || x.sicherheitsbeiwert === null) return null;
    sum += x.q * x.sicherheitsbeiwert;
  }
  return sum;
}
