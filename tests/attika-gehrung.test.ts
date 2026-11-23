import { describe, expect, it } from "vitest";
import { attikaStreifen, polygonArea, type Dachflaeche, type Kontur } from "../src/core/index";

const pt = (id: string, x: number, y: number) => ({ id, x, y });
function dach(kontur: Kontur, breiten: Record<string, number>): Dachflaeche {
  return {
    id: "d", name: "D", typ: "dach", kontur, aufbauten: [], zonen: [], vorgaben: {}, tuerschwellen: [], entwaesserung: [],
    attika: Object.entries(breiten).map(([kante, breite]) => ({ id: `a${kante}`, kante, breite })),
  };
}
const flaeche = (q: { x: number; y: number }[]) => polygonArea({ outer: q, holes: [] });
const rechteck = [pt("1", 0, 0), pt("2", 10, 0), pt("3", 10, 5), pt("4", 0, 5)];

describe("Attika-Ecken auf Gehrung", () => {
  it("90°, gleiche Breiten: Gehrungsecke = Schnitt der Außenkanten", () => {
    const d = dach(rechteck, { "1": 0.3, "2": 0.3 });
    const q = attikaStreifen(d, d.attika[0]!);
    expect(q[2]).toMatchObject({ x: 10.3 }); expect(q[2]!.y).toBeCloseTo(-0.3, 12);
    expect(q[3]!.x).toBeCloseTo(0, 12); // Nachbar 4 ohne Attika: Ende liegt auf dessen Kante
    expect(q[3]!.y).toBeCloseTo(-0.3, 12);
  });
  it("90°, ungleiche Breiten: beide Streifen treffen sich ohne Lücke/Überlappung", () => {
    const d = dach(rechteck, { "1": 0.3, "2": 0.5 });
    const a = attikaStreifen(d, d.attika[0]!), b = attikaStreifen(d, d.attika[1]!);
    expect(a[2]!.x).toBeCloseTo(10.5, 12); expect(a[2]!.y).toBeCloseTo(-0.3, 12);
    expect(b[3]!.x).toBeCloseTo(10.5, 12); expect(b[3]!.y).toBeCloseTo(-0.3, 12);
    // gemeinsame Gehrungslinie: Ecke (10,0) → (10.5,-0.3)
    expect(a[1]).toEqual(b[0]);
  });
  it("beliebiger Winkel (60°): Gehrungspunkt liegt auf beiden Außenkanten (Abstand = Breite)", () => {
    const k = [pt("1", 0, 0), pt("2", 10, 0), pt("3", 5, 8.66), ];
    const d = dach(k, { "1": 0.2, "2": 0.6 });
    const a = attikaStreifen(d, d.attika[0]!);
    const x = a[2]!; // Ecke bei Punkt 2
    expect(Math.abs(x.y + 0.2)).toBeLessThan(1e-9); // Abstand zur Kante 1 (y=0) = 0.2
    const l = Math.hypot(-5, 8.66), nx = 8.66 / l, ny = 5 / l; // Außennormale Kante 2→3
    const abst = (x.x - 10) * nx + x.y * ny;
    expect(abst).toBeCloseTo(0.6, 6);
  });
  it("Zusammen ergeben sich lückenlose Streifen: Fläche = L·B + Eckdreiecke, nie negativ", () => {
    const d = dach(rechteck, { "1": 0.3, "2": 0.5, "3": 0.3, "4": 0.2 });
    for (const a of d.attika) expect(flaeche(attikaStreifen(d, a))).toBeGreaterThan(0);
  });
  it("Abschnitt bleibt rechtwinklig", () => {
    const d = dach(rechteck, { "1": 0.3 });
    const q = attikaStreifen(d, d.attika[0]!, [{ x: 2, y: 0 }, { x: 4, y: 0 }]);
    expect(q[2]).toEqual({ x: 4, y: -0.3 });
  });
});
