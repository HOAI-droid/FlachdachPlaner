/** Projekt-JSON: deterministische Ausgabe, Einlesen mit Migration und Validierung (wirft nie). */
import { MIGRATIONS, SCHEMA_VERSION, migrate, type MigrationChain, type RohDokument } from "./migrate";
import type { ProjectModel, Projekt } from "./types";
import { validateProject, validateProjekt, type ValidationError } from "./validate";
import { modellFuerVariante, projektAusModell } from "./varianten";

/**
 * Kanonische Form: Objektschlüssel sortiert (Wurzel: `schemaVersion` zuerst),
 * `undefined` entfällt, Listen behalten ihre Reihenfolge. −0 wird wie in JSON zu 0.
 */
function kanonisch(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(kanonisch);
  if (typeof v === "object" && v !== null) {
    const keys = Object.keys(v).filter((k) => (v as Record<string, unknown>)[k] !== undefined).sort();
    // Object.fromEntries legt eigene Eigenschaften an (auch für "__proto__"), kein Prototyp-Wechsel.
    return Object.fromEntries(keys.map((k) => [k, kanonisch((v as Record<string, unknown>)[k])]));
  }
  return v;
}

function kanonischerText(p: object): string {
  const k = kanonisch(p) as Record<string, unknown>;
  const { schemaVersion, ...rest } = k;
  return JSON.stringify({ schemaVersion, ...rest }, null, 2) + "\n";
}

/** Serialisiert eine Projektdatei (v3) deterministisch (gleiches Projekt → byte-gleiche Ausgabe). */
export const serializeProjekt = (p: Projekt): string => kanonischerText(p);

/**
 * Übergang bis zur Varianten-UI (Schritt 37): schreibt ein Modell in Dachflächen-Form als v3-Datei
 * mit genau einer Variante. Weitere Varianten gehen dabei nicht ein → für Projekte `serializeProjekt`.
 */
export const serializeProject = (m: ProjectModel): string => serializeProjekt(projektAusModell(m));

export type ParseResult<T = ProjectModel> =
  | { readonly ok: true; readonly projekt: T; readonly hinweise: readonly string[] }
  | { readonly ok: false; readonly fehler: readonly ValidationError[]; readonly neuereVersion: boolean };

export interface ParseOptions {
  /** Nur für Tests/Erweiterungen: andere Migrationskette bzw. Zielversion. */
  readonly migrations?: MigrationChain;
  readonly zielVersion?: number;
}

const fehler = (pfad: string, meldung: string, neuereVersion = false): ParseResult =>
  ({ ok: false, fehler: [{ pfad, meldung }], neuereVersion });

/**
 * Liest Projekt-JSON: Syntax → Schemaversion → Migration → Validierung. Ergebnis ist das Rohdokument
 * der Zielversion (Varianten-Form ab v3, Dachflächen-Form bis v2).
 */
function parseRoh(text: string, opts: ParseOptions): ParseResult<unknown> {
  const ziel = opts.zielVersion ?? SCHEMA_VERSION;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return fehler("", `Kein gültiges JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return fehler("", "Projekt muss ein JSON-Objekt sein");
  const sv = (raw as RohDokument)["schemaVersion"];
  if (typeof sv !== "number" || !Number.isInteger(sv) || sv < 1) {
    return fehler("/schemaVersion", "Schemaversion fehlt oder ist keine ganze Zahl ≥ 1");
  }
  const m = migrate(raw as RohDokument, opts.migrations ?? MIGRATIONS, ziel);
  if (!m.ok) return fehler("/schemaVersion", m.meldung, m.neuereVersion);
  const errs = ziel >= 3 ? validateProjekt(m.doc, ziel) : validateProject(m.doc, ziel);
  if (errs.length > 0) return { ok: false, fehler: errs, neuereVersion: false };
  return { ok: true, projekt: m.doc, hinweise: m.hinweise };
}

/** Liest eine Projektdatei (jede bekannte Version) als `Projekt` (v3, Varianten-Form). */
export function parseProjekt(text: string, opts: ParseOptions = {}): ParseResult<Projekt> {
  return parseRoh(text, opts) as ParseResult<Projekt>;
}

/**
 * Übergang bis zur Varianten-UI (Schritt 37): liest eine Projektdatei und liefert die Ansicht der
 * aktiven Variante (Dachflächen-Form). Für Zielversionen < 3 (Tests) das Dokument selbst.
 */
export function parseProject(text: string, opts: ParseOptions = {}): ParseResult {
  const r = parseRoh(text, opts);
  if (!r.ok) return r;
  if ((opts.zielVersion ?? SCHEMA_VERSION) < 3) return r as ParseResult;
  return { ok: true, projekt: modellFuerVariante(r.projekt as Projekt), hinweise: r.hinweise };
}
