/** Migrationskette für Projekt-JSON. Jede Migration hebt ein Dokument von Version n auf n+1. */

/** Aktuelle Schemaversion des Projektformats. */
export const SCHEMA_VERSION = 1;

/** Rohes JSON-Dokument (vor Validierung). */
export type RohDokument = Record<string, unknown>;

/** Migration von Version `n` (Schlüssel) auf `n + 1`. Darf das übergebene Dokument verändern. */
export type Migration = (doc: RohDokument) => RohDokument;
export type MigrationChain = Readonly<Record<number, Migration>>;

/** Registrierte Migrationen des Programms (bisher keine: es gibt nur Version 1). */
export const MIGRATIONS: MigrationChain = {};

export type MigrationResult =
  | { readonly ok: true; readonly doc: RohDokument; readonly hinweise: readonly string[] }
  | { readonly ok: false; readonly meldung: string; readonly neuereVersion: boolean };

/**
 * Hebt `doc` (mit gültiger ganzzahliger `schemaVersion`) auf `ziel`.
 * Neuere Versionen werden nicht angefasst, sondern gemeldet.
 */
export function migrate(doc: RohDokument, chain: MigrationChain, ziel: number): MigrationResult {
  const von = doc["schemaVersion"] as number;
  if (von > ziel) {
    return {
      ok: false,
      neuereVersion: true,
      meldung: `Projekt hat Schemaversion ${von}, dieses Programm kennt nur bis ${ziel}. Bitte Programm aktualisieren.`,
    };
  }
  let cur = doc;
  for (let v = von; v < ziel; v++) {
    const m = chain[v];
    if (!m) {
      return { ok: false, neuereVersion: false, meldung: `Keine Migration von Schemaversion ${v} auf ${v + 1} vorhanden.` };
    }
    cur = { ...m(cur), schemaVersion: v + 1 };
  }
  return { ok: true, doc: cur, hinweise: von < ziel ? [`Projekt von Schemaversion ${von} auf ${ziel} migriert.`] : [] };
}
