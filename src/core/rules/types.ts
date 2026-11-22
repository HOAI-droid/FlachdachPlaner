/**
 * Rule-Pack-Typen (spiegeln die JSON-Schemas in rulepacks/schema/).
 * Einheiten: m, m², m/m, l/s, l/(s·ha). Werte stammen ausschließlich aus Packs.
 */

export const PACK_TYPEN = [
  "regeln", "ablaeufe", "les", "dachreiter", "abflussbeiwerte", "regenspenden", "daemmplatten", "orte",
] as const;
export type PackTyp = (typeof PACK_TYPEN)[number];

/** Pflichtkopf jedes Packs. */
export interface PackKopf {
  readonly id: string;
  readonly typ: PackTyp;
  readonly version: string;
  readonly titel?: string;
  readonly quelle: string;
  readonly ausgabe: string;
  /** ISO-Datum JJJJ-MM-TT. */
  readonly gueltigAb: string;
  readonly geprueft: boolean;
  readonly lizenz?: string;
  readonly hinweis?: string;
}

export type Einheit = "m2" | "m" | "m/m" | "1" | "l/s" | "l/(s·ha)";

export interface RegelParameterWert { readonly wert: number; readonly einheit: Einheit }
export interface Regel {
  readonly id: string;
  readonly titel: string;
  readonly fundstelle?: string;
  readonly parameter: Readonly<Record<string, RegelParameterWert>>;
}

/** Abflussleistung bei Anstauhöhe `anstau` (m): `q` in l/s. */
export interface Abflusspunkt { readonly anstau: number; readonly q: number }

export interface AblaufEintrag {
  readonly id: string;
  readonly hersteller: string;
  readonly produkt: string;
  readonly art: "gully" | "notablauf";
  readonly nennweite?: number;
  readonly wehrhoehe?: number;
  readonly abflussleistung: readonly Abflusspunkt[];
  readonly fundstelle?: string;
}

export interface LesEintrag {
  readonly id: string;
  readonly hersteller: string;
  readonly produkt: string;
  readonly gefaelle: { readonly laengs: number; readonly quer: number; readonly diagonal: number };
  readonly keil: { readonly laenge: number; readonly breiteJeSeite: number; readonly dickeMin: number; readonly dickeMax: number };
  readonly plattenformat?: { readonly laenge: number; readonly breite: number };
  readonly maxLaenge?: number;
  readonly fundstelle?: string;
}

export interface DachreiterEintrag {
  readonly id: string;
  readonly hersteller: string;
  readonly produkt: string;
  readonly art: "haupt" | "not";
  /** Lichte Breite/Höhe der Einlauföffnung, Einbaulänge durch die Attika, Unterkante Einlauf über Abdichtung (m). */
  readonly breite: number;
  readonly hoehe: number;
  readonly einbaulaenge: number;
  readonly einlaufhoehe?: number;
  readonly abflussleistung?: readonly Abflusspunkt[];
  readonly fundstelle?: string;
}

export interface AbflussbeiwertEintrag {
  readonly id: string;
  readonly bezeichnung: string;
  readonly c: number;
  readonly fundstelle?: string;
}

export interface KostraRaster {
  readonly crs: string;
  readonly x0: number;
  readonly y0: number;
  readonly zellgroesse: number;
  readonly spalten: number;
  readonly zeilen: number;
}

export interface Plattentyp { readonly typ: string; readonly dickeAnfang: number; readonly dickeEnde: number }
export interface Sonderplatte {
  readonly id: string; readonly bezeichnung: string;
  readonly laenge?: number; readonly breite?: number; readonly dickeAnfang?: number; readonly dickeEnde?: number;
}
export interface Kehlkeil {
  readonly id: string; readonly typ: string; readonly seite: "L" | "R"; readonly laenge: number; readonly breite: number;
  /** Winkel zwischen Kehle und Reihenrichtung in Grad (fehlt = 45). */
  readonly winkel?: number;
}

export interface OrtEintrag { readonly plz: string; readonly ort: string; readonly lat: number; readonly lon: number }

export interface RegelPack extends PackKopf { readonly typ: "regeln"; readonly daten: { readonly regeln: readonly Regel[] } }
export interface AblaufPack extends PackKopf { readonly typ: "ablaeufe"; readonly daten: { readonly eintraege: readonly AblaufEintrag[] } }
export interface LesPack extends PackKopf { readonly typ: "les"; readonly daten: { readonly eintraege: readonly LesEintrag[] } }
export interface DachreiterPack extends PackKopf { readonly typ: "dachreiter"; readonly daten: { readonly eintraege: readonly DachreiterEintrag[] } }
export interface AbflussbeiwertPack extends PackKopf {
  readonly typ: "abflussbeiwerte"; readonly daten: { readonly eintraege: readonly AbflussbeiwertEintrag[] };
}
export interface RegenspendenPack extends PackKopf {
  readonly typ: "regenspenden";
  readonly daten: {
    readonly raster: KostraRaster;
    /** Zeilenweise, Index j·spalten + i, Zeile 0 = Süden; null = keine Daten. l/(s·ha). */
    readonly werte: { readonly r5_5: readonly (number | null)[]; readonly r5_100: readonly (number | null)[] };
  };
}
export interface DaemmplattenPack extends PackKopf {
  readonly typ: "daemmplatten";
  readonly daten: {
    readonly format: { readonly laenge: number; readonly breite: number };
    readonly gefaelle: number;
    readonly typen: readonly Plattentyp[];
    readonly zusatzlage?: { readonly dicke: number };
    readonly sonderplatten?: readonly Sonderplatte[];
    readonly kehlkeile?: readonly Kehlkeil[];
  };
}
export interface OrtePack extends PackKopf { readonly typ: "orte"; readonly daten: { readonly eintraege: readonly OrtEintrag[] } }

export type RulePack =
  | RegelPack | AblaufPack | LesPack | DachreiterPack | AbflussbeiwertPack | RegenspendenPack | DaemmplattenPack | OrtePack;

/** Hinweis beim Laden (kein Fehler), z. B. ungeprüftes Regelwerk. */
export interface PackHinweis {
  readonly code: "pack-ungeprueft";
  readonly packId: string;
  readonly meldung: string;
}
