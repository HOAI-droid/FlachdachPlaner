/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { computeCatchments, computeSlope, createProject, layoutInsulation, loadRulePack, type DaemmplattenPack, type ProjectModel } from "../src/core/index";
import { PdfDokument, textBreite } from "../src/io/pdf/pdf";
import { Abbildung, baueProjektPdf, waehleMassstab } from "../src/io/pdf/plan";

const packTexte = import.meta.glob("../rulepacks/*/pack.json", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;
const r = loadRulePack(JSON.parse(packTexte["../rulepacks/daemmplatten/pack.json"]!));
if (!r.ok) throw new Error("Katalog");
const KAT = r.pack as DaemmplattenPack;

const pt = (id: string, x: number, y: number) => ({ id, x, y });
const modell = (): ProjectModel => ({
  ...createProject("Testdach (PDF)", "2026-01-01T00:00:00Z"), gefaelleStandard: 0.02,
  dachflaechen: [{
    id: "d1", name: "Dach", typ: "dach", aufbauten: [], zonen: [], vorgaben: {}, attika: [], tuerschwellen: [],
    kontur: [pt("a", 0, 0), pt("b", 10.6, 0), pt("c", 10.6, 15.3), pt("d", 4.15, 15.3), pt("e", 4.15, 7.1), pt("f", 0, 7.1)],
    entwaesserung: [{ id: "g1", art: "gully", name: "A1", typ: null, position: { x: 0, y: 0 }, z: 0.1 }, { id: "g2", art: "gully", name: "A2", typ: null, position: { x: 10.6, y: 15.3 }, z: 0 }],
  }],
});

describe("Schritt 28: PDF-Export", () => {
  it("10 m bei 1:100 = 100 mm ± 0,2 mm", () => {
    const a = new Abbildung(100, 0, 0, 20, 30);
    expect(a.x(10) - a.x(0)).toBeCloseTo(100, 1);
    expect(Math.abs(a.y(10) - a.y(0) - 100)).toBeLessThan(0.2);
  });
  it("Maßstab: kleinster genormter, der passt", () => {
    expect(waehleMassstab(10, 10, 300, 300)).toBe(50);
    expect(waehleMassstab(100, 100, 250, 200)).toBe(500);
  });
  it("gültiger PDF-Aufbau, xref-Offsets stimmen, Umlaute in WinAnsi", () => {
    const d = new PdfDokument("T");
    d.seite(100, 100).text("Gefälle (äöüß) \\ Ø 2,5 mm", 5, 5);
    const b = d.bytes(), s = Array.from(b, (c) => String.fromCharCode(c)).join("");
    expect(s.startsWith("%PDF-1.4")).toBe(true);
    expect(s.trimEnd().endsWith("%%EOF")).toBe(true);
    const start = Number(/startxref\n(\d+)/.exec(s)![1]);
    expect(s.slice(start, start + 4)).toBe("xref");
    const offs = [...s.slice(start).matchAll(/(\d{10}) 00000 n/g)].map((x) => Number(x[1]));
    offs.forEach((o, i) => expect(s.slice(o, o + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
    expect(textBreite("iiii", 10)).toBeLessThan(textBreite("MMMM", 10));
  });
  it("Projekt-PDF: 2 Blätter A3, Schriftfeld-Inhalt, Maßstab genormt", () => {
    const m = modell();
    const slope = computeSlope(m, { daemmdickeTiefpunktStandard: 20 });
    const catchments = computeCatchments(m, slope, {});
    const plan = layoutInsulation(m, slope, KAT);
    const eids = new Map(catchments.flaechen.map((f, i) => [f.id, `E${i + 1}`] as const));
    const out = baueProjektPdf({ modell: m, slope, catchments, eids, plan, farbe: () => "#77AADD", datum: "01.01.2026", regelwerk: "Test 1.0" });
    expect([50, 100, 200]).toContain(out.massstab);
    const s = Array.from(out.bytes, (c) => String.fromCharCode(c)).join("");
    expect((s.match(/\/Type \/Page /g) ?? []).length).toBe(2);
    expect(s).toContain("/MediaBox [0 0 1190.551 841.89]");
    expect(s).toContain("(Gef\\344lleplan)");
    expect(s).toContain("(Testdach \\(PDF\\))");
    expect(s).not.toContain("NaN");
  });
});
