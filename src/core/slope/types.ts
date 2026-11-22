/** Ergebnistypen des Höhenfelds (PLAN §5 `computeSlope`). Längen/Koten in m, Dämmdicken in mm. */
import type { Polygon, Vec2 } from "../geometry/types";
import type { Id } from "../model/types";

/** Ablauf als Quelle des Höhenfelds: Lage und Kote des Tiefpunkts. */
export interface Hoehenquelle {
  readonly ablaufId: Id;
  readonly position: Vec2;
  readonly z: number;
}

/**
 * Höhenfeld einer Dachfläche: h(x) = min_i (z_i + s · d∞(x, E_i)),
 * d∞ = Maximumsnorm im Achsensystem der Dachfläche (`achse` = Einheitsvektor der 1. Achse).
 */
export interface Hoehenfeld {
  readonly gefaelle: number;
  readonly achse: Vec2;
  readonly quellen: readonly Hoehenquelle[];
}

/** Ebene h(x, y) = a·x + b·y + c (a, b dimensionslos, c in m). */
export interface Ebene {
  readonly a: number;
  readonly b: number;
  readonly c: number;
}

/** Ebene Teilfläche des Höhenfelds: ein Ablauf, eine der vier Pyramidenseiten. */
export interface Facette {
  readonly id: string;
  readonly ablaufId: Id;
  /** Pyramidenseite: 0 = +Achse, 1 = +Querachse, 2 = −Achse, 3 = −Querachse. */
  readonly seite: 0 | 1 | 2 | 3;
  readonly polygon: Polygon;
  /** m² */
  readonly flaeche: number;
  readonly ebene: Ebene;
  /** Gefälle (m/m). */
  readonly gefaelle: number;
  /** Einheitsvektor in Fallrichtung (bergab). */
  readonly fallrichtung: Vec2;
}

/** Grat (Wasserscheide zwischen zwei Abläufen) oder Kehle (Faltlinie zum Ablauf). */
export interface Faltlinie {
  readonly art: "grat" | "kehle";
  readonly von: Vec2;
  readonly bis: Vec2;
  /** Beteiligte Abläufe (bei Kehlen zweimal derselbe). */
  readonly ablaufIds: readonly [Id, Id];
}

export type KotenArt = "ablauf" | "ecke" | "grat" | "kehle";

export interface Kote {
  readonly position: Vec2;
  /** Höhe in m über Projekt-Nullpunkt. */
  readonly kote: number;
  readonly art: KotenArt;
}

export interface Extrempunkt {
  readonly kote: number;
  readonly orte: readonly Vec2[];
}

export interface Gefaellepfeil {
  readonly facetteId: string;
  /** Punkt im Inneren der Facette. */
  readonly start: Vec2;
  /** Einheitsvektor bergab. */
  readonly richtung: Vec2;
  readonly gefaelle: number;
}

/** Mittlere Gefälledämmdicke (A2b), flächengewichtet, ohne Aufbauten. */
export interface Gefaelledaemmung {
  /** d_m in mm. */
  readonly mittel: number;
  /** = d_TP in mm. */
  readonly min: number;
  /** d_TP + (HP − TP) in mm. */
  readonly max: number;
  readonly tiefpunktDicke: number;
  /** true, wenn d_TP an der Dachfläche vorgegeben ist (sonst Standard). */
  readonly tiefpunktVorgegeben: boolean;
  /** Bezugsfläche in m². */
  readonly flaeche: number;
}

export interface DachGefaelle {
  readonly dachflaecheId: Id;
  readonly feld: Hoehenfeld;
  readonly facetten: readonly Facette[];
  readonly linien: readonly Faltlinie[];
  /** Koten an Ecken (Kontur, Aufbauten), Abläufen und Enden der Grate/Kehlen. */
  readonly koten: readonly Kote[];
  readonly hochpunkt: Extrempunkt | null;
  readonly tiefpunkt: Extrempunkt | null;
  readonly pfeile: readonly Gefaellepfeil[];
  readonly daemmung: Gefaelledaemmung | null;
}

export type SlopeHinweisCode = "keine-punktablaeufe" | "ablauf-nicht-beruecksichtigt" | "ablauf-ausserhalb" | "gefaelle-null";

export interface SlopeHinweis {
  readonly code: SlopeHinweisCode;
  readonly dachflaecheId: Id;
  readonly objektId?: Id;
  readonly meldung: string;
}

export interface SlopeResult {
  readonly dachflaechen: readonly DachGefaelle[];
  readonly hinweise: readonly SlopeHinweis[];
}

export interface SlopeOptionen {
  /** Standard-Mindestdämmdicke am Tiefpunkt in mm (z. B. aus Pack), wenn die Dachfläche keine vorgibt; sonst 0. */
  readonly daemmdickeTiefpunktStandard?: number;
}
