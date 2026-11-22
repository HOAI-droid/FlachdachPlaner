import { describe, expect, it } from "vitest";
import {
  ablaeufeHinzufuegen, computeCatchments, computeSlope, createProject, ebeneFacetten, loadRulePack, pruefeVorgaben, schlageAblaeufeVor,
  type Dachflaeche, type Entwaesserung, type Kontur, type ProjectModel, type RegelPack, type RulePack,
} from "../src/core/index";

/** Notabläufe beeinflussen die Gefälleplanung nicht (Review-Punkt a). */
const packTexte = import.meta.glob("../rulepacks/*/pack.json", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;
const lade = (roh: unknown): RulePack => {
  const r = loadRulePack(roh);
  if (!r.ok) throw new Error(JSON.stringify(r.fehler));
  return r.pack;
};
const zvdh = lade(JSON.parse(packTexte["../rulepacks/zvdh-2026/pack.json"]!)) as RegelPack;
const pt = (id: string, x: number, y: number) => ({ id, x, y });
const rechteck = (w: number, h: number): Kontur => [pt("k1", 0, 0), pt("k2", w, 0), pt("k3", w, h), pt("k4", 0, h)];
const gully = (id: string, x: number, y: number, z = 0): Entwaesserung => ({ id, art: "gully", name: id, typ: null, position: { x, y }, z });
const not = (id: string, x: number, y: number, z = 0.05): Entwaesserung => ({ id, art: "notablauf", name: id, typ: null, position: { x, y }, z });
function projekt(x: Partial<Dachflaeche> = {}): ProjectModel {
  const d: Dachflaeche = {
    id: "d1", name: "Dach", typ: "dach", aufbauten: [], zonen: [], vorgaben: {}, attika: [], tuerschwellen: [],
    kontur: rechteck(20, 10), entwaesserung: [], ...x,
  };
  return { ...createProject("Test", "2026-01-01T00:00:00Z"), gefaelleStandard: 0.02, dachflaechen: [d] };
}

describe("Notabläufe ohne Einfluss auf das Gefälle", () => {
  const ohne = projekt({ entwaesserung: [gully("g1", 10, 5)] });
  const mit = projekt({ entwaesserung: [gully("g1", 10, 5), not("n1", 2, 2, -0.5), not("n2", 18, 8)] });

  it("Höhenfeld, Facetten, Linien, Platten und Einzugsflächen wie ohne Notabläufe", () => {
    const a = computeSlope(ohne).dachflaechen[0]!, b = computeSlope(mit).dachflaechen[0]!;
    expect(b.feld.quellen).toEqual(a.feld.quellen);
    expect(b.facetten).toEqual(a.facetten);
    expect(b.linien).toEqual(a.linien);
    expect(b.koten).toEqual(a.koten);
    expect(ebeneFacetten(b.facetten)).toEqual(ebeneFacetten(a.facetten));
    const fa = computeCatchments(ohne, computeSlope(ohne), { regeln: zvdh }).flaechen;
    const fb = computeCatchments(mit, computeSlope(mit), { regeln: zvdh }).flaechen;
    expect(fb.map((f) => [f.ablaufId, f.gesamtFlaeche])).toEqual(fa.map((f) => [f.ablaufId, f.gesamtFlaeche]));
  });

  it("Notablauf bleibt im Modell (Anzeige/Export) und wird auf Lage geprüft", () => {
    const m = projekt({ entwaesserung: [gully("g1", 10, 5), not("n9", 30, 5)] });
    const r = computeSlope(m);
    expect(m.dachflaechen[0]!.entwaesserung.map((e) => e.id)).toEqual(["g1", "n9"]);
    expect(r.hinweise.map((h) => [h.code, h.objektId])).toEqual([["ablauf-ausserhalb", "n9"]]);
  });

  it("nur Notabläufe: kein Gefälle, ein Hinweis ‚keine-ablaeufe‘ mit Grund, kein Hinweis je Notablauf", () => {
    const r = computeSlope(projekt({ entwaesserung: [not("n1", 5, 5), not("n2", 15, 5)] }));
    expect(r.dachflaechen[0]!.facetten).toEqual([]);
    expect(r.hinweise).toHaveLength(1);
    expect(r.hinweise[0]!.code).toBe("keine-ablaeufe");
    expect(r.hinweise[0]!.meldung).toMatch(/Notabl/);
  });

  it("Vorgaben: min. Tiefpunkt und Dämmdicke am Tiefpunkt nur für Hauptabläufe", () => {
    const m = projekt({
      entwaesserung: [gully("g1", 10, 5, 0.3), not("n1", 2, 2, 0)],
      vorgaben: { minTiefpunkt: 0.2, okRohdecke: 0.1 }, daemmdickeTiefpunkt: 20,
    });
    const b = pruefeVorgaben(m, computeSlope(m));
    expect(b.filter((x) => x.objektId === "n1")).toEqual([]);
  });

  it("Vorschlag: Notabläufe zählen nicht als vorhandene Abläufe", () => {
    const m = projekt({ kontur: rechteck(40, 20), entwaesserung: [not("n1", 20, 10, 0)] });
    const r = schlageAblaeufeVor(m, [zvdh]);
    expect(r.befunde.map((b) => b.code)).not.toContain("vorschlag-nicht-noetig");
    expect(r.ablaeufe.length).toBeGreaterThanOrEqual(3);
    const neu = ablaeufeHinzufuegen(r.ablaeufe).anwenden(m);
    expect(neu.dachflaechen[0]!.entwaesserung.filter((e) => e.art === "notablauf")).toHaveLength(1);
  });

  it("Not-Dachreiter (Pack-Art not) ist keine Höhenquelle, Lage bleibt erhalten", () => {
    const kopf = { version: "1.0.0", quelle: "Test", ausgabe: "Test", gueltigAb: "2026-01-01", geprueft: true };
    const dr = lade({ id: "test-dr", typ: "dachreiter", ...kopf, daten: { eintraege: [
      { id: "nd", hersteller: "H", produkt: "Not", art: "not", breite: 0.3, hoehe: 0.1, einbaulaenge: 0.4, einlaufhoehe: 0.03 },
    ] } });
    const m = projekt({ entwaesserung: [gully("g1", 10, 5),
      { id: "r1", art: "dachreiter", name: "R", typ: { packId: "test-dr", eintragId: "nd" }, lage: { kante: "k1", abstand: 5 }, z: 0 }] });
    const g = computeSlope(m, { packs: [dr] }).dachflaechen[0]!;
    expect(g.feld.quellen.map((q) => q.ablaufId)).toEqual(["g1"]);
    expect(g.dachreiter.map((x) => x.ablaufId)).toEqual(["r1"]);
  });
});
