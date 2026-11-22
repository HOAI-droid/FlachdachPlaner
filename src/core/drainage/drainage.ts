/**
 * Notentwässerung (PLAN Schritt 10): Q = r · C · A / 10000 (l/s, r in l/(s·ha), A in m²),
 * n_not = max(1, ceil(Q · f / Q_Ablauf(Anstau))). r = r(5,100): manuell vor Raster vor Projektwert;
 * C aus Abflussbeiwert-Pack, f = Sicherheitsbeiwert Not und Anstau aus Regel-Pack, Q_Ablauf aus der
 * Abflusstabelle des Notablauf-/Notüberlauf-Produkts (lineare Interpolation, keine Extrapolation).
 * Fehlt eine Angabe → Befund und null statt Zahl.
 * Empfohlener Bereich: Konturabschnitte der Einzugsfläche mit h ≤ h_min(Rand) + Anstau.
 */
import { EPS } from "../geometry/eps";
import { pointInPolygon } from "../geometry/polygon";
import { dist } from "../geometry/segment";
import type { Vec2 } from "../geometry/types";
import type { Einzugsflaeche } from "../catchment/types";
import type { Befund } from "../checks/types";
import type { Id, PackRef, ProjectModel } from "../model/types";
import type { RainData } from "../rain/rain";
import { findeRegelParameter, type RegelWert } from "../rules/regeln";
import type { Abflusspunkt, AbflussbeiwertPack, AblaufPack, DachreiterPack, RulePack } from "../rules/types";
import { hoeheDachflaeche } from "../slope/slope";
import type { SlopeResult } from "../slope/types";

export const REGEL_NOT_ANSTAU = "notentwaesserung-anstau";
export const REGEL_NOT_BEIWERT = "barrierefrei-schwelle";
export const REGEL_NOTENTWAESSERUNG = "notentwaesserung-bemessung";

export interface NotBereich {
  readonly kante: Id;
  readonly von: Vec2;
  readonly bis: Vec2;
  /** größte Höhe im Abschnitt (m). */
  readonly hoeheMax: number;
}

export interface EmergencyEstimate {
  readonly einzugsflaecheId: string;
  readonly dachflaecheId: Id;
  readonly ablaufId: Id;
  /** m² (Dach + Attika). */
  readonly flaeche: number;
  /** l/(s·ha) */
  readonly r: number | null;
  readonly c: number | null;
  /** l/s */
  readonly q: number | null;
  readonly sicherheitsbeiwert: number | null;
  /** Anstauhöhe in m. */
  readonly anstau: number | null;
  /** Abflussleistung eines Notablaufs beim Anstau, l/s. */
  readonly qAblauf: number | null;
  readonly anzahl: number | null;
  readonly bereich: readonly NotBereich[];
}

export interface EmergencyOptionen {
  /** Abflussbeiwert C (Abflussbeiwert-Pack). */
  readonly abflussbeiwert?: PackRef;
  /** Notablauf/Notüberlauf (Ablauf- oder Dachreiter-Pack); sonst der erste Notablauf der Dachfläche mit Produkt. */
  readonly notablauf?: PackRef;
}

export interface EmergencyResult {
  readonly schaetzungen: readonly EmergencyEstimate[];
  readonly befunde: readonly Befund[];
}

/** Lineare Interpolation der Abflusstabelle bei `anstau`; null außerhalb der Tabelle. */
export function abflussBei(tabelle: readonly Abflusspunkt[], anstau: number): number | null {
  const t = [...tabelle].sort((a, b) => a.anstau - b.anstau);
  for (let k = 0; k < t.length; k++) {
    const a = t[k]!;
    if (Math.abs(a.anstau - anstau) <= EPS) return a.q;
    const b = t[k + 1];
    if (b && a.anstau < anstau && anstau < b.anstau) return a.q + ((anstau - a.anstau) / (b.anstau - a.anstau)) * (b.q - a.q);
  }
  return null;
}

/** n = max(1, ceil(Q·f/Q_Ablauf)); Rundungsrauschen (1e-9) wird nicht aufgerundet. */
export const anzahlNotablaeufe = (q: number, f: number, qAblauf: number): number =>
  Math.max(1, Math.ceil((q * f) / qAblauf - 1e-9));

