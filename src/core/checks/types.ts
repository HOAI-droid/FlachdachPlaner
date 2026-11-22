/** Befunde der Prüfungen (PLAN §5 `runChecks`). Längen/Koten in m. */
import type { Vec2 } from "../geometry/types";
import type { Id } from "../model/types";

export type BefundStufe = "fehler" | "warnung" | "hinweis";

export interface Befund {
  readonly stufe: BefundStufe;
  /** Feiner Befundcode (z. B. "vorgabe-max-hochpunkt"). */
  readonly code: string;
  readonly meldung: string;
  /** Betroffenes Objekt (Dachfläche, Zone, Ablauf, Attika, Schwelle, Pack); null = Projekt. */
  readonly objektId: Id | null;
  readonly dachflaecheId?: Id;
  /** Regel/Vorgabe, aus der der Befund folgt. */
  readonly regelId: string;
  /** Herkunft der Grenze: Pack-Quelle, Planungsvorgabe oder Programmprüfung. */
  readonly quelle: string;
  readonly ort?: Vec2;
  /** Ist-Wert, Grenzwert und Überschreitung (Ist − Grenze, Vorzeichen je Regel so, dass > 0 = verletzt). */
  readonly wert?: number;
  readonly grenze?: number;
  readonly differenz?: number;
}

/** Quelle modellinterner Prüfungen ohne Regelwerksgrenzwert. */
export const QUELLE_PROGRAMM = "Flachdachplaner – Prüfung des Höhenmodells";
