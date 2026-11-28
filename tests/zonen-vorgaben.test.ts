import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  computeSlope, createProject, hoeheDachflaeche, loadRulePack, pruefeVorgaben, standardDaemmdickeTiefpunkt, verletzteKoten,
  type Dachflaeche, type DaemmplattenPack, type Entwaesserung, type Kontur, type ProjectModel, type Zone,
} from "../src/core/index";

const packTexte = import.meta.glob("../rulepacks/*/pack.json", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;
const pt = (id: string, x: number, y: number) => ({ id, x, y });
const rechteck = (pre: string, w: number, h: number, x0 = 0, y0 = 0): Kontur =>
  [pt(`${pre}1`, x0, y0), pt(`${pre}2`, x0 + w, y0), pt(`${pre}3`, x0 + w, y0 + h), pt(`${pre}4`, x0, y0 + h)];
const gully = (id: string, x: number, y: number, z = 0): Entwaesserung =>
  ({ id, art: "gully", name: id, typ: null, position: { x, y }, z });
function projekt(x: Partial<Dachflaeche> = {}): ProjectModel {
  const d: Dachflaeche = {
    id: "d1", name: "Dach", typ: "dach", aufbauten: [], zonen: [], vorgaben: {}, attika: [], tuerschwellen: [],
    kontur: rechteck("k", 20, 10), entwaesserung: [gully("g1", 10, 5)], ...x,
  };
  return { ...createProject("Test", "2026-01-01T00:00:00Z"), gefaelleStandard: 0.02, dachflaechen: [d] };
}
const terrasse = (z: Partial<Zone> = {}): Zone =>
  ({ id: "t1", name: "Terrasse", kontur: rechteck("t", 5, 10), hoehenversatz: -0.1, ...z });

/** Unabhängige d_m-Nachrechnung: Mittelpunktsregel auf feinem Raster, je Teilfläche eigener Tiefpunkt. */
function dmNumerisch(h: (x: number, y: number) => number, x0: number, x1: number, tp: number, dtp: number, schritt = 0.02) {
  let s = 0, n = 0;
  for (let i = 0; x0 + (i + 0.5) * schritt < x1; i++) {
    for (let j = 0; (j + 0.5) * schritt < 10; j++) { s += h(x0 + (i + 0.5) * schritt, (j + 0.5) * schritt); n++; }
  }
  return { mittel: dtp + 1000 * (s / n - tp), flaeche: (x1 - x0) * 10 };
}
const linf = (x: number, y: number) => Math.max(Math.abs(x - 10), Math.abs(y - 5));

describe("Schritt 8: Zonen/Stufen", () => {
  it("Terrassenzone −0,10 m getrennt berechnet, d_m flächengewichtet", () => {
    const m = projekt({ zonen: [terrasse()], daemmdickeTiefpunkt: 20 });
    const g = computeSlope(m).dachflaechen[0]!;
    expect(g.zonen).toHaveLength(1);
    const z = g.zonen[0]!;
    expect(z.flaeche).toBeCloseTo(50, 6);
    // Zonenfeld: −0,10 + 0,02·d → HP 0,10 bei x=0, TP 0 am Zonenrand x=5
    expect(z.hochpunkt!.kote).toBeCloseTo(0.1, 9);
    expect(z.tiefpunkt!.kote).toBeCloseTo(0, 9);
    expect(z.facetten.every((f) => f.zoneId === "t1")).toBe(true);
    // Stufe am Zonenrand: Hauptfläche 0,10, Zone 0,00
    expect(hoeheDachflaeche(g, { x: 5.001, y: 5 })).toBeCloseTo(0.1 - 0.00002, 6);
    expect(hoeheDachflaeche(g, { x: 4.999, y: 5 })).toBeCloseTo(0.00002, 6);
    // Dämmung: Zone getrennt (eigener TP), dann flächengewichtet
    const zn = dmNumerisch((x, y) => -0.1 + 0.02 * linf(x, y), 0, 5, 0, 20);
    const hn = dmNumerisch((x, y) => 0.02 * linf(x, y), 5, 20, 0, 20);
    expect(z.daemmung!.mittel).toBeCloseTo(zn.mittel, 1);
    expect(z.daemmung!.mittel).toBeCloseTo(70, 6); // 20 + 1000·0,02·2,5
    expect(g.daemmungHaupt!.mittel).toBeCloseTo(hn.mittel, 1);
    const erwartet = (zn.flaeche * zn.mittel + hn.flaeche * hn.mittel) / (zn.flaeche + hn.flaeche);
    expect(g.daemmung!.mittel).toBeCloseTo(erwartet, 1);
    expect(g.daemmung!.flaeche).toBeCloseTo(200, 6);
    // ohne Zone ergäbe sich ein anderer Mittelwert (Zone wirkt sich aus)
    const ohne = computeSlope(projekt({ daemmdickeTiefpunkt: 20 })).dachflaechen[0]!.daemmung!.mittel;
    expect(Math.abs(ohne - g.daemmung!.mittel)).toBeGreaterThan(1);
  });

  it("Eigenschaft: d_m = flächengewichtetes Mittel der Teile, für beliebige Versätze/Zonenbreiten", () => {
    fc.assert(fc.property(fc.double({ min: -0.3, max: 0.3, noNaN: true }), fc.integer({ min: 1, max: 9 }), (v, b) => {
      const g = computeSlope(projekt({ zonen: [terrasse({ hoehenversatz: v, kontur: rechteck("t", b, 10) })] })).dachflaechen[0]!;
      const teile = [g.daemmungHaupt!, g.zonen[0]!.daemmung!];
      const f = teile[0]!.flaeche + teile[1]!.flaeche;
      expect(f).toBeCloseTo(200, 6);
      expect(g.daemmung!.mittel).toBeCloseTo((teile[0]!.flaeche * teile[0]!.mittel + teile[1]!.flaeche * teile[1]!.mittel) / f, 9);
      // Versatz verschiebt nur Koten, nicht die Dicke über dem eigenen TP
      expect(g.zonen[0]!.tiefpunkt!.kote).toBeCloseTo(v + 0.02 * (10 - b), 9);
    }), { numRuns: 30 });
  });

  it("Zone außerhalb der Dachfläche → Hinweis", () => {
    const r = computeSlope(projekt({ zonen: [terrasse({ kontur: rechteck("t", 5, 10, -2, 0) })] }));
    expect(r.hinweise.map((h) => h.code)).toContain("zone-ausserhalb");
    expect(r.dachflaechen[0]!.zonen[0]!.flaeche).toBeCloseTo(30, 6);
  });

  it("0-%-Zone: waagerecht auf min z + Versatz, ohne Pfeil", () => {
    const g = computeSlope(projekt({ zonen: [terrasse({ gefaelle: 0, begruendung: "Belag auf Stelzlagern" })] })).dachflaechen[0]!;
    const z = g.zonen[0]!;
    expect(z.hochpunkt!.kote).toBeCloseTo(-0.1, 9);
    expect(z.tiefpunkt!.kote).toBeCloseTo(-0.1, 9);
    expect(g.pfeile.some((p) => p.facetteId.startsWith("t1:"))).toBe(false);
  });
});

describe("Schritt 8: Vorgabenprüfung", () => {
  it("Hochpunkt über max. HP → Fehler mit Differenz; eingehalten → kein Befund", () => {
    const m = projekt({ vorgaben: { maxHochpunkt: 0.15 }, zonen: [terrasse()] });
    const b = pruefeVorgaben(m, computeSlope(m)).filter((x) => x.regelId === "vorgabe-max-hochpunkt");
    expect(b).toHaveLength(1); // Zone (HP 0,10) hält 0,15 ein
    expect(b[0]).toMatchObject({ stufe: "fehler", objektId: "d1", dachflaecheId: "d1" });
    expect(b[0]!.differenz).toBeCloseTo(0.05, 9);
    expect(b[0]!.meldung).toContain("50 mm");
    expect(b[0]!.quelle).toContain("Dach");
    const ok = projekt({ vorgaben: { maxHochpunkt: 0.2 } });
    expect(pruefeVorgaben(ok, computeSlope(ok))).toEqual([]);
  });

  it("verletzteKoten: nur Koten mit dem gemeldeten Verstoßwert sind rot", () => {
    const m = projekt({ vorgaben: { maxHochpunkt: 0.15 } });
    const sl = computeSlope(m), b = pruefeVorgaben(m, sl);
    const rot = verletzteKoten(b), hp = sl.dachflaechen[0]!.hochpunkt!.kote;
    expect(rot(hp)).toBe(true);
    expect(rot(hp - 0.01)).toBe(false);
    expect(verletzteKoten([])(hp)).toBe(false);
  });

  it("Zonenvorgabe hat Vorrang vor Dachvorgabe", () => {
    const m = projekt({ vorgaben: { maxHochpunkt: 0.5 }, zonen: [terrasse({ vorgaben: { maxHochpunkt: 0.08 } })] });
    const b = pruefeVorgaben(m, computeSlope(m));
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ objektId: "t1", regelId: "vorgabe-max-hochpunkt" });
    expect(b[0]!.differenz).toBeCloseTo(0.02, 9);
  });

  it("Ablauf-Kote z unter min. TP → Fehler; höheres z hebt ihn auf", () => {
    const m = projekt({ vorgaben: { minTiefpunkt: 0.01 } });
    const b = pruefeVorgaben(m, computeSlope(m));
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ stufe: "fehler", objektId: "g1", regelId: "vorgabe-min-tiefpunkt", ort: { x: 10, y: 5 } });
    expect(b[0]!.differenz).toBeCloseTo(0.01, 9);
    const hoch = projekt({ vorgaben: { minTiefpunkt: 0.01 }, entwaesserung: [gully("g1", 10, 5, 0.01)] });
    expect(pruefeVorgaben(hoch, computeSlope(hoch))).toEqual([]);
  });

  it("Mindestdämmdicke am TP gegen OK Rohdecke: z und d_TP fließen ein", () => {
    const m = projekt({ vorgaben: { okRohdecke: -0.01 }, daemmdickeTiefpunkt: 20, zonen: [terrasse()] });
    const b = pruefeVorgaben(m, computeSlope(m)).filter((x) => x.regelId === "vorgabe-daemmdicke-tiefpunkt");
    // Hauptfläche (g1, z=0) und Zone (TP 0) haben je 10 mm statt 20 mm
    expect(b.map((x) => x.objektId).sort()).toEqual(["g1", "t1"]);
    for (const x of b) expect(x.differenz).toBeCloseTo(0.01, 9);
    // d_TP 10 mm reicht
    const dünn = projekt({ vorgaben: { okRohdecke: -0.01 }, daemmdickeTiefpunkt: 10 });
    expect(pruefeVorgaben(dünn, computeSlope(dünn))).toEqual([]);
    // höhere Ablaufkote reicht ebenfalls
    const hoch = projekt({ vorgaben: { okRohdecke: -0.01 }, daemmdickeTiefpunkt: 20, entwaesserung: [gully("g1", 10, 5, 0.01)] });
    expect(pruefeVorgaben(hoch, computeSlope(hoch))).toEqual([]);
  });

  it("Mindestdämmdicke aus Dämmplatten-Pack (Standard); ohne Angabe → Warnung statt Zahl", () => {
    const r = loadRulePack(JSON.parse(packTexte["../rulepacks/daemmplatten/pack.json"]!));
    expect(r.ok).toBe(true);
    const std = standardDaemmdickeTiefpunkt((r as { pack: DaemmplattenPack }).pack);
    expect(std).toBeGreaterThan(0);
    const m = projekt({ vorgaben: { okRohdecke: 0.0 } });
    const b = pruefeVorgaben(m, computeSlope(m), { daemmdickeTiefpunktStandard: std! });
    expect(b).toHaveLength(1);
    expect(b[0]!.differenz).toBeCloseTo(std! / 1000, 9);
    const ohne = pruefeVorgaben(m, computeSlope(m));
    expect(ohne).toHaveLength(1);
    expect(ohne[0]).toMatchObject({ stufe: "warnung", code: "daemmdicke-tiefpunkt-fehlt" });
    expect(ohne[0]!.differenz).toBeUndefined();
  });

  it("0-%-Zone: mit Begründung Hinweis (Begründung in Meldung), ohne Begründung Fehler", () => {
    const mit = projekt({ zonen: [terrasse({ gefaelle: 0, begruendung: "Stelzlager, Entwässerung unter Belag" })] });
    const b = pruefeVorgaben(mit, computeSlope(mit));
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ stufe: "hinweis", objektId: "t1", regelId: "vorgabe-zone-ohne-gefaelle" });
    expect(b[0]!.meldung).toContain("Stelzlager");
    const ohne = projekt({ zonen: [terrasse({ gefaelle: 0 })] });
    expect(pruefeVorgaben(ohne, computeSlope(ohne))[0]).toMatchObject({ stufe: "fehler" });
    const mitGefaelle = projekt({ zonen: [terrasse({ gefaelle: 0.015 })] });
    expect(pruefeVorgaben(mitGefaelle, computeSlope(mitGefaelle))).toEqual([]);
  });
});
