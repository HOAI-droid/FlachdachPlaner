/**
 * Projekt-Datenmodell (rein, serialisierbar, UI-frei).
 * Einheiten: Längen und Höhen in m, Gefälle dimensionslos (m/m, 0.02 = 2 %),
 * Regenspenden in l/(s·ha). Höhen z beziehen sich auf den Projekt-Nullpunkt (±0,000).
 * Keine Grenzwerte oder Herstellermaße: Produkte nur als Verweis auf Pack-Einträge.
 */
import type { Vec2 } from "../geometry/types";

/** Stabile Objekt-ID (projektweit eindeutig). */
export type Id = string;

/** Konturpunkt mit stabiler ID (Planaktualisierung, Kantenbezüge). Strukturell ein Vec2. */
export interface KonturPunkt extends Vec2 {
  readonly id: Id;
}

/** Geschlossener Linienzug aus Konturpunkten (letzter Punkt nicht wiederholt). */
export type Kontur = readonly KonturPunkt[];

/** Verweis auf einen Eintrag in einem Rule-Pack (z. B. Ablauftyp, LES, Dachreiter). */
export interface PackRef {
  readonly packId: string;
  readonly eintragId: string;
}

/**
 * Position auf einer Konturkante der Dachfläche: Kante von Punkt `kante`
 * zum nächsten Konturpunkt, `abstand` in m ab dem Startpunkt.
 */
export interface KantenPosition {
  readonly kante: Id;
  readonly abstand: number;
}

export interface Projektmetadaten {
  readonly name: string;
  readonly projektnummer?: string;
  readonly bearbeiter?: string;
  readonly notiz?: string;
  /** ISO-8601-Zeitstempel. */
  readonly erstelltAm: string;
  readonly geaendertAm: string;
}

/** Regenspende: Pack-Wert (null = nicht ermittelbar) und optionaler Nutzerwert; beide werden gespeichert. */
export interface Regenspende {
  readonly packWert: number | null;
  readonly manuellWert?: number;
}

export interface Koordinate {
  /** WGS84, Grad. */
  readonly lat: number;
  readonly lon: number;
}

export interface Standort {
  readonly bezeichnung?: string;
  readonly koordinate: Koordinate | null;
  /** r(5,5) und r(5,100): Dauerstufe 5 min, Wiederkehrzeit 5 bzw. 100 a. */
  readonly regen: { readonly r5_5: Regenspende; readonly r5_100: Regenspende };
}

/** Planungsvorgaben als absolute Höhen z in m. */
export interface Hoehenvorgaben {
  readonly maxHochpunkt?: number;
  readonly minTiefpunkt?: number;
}

/** Aufbau (Lichtkuppel, Technik o. Ä.): Loch in der Dachfläche. */
export interface Aufbau {
  readonly id: Id;
  readonly name: string;
  readonly kontur: Kontur;
}

/** Zone/Stufe innerhalb einer Dachfläche. */
export interface Zone {
  readonly id: Id;
  readonly name: string;
  readonly kontur: Kontur;
  /** Höhenversatz gegenüber der Dachfläche in m (z. B. −0,10). */
  readonly hoehenversatz: number;
  /** Abweichendes Gefälle (m/m). 0 nur mit `begruendung`. */
  readonly gefaelle?: number;
  readonly begruendung?: string;
  readonly vorgaben?: Hoehenvorgaben;
}

export interface AttikaSegment {
  readonly id: Id;
  /** Konturkante (Startpunkt-ID); Segment = ganze Kante. */
  readonly kante: Id;
  /** Breite des Attikastreifens in m (Horizontalprojektion). */
  readonly breite: number;
  /** Oberkante Attika z in m, falls bekannt. */
  readonly oberkante?: number;
}

export interface Tuerschwelle {
  readonly id: Id;
  readonly name: string;
  /** Lage: Kante + Abstand des Schwellenanfangs. */
  readonly lage: KantenPosition;
  readonly breite: number;
  /** Oberkante Schwelle z in m, falls bekannt. */
  readonly oberkante?: number;
  readonly barrierefrei: boolean;
}

interface EntwaesserungBasis {
  readonly id: Id;
  readonly name: string;
  /** Produkttyp aus einem Pack; null = noch nicht gewählt. */
  readonly typ: PackRef | null;
}
export interface Gully extends EntwaesserungBasis {
  readonly art: "gully";
  readonly position: Vec2;
}
export interface Notablauf extends EntwaesserungBasis {
  readonly art: "notablauf";
  readonly position: Vec2;
}
export interface Dachreiter extends EntwaesserungBasis {
  readonly art: "dachreiter";
  /** Mitte des Dachreiters auf der Konturkante. */
  readonly lage: KantenPosition;
}
export interface Linienentwaesserung extends EntwaesserungBasis {
  readonly art: "les";
  readonly von: Vec2;
  readonly bis: Vec2;
}
export type Entwaesserung = Gully | Notablauf | Dachreiter | Linienentwaesserung;
export type EntwaesserungsArt = Entwaesserung["art"];

export type DachflaechenTyp = "dach" | "terrasse";

export interface Dachflaeche {
  readonly id: Id;
  readonly name: string;
  readonly typ: DachflaechenTyp;
  readonly kontur: Kontur;
  /** Aufbauten = Löcher der Dachfläche. */
  readonly aufbauten: readonly Aufbau[];
  readonly zonen: readonly Zone[];
  readonly vorgaben: Hoehenvorgaben;
  readonly attika: readonly AttikaSegment[];
  readonly tuerschwellen: readonly Tuerschwelle[];
  readonly entwaesserung: readonly Entwaesserung[];
}

/** Passpunkt: Punkt in Unterlagenkoordinaten ↔ Weltkoordinate (m). */
export interface Passpunkt {
  readonly unterlage: Vec2;
  readonly welt: Vec2;
}

/** Unterlage (PDF/DXF) als Verweis; Einbetten optional. */
export interface Unterlage {
  readonly dateiname: string;
  readonly art: "pdf" | "dxf";
  readonly pruefsumme: { readonly algorithmus: "sha-256"; readonly wert: string };
  /** PDF-Seite (ab 1). */
  readonly seite?: number;
  /** Maßstabsnenner (100 = 1:100), falls angegeben. */
  readonly massstab?: number;
  /** Zwei-Punkt-Zuordnung (Maßstab + Ausrichtung). */
  readonly passpunkte: readonly [Passpunkt, Passpunkt];
  /** Eingebettete Datei (Base64), nur wenn der Nutzer das wählt. */
  readonly eingebettet?: { readonly base64: string };
}

export interface ProjectModel {
  readonly schemaVersion: number;
  readonly meta: Projektmetadaten;
  /** Verwendete Pack-Versionen je Pack-ID. */
  readonly packVersionen: Readonly<Record<string, string>>;
  readonly standort: Standort;
  /** Gefälle-Standard (m/m); Vorgabe 0.02. */
  readonly gefaelleStandard: number;
  readonly dachflaechen: readonly Dachflaeche[];
  readonly unterlage: Unterlage | null;
}
