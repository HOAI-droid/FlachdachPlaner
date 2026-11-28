/// <reference types="vite/client" />
/** PLAN M9 Schritt 43: computeNotwasserstaende (Kante, Q-Anteil, Überfallhöhe, Notwasserstand; Schätzung). */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  computeCatchments, computeNotwasserstaende, computeSlope, createProject, estimateEmergency, loadRulePack, poleniUeberfallhoehe,
  VERMERK_SCHAETZUNG,
  type Dachflaeche, type EmergencyEstimate, type Entwaesserung, type Kontur, type ProjectModel, type RegelPack, type RulePack,
} from "../src/core/index";

const packTexte = import.meta.glob("../rulepacks/*/pack.json", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;
const lade = (raw: unknown): RulePack => {
  const r = loadRulePack(raw);
  if (!r.ok) throw new Error(JSON.stringify(r.fehler));
  return r.pack;
};
const roh = () => JSON.parse(packTexte["../rulepacks/zvdh-2026/pack.json"]!) as { daten: { regeln: { id: string; parameter: Record<string, unknown> }[] } };
const ZVDH = lade(roh());
const kopf = { version: "1.0.0", quelle: "Test", ausgabe: "Test", gueltigAb: "2026-01-01", geprueft: true };
/** Testmaße frei gewählt (keine Herstellerwerte). */
const DR = lade({ id: "t-dr", typ: "dachreiter", ...kopf, daten: { eintraege: [
  { id: "sp", hersteller: "T", produkt: "Speier", art: "not", breite: 0.3, hoehe: 0.1, einbaulaenge: 0.4, einlaufhoehe: 0.035, ueberlaufBreite: 0.3 },
  { id: "sp-ohne", hersteller: "T", produkt: "Speier ohne Daten", art: "not", breite: 0.3, hoehe: 0.1, einbaulaenge: 0.4 },
  { id: "haupt", hersteller: "T", produkt: "Dachreiter", art: "haupt", breite: 0.3, hoehe: 0.1, einbaulaenge: 0.4, einlaufhoehe: 0.01 },
] } });
const AB = lade({ id: "t-ab", typ: "ablaeufe", ...kopf, daten: { eintraege: [
  { id: "na", hersteller: "T", produkt: "Notablauf", art: "notablauf", wehrhoehe: 0.05, anstauBeiQ: 0.03, abflussleistung: [{ anstau: 0.035, q: 6 }] },
  { id: "na-ohne", hersteller: "T", produkt: "Notablauf ohne Daten", art: "notablauf", abflussleistung: [{ anstau: 0.035, q: 6 }] },
] } });
const PACKS = [ZVDH, DR, AB];

const pt = (id: string, x: number, y: number) => ({ id, x, y });
const rechteck = (w: number, h: number): Kontur => [pt("k1", 0, 0), pt("k2", w, 0), pt("k3", w, h), pt("k4", 0, h)];
const gully = (id: string, x: number, y: number, z = 0): Entwaesserung => ({ id, art: "gully", name: id, typ: null, position: { x, y }, z });
const speier = (id: string, abstand: number, eintragId = "sp", extra: { ueberlaufKante?: number } = {}): Entwaesserung =>
  ({ id, art: "dachreiter", name: id, typ: { packId: "t-dr", eintragId }, lage: { kante: "k1", abstand }, z: 0.05, ...extra });
const notablauf = (id: string, eintragId: string | null = "na", extra: { ueberlaufKante?: number } = {}): Entwaesserung =>
  ({ id, art: "notablauf", name: id, typ: eintragId ? { packId: "t-ab", eintragId } : null, position: { x: 2, y: 2 }, z: 0.04, ...extra });

function projekt(entwaesserung: Entwaesserung[]): ProjectModel {
  const d: Dachflaeche = {
    id: "d1", name: "Dach", typ: "dach", aufbauten: [], zonen: [], vorgaben: {}, attika: [], tuerschwellen: [],
    kontur: rechteck(20, 10), entwaesserung: [gully("g1", 10, 5), ...entwaesserung],
  };
  return { ...createProject("Test", "2026-01-01T00:00:00Z"), gefaelleStandard: 0.02, dachflaechen: [d] };
}
/** Schätzung mit Q · f = qNot (l/s). */
const schaetzung = (qNot: number, f = 2): EmergencyEstimate => ({
  einzugsflaecheId: "e1", dachflaecheId: "d1", ablaufId: "g1", flaeche: 200, r: null, c: null, q: qNot / f,
  sicherheitsbeiwert: f, anstau: null, qAblauf: null, anzahl: null, bereich: [],
});
const rechne = (m: ProjectModel, e: readonly EmergencyEstimate[], packs: readonly RulePack[] = PACKS) =>
  computeNotwasserstaende(m, computeSlope(m, { packs }), e, packs);
const MM = 0.001;

describe("computeNotwasserstaende", () => {
  it("Poleni: b = 0,30 m, μ = 0,6, Q = 7,95 l/s → h_ü = 60,7 mm ± 0,5", () => {
    expect(Math.abs(poleniUeberfallhoehe(7.95, 0.3, 0.6)! / MM - 60.7)).toBeLessThanOrEqual(0.5);
    const [w] = rechne(projekt([speier("s1", 5)]), [schaetzung(7.95)]);
    expect(w!.art).toBe("speier");
    expect(w!.qAnteil).toBeCloseTo(7.95, 9);
    expect(Math.abs(w!.ueberfallhoehe! / MM - 60.7)).toBeLessThanOrEqual(0.5);
    expect(w!.ueberfallQuelle).toBe("poleni");
    expect(w!.kante).toBeCloseTo(0.05 + 0.035, 9);
    expect(w!.kanteQuelle).toBe("pack");
    expect(w!.wasserstand).toBeCloseTo(w!.kante! + w!.ueberfallhoehe!, 12);
    expect(w!.vermerk).toBe(VERMERK_SCHAETZUNG);
  });
  it("μ kommt aus dem Pack", () => {
    const raw = roh();
    (raw.daten.regeln.find((r) => r.id === "notentwaesserung-anstau")!.parameter).ueberfallbeiwert = { wert: 0.5, einheit: "1" };
    const [w] = rechne(projekt([speier("s1", 5)]), [schaetzung(7.95)], [lade(raw), DR, AB]);
    expect(w!.ueberfallhoehe!).toBeCloseTo(poleniUeberfallhoehe(7.95, 0.3, 0.5)!, 12);
    const ohne = roh();
    delete (ohne.daten.regeln.find((r) => r.id === "notentwaesserung-anstau")!.parameter).ueberfallbeiwert;
    const [x] = rechne(projekt([speier("s1", 5)]), [schaetzung(7.95)], [lade(ohne), DR, AB]);
    expect(x!.ueberfallhoehe).toBeNull();
    expect(x!.wasserstand).toBeNull();
  });
  it("2 gleiche Speier → je Q/2, h_ü kleiner", () => {
    const [a] = rechne(projekt([speier("s1", 5)]), [schaetzung(7.95)]);
    const zwei = rechne(projekt([speier("s1", 5), speier("s2", 15)]), [schaetzung(7.95)]);
    expect(zwei).toHaveLength(2);
    for (const w of zwei) {
      expect(w.qAnteil).toBeCloseTo(7.95 / 2, 9);
      expect(w.ueberfallhoehe!).toBeLessThan(a!.ueberfallhoehe!);
    }
  });
  it("Eigenschaft: h_ü monoton in Q", () => {
    fc.assert(fc.property(fc.double({ min: 0, max: 50, noNaN: true }), fc.double({ min: 0, max: 50, noNaN: true }), (q1, q2) => {
      const [lo, hi] = q1 <= q2 ? [q1, q2] : [q2, q1];
      const m = projekt([speier("s1", 5)]);
      const a = rechne(m, [schaetzung(lo)])[0]!.ueberfallhoehe!, b = rechne(m, [schaetzung(hi)])[0]!.ueberfallhoehe!;
      return a <= b + 1e-15;
    }), { numRuns: 50, seed: 3 });
  });
  it("Notablauf: Kante z + Wehrhöhe, h_ü = Pack-Anstauwert", () => {
    const [w] = rechne(projekt([notablauf("n1")]), [schaetzung(6)]);
    expect(w!.art).toBe("notablauf");
    expect(w!.kante).toBeCloseTo(0.04 + 0.05, 9);
    expect(w!.ueberfallhoehe).toBeCloseTo(0.03, 12);
    expect(w!.ueberfallQuelle).toBe("pack");
    expect(w!.wasserstand).toBeCloseTo(0.12, 9);
    expect(w!.ort).toEqual({ x: 2, y: 2 });
  });
  it("fehlende Wehrhöhe/Breite → kante bzw. wasserstand null, keine Zahl", () => {
    const w = rechne(projekt([speier("s1", 5, "sp-ohne"), notablauf("n1", "na-ohne"), notablauf("n2", null)]), [schaetzung(6)]);
    expect(w).toHaveLength(3);
    for (const x of w) {
      expect(x.kante).toBeNull();
      expect(x.kanteQuelle).toBeNull();
      expect(x.ueberfallhoehe).toBeNull();
      expect(x.ueberfallQuelle).toBeNull();
      expect(x.wasserstand).toBeNull();
    }
    // Breite fehlt, Kante vom Nutzer: Kante ja, Wasserstand nein
    const [y] = rechne(projekt([speier("s1", 5, "sp-ohne", { ueberlaufKante: 0.02 })]), [schaetzung(6)]);
    expect(y!.kante).toBeCloseTo(0.07, 9);
    expect(y!.wasserstand).toBeNull();
  });
  it("ohne Schätzung bzw. ohne Q → qAnteil und h_ü (Speier) null", () => {
    const [w] = rechne(projekt([speier("s1", 5)]), []);
    expect(w!.qAnteil).toBeNull();
    expect(w!.ueberfallhoehe).toBeNull();
    expect(w!.kante).not.toBeNull();
    const [x] = rechne(projekt([speier("s1", 5)]), [{ ...schaetzung(6), q: null }]);
    expect(x!.qAnteil).toBeNull();
  });
  it("Nutzerwert überschreibt, Pack-Wert bleibt sichtbar, kanteQuelle = nutzer", () => {
    const [w] = rechne(projekt([speier("s1", 5, "sp", { ueberlaufKante: 0.06 })]), [schaetzung(7.95)]);
    expect(w!.kante).toBeCloseTo(0.05 + 0.06, 9);
    expect(w!.kanteQuelle).toBe("nutzer");
    expect(w!.kantePack).toBeCloseTo(0.05 + 0.035, 9);
    const [n] = rechne(projekt([notablauf("n1", "na", { ueberlaufKante: 0 })]), [schaetzung(6)]);
    expect(n!.kante).toBeCloseTo(0.04, 9);
    expect(n!.kanteQuelle).toBe("nutzer");
  });
  it("Haupt-Dachreiter und Gullys sind keine Notelemente", () => {
    expect(rechne(projekt([speier("h1", 5, "haupt")]), [schaetzung(6)])).toEqual([]);
  });
  it("mit estimateEmergency: Q · f der Dachfläche, deterministisch", () => {
    const m = { ...projekt([speier("s1", 5), notablauf("n1")]) };
    const mr: ProjectModel = { ...m, standort: { ...m.standort, regen: { ...m.standort.regen, r5_100: { ...m.standort.regen.r5_100, manuellWert: 500 } } } };
    const s = computeSlope(mr, { packs: PACKS });
    const fl = computeCatchments(mr, s, { regeln: ZVDH as RegelPack }).flaechen;
    const abw = lade({ id: "t-c", typ: "abflussbeiwerte", ...kopf, daten: { eintraege: [{ id: "c1", bezeichnung: "Dach", c: 1 }] } });
    const packs = [...PACKS, abw];
    const e = estimateEmergency(mr, s, fl, null, packs, { abflussbeiwert: { packId: "t-c", eintragId: "c1" } }).schaetzungen;
    const sum = e.reduce((x, y) => x + y.q! * y.sicherheitsbeiwert!, 0);
    expect(sum).toBeGreaterThan(0);
    const w = computeNotwasserstaende(mr, s, e, packs);
    expect(w.map((x) => x.objektId)).toEqual(["s1", "n1"]);
    for (const x of w) expect(x.qAnteil).toBeCloseTo(sum / 2, 9);
    expect(computeNotwasserstaende(mr, s, e, packs)).toEqual(w);
  });
});
