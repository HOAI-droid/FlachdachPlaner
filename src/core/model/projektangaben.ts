/** Plankopf-/Schriftfeldangaben in `meta` (seit Schemaversion 3): Prüfung und Setter. Rein. */
import type { Projektangaben, Projektmetadaten } from "./types";

/** Optionale Plankopf-Felder in `meta` (Reihenfolge = Formularreihenfolge). */
export const PROJEKTANGABEN_FELDER = [
  "bauvorhaben", "bauherr", "planinhalt", "bueroName", "bueroAnschrift", "bueroKontakt",
  "bearbeiter", "geprueftVon", "planNummer", "planDatum", "revision", "revisionDatum",
] as const satisfies readonly (keyof Projektangaben)[];

export type ProjektangabenFeld = (typeof PROJEKTANGABEN_FELDER)[number];
/** Über `setzeProjektangaben` änderbare Felder: Plankopf-Felder, Projektname, Projektnummer, Notiz. */
export type AngabenFeld = ProjektangabenFeld | "name" | "projektnummer" | "notiz";

export const ANGABE_MAX_LAENGE = 200;
export const NOTIZ_MAX_LAENGE = 2000;
const DATUMS_FELDER: ReadonlySet<string> = new Set(["planDatum", "revisionDatum"]);
const ISO_DATUM = /^(\d{4})-(\d{2})-(\d{2})$/;
const ALLE_FELDER: ReadonlySet<string> = new Set<string>([...PROJEKTANGABEN_FELDER, "name", "projektnummer", "notiz"]);

/** Kalendergültiges ISO-Datum JJJJ-MM-TT (z. B. kein 2026-02-30). */
export function istIsoDatum(s: string): boolean {
  const m = ISO_DATUM.exec(s);
  if (!m) return false;
  const [j, mo, t] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(j, mo - 1, t));
  return d.getUTCFullYear() === j && d.getUTCMonth() === mo - 1 && d.getUTCDate() === t;
}

/** Fehlermeldung für einen Textwert eines Angabenfelds oder null (gültig). Leere Texte sind gültig. */
export function pruefeAngabe(feld: string, wert: string): string | null {
  const max = feld === "notiz" ? NOTIZ_MAX_LAENGE : ANGABE_MAX_LAENGE;
  if (wert.length > max) return `Höchstens ${max} Zeichen`;
  if (DATUMS_FELDER.has(feld) && wert !== "" && !istIsoDatum(wert)) return "Datum als JJJJ-MM-TT erwartet";
  return null;
}

/** Änderung: Text setzt (getrimmt), "" oder null entfernt das Feld (Projektname: Pflicht, nicht leer). */
export type ProjektangabenTeil = { readonly [K in AngabenFeld]?: string | null };

export interface AngabenFehler {
  /** Feldname in `meta`. */
  readonly feld: string;
  readonly meldung: string;
}

export type AngabenErgebnis<T> =
  | { readonly ok: true; readonly modell: T }
  | { readonly ok: false; readonly fehler: readonly AngabenFehler[] };

/**
 * Setzt Plankopf-Angaben in `meta` (für `Projekt` wie für `ProjectModel`). Prüft alle Felder und
 * ändert nur, wenn alle gültig sind (sonst alle Fehler). Ohne inhaltliche Änderung kommt dasselbe
 * Objekt zurück (kein Undo-Schritt). `geaendertAm` bleibt unberührt (Zeit setzt der Aufrufer).
 */
export function setzeProjektangaben<T extends { readonly meta: Projektmetadaten }>(modell: T, teil: ProjektangabenTeil): AngabenErgebnis<T> {
  const fehler: AngabenFehler[] = [];
  const neu: Record<string, unknown> = { ...modell.meta };
  let geaendert = false;
  for (const [feld, roh] of Object.entries(teil) as [string, unknown][]) {
    if (roh === undefined) continue;
    if (!ALLE_FELDER.has(feld)) { fehler.push({ feld, meldung: "Unbekanntes Feld" }); continue; }
    if (roh !== null && typeof roh !== "string") { fehler.push({ feld, meldung: "Text erwartet" }); continue; }
    const wert = (roh ?? "").trim();
    if (feld === "name" && wert === "") { fehler.push({ feld, meldung: "Projektname darf nicht leer sein" }); continue; }
    const f = pruefeAngabe(feld, wert);
    if (f) { fehler.push({ feld, meldung: f }); continue; }
    if (wert === "") {
      if (neu[feld] !== undefined) { delete neu[feld]; geaendert = true; }
    } else if (neu[feld] !== wert) { neu[feld] = wert; geaendert = true; }
  }
  if (fehler.length) return { ok: false, fehler };
  if (!geaendert) return { ok: true, modell };
  return { ok: true, modell: { ...modell, meta: neu as unknown as Projektmetadaten } };
}
