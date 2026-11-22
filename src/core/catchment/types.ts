/** Ergebnistypen der Einzugsflächen (PLAN Schritt 7). Flächen in m², Längen in m. */
import type { Polygon, Vec2 } from "../geometry/types";
import type { Id } from "../model/types";
import type { FlaechenBewertung, FlaechenStufe } from "../rules/regeln";
import type { RegelPack } from "../rules/types";

/** Teil eines Attikasegments, der einer Einzugsfläche zugeschlagen wird (Länge × Breite, Horizontalprojektion). */
export interface AttikaAnteil {
  readonly attikaId: Id;
  readonly von: Vec2;
  readonly bis: Vec2;
  readonly laenge: number;
  readonly breite: number;
  readonly flaeche: number;
}

/** Einzugsfläche eines Ablaufs: Zelle des Höhenfelds, an Kontur geschnitten, ohne Aufbauten. */
export interface Einzugsflaeche {
  /** `${dachflaecheId}/${ablaufId}` */
  readonly id: string;
  readonly dachflaecheId: Id;
  readonly ablaufId: Id;
  readonly polygone: readonly Polygon[];
  /** Dachfläche der Zelle (ohne Aufbauten, ohne Attika). */
  readonly dachFlaeche: number;
  /** Summe der zugeschlagenen Attikaanteile. */
  readonly attikaFlaeche: number;
  /** dachFlaeche + attikaFlaeche; maßgebend für die Flächengrenze je Ablauf. */
  readonly gesamtFlaeche: number;
  readonly attika: readonly AttikaAnteil[];
  /** Farbindex 0 … FARBEN_ANZAHL−1 (Palette in DESIGN.md); benachbarte Flächen nie gleich. */
  readonly farbe: number;
  /** Bewertung der Gesamtfläche gegen das Regel-Pack; null ohne Pack/Regel. */
  readonly bewertung: FlaechenBewertung | null;
}

export type CatchmentHinweisCode =
  | "flaeche-je-ablauf" | "regel-fehlt" | "attika-kante-fehlt" | "attika-ohne-ablauf" | "farben-erschoepft";

export interface CatchmentHinweis {
  readonly code: CatchmentHinweisCode;
  readonly dachflaecheId: Id;
  readonly objektId?: Id;
  readonly meldung: string;
  /** Nur bei `flaeche-je-ablauf`. */
  readonly stufe?: Exclude<FlaechenStufe, "ok">;
  /** Nur bei `flaeche-je-ablauf`: true, wenn die Dachfläche allein die Stufe nicht erreicht (Attikaanteil löst aus). */
  readonly durchAttika?: boolean;
  readonly regelId?: string;
  readonly quelle?: string;
}

export interface CatchmentResult {
  readonly flaechen: readonly Einzugsflaeche[];
  /** Paare benachbarter Einzugsflächen (IDs, gemeinsame Kante > Toleranz). */
  readonly nachbarn: readonly (readonly [string, string])[];
  readonly hinweise: readonly CatchmentHinweis[];
}

export interface CatchmentOptionen {
  /** Regel-Pack mit `flaeche-je-ablauf`; ohne Pack keine Bewertung. */
  readonly regeln?: RegelPack;
}
