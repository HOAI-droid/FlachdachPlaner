/**
 * PLAN R5 (A2 bei L/U-Formen): Der Abstand zum Ablauf läuft innerhalb der Dachkontur (geodätisch),
 * an reflexen Konturecken über die Ecke (d = d(x, Ecke) + d(Ecke, E)), nicht quer durch die Außenseite.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  computeCatchments, computeSlope, createProject, hoeheAm, intersection, pointInPolygon, polygonArea, union,
  type Dachflaeche, type Entwaesserung, type Kontur, type ProjectModel, type Vec2,
} from "../src/core/index";

const pt = (id: string, x: number, y: number) => ({ id, x, y });
const gully = (id: string, x: number, y: number, z = 0): Entwaesserung =>
  ({ id, art: "gully", name: id, typ: null, position: { x, y }, z });
function projekt(dach: Partial<Dachflaeche> & Pick<Dachflaeche, "kontur" | "entwaesserung">, gefaelle = 0.02): ProjectModel {
  const d: Dachflaeche = { id: "d1", name: "Dach", typ: "dach", aufbauten: [], zonen: [], vorgaben: {}, attika: [], tuerschwellen: [], ...dach };
  return { ...createProject("Test", "2026-01-01T00:00:00Z"), gefaelleStandard: gefaelle, dachflaechen: [d] };
}

/** L-Dach wie Nutzerbeobachtung: oberer Flügel 14 × 10 m, unterer Flügel 8 m breit, Innenecke rechts bei (8|10). */
const L_KONTUR: Kontur = [pt("a", 0, 0), pt("b", 8, 0), pt("c", 8, 10), pt("d", 14, 10), pt("e", 14, 20), pt("f", 0, 20)];
const E1 = gully("E1", 0.5, 19.5), E2 = gully("E2", 7.5, 0.5);
const L_DACH = projekt({ kontur: L_KONTUR, entwaesserung: [E1, E2] });
const FLAECHE = 8 * 10 + 14 * 10;
const linf = (p: Vec2, q: Vec2) => Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y));

describe("R5: geodätischer Abstand um die Innenecke (L-Dach, E1 oben links, E2 unten rechts)", () => {
  const g = computeSlope(L_DACH).dachflaechen[0]!;
  // Im Dreieck rechts oberhalb der Innenecke: Luftlinie zu E2 (9,8 m) läuft außerhalb des Dachs.
  const P = { x: 13.5, y: 10.3 };

  it("Zelle im Dreieck gehört zu E1 (rot), Höhe aus E1", () => {
    const f = g.facetten.find((x) => pointInPolygon(P, x.polygon) === "inside");
    expect(f?.ablaufId).toBe("E1");
    expect(hoeheAm(g.feld, P)).toBeCloseTo(0.02 * linf(P, E1.art === "gully" ? E1.position : P), 9);
  });

  it("keine Kehle/kein Grat zwischen E1 und E2 im oberen Flügel rechts der Innenecke", () => {
    const rechtsOben = (p: Vec2) => p.x > 8 + 1e-6 && p.y > 10 + 1e-6;
    const falsch = g.linien.filter((l) => l.ablaufIds.includes("E2") && l.ablaufIds.includes("E1") &&
      (rechtsOben(l.von) || rechtsOben(l.bis) || rechtsOben({ x: (l.von.x + l.bis.x) / 2, y: (l.von.y + l.bis.y) / 2 })));
    expect(falsch).toEqual([]);
  });

  it("Einzugsfläche E2 reicht nicht in den oberen Flügel rechts der Innenecke", () => {
    const c = computeCatchments(L_DACH, computeSlope(L_DACH));
    const e2 = c.flaechen.find((f) => f.ablaufId === "E2")!;
    const ecke = { outer: [{ x: 8, y: 10 }, { x: 14, y: 10 }, { x: 14, y: 20 }, { x: 8, y: 20 }], holes: [] };
    const teil = intersection(e2.polygone, [ecke]).reduce((s, p) => s + polygonArea(p), 0);
    expect(teil).toBeLessThan(1e-3);
    expect(c.flaechen.reduce((s, f) => s + f.dachFlaeche, 0)).toBeCloseTo(FLAECHE, 2);
  });

  it("Höhe in der Ecke: über die Innenecke gerechnet, Koten an der rechten Kante aus E1", () => {
    // Ecke (14|10): E1 13,5 m → +0,270; über die Innenecke zu E2 wäre 9,5 + 6 = 15,5 m.
    const k = g.koten.find((x) => Math.hypot(x.position.x - 14, x.position.y - 10) < 1e-6);
    expect(k?.kote).toBeCloseTo(0.27, 9);
    expect(g.hochpunkt?.kote).toBeCloseTo(0.27, 9);
  });

  it("Facetten lückenlos und überlappungsfrei, Summe = Dachfläche", () => {
    const summe = g.facetten.reduce((s, f) => s + f.flaeche, 0);
    const vereinigt = union(g.facetten.map((f) => f.polygon)).reduce((s, p) => s + polygonArea(p), 0);
    expect(summe).toBeCloseTo(FLAECHE, 2);
    expect(vereinigt).toBeCloseTo(FLAECHE, 2);
  });

  it("deterministisch", () => {
    expect(JSON.stringify(computeSlope(L_DACH))).toBe(JSON.stringify(computeSlope(L_DACH)));
  });
});

