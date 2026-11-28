/**
 * Ergebnistypen des Gefälledämmplans (PLAN §5 `layoutInsulation`, Schritte 24/25).
 * Längen/Dicken in m, Flächen in m². Keine Stückliste (Nutzerentscheid).
 */
import type { Befund } from "../checks/types";
import type { Polygon, Ring, Vec2 } from "../geometry/types";
import type { Id } from "../model/types";
import type { DaemmplattenPack } from "../rules/types";
import type { Ebene } from "../slope/types";

/** Plattenkatalog = Dämmplatten-Pack (Format, Gefälle, Dickenstufen, Zusatzlage, Kehlkeile). */
export type PlateCatalog = DaemmplattenPack;

/** "platte" = Gefälleplatte (ganz oder Zuschnitt), "kehlkeil" = Kehlkeil aus dem Katalog, "flach" = 0-%-Fläche. */
export type PlattenArt = "platte" | "kehlkeil" | "flach";

export interface VerlegtePlatte {
  /** `${facetteId}/${reihe}/${spalte}` (bei mehreren Stücken je Zelle mit `/n`). */
  readonly id: string;
  readonly dachflaecheId: Id;
  readonly facetteId: string;
  readonly zoneId?: Id;
  readonly ablaufId: Id;
  readonly art: PlattenArt;
  /** Plattentyp aus dem Katalog; null bei "flach". */
  readonly typ: string | null;
  /** Anzahl Zusatzlagen unter der Platte (Neustart über dem höchsten Typ). */
  readonly zusatzlagen: number;
  /** Kehlkeil: Katalog-ID und Seite (Blick die Kehle hinab zum Ablauf). */
  readonly kehlkeilId?: string;
  readonly seite?: "L" | "R";
  /** Planbeschriftung: "3", "1+1" (Typ 1 auf einer Zusatzlage), "K2 L", "K1+1 R", "F". */
  readonly bezeichnung: string;
  /** Reihe ab Dickenstufe 0 (Typ 1 ohne Zusatzlage) und Spalte ab Verlegestart. */
  readonly reihe: number;
  readonly spalte: number;
  /** true = Stück kleiner als die Rohplatte bzw. der volle Kehlkeil. */
  readonly zuschnitt: boolean;
  /** Stück grenzt an einen Grat (Platten treffen gespiegelt ohne Keil zusammen). */
  readonly gratschnitt: boolean;
  /** Verlegte Kontur (bei ganzen Platten exakt das Katalogformat). */
  readonly polygon: Polygon;
  readonly flaeche: number;
  /** Rohplatte im Katalogformat (Rechteck, gegen den Uhrzeigersinn). */
  readonly rohplatte: Ring;
  /** Ausdehnung des Stücks in Fallrichtung (laenge) und Reihenrichtung (breite). */
  readonly laenge: number;
  readonly breite: number;
  /** Einheitsvektor der Dickenzunahme (bergauf); Verlegepfeile zeigen entgegen (zum Ablauf). */
  readonly richtung: Vec2;
  /** Gesamte Dämmdicke (Grundlage + Zusatzlagen + Platte) als Ebene über (x, y), gültig im Stück. */
  readonly dicke: Ebene;
}

/** Verlegestart einer Facette: Rasterursprung (Ablauf) und Richtungen von Reihen/Spalten. */
export interface Verlegestart {
  readonly facetteId: string;
  readonly ablaufId: Id;
  readonly punkt: Vec2;
  /** Bergauf (Reihenfolge der Reihen ab Tiefpunkt). */
  readonly reihenrichtung: Vec2;
  /** Längs der Reihe (Spalten). */
  readonly spaltenrichtung: Vec2;
}

/** Verlegepfeil je Facette und Reihe (zeigt bergab zum Ablauf). */
export interface Verlegepfeil {
  readonly facetteId: string;
  readonly reihe: number;
  readonly start: Vec2;
  readonly richtung: Vec2;
}

export interface DaemmplanDach {
  readonly dachflaecheId: Id;
  readonly platten: readonly VerlegtePlatte[];
  readonly pfeile: readonly Verlegepfeil[];
  readonly verlegestarts: readonly Verlegestart[];
  /** N0: Tiefpunkt der Dachfläche (Bezug der Dickenstufen). */
  readonly n0: { readonly position: Vec2; readonly kote: number } | null;
  /** Mindestdämmdicke am Tiefpunkt d_TP (m). */
  readonly tiefpunktDicke: number;
  /** Konstante Lage unter den Gefälleplatten: max(0, d_TP − Anfangsdicke Typ 1) (m). */
  readonly grundlage: number;
  /** Dicke einer Zusatzlage (m). */
  readonly zusatzlageDicke: number;
}

export interface InsulationLayout {
  readonly katalog: { readonly packId: string; readonly version: string };
  readonly dachflaechen: readonly DaemmplanDach[];
  readonly befunde: readonly Befund[];
}

export interface LayoutOptionen {
  /** Standard-Mindestdämmdicke am Tiefpunkt in mm, wenn weder Slope-Ergebnis noch Dachfläche sie liefern. */
  readonly daemmdickeTiefpunktStandard?: number;
}

/** Ergebnis der Maß- und Lückenprüfung (Schritt 25) je Dachfläche. Flächen in m². */
export interface VerlegeplanPruefungDach {
  readonly dachflaecheId: Id;
  readonly dachflaeche: number;
  readonly plattenflaeche: number;
  /** Dachfläche ohne Platten. */
  readonly luecken: number;
  /** Doppelt belegte Fläche (Σ Platten − Vereinigung). */
  readonly ueberlappungen: number;
  readonly ganzePlatten: number;
  readonly zuschnitte: number;
  readonly kehlkeile: number;
  readonly ok: boolean;
}

export interface VerlegeplanPruefung {
  readonly ok: boolean;
  readonly dachflaechen: readonly VerlegeplanPruefungDach[];
  readonly befunde: readonly Befund[];
}

export interface PruefOptionen {
  /** Flächentoleranz in m² (Standard 0,01). */
  readonly flaechenToleranz?: number;
}
