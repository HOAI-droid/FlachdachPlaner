import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  abflussBei, anzahlNotablaeufe, computeCatchments, computeSlope, createProject, ermittleRegen, estimateEmergency, loadRulePack,
  projiziere, resolveRain,
  type Dachflaeche, type Entwaesserung, type Kontur, type ProjectModel, type RegenspendenPack, type RulePack,
} from "../src/core/index";

const packTexte = import.meta.glob("../rulepacks/*/pack.json", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;
const lade = <T extends RulePack = RulePack>(roh: unknown): T => {
  const r = loadRulePack(roh);
  if (!r.ok) throw new Error(JSON.stringify(r.fehler));
  return r.pack as T;
};
const zvdh = lade(JSON.parse(packTexte["../rulepacks/zvdh-2026/pack.json"]!));
const kopf = { version: "1.0.0", quelle: "Testdaten", ausgabe: "Test", gueltigAb: "2026-01-01", geprueft: true };

// Testraster WGS84: Länge 5–16°, Breite 47–56°, 1°-Zellen; Zelle (9, 2) ohne Daten (außerhalb DE).
const SP = 11, ZE = 9;
const werte = (v: number) => Array.from({ length: SP * ZE }, (_, k) => (k === 2 * SP + 9 ? null : v + k));
const kostra = lade<RegenspendenPack>({
  id: "test-kostra", typ: "regenspenden", ...kopf, quelle: "Test-KOSTRA",
  daten: { raster: { crs: "EPSG:4326", x0: 5, y0: 47, zellgroesse: 1, spalten: SP, zeilen: ZE }, werte: { r5_5: werte(300), r5_100: werte(500) } },
});
const beiwerte = lade({ id: "test-c", typ: "abflussbeiwerte", ...kopf, daten: { eintraege: [{ id: "c05", bezeichnung: "Test", c: 0.5 }] } });
const ablaeufe = lade({ id: "test-ablaeufe", typ: "ablaeufe", ...kopf, daten: { eintraege: [
  { id: "na", hersteller: "H", produkt: "Notablauf", art: "notablauf", wehrhoehe: 0.05,
    abflussleistung: [{ anstau: 0.02, q: 4 }, { anstau: 0.05, q: 8 }] },
  { id: "kurz", hersteller: "H", produkt: "Notablauf kurz", art: "notablauf", abflussleistung: [{ anstau: 0.01, q: 2 }, { anstau: 0.02, q: 3 }] },
] } });
const dachreiter = lade({ id: "test-dr", typ: "dachreiter", ...kopf, daten: { eintraege: [
  { id: "nd", hersteller: "H", produkt: "Notüberlauf ohne Tabelle", art: "not", breite: 0.3, hoehe: 0.1, einbaulaenge: 0.4, einlaufhoehe: 0.03 },
] } });
const PACKS = [zvdh, beiwerte, ablaeufe, dachreiter, kostra];
const C = { packId: "test-c", eintragId: "c05" };

const pt = (id: string, x: number, y: number) => ({ id, x, y });
const rechteck = (pre: string, w: number, h: number): Kontur => [pt(`${pre}1`, 0, 0), pt(`${pre}2`, w, 0), pt(`${pre}3`, w, h), pt(`${pre}4`, 0, h)];
const gully = (id: string, x: number, y: number): Entwaesserung => ({ id, art: "gully", name: id, typ: null, position: { x, y }, z: 0 });
function projekt(w: number, h: number, extra: Partial<Dachflaeche> = {}, regen?: ProjectModel["standort"]["regen"]): ProjectModel {
  const d: Dachflaeche = { id: "d1", name: "Dach", typ: "dach", aufbauten: [], zonen: [], vorgaben: {}, attika: [], tuerschwellen: [],
    kontur: rechteck("k", w, h), entwaesserung: [gully("g1", w / 2, h / 2)], ...extra };
  const m = createProject("Test", "2026-01-01T00:00:00Z");
  return { ...m, standort: { ...m.standort, ...(regen ? { regen } : {}) }, dachflaechen: [d] };
}
const schaetze = (m: ProjectModel, rain = resolveRain({ lat: 52.52, lon: 13.4 }, kostra), opt = {}) => {
  const s = computeSlope(m);
  return estimateEmergency(m, s, computeCatchments(m, s).flaechen, rain, PACKS, { abflussbeiwert: C, ...opt });
};

describe("Schritt 10: resolveRain", () => {
  it("Berlin → Zelle (8, 5) mit Werten und Quelle", () => {
    const r = resolveRain({ lat: 52.52, lon: 13.4 }, kostra)!;
    const index = 5 * SP + 8;
    expect(r.zelle).toEqual({ i: 8, j: 5, index });
    expect(r.r5_100).toBe(500 + index);
    expect(r.r5_5).toBe(300 + index);
    expect(r.quelle).toBe("Test-KOSTRA");
  });

  it("Koordinate außerhalb Deutschlands (Paris) → null + Befund", () => {
    expect(resolveRain({ lat: 48.85, lon: 2.35 }, kostra)).toBeNull();
    const e = ermittleRegen({ lat: 48.85, lon: 2.35 }, kostra);
    expect(e.rain).toBeNull();
    expect(e.befunde).toHaveLength(1);
    expect(e.befunde[0]).toMatchObject({ code: "regen-ausserhalb", regelId: "regenspende-kostra", quelle: "Test-KOSTRA" });
  });

  it("Zelle ohne Wert (im Raster, außerhalb DE) → null + Befund; kein Standort → Befund", () => {
    const e = ermittleRegen({ lat: 49.5, lon: 14.5 }, kostra);
    expect(e.rain).toBeNull();
    expect(e.befunde[0]!.code).toBe("regen-ohne-wert");
    expect(ermittleRegen(null, kostra).befunde[0]!.code).toBe("standort-fehlt");
  });

  it("Platzhalter-Pack (KBS offen) → null + Befund, keine Zahl", () => {
    const platzhalter = lade<RegenspendenPack>(JSON.parse(packTexte["../rulepacks/kostra-dwd-2020/pack.json"]!));
    const e = ermittleRegen({ lat: 52.52, lon: 13.4 }, platzhalter);
    expect(e.rain).toBeNull();
    expect(e.befunde[0]!.code).toBe("regen-kbs-unbekannt");
  });

  it("EPSG:3034 (LCC Europe): Ursprung, Mittelmeridian, Maßstab 1 am Standardparallel 35°", () => {
    const o = projiziere("EPSG:3034", { lat: 52, lon: 10 })!;
    expect(o.x).toBeCloseTo(4_000_000, 6);
    expect(o.y).toBeCloseTo(2_800_000, 6);
    expect(projiziere("EPSG:3034", { lat: 48, lon: 10 })!.x).toBeCloseTo(4_000_000, 6);
    // Meridianbogen an 35°: dy/dφ = M(φ) = a(1−e²)/(1−e² sin²φ)^{3/2}
    const a = 6378137, f = 1 / 298.257222101, e2 = f * (2 - f), phi = (35 * Math.PI) / 180, dphi = 1e-6;
    const M = (a * (1 - e2)) / (1 - e2 * Math.sin(phi) ** 2) ** 1.5;
    const y1 = projiziere("EPSG:3034", { lat: 35 - (dphi * 90) / Math.PI, lon: 10 })!.y;
    const y2 = projiziere("EPSG:3034", { lat: 35 + (dphi * 90) / Math.PI, lon: 10 })!.y;
    expect((y2 - y1) / dphi / M).toBeCloseTo(1, 6);
    // östlich liegt rechts vom Mittelmeridian, Norden oben
    expect(projiziere("EPSG:3034", { lat: 52, lon: 13.4 })!.x).toBeGreaterThan(4_000_000);
    expect(projiziere("EPSG:3034", { lat: 54, lon: 10 })!.y).toBeGreaterThan(2_800_000);
  });

  it("Raster in EPSG:3034: Zelle um den Ursprung gefunden", () => {
    const p = lade<RegenspendenPack>({ id: "k3034", typ: "regenspenden", ...kopf, daten: {
      raster: { crs: "EPSG:3034", x0: 3_997_500, y0: 2_797_500, zellgroesse: 5000, spalten: 1, zeilen: 1 }, werte: { r5_5: [250], r5_100: [480] } } });
    expect(resolveRain({ lat: 52, lon: 10 }, p)!.r5_100).toBe(480);
    expect(resolveRain({ lat: 52.2, lon: 10 }, p)).toBeNull();
  });
});

describe("Schritt 10: Notentwässerung", () => {
  it("318 m², r = 500, C = 0,5 → Q = 7,95 l/s; Q_Ablauf(35 mm) = 6 → n = 3", () => {
    const m = projekt(31.8, 10, { entwaesserung: [gully("g1", 15.9, 5), { id: "n1", art: "notablauf", name: "N1",
      typ: { packId: "test-ablaeufe", eintragId: "na" }, position: { x: 15.9, y: 0.3 }, z: 0.1 }] },
      { r5_5: { packWert: null }, r5_100: { packWert: null, manuellWert: 500 } });
    const s = computeSlope(m);
    const flaechen = computeCatchments(m, s).flaechen.filter((f) => f.ablaufId === "g1");
    // Notablauf ist eigene Quelle; für die Bemessung zählt hier die ganze Dachfläche
    const ganz = [{ ...flaechen[0]!, gesamtFlaeche: 318 }];
    const r = estimateEmergency(m, s, ganz, null, PACKS, { abflussbeiwert: C });
    const e = r.schaetzungen[0]!;
    expect(e.r).toBe(500);
    expect(e.c).toBe(0.5);
    expect(e.q).toBeCloseTo(7.95, 9);
    expect(e.sicherheitsbeiwert).toBe(2);
    expect(e.anstau).toBe(0.035);
    expect(e.qAblauf).toBeCloseTo(6, 9);
    expect(e.anzahl).toBe(3);
    for (const b of r.befunde) { expect(b.regelId).toMatch(/\S/); expect(b.quelle).toMatch(/\S/); }
  });

  it("Formel direkt: n = ceil(Q·2/Q_A), mindestens 1", () => {
    expect(anzahlNotablaeufe(7.95, 2, 6)).toBe(3);
    expect(anzahlNotablaeufe(3, 2, 6)).toBe(1);
    expect(anzahlNotablaeufe(0.01, 2, 6)).toBe(1);
    expect(anzahlNotablaeufe(0, 2, 6)).toBe(1);
    fc.assert(fc.property(fc.double({ min: 0, max: 200, noNaN: true }), fc.double({ min: 0.5, max: 50, noNaN: true }), (q, qa) => {
      const n = anzahlNotablaeufe(q, 2, qa);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n * qa).toBeGreaterThanOrEqual(q * 2 - 1e-6);
      if (n > 1) expect((n - 1) * qa).toBeLessThan(q * 2);
    }));
  });

  it("r aus Rasterzelle, wenn nicht manuell; Ablauf aus Option; Bereich an den Tiefpunkten des Randes", () => {
    const rain = resolveRain({ lat: 52.52, lon: 13.4 }, kostra)!;
    const r = schaetze(projekt(31.8, 10), rain, { notablauf: { packId: "test-ablaeufe", eintragId: "na" } });
    const e = r.schaetzungen[0]!;
    expect(e.r).toBe(rain.r5_100);
    expect(e.q).toBeCloseTo((rain.r5_100! * 0.5 * 318) / 10000, 6);
    expect(e.anzahl).toBe(Math.ceil((e.q! * 2) / 6));
    // h = 0,02·max(|x−15,9|, 5): Rand-Minimum 0,10 auf den Längsseiten, + 35 mm → |x−15,9| ≤ 6,75
    expect(e.bereich).toHaveLength(2);
    for (const b of e.bereich) {
      expect(["k1", "k3"]).toContain(b.kante);
      expect(Math.abs(b.bis.x - b.von.x)).toBeCloseTo(13.5, 0);
      expect(b.hoeheMax).toBeLessThanOrEqual(0.135 + 1e-9);
    }
  });

  it("fehlende Abflusstabelle → Befund, keine Anzahl", () => {
    const r = schaetze(projekt(20, 10), undefined, { notablauf: { packId: "test-dr", eintragId: "nd" } });
    expect(r.schaetzungen[0]!.q).not.toBeNull();
    expect(r.schaetzungen[0]!.qAblauf).toBeNull();
    expect(r.schaetzungen[0]!.anzahl).toBeNull();
    expect(r.befunde.find((b) => b.code === "abflusstabelle-fehlt")).toMatchObject({ regelId: "notentwaesserung-bemessung", quelle: "Testdaten" });
  });

  it("Tabelle deckt 35 mm nicht ab → Befund, keine Extrapolation", () => {
    const r = schaetze(projekt(20, 10), undefined, { notablauf: { packId: "test-ablaeufe", eintragId: "kurz" } });
    expect(r.schaetzungen[0]!.anzahl).toBeNull();
    expect(r.befunde.map((b) => b.code)).toContain("abflusstabelle-bereich");
    expect(abflussBei([{ anstau: 0.01, q: 2 }, { anstau: 0.02, q: 3 }], 0.015)).toBeCloseTo(2.5, 9);
    expect(abflussBei([{ anstau: 0.01, q: 2 }], 0.02)).toBeNull();
  });

  it("ohne Notablauf-Produkt, ohne C, ohne r → je Befund, keine Zahl", () => {
    const ohneAblauf = schaetze(projekt(20, 10));
    expect(ohneAblauf.schaetzungen[0]!.anzahl).toBeNull();
    expect(ohneAblauf.befunde.map((b) => b.code)).toContain("notablauf-fehlt");
    const m = projekt(20, 10);
    const s = computeSlope(m);
    const ohneC = estimateEmergency(m, s, computeCatchments(m, s).flaechen, null, PACKS);
    expect(ohneC.schaetzungen[0]!.q).toBeNull();
    expect(ohneC.befunde.map((b) => b.code)).toEqual(expect.arrayContaining(["abflussbeiwert-fehlt", "regenspende-fehlt"]));
    // fehlende Regel (Regel-Pack nicht geladen)
    const ohneRegeln = estimateEmergency(m, s, computeCatchments(m, s).flaechen, null, [beiwerte, ablaeufe], { abflussbeiwert: C });
    expect(ohneRegeln.befunde.filter((b) => b.code === "regel-fehlt").map((b) => b.regelId).sort())
      .toEqual(["barrierefrei-schwelle", "notentwaesserung-anstau"]);
  });
});
