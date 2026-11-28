/** Hilfsfunktionen zum Modell (rein). */
import type { Polygon } from "../geometry/types";
import { SCHEMA_VERSION } from "./migrate";
import type { Dachflaeche, Kontur, KonturPunkt, ProjectModel, Projekt, Wandanschluss, Zone } from "./types";
import { projektAusModell } from "./varianten";

/** Vorgabe Gefälle-Standard: 2 % (m/m). Nutzervorgabe, kein Regelgrenzwert. */
export const GEFAELLE_STANDARD = 0.02;

/** Leeres Modell (Dachflächen-Form/Varianten-Ansicht) mit Standardwerten. `jetzt` als ISO-Zeitstempel (Aufrufer liefert die Zeit, Kern bleibt deterministisch). */
export function createProject(name: string, jetzt: string): ProjectModel {
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: { name, erstelltAm: jetzt, geaendertAm: jetzt },
    packVersionen: {},
    standort: { koordinate: null, regen: { r5_5: { packWert: null }, r5_100: { packWert: null } } },
    gefaelleStandard: GEFAELLE_STANDARD,
    dachflaechen: [],
    unterlage: null,
  };
}

/** Leeres Projekt (Dateiform v3) mit einer leeren Variante „Variante 1“. */
export const createProjekt = (name: string, jetzt: string): Projekt => projektAusModell(createProject(name, jetzt));

/** Dachfläche als Geometrie-Polygon: Kontur außen, Aufbauten als Löcher. */
export function dachPolygon(d: Dachflaeche): Polygon {
  return { outer: d.kontur, holes: d.aufbauten.map((a) => a.kontur) };
}

/** Kante ab Punkt `kante` bis zum nächsten Konturpunkt; undefined, wenn die ID fehlt. */
export function konturKante(k: Kontur, kante: string): readonly [KonturPunkt, KonturPunkt] | undefined {
  const i = k.findIndex((p) => p.id === kante);
  if (i < 0) return undefined;
  return [k[i]!, k[(i + 1) % k.length]!];
}

/** Wandanschlüsse einer Dachfläche (Feld seit v4 optional; fehlt = keine). */
export const wandanschluesseVon = (d: Dachflaeche): readonly Wandanschluss[] => d.wandanschluesse ?? [];

/** Wirksame Belagdicke in m: Wert der Zone, sonst der Dachfläche, sonst 0 (= OK Abdichtung). */
export const belagDickeVon = (d: Dachflaeche, z?: Zone): number => z?.belagDicke ?? d.belagDicke ?? 0;
