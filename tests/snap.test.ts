import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  createSnapIndex, distPointSegment, querySegments, snap, type SnapSegment, type Vec2,
} from "../src/core/index";

const v = (x: number, y: number): Vec2 => ({ x, y });
const seg = (ax: number, ay: number, bx: number, by: number): SnapSegment => ({ a: v(ax, ay), b: v(bx, by) });
/** Kreuz: waagerecht 0..10 auf y=5, senkrecht x=3 von 0..10. */
const kreuz = [seg(0, 5, 10, 5), seg(3, 0, 3, 10)];

describe("Punktfang je Fangart", () => {
  it("Endpunkt", () => {
    const t = snap(createSnapIndex(kreuz), v(9.95, 5.04), 0.1);
    expect(t).toMatchObject({ art: "endpunkt", punkt: v(10, 5), segmente: [0] });
    expect(t!.abstand).toBeCloseTo(Math.hypot(0.05, 0.04), 12);
  });
  it("Mittelpunkt", () => {
    const t = snap(createSnapIndex(kreuz), v(5.02, 5.01), 0.1);
    expect(t).toMatchObject({ art: "mittelpunkt", punkt: v(5, 5), segmente: [0] });
  });
  it("Schnittpunkt", () => {
    const t = snap(createSnapIndex(kreuz), v(3.05, 5.05), 0.1);
    expect(t).toMatchObject({ art: "schnittpunkt", segmente: [0, 1] });
    expect(t!.punkt.x).toBeCloseTo(3, 12);
    expect(t!.punkt.y).toBeCloseTo(5, 12);
  });
  it("Lot vom Referenzpunkt", () => {
    const idx = createSnapIndex([seg(0, 0, 10, 0)]);
    const t = snap(idx, v(7.03, 0.02), 0.1, { referenzpunkt: v(7, 4) });
    expect(t).toMatchObject({ art: "lot", segmente: [0] });
    expect(t!.punkt.x).toBeCloseTo(7, 12);
    expect(t!.punkt.y).toBeCloseTo(0, 12);
    // Lotfuß außerhalb des Segments → kein Lot.
    expect(snap(idx, v(10.0, 0.02), 0.01, { referenzpunkt: v(12, 4), arten: ["lot"] })).toBeNull();
  });
  it("Ortho (Achse 0 und gedreht)", () => {
    const leer = createSnapIndex([]);
    const t = snap(leer, v(5, 1.05), 0.1, { referenzpunkt: v(1, 1) });
    expect(t).toMatchObject({ art: "ortho", punkt: v(5, 1), segmente: [] });
    expect(t!.abstand).toBeCloseTo(0.05, 12);
    const s = snap(leer, v(1.04, -4), 0.1, { referenzpunkt: v(1, 1) });
    expect(s!.punkt.x).toBeCloseTo(1, 12);
    expect(s!.punkt.y).toBeCloseTo(-4, 12);
    const g = snap(leer, v(3.02, 2.98), 0.1, { referenzpunkt: v(0, 0), orthoAchse: Math.PI / 4 });
    expect(g!.punkt.x).toBeCloseTo(3, 12);
    expect(g!.punkt.y).toBeCloseTo(3, 12);
    expect(snap(leer, v(5, 2), 0.1, { referenzpunkt: v(1, 1) })).toBeNull();
  });
});

describe("Prioritäten", () => {
  // Kurzes Segment: End-, Mittel-, Schnittpunkt liegen alle im Toleranzkreis.
  const segs = [seg(0, 0, 0.1, 0), seg(0.04, -1, 0.04, 1)];
  const idx = createSnapIndex(segs);
  const p = v(0.05, 0.001);
  it("End > Schnitt > Mitte > Lot > Ortho", () => {
    const opt = { referenzpunkt: v(0.05, 3) };
    expect(snap(idx, p, 0.2, opt)!.art).toBe("endpunkt");
    expect(snap(idx, p, 0.2, { ...opt, arten: ["schnittpunkt", "mittelpunkt", "lot", "ortho"] })!.art).toBe("schnittpunkt");
    expect(snap(idx, p, 0.2, { ...opt, arten: ["mittelpunkt", "lot", "ortho"] })!.art).toBe("mittelpunkt");
    expect(snap(idx, p, 0.2, { ...opt, arten: ["lot", "ortho"] })!.art).toBe("lot");
    expect(snap(idx, p, 0.2, { ...opt, arten: ["ortho"] })!.art).toBe("ortho");
  });
  it("Endpunkt schlägt näheren Mittelpunkt", () => {
    const t = snap(createSnapIndex([seg(0, 0, 1, 0)]), v(0.5, 0), 0.6);
    expect(t!.art).toBe("endpunkt");
  });
  it("innerhalb einer Art gewinnt der nächste Punkt, bei Gleichstand kleinster Index", () => {
    const i2 = createSnapIndex([seg(0, 0, 1, 0), seg(1.2, 0, 3, 0)]);
    expect(snap(i2, v(1.15, 0), 0.3)).toMatchObject({ punkt: v(1.2, 0), segmente: [1] });
    const gleich = createSnapIndex([seg(5, 5, 6, 5), seg(5, 5, 5, 6)]);
    expect(snap(gleich, v(5, 5), 0.1)!.segmente).toEqual([0]);
  });
});

