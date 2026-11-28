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

/**
 * Plankopf-/Schriftfeldangaben (alle optional, Text; seit Schemaversion 3).
 * Länge je Feld ≤ 200 Zeichen; `planDatum`/`revisionDatum` als ISO-Datum JJJJ-MM-TT.
 */
export interface Projektangaben {
  readonly bauvorhaben?: string;
  readonly bauherr?: string;
  /** Planinhalt (Standard bei Ausgabe aus dem Planblatt, z. B. „Gefälleplan“). */
  readonly planinhalt?: string;
  readonly bueroName?: string;
  readonly bueroAnschrift?: string;
  readonly bueroKontakt?: string;
  readonly bearbeiter?: string;
  readonly geprueftVon?: string;
  readonly planNummer?: string;
  /** ISO-Datum JJJJ-MM-TT. */
  readonly planDatum?: string;
  readonly revision?: string;
  /** ISO-Datum JJJJ-MM-TT. */
  readonly revisionDatum?: string;
}

export interface Projektmetadaten extends Projektangaben {
  /** Projektname (Anzeige im Plankopf als Projekt). */
  readonly name: string;
  readonly projektnummer?: string;
  /** Freitext, ≤ 2000 Zeichen. */
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
  /** OK Rohdecke/Unterkonstruktion z in m: am Tiefpunkt muss z − okRohdecke ≥ Mindestdämmdicke bleiben. */
  readonly okRohdecke?: number;
}

/** Aufbau (Lichtkuppel, Technik o. Ä.): Loch in der Dachfläche. */
export interface Aufbau {
  readonly id: Id;
  readonly name: string;
  readonly kontur: Kontur;
  /** Oberkante Aufsetzkranz z in m (seit v4), falls bekannt; ohne Wert keine Anschlussprüfung. */
  readonly oberkante?: number;
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
  /** Belagdicke in m (seit v4, ≥ 0); fehlt = Wert der Dachfläche. */
  readonly belagDicke?: number;
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
  /** Entwässerungsrinne vor der Tür (seit v4); fehlt = false. */
  readonly rinne?: boolean;
}

/** Wandanschluss (seit v4): Teilstrecke einer Konturkante an aufgehendem Bauteil, wie die Türschwelle. */
export interface Wandanschluss {
  readonly id: Id;
  readonly name: string;
  /** Lage: Kante + Abstand des Anfangs. */
  readonly lage: KantenPosition;
  /** Länge in m entlang der Kante (> 0). */
  readonly laenge: number;
  /** Oberkante Anschluss z in m, falls bekannt. */
  readonly oberkante?: number;
}

