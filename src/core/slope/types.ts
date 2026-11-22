/** Ergebnistypen des Höhenfelds (PLAN §5 `computeSlope`). Längen/Koten in m, Dämmdicken in mm. */
import type { Polygon, Vec2 } from "../geometry/types";
import type { Id, PackRef } from "../model/types";
import type { DachreiterEintrag, RulePack } from "../rules/types";

/**
 * Ablauf als Quelle des Höhenfelds: Punkt (`bis` = `position`) oder Strecke `position`–`bis`
 * (LES: `position` = tieferes Ende; Dachreiter: Einlauföffnung auf der Konturkante), Kote z.
 */
export interface Hoehenquelle {
  readonly ablaufId: Id;
  readonly position: Vec2;
  readonly bis: Vec2;
  /** Einheitsvektor der 1. Achse des Abstandsmaßes: Streckenrichtung bzw. Dach-/Kantenachse bei Punkten. */
  readonly achse: Vec2;
  readonly z: number;
}

/**
 * Höhenfeld einer Dachfläche: h(x) = min_i (z_i + s · d(x, E_i)), d = Maximumsnorm im
 * Achsensystem der Quelle (siehe `quellAbstand`). `achse` = Dachachse (für Punktabläufe).
 */
export interface Hoehenfeld {
  readonly gefaelle: number;
  readonly achse: Vec2;
  readonly quellen: readonly Hoehenquelle[];
}

/** Eine Seite des LES-Keils: Dreieck (an Dachfläche geschnitten) mit linearer Keildicke. */
export interface LesKeilSeite {
  /** +1 = links der LES (in Richtung von → bis), −1 = rechts. */
  readonly seite: 1 | -1;
  /** Keilfläche, an Kontur und Aufbauten geschnitten. */
  readonly flaechen: readonly Polygon[];
  /** Keildicke in m als Ebene über (x, y), gültig innerhalb `flaechen`. */
  readonly dicke: Ebene;
}

/**
 * LES-Keil (PLAN Schritt 6): liegt AUF der Gefälledämmung (additiv zum Höhenfeld). Spitze am tieferen
 * Ende `von`, Dicke wächst längs mit `gefaelleLaengs` und fällt quer mit `gefaelleQuer` bis auf
 * `dickeTief` am Keilrand. Alle Maße/Gefälle aus dem Pack-Eintrag. Längen/Dicken in m.
 */
export interface LesKeil {
  readonly ablaufId: Id;
  readonly eintrag: PackRef;
  readonly von: Vec2;
  readonly bis: Vec2;
  /** Einheitsvektor von → bis. */
  readonly richtung: Vec2;
  readonly laenge: number;
  readonly breiteJeSeite: number;
  readonly gefaelleLaengs: number;
  readonly gefaelleQuer: number;
  /** Keildicke an der Spitze und am Keilrand. */
  readonly dickeTief: number;
  /** Keildicke am hohen Ende auf der LES-Achse. */
  readonly dickeHoch: number;
  /** OK Keil auf der LES-Achse am tieferen Ende (z + dickeTief) und am Gegenende (+ Längsgefälle · Länge). */
  readonly koteTief: number;
  readonly koteHoch: number;
  readonly seiten: readonly [LesKeilSeite, LesKeilSeite];
}

/** Dachreiter als Randquelle: Einlauföffnung auf der Konturkante, Maße aus dem Pack (null = fehlen). */
export interface DachreiterLage {
  readonly ablaufId: Id;
  readonly eintrag: PackRef | null;
  readonly mitte: Vec2;
  /** Enden der Einlauföffnung auf der Kante (gleich `mitte`, wenn Maße fehlen). */
  readonly von: Vec2;
  readonly bis: Vec2;
  /** Wirksame Öffnungsbreite in m (auf die Kante begrenzt). */
  readonly breite: number;
  /** Herstellermaße unverändert aus dem Pack. */
  readonly masse: DachreiterEintrag | null;
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
  /** Zone/Stufe, zu der die Facette gehört (fehlt = Hauptfläche der Dachfläche). */
  readonly zoneId?: Id;
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
  /** d_TP + größte Dicke über Tiefpunkt (Höhenfeld + LES-Keil) in mm. */
  readonly max: number;
  readonly tiefpunktDicke: number;
  /** true, wenn d_TP an der Dachfläche vorgegeben ist (sonst Standard). */
  readonly tiefpunktVorgegeben: boolean;
  /** Bezugsfläche in m². */
  readonly flaeche: number;
}