describe("R5: Eigenschaften (L- und U-Dächer, zufällige Gullys)", () => {
  const zahl = (min: number, max: number) => fc.double({ min, max, noNaN: true, noDefaultInfinity: true });
  /** U-Dach: Schenkel 4 m breit, Basis 4 m hoch, Gesamtbreite 14 m, Höhe 12 m. */
  const U_KONTUR: Kontur = [pt("a", 0, 0), pt("b", 14, 0), pt("c", 14, 12), pt("d", 10, 12), pt("e", 10, 4), pt("f", 4, 4), pt("g", 4, 12), pt("h", 0, 12)];
  const formen = [
    { kontur: L_KONTUR, flaeche: FLAECHE, teile: [[0, 0, 8, 10], [0, 10, 14, 20]] },
    { kontur: U_KONTUR, flaeche: 14 * 4 + 2 * 4 * 8, teile: [[0, 0, 14, 4], [0, 4, 4, 12], [10, 4, 14, 12]] },
  ] as const;
  const fall = fc.record({
    form: fc.constantFrom(0, 1),
    gullys: fc.array(fc.record({ fx: zahl(0.02, 0.98), fy: zahl(0.02, 0.98), z: zahl(-0.1, 0.1) }), { minLength: 1, maxLength: 3 }),
    s: zahl(0.01, 0.05),
  });

  it("Flächensumme = Dachfläche, lückenlos; Höhe stetig (Lipschitz s·L∞ in jedem konvexen Teil)", () => {
    fc.assert(fc.property(fall, zahl(0, 1), zahl(0, 1), zahl(0, 1), zahl(0, 1), (f, a, b, c, d) => {
      const form = formen[f.form]!;
      // Gullys in ein Teilrechteck legen (Teil per Index), damit sie im Dach liegen.
      const ent = f.gullys.map((x, i) => {
        const [x0, y0, x1, y1] = form.teile[i % form.teile.length]!;
        return gully(`g${i}`, x0 + x.fx * (x1 - x0), y0 + x.fy * (y1 - y0), x.z);
      });
      const m = projekt({ kontur: form.kontur, entwaesserung: ent }, f.s);
      const g = computeSlope(m).dachflaechen[0]!;
      const summe = g.facetten.reduce((s, x) => s + x.flaeche, 0);
      expect(Math.abs(summe - form.flaeche)).toBeLessThanOrEqual(0.01);
      const vereinigt = union(g.facetten.map((x) => x.polygon)).reduce((s, p) => s + polygonArea(p), 0);
      expect(Math.abs(vereinigt - form.flaeche)).toBeLessThanOrEqual(0.01);
      for (const [x0, y0, x1, y1] of form.teile) {
        const p = { x: x0 + a * (x1 - x0), y: y0 + b * (y1 - y0) }, q = { x: x0 + c * (x1 - x0), y: y0 + d * (y1 - y0) };
        expect(Math.abs(hoeheAm(g.feld, p) - hoeheAm(g.feld, q))).toBeLessThanOrEqual(f.s * linf(p, q) + 1e-9);
      }
      // Facettenebene = Höhenfeld im Facetteninneren (Koten stetig, keine Sprünge an Teilgrenzen).
      for (const x of g.facetten) {
        for (const v of x.polygon.outer) {
          expect(Math.abs(x.ebene.a * v.x + x.ebene.b * v.y + x.ebene.c - hoeheAm(g.feld, v))).toBeLessThanOrEqual(1e-5);
        }
      }
    }), { numRuns: 40, seed: 11 });
  });
});
