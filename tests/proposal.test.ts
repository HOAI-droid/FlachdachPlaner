import { describe, expect, it } from "vitest";
import {
  ablaeufeHinzufuegen, ausfuehren, computeCatchments, computeSlope, createProject, loadRulePack, neuerVerlauf,
  pointInPolygon, dachPolygon, rueckgaengig, schlageAblaeufeVor,
  type Dachflaeche, type Entwaesserung, type Kontur, type ProjectModel, type RegelPack, type RulePack,
} from "../src/core/index";

const packTexte = import.meta.glob("../rulepacks/*/pack.json", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;
const lade = (roh: unknown): RulePack => {
  const r = loadRulePack(roh);
  if (!r.ok) throw new Error(JSON.stringify(r.fehler));
  return r.pack;
};
const zvdh = lade(JSON.parse(packTexte["../rulepacks/zvdh-2026/pack.json"]!)) as RegelPack;
const GRENZE = zvdh.daten.regeln.find((r) => r.id === "flaeche-je-ablauf")!.parameter["hinweisAb"]!.wert;

const pt = (id: string, x: number, y: number) => ({ id, x, y });
const rechteck = (w: number, h: number): Kontur => [pt("k1", 0, 0), pt("k2", w, 0), pt("k3", w, h), pt("k4", 0, h)];
const gully = (id: string, x: number, y: number, z = 0): Entwaesserung => ({ id, art: "gully", name: id, typ: null, position: { x, y }, z });
function projekt(x: Partial<Dachflaeche> = {}): ProjectModel {
  const d: Dachflaeche = {
    id: "d1", name: "Dach", typ: "dach", aufbauten: [], zonen: [], vorgaben: {}, attika: [], tuerschwellen: [],
    kontur: rechteck(40, 20), entwaesserung: [], ...x,
  };
  return { ...createProject("Test", "2026-01-01T00:00:00Z"), gefaelleStandard: 0.02, dachflaechen: [d] };
}
const flaechenNach = (m: ProjectModel) => computeCatchments(m, computeSlope(m), { regeln: zvdh }).flaechen.map((f) => f.gesamtFlaeche);

describe("Schritt 31: Vorschlag Abläufe", () => {
  it("40×20 ohne Abläufe → ≥ 3 Abläufe, alle Einzugsflächen < Grenzwert", () => {
    const m = projekt();
    const r = schlageAblaeufeVor(m, [zvdh]);
    expect(r.ablaeufe.length).toBeGreaterThanOrEqual(3);
    const neu = ablaeufeHinzufuegen(r.ablaeufe).anwenden(m);
    const f = flaechenNach(neu);
    expect(f).toHaveLength(r.ablaeufe.length);
    for (const a of f) expect(a).toBeLessThan(GRENZE);
    expect(f.reduce((s, a) => s + a, 0)).toBeCloseTo(800, 6);
    const poly = dachPolygon(m.dachflaechen[0]!);
    for (const a of r.ablaeufe) expect(pointInPolygon(a.position, poly)).toBe("inside");
    expect(r.befunde.find((b) => b.code === "vorschlag-ablaeufe")).toBeTruthy();
  });

  it("deterministisch und Modell unverändert", () => {
    const m = projekt();
    const kopie = JSON.stringify(m);
    const a = schlageAblaeufeVor(m, [zvdh]), b = schlageAblaeufeVor(m, [zvdh]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(m)).toBe(kopie);
  });

  it("max. Hochpunkt erzwingt mehr Abläufe und wird eingehalten", () => {
    const ohne = schlageAblaeufeVor(projekt(), [zvdh]).ablaeufe.length;
    const m = projekt({ vorgaben: { maxHochpunkt: 0.1 } });
    const r = schlageAblaeufeVor(m, [zvdh]);
    expect(r.ablaeufe.length).toBeGreaterThan(ohne);
    const neu = ablaeufeHinzufuegen(r.ablaeufe).anwenden(m);
    const hp = computeSlope(neu).dachflaechen[0]!.hochpunkt!.kote;
    expect(hp).toBeLessThanOrEqual(0.1 + 1e-9);
  });

  it("nur HP-Vorgabe ohne Regel-Pack genügt als Kriterium", () => {
    const r = schlageAblaeufeVor(projekt({ vorgaben: { maxHochpunkt: 0.2 } }), []);
    expect(r.ablaeufe.length).toBeGreaterThan(0);
  });

  it("ohne Regel und ohne HP-Vorgabe: Befund, kein Vorschlag", () => {
    const r = schlageAblaeufeVor(projekt(), []);
    expect(r.ablaeufe).toHaveLength(0);
    expect(r.befunde[0]).toMatchObject({ code: "vorschlag-kein-kriterium", stufe: "hinweis" });
  });

  it("vorhandene Abläufe bleiben; genügen sie, wird nichts vorgeschlagen", () => {
    const genug = projekt({ kontur: rechteck(20, 10), entwaesserung: [gully("g1", 10, 5)] });
    const r = schlageAblaeufeVor(genug, [zvdh]);
    expect(r.ablaeufe).toHaveLength(0);
    expect(r.befunde[0]!.code).toBe("vorschlag-nicht-noetig");

    const m = projekt({ entwaesserung: [gully("g1", 5, 10)] });
    const v = schlageAblaeufeVor(m, [zvdh]);
    expect(v.ablaeufe.length).toBeGreaterThanOrEqual(2);
    const neu = ablaeufeHinzufuegen(v.ablaeufe).anwenden(m);
    expect(neu.dachflaechen[0]!.entwaesserung[0]).toEqual(m.dachflaechen[0]!.entwaesserung[0]);
    for (const a of flaechenNach(neu)) expect(a).toBeLessThan(GRENZE);
  });

  it("L-Dach mit Aufbau: Vorschläge innerhalb, Flächen < Grenzwert", () => {
    const kontur: Kontur = [pt("k1", 0, 0), pt("k2", 40, 0), pt("k3", 40, 15), pt("k4", 15, 15), pt("k5", 15, 40), pt("k6", 0, 40)];
    const m = projekt({ kontur, aufbauten: [{ id: "a1", name: "LK", kontur: [pt("a1", 5, 5), pt("a2", 7, 5), pt("a3", 7, 7), pt("a4", 5, 7)] }] });
    const r = schlageAblaeufeVor(m, [zvdh]);
    const neu = ablaeufeHinzufuegen(r.ablaeufe).anwenden(m);
    const poly = dachPolygon(m.dachflaechen[0]!);
    for (const a of r.ablaeufe) expect(pointInPolygon(a.position, poly)).toBe("inside");
    for (const a of flaechenNach(neu)) expect(a).toBeLessThan(GRENZE);
  });

  it("unerreichbare HP-Vorgabe → Warnung, kein Vorschlag", () => {
    const r = schlageAblaeufeVor(projekt({ vorgaben: { maxHochpunkt: -0.05 } }), [zvdh]);
    expect(r.ablaeufe).toHaveLength(0);
    expect(r.befunde[0]).toMatchObject({ code: "vorschlag-ziel-nicht-erreicht", stufe: "warnung" });
  });

  it("Befehl: ein Undo-Schritt, rückgängig stellt Ausgangsmodell her", () => {
    const m = projekt();
    const r = schlageAblaeufeVor(m, [zvdh]);
    const v = ausfuehren(neuerVerlauf(m), ablaeufeHinzufuegen(r.ablaeufe));
    expect(v.aktuell.dachflaechen[0]!.entwaesserung).toHaveLength(r.ablaeufe.length);
    expect(new Set(v.aktuell.dachflaechen[0]!.entwaesserung.map((e) => e.id)).size).toBe(r.ablaeufe.length);
    expect(rueckgaengig(v).aktuell).toBe(m);
    expect(ausfuehren(neuerVerlauf(m), ablaeufeHinzufuegen([])).zurueck).toHaveLength(0);
  });
});
