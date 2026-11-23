/**
 * Varianten (PLAN Schritt 36): Ansicht einer Variante als `ProjectModel` und Rückschreiben. Rein.
 * Nur dieses Modul und `core/edit` greifen auf `Projekt.varianten` zu (Guard-Test); der Rechenkern
 * arbeitet unverändert auf der Ansicht.
 */
import { SCHEMA_VERSION, VARIANTE_STANDARDNAME } from "./migrate";
import type { Dachflaeche, Id, ProjectModel, Projekt, Variante } from "./types";

export const VARIANTEN_NAME_MAX = 200;

/** Vergleichsschlüssel für Variantennamen: ohne Randleerzeichen, ohne Groß-/Kleinschreibung. */
export const variantenNameSchluessel = (name: string): string => name.trim().toLocaleLowerCase("de");

/**
 * IDs der übrigen Varianten an einer Ansicht (Symbol-Schlüssel: wird durch `{...m}` weitergereicht,
 * aber nie serialisiert oder validiert). `neueIds` berücksichtigt sie, damit neue IDs projektweit eindeutig sind.
 */
const FREMDE_IDS: unique symbol = Symbol("fremdeIds");
type MitFremden = ProjectModel & { readonly [FREMDE_IDS]?: readonly Id[] };

/** Für `neueIds`: in anderen Varianten belegte IDs (leer bei einer Ansicht ohne Geschwister). */
export const reservierteIds = (m: ProjectModel): readonly Id[] => (m as MitFremden)[FREMDE_IDS] ?? [];

/** Alle Objekt-IDs einer Dachflächenliste (Dachflächen, Konturpunkte, Aufbauten, Zonen, Attika, Schwellen, Wandanschlüsse, Entwässerung). */
export function idsDerDachflaechen(ds: readonly Dachflaeche[]): Id[] {
  const ids: Id[] = [];
  for (const d of ds) {
    ids.push(d.id, ...d.kontur.map((p) => p.id));
    for (const a of d.aufbauten) ids.push(a.id, ...a.kontur.map((p) => p.id));
    for (const z of d.zonen) ids.push(z.id, ...z.kontur.map((p) => p.id));
    ids.push(...d.attika.map((a) => a.id), ...d.tuerschwellen.map((t) => t.id), ...(d.wandanschluesse ?? []).map((w) => w.id));
    ids.push(...d.entwaesserung.map((e) => e.id));
  }
  return ids;
}

/** Variante mit `id` (Standard: die aktive); wirft bei unbekannter ID (Programmierfehler). */
export function variante(p: Projekt, id: Id = p.aktiveVariante): Variante {
  const v = p.varianten.find((x) => x.id === id);
  if (!v) throw new Error(`Variante "${id}" gibt es nicht`);
  return v;
}

/** Varianten in Listenreihenfolge (für Listen, Export-Auswahl, Statusleiste). */
export const variantenListe = (p: Projekt): readonly { readonly id: Id; readonly name: string; readonly aktiv: boolean }[] =>
  p.varianten.map((v) => ({ id: v.id, name: v.name, aktiv: v.id === p.aktiveVariante }));

/**
 * Ansicht der Variante `id` (Standard: aktive) im bisherigen Modellformat: Rechenkern, Werkzeuge
 * und Exporte arbeiten darauf unverändert. `gefaelleStandard` = Wert der Variante, sonst projektweit.
 */
export function modellFuerVariante(p: Projekt, id: Id = p.aktiveVariante): ProjectModel {
  const v = variante(p, id);
  const m: ProjectModel = {
    schemaVersion: p.schemaVersion,
    meta: p.meta,
    packVersionen: p.packVersionen,
    standort: p.standort,
    gefaelleStandard: v.gefaelleStandard ?? p.gefaelleStandard,
    dachflaechen: v.dachflaechen,
    unterlage: p.unterlage,
  };
  if (p.varianten.length < 2) return m;
  const fremde = p.varianten.filter((x) => x.id !== v.id).flatMap((x) => [x.id, ...idsDerDachflaechen(x.dachflaechen)]);
  return { ...m, [FREMDE_IDS]: fremde } as MitFremden;
}

/**
 * Schreibt eine (geänderte) Ansicht in die Variante `id` zurück: Dachflächen und Gefälle-Standard in
 * die Variante, Metadaten/Standort/Packs/Unterlage projektweit. Unverändert → dasselbe Objekt `p`.
 * Ein geänderter Gefälle-Standard gilt nur für diese Variante.
 */
export function mitModell(p: Projekt, m: ProjectModel, id: Id = p.aktiveVariante): Projekt {
  const v = variante(p, id);
  const gefaelleAlt = v.gefaelleStandard ?? p.gefaelleStandard;
  const vNeu: Variante = m.dachflaechen === v.dachflaechen && m.gefaelleStandard === gefaelleAlt
    ? v
    : { ...v, dachflaechen: m.dachflaechen, ...(m.gefaelleStandard === gefaelleAlt ? {} : { gefaelleStandard: m.gefaelleStandard }) };
  const gleich = vNeu === v && m.meta === p.meta && m.packVersionen === p.packVersionen && m.standort === p.standort && m.unterlage === p.unterlage;
  if (gleich) return p;
  return {
    ...p,
    meta: m.meta, packVersionen: m.packVersionen, standort: m.standort, unterlage: m.unterlage,
    varianten: vNeu === v ? p.varianten : p.varianten.map((x) => (x.id === id ? vNeu : x)),
  };
}

/** Nächste freie Varianten-ID `v<n>` (n ab 1), die keine der `belegt`-IDs ist. */
export function freieVariantenId(belegt: Iterable<Id>): Id {
  const s = new Set(belegt);
  let n = 1;
  while (s.has(`v${n}`)) n++;
  return `v${n}`;
}

/** Projekt aus einem Modell in Dachflächen-Form: eine Variante `name` (ID `v1`, bei Kollision `v2` …). */
export function projektAusModell(m: ProjectModel, name: string = VARIANTE_STANDARDNAME): Projekt {
  const v = { id: freieVariantenId(idsDerDachflaechen(m.dachflaechen)), name };
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: m.meta, packVersionen: m.packVersionen, standort: m.standort, gefaelleStandard: m.gefaelleStandard,
    varianten: [{ id: v.id, name: v.name, dachflaechen: m.dachflaechen }],
    aktiveVariante: v.id,
    unterlage: m.unterlage,
  };
}
