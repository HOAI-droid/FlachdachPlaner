import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { flatten, parseDxf, sehnenAnzahl } from "../src/io/dxf";
import { createSnapIndex, snap } from "../src/core/snap";

const doc = parseDxf(readFileSync("tests/fixtures/unterlage.dxf", "utf8"));
const MM = 0.001;
const laenge = (s: { a: { x: number; y: number }; b: { x: number; y: number } }) => Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);

describe("DXF-Parser", () => {
  it("liest $INSUNITS, Layer und Blöcke", () => {
    expect(doc.insunits).toBe(4);
    expect(doc.layer).toEqual(["0", "ACHSE", "HILFE", "MOEBEL", "WAND"]);
    expect(doc.bloecke.get("TISCH")?.entitaeten).toHaveLength(2);
  });
  it("rechnet mm in Meter um (LINE, LWPOLYLINE geschlossen)", () => {
    const { segmente, einheitBekannt } = flatten(doc);
    expect(einheitBekannt).toBe(true);
    const wand = segmente.filter((s) => s.layer === "WAND" && s.a.x < 11 && s.a.y > -0.5);
    const rechteck = wand.filter((s) => s.a.y >= 0 && s.b.y >= 0 && s.a.x <= 10 && s.b.x <= 10);
    expect(rechteck).toHaveLength(4);
    expect(rechteck.reduce((a, s) => a + laenge(s), 0)).toBeCloseTo(30, 3);
    const hilfe = segmente.filter((s) => s.layer === "HILFE");
    expect(hilfe).toHaveLength(1);
    expect(laenge(hilfe[0]!)).toBeCloseTo(5, 3);
  });
  it("Bulge 1 = Halbkreis r = 1 m, Sehnenfehler ≤ 1 mm, Maße ± 1 mm", () => {
    const { segmente } = flatten(doc);
    const bg = segmente.filter((s) => s.layer === "WAND" && s.a.x >= 12 - 1e-9);
    expect(bg.length).toBeGreaterThan(8);
    for (const s of bg) {
      expect(Math.hypot(s.a.x - 13, s.a.y)).toBeCloseTo(1, 6);
      const sagitta = 1 - Math.sqrt(1 - (laenge(s) / 2) ** 2);
      expect(sagitta).toBeLessThanOrEqual(MM + 1e-9);
    }
    expect(bg[0]!.a).toEqual({ x: 12, y: 0 });
    const ende = bg[bg.length - 1]!.b;
    expect(Math.hypot(ende.x - 14, ende.y)).toBeLessThan(MM);
    expect(Math.min(...bg.map((s) => s.a.y))).toBeCloseTo(-1, 2); // positiver Bulge → Bogen unterhalb (CCW)
    expect(Math.abs(bg.reduce((a, s) => a + laenge(s), 0) - Math.PI)).toBeLessThan(0.003);
  });
  it("ARC (0°–90°, r = 2 m) und CIRCLE (r = 0,5 m)", () => {
    const { segmente } = flatten(doc);
    const arc = segmente.filter((s) => s.layer === "ACHSE" && s.a.x < 5);
    expect(arc[0]!.a.x).toBeCloseTo(2, 6); expect(arc[0]!.a.y).toBeCloseTo(8, 6);
    expect(arc[arc.length - 1]!.b.x).toBeCloseTo(0, 6); expect(arc[arc.length - 1]!.b.y).toBeCloseTo(10, 6);
    expect(arc.reduce((a, s) => a + laenge(s), 0)).toBeCloseTo(Math.PI, 2);
    const kreis = segmente.filter((s) => s.layer === "ACHSE" && s.a.x > 5);
    for (const s of kreis) expect(Math.hypot(s.a.x - 20, s.a.y)).toBeCloseTo(0.5, 6);
    expect(Math.abs(kreis.reduce((a, s) => a + laenge(s), 0) - Math.PI)).toBeLessThan(0.003); // eingeschriebenes Vieleck
    expect(sehnenAnzahl(2, Math.PI / 2, MM)).toBeGreaterThan(10);
  });
  it("INSERT mit Skalierung 2 und Drehung 90°, Layer-Vererbung von „0“", () => {
    const { segmente } = flatten(doc);
    const m = segmente.filter((s) => s.layer === "MOEBEL");
    expect(m).toHaveLength(2);
    expect(m[0]!.a.x).toBeCloseTo(0, 6); expect(m[0]!.a.y).toBeCloseTo(-3, 6);
    expect(m[0]!.b.x).toBeCloseTo(0, 6); expect(m[0]!.b.y).toBeCloseTo(-1, 6);
    expect(m[1]!.b.x).toBeCloseTo(-1, 6); expect(m[1]!.b.y).toBeCloseTo(-1, 6);
  });
  it("Layer ein/aus", () => {
    const an = new Set(["WAND"]);
    const { segmente } = flatten(doc, { layerSichtbar: an });
    expect(segmente.every((s) => s.layer === "WAND")).toBe(true);
    expect(flatten(doc, { layerSichtbar: new Set() }).segmente).toHaveLength(0);
  });
  it("fangbar: Endpunkt, Mittelpunkt, Kreis- und Blockpunkte", () => {
    const { segmente } = flatten(doc);
    const idx = createSnapIndex(segmente);
    const ecke = snap(idx, { x: 10.003, y: 5.002 }, 0.02);
    expect(ecke?.art).toBe("endpunkt");
    expect(ecke!.punkt.x).toBeCloseTo(10, 6); expect(ecke!.punkt.y).toBeCloseTo(5, 6);
    const mitte = snap(idx, { x: 5.004, y: 0.003 }, 0.02, { arten: ["mittelpunkt"] });
    expect(mitte?.art).toBe("mittelpunkt");
    expect(mitte!.punkt.x).toBeCloseTo(5, 6);
    const block = snap(idx, { x: -1.002, y: -0.998 }, 0.02);
    expect(block?.art).toBe("endpunkt");
    expect(block!.punkt.x).toBeCloseTo(-1, 6);
  });
  it("ohne $INSUNITS: Annahme 1 Einheit = 1 m, einheitBekannt = false", () => {
    const d = parseDxf("0\nSECTION\n2\nENTITIES\n0\nLINE\n8\n0\n10\n0\n20\n0\n11\n3\n21\n4\n0\nENDSEC\n0\nEOF\n");
    const r = flatten(d);
    expect(r.einheitBekannt).toBe(false);
    expect(laenge(r.segmente[0]!)).toBeCloseTo(5, 9);
  });
});