/**
 * Zone/Stufe (PLAN Schritt 8): eigenes Höhenfeld h_Z(x) = versatz + min_i (z_i + s_Z · d(x, E_i)) über
 * die Abläufe der Dachfläche, nur innerhalb der Zone (an Dach und früheren Zonen geschnitten).
 * s_Z = Zonengefälle oder Gefälle-Standard; s_Z = 0 ergibt eine waagerechte Fläche auf min z + versatz.
 * Dämmung getrennt gemittelt (eigener Tiefpunkt), in `DachGefaelle.daemmung` flächengewichtet.
 */
export interface ZonenGefaelle {
  readonly zoneId: Id;
  readonly versatz: number;
  readonly feld: Hoehenfeld;
  readonly polygone: readonly Polygon[];
  /** m² */
  readonly flaeche: number;
  /** Facetten der Zone (auch in `DachGefaelle.facetten` enthalten, dort mit `zoneId`). */
  readonly facetten: readonly Facette[];
  readonly linien: readonly Faltlinie[];
  readonly koten: readonly Kote[];
  readonly hochpunkt: Extrempunkt | null;
  readonly tiefpunkt: Extrempunkt | null;
  readonly daemmung: Gefaelledaemmung | null;
}

export interface DachGefaelle {
  readonly dachflaecheId: Id;
  readonly feld: Hoehenfeld;
  /** Facetten der Hauptfläche und aller Zonen (Zonenfacetten mit `zoneId`). */
  readonly facetten: readonly Facette[];
  /** Grate/Kehlen der Hauptfläche (Zonen: `zonen[].linien`). */
  readonly linien: readonly Faltlinie[];
  /** Koten der Hauptfläche an Ecken (Kontur, Aufbauten, Zonenränder), Abläufen und Enden der Grate/Kehlen. */
  readonly koten: readonly Kote[];
  /** HP/TP über Hauptfläche und Zonen. */
  readonly hochpunkt: Extrempunkt | null;
  readonly tiefpunkt: Extrempunkt | null;
  readonly pfeile: readonly Gefaellepfeil[];
  /** Mittlere Gefälledämmung der ganzen Dachfläche: Hauptfläche und Zonen getrennt gemittelt, flächengewichtet. */
  readonly daemmung: Gefaelledaemmung | null;
  /** Nur Hauptfläche (ohne Zonen) inkl. LES-Keile (additiv). */
  readonly daemmungHaupt: Gefaelledaemmung | null;
  readonly zonen: readonly ZonenGefaelle[];
  readonly les: readonly LesKeil[];
  readonly dachreiter: readonly DachreiterLage[];
}

export type SlopeHinweisCode =
  | "keine-ablaeufe" | "ablauf-ausserhalb" | "gefaelle-null" | "pack-ungeprueft"
  | "les-typ-fehlt" | "les-laenge-null" | "les-laenge-abweichend" | "les-zu-lang" | "les-pack-inkonsistent" | "les-gefaelle-ungueltig"
  | "dachreiter-masse-fehlen" | "dachreiter-lage-ungueltig" | "zone-ausserhalb" | "zonen-ueberlappen";

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
  /** Geladene Rule-Packs (LES, Dachreiter); Produkte werden über `typ` (PackRef) aufgelöst. */
  readonly packs?: readonly RulePack[];
}