export function estimateEmergency(
  m: ProjectModel, slope: SlopeResult, flaechen: readonly Einzugsflaeche[], rain: RainData | null,
  packs: readonly RulePack[], opt: EmergencyOptionen = {},
): EmergencyResult {
  const befunde: Befund[] = [];
  const gemeldet = new Set<string>();
  const melde = (key: string, b: Omit<Befund, "stufe" | "code"> & { code?: string; stufe?: Befund["stufe"] }) => {
    if (gemeldet.has(key)) return;
    gemeldet.add(key);
    befunde.push({ stufe: "warnung", code: key.split(":")[0]!, ...b });
  };
  const regel = (regelId: string, name: string): RegelWert | null => {
    const w = findeRegelParameter(packs, regelId, name);
    if (!w) melde(`regel-fehlt:${regelId}.${name}`, { objektId: null, regelId, quelle: "Regel-Packs",
      meldung: `Regel „${regelId}“ (Parameter „${name}“) fehlt im Regel-Pack; Notentwässerung nicht bemessbar.` });
    return w;
  };

  // r(5,100): manuell vor Raster vor gespeichertem Pack-Wert
  const rr = m.standort.regen.r5_100;
  const r = rr.manuellWert ?? rain?.r5_100 ?? rr.packWert;
  const rQuelle = rr.manuellWert !== undefined ? "Nutzereingabe" : rain?.r5_100 != null ? rain.quelle : "Projekt (Pack-Wert)";
  if (r === null) {
    melde("regenspende-fehlt", { objektId: null, regelId: REGEL_NOTENTWAESSERUNG, quelle: rain?.quelle ?? "Regenspenden-Pack",
      meldung: "Regenspende r(5,100) unbekannt; Notentwässerung nicht bemessbar." });
  }
  const c = abflussbeiwert(packs, opt.abflussbeiwert, melde);
  const f = regel(REGEL_NOT_BEIWERT, "sicherheitsbeiwertNot");
  const anstau = regel(REGEL_NOT_ANSTAU, "max");

  const schaetzungen = flaechen.map((ef): EmergencyEstimate => {
    const d = m.dachflaechen.find((x) => x.id === ef.dachflaecheId);
    const g = slope.dachflaechen.find((x) => x.dachflaecheId === ef.dachflaecheId);
    const q = r !== null && c !== null ? (r * c * ef.gesamtFlaeche) / 10000 : null;
    const ref = opt.notablauf ?? d?.entwaesserung.find((e) => e.art === "notablauf" && e.typ)?.typ ?? null;
    const qAblauf = anstau ? notablaufLeistung(packs, ref, anstau.wert, ef.dachflaecheId, melde) : null;
    const anzahl = q !== null && f && qAblauf !== null && qAblauf > 0 ? anzahlNotablaeufe(q, f.wert, qAblauf) : null;
    const bereich = d && g && anstau ? empfohlenerBereich(d.kontur, ef, (p) => hoeheDachflaeche(g, p), anstau.wert) : [];
    return {
      einzugsflaecheId: ef.id, dachflaecheId: ef.dachflaecheId, ablaufId: ef.ablaufId, flaeche: ef.gesamtFlaeche,
      r, c, q, sicherheitsbeiwert: f?.wert ?? null, anstau: anstau?.wert ?? null, qAblauf, anzahl, bereich,
    };
  });
  if (r !== null && schaetzungen.length > 0) {
    befunde.push({ stufe: "hinweis", code: "notentwaesserung-annahme", objektId: null, regelId: REGEL_NOTENTWAESSERUNG,
      quelle: rQuelle, meldung: `Notentwässerung überschlägig mit r(5,100) = ${r} l/(s·ha); Nachweis nach Regelwerk erforderlich.` });
  }
  return { schaetzungen, befunde };
}

type Melde = (key: string, b: Omit<Befund, "stufe" | "code"> & { code?: string; stufe?: Befund["stufe"] }) => void;

function abflussbeiwert(packs: readonly RulePack[], ref: PackRef | undefined, melde: Melde): number | null {
  if (!ref) {
    melde("abflussbeiwert-fehlt", { objektId: null, regelId: REGEL_NOTENTWAESSERUNG, quelle: "Abflussbeiwert-Pack",
      meldung: "Kein Abflussbeiwert C gewählt; Notentwässerung nicht bemessbar." });
    return null;
  }
  const pack = packs.find((p): p is AbflussbeiwertPack => p.typ === "abflussbeiwerte" && p.id === ref.packId);
  const e = pack?.daten.eintraege.find((x) => x.id === ref.eintragId);
  if (!e) {
    melde("abflussbeiwert-fehlt", { objektId: null, regelId: REGEL_NOTENTWAESSERUNG, quelle: pack?.quelle ?? "Abflussbeiwert-Pack",
      meldung: `Abflussbeiwert ${ref.packId}/${ref.eintragId} nicht im Pack; Notentwässerung nicht bemessbar.` });
    return null;
  }
  return e.c;
}

