/**
 * Undo/Redo (PLAN Schritt 17), Befehlsmuster über unveränderliche Projektzustände:
 * Ein Befehl ist eine reine Funktion Modell → Modell mit Bezeichnung; der Verlauf hält die
 * Vorzustände (strukturelles Teilen, daher billig). Rein, ohne DOM.
 */
import type { ProjectModel } from "../model/types";

/** Befehl auf einem Zustand `T` (Standard: Varianten-Ansicht; für das ganze Projekt `Befehl<Projekt>`). */
export interface Befehl<T = ProjectModel> {
  readonly label: string;
  readonly anwenden: (m: T) => T;
}

export interface Verlauf<T = ProjectModel> {
  readonly aktuell: T;
  readonly zurueck: readonly { readonly label: string; readonly modell: T }[];
  readonly vor: readonly { readonly label: string; readonly modell: T }[];
}

export const MAX_SCHRITTE = 200;

export const neuerVerlauf = <T = ProjectModel>(m: T): Verlauf<T> => ({ aktuell: m, zurueck: [], vor: [] });

/** Führt den Befehl aus; liefert denselben Verlauf, wenn der Befehl nichts ändert. Löscht die Wiederholen-Liste. */
export function ausfuehren<T>(v: Verlauf<T>, b: Befehl<T>): Verlauf<T> {
  const n = b.anwenden(v.aktuell);
  if (n === v.aktuell) return v;
  const zurueck = [...v.zurueck, { label: b.label, modell: v.aktuell }];
  return { aktuell: n, zurueck: zurueck.length > MAX_SCHRITTE ? zurueck.slice(-MAX_SCHRITTE) : zurueck, vor: [] };
}

export const kannRueckgaengig = <T>(v: Verlauf<T>): boolean => v.zurueck.length > 0;
export const kannWiederholen = <T>(v: Verlauf<T>): boolean => v.vor.length > 0;

export function rueckgaengig<T>(v: Verlauf<T>): Verlauf<T> {
  const letzter = v.zurueck[v.zurueck.length - 1];
  if (!letzter) return v;
  return {
    aktuell: letzter.modell, zurueck: v.zurueck.slice(0, -1),
    vor: [{ label: letzter.label, modell: v.aktuell }, ...v.vor],
  };
}

export function wiederholen<T>(v: Verlauf<T>): Verlauf<T> {
  const erster = v.vor[0];
  if (!erster) return v;
  return {
    aktuell: erster.modell, zurueck: [...v.zurueck, { label: erster.label, modell: v.aktuell }], vor: v.vor.slice(1),
  };
}

/** Geändert seit dem Stand `gespeichert` (Modellreferenz beim Speichern/Öffnen/Neu)? Undo bis dorthin gilt wieder als unverändert. */
export const istGeaendert = <T>(v: Verlauf<T>, gespeichert: T): boolean => v.aktuell !== gespeichert;