describe("Toleranz und Randfälle", () => {
  const idx = createSnapIndex(kreuz);
  it("knapp außerhalb kein Treffer, genau auf Grenze Treffer", () => {
    expect(snap(idx, v(10.11, 5), 0.1, { arten: ["endpunkt"] })).toBeNull();
    expect(snap(idx, v(10.0625, 5), 0.0625, { arten: ["endpunkt"] })!.art).toBe("endpunkt");
  });
  it("Toleranz skaliert (Weltmeter): größere Toleranz fängt weiter", () => {
    expect(snap(idx, v(10.5, 5), 0.4)).toBeNull();
    expect(snap(idx, v(10.5, 5), 0.6)!.art).toBe("endpunkt");
  });
  it("leere Eingabe", () => {
    const leer = createSnapIndex([]);
    expect(snap(leer, v(0, 0), 1)).toBeNull();
    expect(querySegments(leer, v(0, 0), 1)).toEqual([]);
  });
  it("ungültige Toleranz/Punkt, nicht-endliche Segmente, entartete Segmente", () => {
    expect(snap(idx, v(10, 5), -1)).toBeNull();
    expect(snap(idx, v(10, 5), NaN)).toBeNull();
    expect(snap(idx, v(NaN, 5), 1)).toBeNull();
    const i2 = createSnapIndex([seg(NaN, 0, 1, 1), seg(2, 2, 2, 2)]);
    expect(snap(i2, v(2.01, 2), 0.1)).toMatchObject({ art: "endpunkt", segmente: [1] });
    expect(snap(i2, v(2.01, 2), 0.1, { arten: ["lot"], referenzpunkt: v(0, 0) })).toBeNull();
  });
  it("Punkt außerhalb der Index-Ausdehnung", () => {
    expect(snap(idx, v(500, 500), 1)).toBeNull();
    expect(snap(idx, v(-0.05, 5), 0.1)!.punkt).toEqual(v(0, 5));
  });
});

describe("Spatial-Index (Eigenschaft)", () => {
  // Auf µm gerundet: keine subnormalen Zahlen (Gleitkomma-Randfall, z. B. 5e-324, ohne Praxisbezug; ließ den CI-Lauf zufällig rot werden).
  const coord = fc.double({ min: -50, max: 50, noNaN: true }).map((x) => Math.round(x * 1e6) / 1e6);
  const segArb = fc.tuple(coord, coord, coord, coord).map(([a, b, c, d]) => seg(a, b, c, d));
  it("querySegments = Brute-Force", () => {
    fc.assert(fc.property(
      fc.array(segArb, { minLength: 1, maxLength: 60 }), coord, coord, fc.double({ min: 0, max: 20, noNaN: true }),
      fc.option(fc.double({ min: 0.05, max: 30, noNaN: true }), { nil: undefined }),
      (segs, px, py, r, zellgroesse) => {
        const idx = createSnapIndex(segs, { zellgroesse });
        const p = v(px, py);
        const erwartet = segs.flatMap((s, i) => (distPointSegment(p, s.a, s.b) <= r ? [i] : []));
        expect(querySegments(idx, p, r)).toEqual(erwartet);
      }), { numRuns: 300 });
  });
  it("Treffer liegt immer innerhalb der Toleranz", () => {
    fc.assert(fc.property(fc.array(segArb, { maxLength: 30 }), coord, coord, fc.double({ min: 0, max: 5, noNaN: true }),
      (segs, px, py, tol) => {
        const t = snap(createSnapIndex(segs), v(px, py), tol, { referenzpunkt: v(0, 0) });
        if (t) expect(t.abstand).toBeLessThanOrEqual(tol);
      }), { numRuns: 200 });
  });
});

describe("Leistung", () => {
  it("Median-Suche < 2 ms bei 20 000 Segmenten", () => {
    // Deterministischer Pseudozufall (LCG): Unterlage 300×300 m, Segmente 0,2–5 m + 200 lange Linien.
    let s = 12345;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000);
    const segs: SnapSegment[] = [];
    for (let i = 0; i < 19800; i++) {
      const x = rnd() * 300, y = rnd() * 300, w = rnd() * 2 * Math.PI, l = 0.2 + rnd() * 4.8;
      segs.push(seg(x, y, x + l * Math.cos(w), y + l * Math.sin(w)));
    }
    for (let i = 0; i < 200; i++) segs.push(seg(rnd() * 300, 0, rnd() * 300, 300));
    const idx = createSnapIndex(segs);
    const zeiten: number[] = [];
    for (let i = 0; i < 500; i++) {
      const p = v(rnd() * 300, rnd() * 300);
      const t0 = performance.now();
      snap(idx, p, 0.5, { referenzpunkt: v(150, 150) });
      zeiten.push(performance.now() - t0);
    }
    zeiten.sort((a, b) => a - b);
    const median = zeiten[zeiten.length >> 1]!;
    console.info(`snap Median ${(median * 1000).toFixed(1)} µs, p95 ${(zeiten[475]! * 1000).toFixed(1)} µs`);
    expect(median).toBeLessThan(2);
  });
});
