/** Migrationskette für Projekt-JSON. Jede Migration hebt ein Dokument von Version n auf n+1. */

/** Aktuelle Schemaversion des Projektformats. */
export const SCHEMA_VERSION = 3;

/** Rohes JSON-Dokument (vor Validierung). */
export type RohDokument = Record<string, unknown>;

/** Migration von Version `n` (Schlüssel) auf `n + 1`. Darf das übergebene Dokument verändern. */
export type Migration = (doc: RohDokument) => RohDokument;
export type MigrationChain = Readonly<Record<number, Migration>>;

const istObjekt = (v: unknown): v is RohDokument => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * v1 → v2: Entwässerungselemente erhalten die Kote des Tiefpunkts `z` (Standard 0 m).
 * Fehlerhafte Strukturen bleiben unverändert (die Validierung meldet sie danach).
 */
export const migriereV1nachV2: Migration = (doc) => {
  const daecher = doc["dachflaechen"];
  if (!Array.isArray(daecher)) return doc;
  return {
    ...doc,
    dachflaechen: daecher.map((d: unknown) => {
      if (!istObjekt(d) || !Array.isArray(d["entwaesserung"])) return d;
      return {
        ...d,
        entwaesserung: d["entwaesserung"].map((e: unknown) =>
          istObjekt(e) && !Object.hasOwn(e, "z") ? { ...e, z: 0 } : e),
      };
    }),
  };
};

/** Name der Variante, in die ein v2-Projekt migriert wird. */
export const VARIANTE_STANDARDNAME = "Variante 1";

/** Alle Werte von `id`-Feldern im Dokument (rekursiv). */
function sammleIds(v: unknown, out: Set<string>): Set<string> {
  if (Array.isArray(v)) for (const e of v) sammleIds(e, out);
  else if (istObjekt(v)) {
    if (typeof v["id"] === "string") out.add(v["id"]);
    for (const k of Object.keys(v)) sammleIds(v[k], out);
  }
  return out;
}

/**
 * v2 → v3: `dachflaechen` wandern in eine Variante „Variante 1“ (ID `v1`, bei Kollision `v2` …),
 * die aktiv wird. `gefaelleStandard` bleibt projektweit (Variante ohne eigenen Wert → Ergebnis gleich).
 * Neue optionale Plankopf-Felder in `meta` brauchen keine Daten. Fehlt `dachflaechen`, bleibt das
 * Dokument unverändert (die Validierung meldet den Fehler).
 */
export const migriereV2nachV3: Migration = (doc) => {
  if (!Object.hasOwn(doc, "dachflaechen")) return doc;
  const { dachflaechen, ...rest } = doc;
  const belegt = sammleIds(dachflaechen, new Set());
  let n = 1;
  while (belegt.has(`v${n}`)) n++;
  const id = `v${n}`;
  return { ...rest, varianten: [{ id, name: VARIANTE_STANDARDNAME, dachflaechen }], aktiveVariante: id };
};

/** Registrierte Migrationen des Programms. */
export const MIGRATIONS: MigrationChain = { 1: migriereV1nachV2, 2: migriereV2nachV3 };

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