interface EntwaesserungBasis {
  readonly id: Id;
  readonly name: string;
  /** Produkttyp aus einem Pack; null = noch nicht gewählt. */
  readonly typ: PackRef | null;
  /**
   * Kote des Tiefpunkts (OK Abdichtung am Ablauf) in m, Bezug Projekt-Nullpunkt; Standard 0.
   * LES: Kote am tieferen Ende.
   */
  readonly z: number;
}
export interface Gully extends EntwaesserungBasis {
  readonly art: "gully";
  readonly position: Vec2;
  /**
   * Verbundener Gully derselben Dachfläche (optional): beide wirken als eine waagerechte Kehle
   * zwischen den Gullys statt als zwei Punkte (Voraussetzung: gleiche Kote z). Fehlt = einzeln.
   */
  readonly verbundenMit?: Id;
}
export interface Notablauf extends EntwaesserungBasis {
  readonly art: "notablauf";
  readonly position: Vec2;
  /** Überflutungskante in m über `z` (seit v4, ≥ 0), Nutzerwert; fehlt = Pack-Wert. */
  readonly ueberlaufKante?: number;
}
export interface Dachreiter extends EntwaesserungBasis {
  readonly art: "dachreiter";
  /** Mitte des Dachreiters auf der Konturkante. */
  readonly lage: KantenPosition;
  /** Überflutungskante in m über `z` (seit v4, ≥ 0), Nutzerwert; fehlt = Pack-Wert. */
  readonly ueberlaufKante?: number;
}
export interface Linienentwaesserung extends EntwaesserungBasis {
  readonly art: "les";
  /** Tieferes Ende (Kote `z`); das Gegenende liegt um LES-Längsgefälle · Länge höher. */
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
  /** Wandanschlüsse (seit v4); fehlt = keine (Zugriff über `wandanschluesseVon`). */
  readonly wandanschluesse?: readonly Wandanschluss[];
  readonly entwaesserung: readonly Entwaesserung[];
  /** Mindestdämmdicke der Gefälledämmung am Tiefpunkt in mm (optional; sonst Standard). */
  readonly daemmdickeTiefpunkt?: number;
  /** Gewünschte mittlere Gefälledämmdicke in mm: daraus wird beim Setzen der Abläufe Tiefpunktdicke und Kote abgeleitet. */
  readonly daemmMittel?: number;
  /** Belagdicke (Kies, Platten, Gründach) in m (seit v4, ≥ 0); fehlt = 0. Zonen können abweichen. */
  readonly belagDicke?: number;
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
  /** Originalpfad der Datei (nur Desktop-App); Verweis, wenn die Unterlage nicht eingebettet ist. */
  readonly quellpfad?: string;
  /** Eingebettete Datei; `komprimiert: "gzip"` = Base64 von gzip-Daten (fehlt = unkomprimiert, ältere Dateien). */
  readonly eingebettet?: { readonly base64: string; readonly komprimiert?: "gzip" };
}

/**
 * Modell in Dachflächen-Form: Dateiformat bis Schemaversion 2 und seit v3 die *Varianten-Ansicht*
 * (`modellFuerVariante`), auf der Rechenkern, Werkzeuge und Exporte unverändert arbeiten.
 */
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

/** Planungsvariante (seit Schemaversion 3): vollständiger, unabhängiger Satz Dachflächen. */
export interface Variante {
  readonly id: Id;
  /** Nicht leer, projektweit eindeutig (ohne Groß-/Kleinschreibung und Randleerzeichen). */
  readonly name: string;
  readonly dachflaechen: readonly Dachflaeche[];
  /** Abweichender Gefälle-Standard (m/m); fehlt = projektweiter Wert. */
  readonly gefaelleStandard?: number;
}

/**
 * Projektdatei ab Schemaversion 3. Unterlage, Standort, Metadaten und Pack-Versionen gelten
 * projektweit, Dachflächen je Variante. IDs sind projektweit eindeutig (auch über Varianten).
 */
/** Sichtbarkeit, Deckkraft und Sperre einer Zeichenebene (Ebenen-Panel). */
export interface EbenenZustand { readonly sichtbar: boolean; readonly deckkraft: number; readonly gesperrt: boolean }
/** Ansichtseinstellungen, die mit dem Projekt gespeichert werden (nicht rückgängig-fähig). */
export interface Ansichtseinstellungen { readonly ebenen: Readonly<Record<string, EbenenZustand>> }
export const EBENEN_IDS = ["koten", "symbole", "pfeile", "kontur", "daemmplan", "einzugsflaechen", "unterlage"] as const;

export interface Projekt {
  readonly schemaVersion: number;
  readonly meta: Projektmetadaten;
  readonly packVersionen: Readonly<Record<string, string>>;
  readonly standort: Standort;
  /** Projektweiter Gefälle-Standard (m/m), gilt für Varianten ohne eigenen Wert. */
  readonly gefaelleStandard: number;
  /** Mindestens eine Variante; Reihenfolge = Listenreihenfolge. */
  readonly varianten: readonly Variante[];
  readonly aktiveVariante: Id;
  readonly unterlage: Unterlage | null;
  /** Ebenen-Einstellungen; fehlt = alle sichtbar, volle Deckkraft. */
  readonly ansicht?: Ansichtseinstellungen;
}
