/** Projekt-JSON: deterministische Ausgabe, Einlesen mit Migration und Validierung (wirft nie). */
import { MIGRATIONS, SCHEMA_VERSION, migrate, type MigrationChain, type RohDokument } from "./migrate";
import type { ProjectModel } from "./types";
import { validateProject, type ValidationError } from "./validate";

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

/** Serialisiert ein Projekt deterministisch (gleiches Modell → byte-gleiche Ausgabe). */
export function serializeProject(p: ProjectModel): string {
  const k = kanonisch(p) as Record<string, unknown>;
  const { schemaVersion, ...rest } = k;
  return JSON.stringify({ schemaVersion, ...rest }, null, 2) + "\n";
}

export type ParseResult =
  | { readonly ok: true; readonly projekt: ProjectModel; readonly hinweise: readonly string[] }
  | { readonly ok: false; readonly fehler: readonly ValidationError[]; readonly neuereVersion: boolean };

export interface ParseOptions {
  /** Nur für Tests/Erweiterungen: andere Migrationskette bzw. Zielversion. */
  readonly migrations?: MigrationChain;
  readonly zielVersion?: number;
}

const fehler = (pfad: string, meldung: string, neuereVersion = false): ParseResult =>
  ({ ok: false, fehler: [{ pfad, meldung }], neuereVersion });

/** Liest Projekt-JSON: Syntax → Schemaversion → Migration → Validierung. */
export function parseProject(text: string, opts: ParseOptions = {}): ParseResult {
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
  const errs = validateProject(m.doc, ziel);
  if (errs.length > 0) return { ok: false, fehler: errs, neuereVersion: false };
  return { ok: true, projekt: m.doc as unknown as ProjectModel, hinweise: m.hinweise };
}
