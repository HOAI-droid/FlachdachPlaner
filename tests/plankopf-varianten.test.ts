/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import {
  computeCatchments, computeSlope, createProject, layoutInsulation, loadRulePack, setzeProjektangaben,
  type DaemmplattenPack, type ProjectModel,
} from "../src/core/index";
import { baueVariantenPdf, type PlanEingabe } from "../src/io/pdf/plan";

const packTexte = import.meta.glob("../rulepacks/*/pack.json", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;
const r = loadRulePack(JSON.parse(packTexte["../rulepacks/daemmplatten/pack.json"]!));
if (!r.ok) throw new Error("Katalog");
const KAT = r.pack as DaemmplattenPack;

const pt = (id: string, x: number, y: number) => ({ id, x, y });
const basis = (): ProjectModel => ({
  ...createProject("Testdach", "2026-01-01T00:00:00Z"), gefaelleStandard: 0.02,
  dachflaechen: [{
    id: "d1", name: "Dach", typ: "dach", aufbauten: [], zonen: [], vorgaben: {}, attika: [], tuerschwellen: [],
    kontur: [pt("a", 0, 0), pt("b", 10, 0), pt("c", 10, 8), pt("d", 0, 8)],
    entwaesserung: [{ id: "g1", art: "gully", name: "A1", typ: null, position: { x: 0, y: 0 }, z: 0.1 }],
  }],
});
const eingabe = (m: ProjectModel, variante?: string): PlanEingabe => {
  const slope = computeSlope(m, { daemmdickeTiefpunktStandard: 20 });
  const catchments = computeCatchments(m, slope, {});
  return {
    modell: m, slope, catchments, eids: new Map(catchments.flaechen.map((f, i) => [f.id, `E${i + 1}`] as const)),
    plan: layoutInsulation(m, slope, KAT), farbe: () => "#77AADD", datum: "01.01.2026", regelwerk: "Test 1.0",
    ...(variante ? { variante } : {}),
  };
};
const text = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join("");

describe("Schritt 38: PDF mit Varianten und Plankopf", () => {
  it("zwei gewählte Varianten → 4 Blätter, Variantenname im Schriftfeld, Reihenfolge wie übergeben", () => {
    const m = basis();
    const out = baueVariantenPdf([{ eingabe: eingabe(m, "Variante B") }, { eingabe: eingabe(m, "Variante A") }]);
    const s = text(out.bytes);
    expect(s).toMatch(/\/Count 4\b/);
    expect(s.indexOf("Variante B")).toBeGreaterThan(-1);
    expect(s.indexOf("Variante B")).toBeLessThan(s.indexOf("Variante A"));
    expect(s).toContain("(4/4)");
  });
  it("Plankopf-Angaben erscheinen im PDF, Plandatum wird deutsch formatiert", () => {
    const a = setzeProjektangaben(basis(), {
      bauherr: "Muster GmbH", bauvorhaben: "Neubau Halle 3", bueroName: "Büro Beispiel", bearbeiter: "S. Ost", planNummer: "G-01",
      planDatum: "2026-12-24", revision: "B", revisionDatum: "2026-12-30",
    });
    if (!a.ok) throw new Error("Angaben");
    const s = text(baueVariantenPdf([{ eingabe: eingabe(a.modell) }]).bytes);
    for (const t of ["Muster GmbH", "Neubau Halle 3", "G-01", "24.12.2026", "30.12.2026"]) expect(s).toContain(t);
    expect(s).not.toContain("01.01.2026"); // Plandatum überschreibt das Exportdatum
  });
  it("leere Angaben zeigen Strich, Exportdatum als Standard; deterministisch", () => {
    const e = eingabe(basis());
    const a = baueVariantenPdf([{ eingabe: e }]).bytes, b = baueVariantenPdf([{ eingabe: e }]).bytes;
    expect(text(a)).toBe(text(b));
    expect(text(a)).toContain("01.01.2026");
  });
  it("ohne Variante: Fehler statt leerem PDF", () => {
    expect(() => baueVariantenPdf([])).toThrow();
  });
});