function notablaufLeistung(packs: readonly RulePack[], ref: PackRef | null, anstau: number, dachId: Id, melde: Melde): number | null {
  if (!ref) {
    melde(`notablauf-fehlt:${dachId}`, { objektId: dachId, dachflaecheId: dachId, regelId: REGEL_NOTENTWAESSERUNG,
      quelle: "Ablauf-/Dachreiter-Pack", meldung: "Kein Notablauf-Produkt gewählt; Anzahl Notabläufe nicht bestimmbar." });
    return null;
  }
  const pack = packs.find((p): p is AblaufPack | DachreiterPack => (p.typ === "ablaeufe" || p.typ === "dachreiter") && p.id === ref.packId);
  const e = (pack?.daten.eintraege as readonly { id: string; produkt: string; abflussleistung?: readonly Abflusspunkt[] }[] | undefined)
    ?.find((x) => x.id === ref.eintragId);
  const quelle = pack?.quelle ?? "Ablauf-/Dachreiter-Pack";
  if (!e || !e.abflussleistung || e.abflussleistung.length === 0) {
    melde(`abflusstabelle-fehlt:${ref.packId}/${ref.eintragId}`, { objektId: dachId, dachflaecheId: dachId, regelId: REGEL_NOTENTWAESSERUNG, quelle,
      meldung: `Abflusstabelle für ${e?.produkt ?? `${ref.packId}/${ref.eintragId}`} fehlt im Pack; Anzahl Notabläufe nicht bestimmbar.` });
    return null;
  }
  const q = abflussBei(e.abflussleistung, anstau);
  if (q === null) {
    melde(`abflusstabelle-bereich:${ref.packId}/${ref.eintragId}`, { objektId: dachId, dachflaecheId: dachId, regelId: REGEL_NOTENTWAESSERUNG, quelle,
      meldung: `Abflusstabelle von ${e.produkt} deckt Anstau ${(anstau * 1000).toFixed(0)} mm nicht ab; keine Extrapolation.` });
  }
  return q;
}

/** Konturabschnitte (Abtastung 5 cm) in der Einzugsfläche mit h ≤ h_min + Anstau. */
function empfohlenerBereich(
  kontur: readonly { id: string; x: number; y: number }[], ef: Einzugsflaeche, h: (p: Vec2) => number, anstau: number,
): NotBereich[] {
  const SCHRITT = 0.05;
  const proben: { kante: Id; p: Vec2; h: number }[][] = [];
  let hMin = Infinity;
  for (let k = 0; k < kontur.length; k++) {
    const a = kontur[k]!, b = kontur[(k + 1) % kontur.length]!;
    const n = Math.max(1, Math.ceil(dist(a, b) / SCHRITT));
    const kante: { kante: Id; p: Vec2; h: number }[] = [];
    for (let s = 0; s <= n; s++) {
      const p = { x: a.x + ((b.x - a.x) * s) / n, y: a.y + ((b.y - a.y) * s) / n };
      if (!ef.polygone.some((poly) => pointInPolygon(p, poly) !== "outside")) { kante.push({ kante: a.id, p, h: Number.NaN }); continue; }
      const hp = h(p);
      hMin = Math.min(hMin, hp);
      kante.push({ kante: a.id, p, h: hp });
    }
    proben.push(kante);
  }
  if (!Number.isFinite(hMin)) return [];
  const out: NotBereich[] = [];
  for (const kante of proben) {
    let lauf: { kante: Id; p: Vec2; h: number }[] = [];
    const schliesse = () => {
      if (lauf.length > 0) out.push({ kante: lauf[0]!.kante, von: lauf[0]!.p, bis: lauf[lauf.length - 1]!.p, hoeheMax: Math.max(...lauf.map((x) => x.h)) });
      lauf = [];
    };
    for (const x of kante) {
      if (!Number.isNaN(x.h) && x.h <= hMin + anstau + EPS) lauf.push(x);
      else schliesse();
    }
    schliesse();
  }
  return out;
}
