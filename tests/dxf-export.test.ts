import { describe, expect, it } from "vitest";
import { computeSlope, createProject, layoutInsulation, loadRulePack, type DaemmplattenPack, type ProjectModel } from "../src/core/index";
import { baueProjektDxf, DXF_LAYER, flatten, parseDxf } from "../src/io/dxf";

const packTexte = import.meta.glob("../rulepacks/*/pack.json", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;
const r = loadRulePack(JSON.parse(packTexte["../rulepacks/daemmplatten/pack.json"]!));
if (!r.ok) throw new Error("Katalog");
const KAT = r.pack as DaemmplattenPack;
const pt = (id: string, x: number, y: number) => ({ id, x, y });
const modell = (): ProjectModel => ({
  ...createProject("Testdach", "2026-01-01T00:00:00Z"), gefaelleStandard: 0.02,
  dachflaechen: [{
    id: "d1", name: "Dach", typ: "dach", aufbauten: [], zonen: [], vorgaben: {}, attika: [{ id: "at", kante: "a", breite: 0.3 }], tuerschwellen: [],
    kontur: [pt("a", 0, 0), pt("b", 10.6, 0), pt("c", 10.6, 15.3), pt("d", 4.15, 15.3), pt("e", 4.15, 7.1), pt("f", 0, 7.1)],
    entwaesserung: [{ id: "g1", art: "gully", name: "Ä1", typ: null, position: { x: 0, y: 0 }, z: 0.1 }, { id: "g2", art: "gully", name: "A2", typ: null, position: { x: 10.6, y: 15.3 }, z: 0 }],
  }],
});

describe("Schritt 29: DXF-Export", () => {
  const m = modell();
  const slope = computeSlope(m, { daemmdickeTiefpunktStandard: 20 });
  const plan = layoutInsulation(m, slope, KAT);
  const text = baueProjektDxf({ modell: m, slope, plan });
  const doc = parseDxf(text);

  it("Layer je Objektart vorhanden, Einheit Meter", () => {
    expect(doc.insunits).toBe(6);
    for (const l of [DXF_LAYER.kontur, DXF_LAYER.ablauf, DXF_LAYER.platte, DXF_LAYER.attika, DXF_LAYER.falt]) expect(doc.layer).toContain(l);
    expect(text).not.toContain("NaN");
    expect(text).toContain("\\U+00C4"); // Ä in Texten maskiert
  });
  it("Re-Import: Kontur ± 1 mm", () => {
    const k = flatten(doc, { layerSichtbar: new Set([DXF_LAYER.kontur]) });
    expect(k.segmente.length).toBe(6);
    const soll = m.dachflaechen[0]!.kontur;
    for (const [i, s] of k.segmente.entries()) {
      const a = soll[i]!, b = soll[(i + 1) % soll.length]!;
      const ok = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.hypot(p.x - q.x, p.y - q.y) < 0.001;
      expect((ok(s.a, a) && ok(s.b, b)) || (ok(s.a, b) && ok(s.b, a))).toBe(true);
    }
  });
  it("Re-Import: Plattenraster ± 1 mm (Gesamtfläche und Anzahl)", () => {
    const k = flatten(doc, { layerSichtbar: new Set([DXF_LAYER.platte, DXF_LAYER.zusatz]) });
    const soll = plan.dachflaechen.flatMap((d) => d.platten.flatMap((p) => [p.polygon.outer, ...p.polygon.holes]));
    expect(k.segmente.length).toBe(soll.reduce((s, q) => s + q.length, 0));
    const eck = new Set(soll.flat().map((v) => `${Math.round(v.x * 1000)},${Math.round(v.y * 1000)}`));
    for (const s of k.segmente) expect(eck.has(`${Math.round(s.a.x * 1000)},${Math.round(s.a.y * 1000)}`)).toBe(true);
  });
});
