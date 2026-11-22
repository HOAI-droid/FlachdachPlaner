/**
 * Zugriff auf Regelparameter. Grenzwerte stehen ausschließlich im Regel-Pack;
 * der Code kennt nur Regel- und Parameternamen.
 */
import type { DaemmplattenPack, Einheit, RegelPack, RulePack } from "./types";

/** Regel-ID der Flächengrenze je Ablauf (Parameter hinweisAb ≥, fehlerUeber >). */
export const REGEL_FLAECHE_JE_ABLAUF = "flaeche-je-ablauf";

/** Ein Parameterwert samt Herkunft (für Befunde: regelId + quelle). */
export interface RegelWert {
  readonly wert: number;
  readonly einheit: Einheit;
  readonly regelId: string;
  readonly packId: string;
  readonly packVersion: string;
  readonly quelle: string;
  readonly fundstelle?: string;
}

/** Liefert einen Parameter einer Regel oder null, wenn Regel/Parameter fehlen. */
export function regelParameter(pack: RegelPack, regelId: string, name: string): RegelWert | null {
  const r = pack.daten.regeln.find((x) => x.id === regelId);
  const p = r && Object.hasOwn(r.parameter, name) ? r.parameter[name] : undefined;
  if (!r || !p) return null;
  return {
    wert: p.wert, einheit: p.einheit, regelId, packId: pack.id, packVersion: pack.version, quelle: pack.quelle,
    ...(r.fundstelle !== undefined ? { fundstelle: r.fundstelle } : {}),
  };
}

export type FlaechenStufe = "ok" | "hinweis" | "fehler";
export interface FlaechenBewertung {
  readonly stufe: FlaechenStufe;
  readonly hinweisAb: RegelWert;
  readonly fehlerUeber: RegelWert;
}

/**
 * Bewertet eine Einzugsfläche je Ablauf (m², inkl. Attikaanteil) gegen das Regel-Pack.
 * null = Regel fehlt oder hat nicht die Einheit m² (der Aufrufer meldet das als Befund).
 */
export function bewerteEinzugsflaeche(flaeche: number, pack: RegelPack): FlaechenBewertung | null {
  const hinweisAb = regelParameter(pack, REGEL_FLAECHE_JE_ABLAUF, "hinweisAb");
  const fehlerUeber = regelParameter(pack, REGEL_FLAECHE_JE_ABLAUF, "fehlerUeber");
  if (!hinweisAb || !fehlerUeber || hinweisAb.einheit !== "m2" || fehlerUeber.einheit !== "m2") return null;
  const stufe: FlaechenStufe = flaeche > fehlerUeber.wert ? "fehler" : flaeche >= hinweisAb.wert ? "hinweis" : "ok";
  return { stufe, hinweisAb, fehlerUeber };
}

/** Sucht einen Regelparameter in allen geladenen Regel-Packs (erstes Vorkommen); null, wenn er fehlt. */
export function findeRegelParameter(packs: readonly RulePack[], regelId: string, name: string): RegelWert | null {
  for (const p of packs) {
    if (p.typ !== "regeln") continue;
    const w = regelParameter(p, regelId, name);
    if (w) return w;
  }
  return null;
}

const MM_JE_M = 1000;

/**
 * Standard-Mindestdämmdicke am Tiefpunkt in mm (A2b): Anfangsdicke der dünnsten Gefälleplatte
 * des Plattenpacks; null bei leerem Pack.
 */
export function standardDaemmdickeTiefpunkt(pack: DaemmplattenPack): number | null {
  if (pack.daten.typen.length === 0) return null;
  return MM_JE_M * Math.min(...pack.daten.typen.map((t) => t.dickeAnfang));
}

