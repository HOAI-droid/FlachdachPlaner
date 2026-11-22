/**
 * Undo/Redo (PLAN Schritt 17), Befehlsmuster über unveränderliche Projektzustände:
 * Ein Befehl ist eine reine Funktion Modell → Modell mit Bezeichnung; der Verlauf hält die
 * Vorzustände (strukturelles Teilen, daher billig). Rein, ohne DOM.
 */
import type { ProjectModel } from "../model/types";

export interface Befehl {
  readonly label: string;
  readonly anwenden: (m: ProjectModel) => ProjectModel;
}

export interface Verlauf {
  readonly aktuell: ProjectModel;
  readonly zurueck: readonly { readonly label: string; readonly modell: ProjectModel }[];
  readonly vor: readonly { readonly label: string; readonly modell: ProjectModel }[];
}

export const MAX_SCHRITTE = 200;

export const neuerVerlauf = (m: ProjectModel): Verlauf => ({ aktuell: m, zurueck: [], vor: [] });

/** Führt den Befehl aus; liefert denselben Verlauf, wenn der Befehl nichts ändert. Löscht die Wiederholen-Liste. */
export function ausfuehren(v: Verlauf, b: Befehl): Verlauf {
  const n = b.anwenden(v.aktuell);
  if (n === v.aktuell) return v;
  const zurueck = [...v.zurueck, { label: b.label, modell: v.aktuell }];
  return { aktuell: n, zurueck: zurueck.length > MAX_SCHRITTE ? zurueck.slice(-MAX_SCHRITTE) : zurueck, vor: [] };
}

export const kannRueckgaengig = (v: Verlauf): boolean => v.zurueck.length > 0;
export const kannWiederholen = (v: Verlauf): boolean => v.vor.length > 0;

export function rueckgaengig(v: Verlauf): Verlauf {
  const letzter = v.zurueck[v.zurueck.length - 1];
  if (!letzter) return v;
  return {
    aktuell: letzter.modell, zurueck: v.zurueck.slice(0, -1),
    vor: [{ label: letzter.label, modell: v.aktuell }, ...v.vor],
  };
}

export function wiederholen(v: Verlauf): Verlauf {
  const erster = v.vor[0];
  if (!erster) return v;
  return {
    aktuell: erster.modell, zurueck: [...v.zurueck, { label: erster.label, modell: v.aktuell }], vor: v.vor.slice(1),
  };
}
