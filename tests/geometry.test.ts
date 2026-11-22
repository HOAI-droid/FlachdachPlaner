import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  EPS, difference, distPointSegment, intersection, offset, orientation, pointInPolygon,
  pointInRing, polygonArea, polygonCentroid, ringArea, ringCentroid, segmentIntersection,
  signedArea, union, type Polygon, type Ring, type Vec2,
} from "../src/core/index";

const v = (x: number, y: number): Vec2 => ({ x, y });
const rect = (x0: number, y0: number, w: number, h: number): Ring =>
  [v(x0, y0), v(x0 + w, y0), v(x0 + w, y0 + h), v(x0, y0 + h)];
const poly = (outer: Ring, holes: Ring[] = []): Polygon => ({ outer, holes });
const total = (ps: Polygon[]) => ps.reduce((s, p) => s + polygonArea(p), 0);

/** Referenz-L-Dach: 20×10 minus Ecke 8×4 oben rechts. */
const L: Ring = [v(0, 0), v(20, 0), v(20, 6), v(12, 6), v(12, 10), v(0, 10)];

describe("Fläche und Orientierung", () => {
  it("EPS ist zentral 1e-9 m", () => expect(EPS).toBe(1e-9));
  it("Rechteck 20×10 = 200 m²", () => {
    expect(ringArea(rect(0, 0, 20, 10))).toBe(200);
    expect(signedArea(rect(0, 0, 20, 10))).toBe(200);
  });
  it("CW-Ring hat negative signierte Fläche", () => {
    const cw = [...rect(0, 0, 20, 10)].reverse();
    expect(signedArea(cw)).toBe(-200);
    expect(orientation(cw)).toBe(-1);
    expect(orientation(rect(0, 0, 20, 10))).toBe(1);
    expect(orientation([v(0, 0), v(1, 1), v(2, 2)])).toBe(0);
  });
  it("Referenz-L-Dach exakt 168 m²", () => expect(ringArea(L)).toBe(168));
  it("Referenz-L-Dach aus Referenzbild 10,60 × 15,30 m (Rechteckanteil)", () => {
    expect(ringArea(rect(0, 0, 10.6, 15.3))).toBeCloseTo(162.18, 12);
  });
  it("Polygon mit Loch: 200 − 2×3 = 194 m²", () => {
    expect(polygonArea(poly(rect(0, 0, 20, 10), [rect(5, 5, 2, 3)]))).toBe(194);
  });
  it("Fläche invariant unter Verschiebung und Drehung (fast-check)", () => {
    fc.assert(fc.property(
      fc.double({ min: -1000, max: 1000, noNaN: true }),
      fc.double({ min: -1000, max: 1000, noNaN: true }),
      fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
      fc.constantFrom(L, rect(0, 0, 20, 10)),
      (dx, dy, phi, ring) => {
        const c = Math.cos(phi), s = Math.sin(phi);
        const moved = ring.map((p) => v(c * p.x - s * p.y + dx, s * p.x + c * p.y + dy));
        const a0 = ringArea(ring);
        return Math.abs(ringArea(moved) - a0) <= 1e-9 * a0;
      },
    ));
  });
});

describe("Punkt-in-Polygon", () => {
  const P = poly(L, [rect(2, 2, 2, 2)]);
  it("innen, außen, Rand, Ecke", () => {
    expect(pointInRing(v(5, 5), L)).toBe("inside");
    expect(pointInRing(v(15, 8), L)).toBe("outside"); // ausgeschnittene Ecke
    expect(pointInRing(v(16, 6), L)).toBe("boundary");
    expect(pointInRing(v(12, 6), L)).toBe("boundary"); // einspringende Ecke
    expect(pointInRing(v(0, 0), L)).toBe("boundary");
    expect(pointInRing(v(20, 3 + EPS / 2), L)).toBe("boundary"); // innerhalb EPS
    expect(pointInRing(v(20 + 1e-6, 3), L)).toBe("outside");
  });
  it("Strahl durch Eckpunkt zählt korrekt", () => {
    expect(pointInRing(v(-1, 6), L)).toBe("outside");
    expect(pointInRing(v(11, 6), L)).toBe("inside");
  });
  it("Löcher: Lochinneres außen, Lochrand Rand", () => {
    expect(pointInPolygon(v(3, 3), P)).toBe("outside");
    expect(pointInPolygon(v(2, 3), P)).toBe("boundary");
    expect(pointInPolygon(v(5, 3), P)).toBe("inside");
  });
});

describe("Abstände und Segmentschnitt", () => {
  it("Punkt-Segment-Abstand: lotrecht, jenseits Endpunkt, entartet", () => {
    expect(distPointSegment(v(5, 3), v(0, 0), v(10, 0))).toBe(3);
    expect(distPointSegment(v(13, 4), v(0, 0), v(10, 0))).toBe(5);
    expect(distPointSegment(v(3, 4), v(0, 0), v(0, 0))).toBe(5);
  });
  it("Kreuzung", () => {
    const r = segmentIntersection(v(0, 0), v(10, 10), v(0, 10), v(10, 0));
    expect(r).toEqual({ kind: "point", point: v(5, 5), t: 0.5, u: 0.5 });
  });
  it("Berührung am Endpunkt, T-Stoß, kein Schnitt", () => {
    expect(segmentIntersection(v(0, 0), v(1, 0), v(1, 0), v(2, 5)).kind).toBe("point");
    const t = segmentIntersection(v(0, 0), v(10, 0), v(4, 0), v(4, 3));
    expect(t.kind === "point" && t.point).toEqual(v(4, 0));
    expect(segmentIntersection(v(0, 0), v(1, 0), v(2, -1), v(2, 1)).kind).toBe("none");
  });
  it("parallel, kollinear überlappend, kollinear berührend", () => {
    expect(segmentIntersection(v(0, 0), v(10, 0), v(0, 1), v(10, 1)).kind).toBe("none");
    expect(segmentIntersection(v(0, 0), v(10, 0), v(12, 0), v(4, 0)))
      .toEqual({ kind: "overlap", from: v(4, 0), to: v(10, 0) });
    const touch = segmentIntersection(v(0, 0), v(10, 0), v(10, 0), v(15, 0));
    expect(touch.kind === "point" && touch.point).toEqual(v(10, 0));
    expect(segmentIntersection(v(0, 0), v(10, 0), v(11, 0), v(15, 0)).kind).toBe("none");
  });
  it("Schnittpunkt liegt auf beiden Segmenten (fast-check)", () => {
    const pt = fc.record({ x: fc.integer({ min: -100, max: 100 }), y: fc.integer({ min: -100, max: 100 }) });
    fc.assert(fc.property(pt, pt, pt, pt, (a, b, c, d) => {
      const r = segmentIntersection(a, b, c, d);
      if (r.kind !== "point") return true;
      return distPointSegment(r.point, a, b) <= 1e-9 * 200 && distPointSegment(r.point, c, d) <= 1e-9 * 200;
    }));
  });
});

describe("Schwerpunkt", () => {
  it("Rechteck und L-Dach", () => {
    expect(ringCentroid(rect(0, 0, 20, 10))).toEqual(v(10, 5));
    // L = 200 m² @ (10|5) minus 32 m² @ (16|8)
    const c = ringCentroid(L);
    expect(c.x).toBeCloseTo((200 * 10 - 32 * 16) / 168, 12);
    expect(c.y).toBeCloseTo((200 * 5 - 32 * 8) / 168, 12);
  });
  it("mit Loch, unabhängig von der Orientierung", () => {
    const c = polygonCentroid(poly([...rect(0, 0, 20, 10)].reverse(), [rect(0, 0, 10, 10)]));
    expect(c.x).toBeCloseTo(15, 12);
    expect(c.y).toBeCloseTo(5, 12);
  });
  it("entartet: Eckpunktmittel", () => {
    expect(ringCentroid([v(0, 0), v(2, 0), v(4, 0)])).toEqual(v(2, 0));
  });
});

describe("Clipper-Adapter", () => {
  const R = poly(rect(0, 0, 20, 10));
  it("Differenz Rechteck − Ecke = L-Dach 168 m²", () => {
    const d = difference([R], [poly(rect(12, 6, 8, 4))]);
    expect(d).toHaveLength(1);
    expect(polygonArea(d[0]!)).toBeCloseTo(168, 9);
    expect(orientation(d[0]!.outer)).toBe(1);
  });
  it("Differenz mit innenliegendem Aufbau liefert Loch (CW)", () => {
    const d = difference([R], [poly(rect(5, 5, 2, 3))]);
    expect(d).toHaveLength(1);
    expect(d[0]!.holes).toHaveLength(1);
    expect(orientation(d[0]!.holes[0]!)).toBe(-1);
    expect(polygonArea(d[0]!)).toBeCloseTo(194, 9);
  });
  it("Union und Schnitt überlappender Rechtecke", () => {
    const a = poly(rect(0, 0, 10, 10)), b = poly(rect(5, 5, 10, 10));
    expect(total(union([a], [b]))).toBeCloseTo(175, 9);
    expect(total(intersection([a], [b]))).toBeCloseTo(25, 9);
    expect(total(union([a, b]))).toBeCloseTo(175, 9);
    expect(intersection([a], [poly(rect(20, 20, 1, 1))])).toEqual([]);
  });
  it("Eingabe im Uhrzeigersinn wird normalisiert", () => {
    expect(total(union([poly([...rect(0, 0, 20, 10)].reverse())]))).toBeCloseTo(200, 9);
  });
  it("deterministisch: gleiche Eingabe → identisches Ergebnis", () => {
    const run = () => difference([poly(L)], [poly(rect(1, 1, 2, 2))]);
    expect(run()).toEqual(run());
  });

  /*
   * Attika-Streifen b = 0,30 m um das Dach 20×10 (Umfang 60 m). Erwartung PLAN Schritt 7: 18,0 m² = Länge × b.
   * Die drei Offset-Varianten unterscheiden sich nur in den 4 Ecken (je ±b² = 0,09 m²):
   *   außen (Dach + b) − Dach  = 20,6·10,6 − 200 = 18,36 m²  (Ecken doppelt gezählt: +4b²)
   *   Dach − innen (Dach − b)  = 200 − 19,4·9,4  = 17,64 m²  (Ecken fehlen: −4b²)
   *   symmetrisch ±b/2 um Kontur = 20,3·10,3 − 19,7·9,7 = 18,00 m² = 60 m · 0,30 m
   * Festlegung: Die Attika liegt außerhalb der Dachkontur (Dach bleibt 200 m², Gesamt 218 m²);
   * ihre Fläche ist Konturlänge × b (Mittellinien-Ansatz, Ecken weder doppelt noch fehlend),
   * was der symmetrischen Streifenfläche entspricht. Miter-Offset nach außen allein ergäbe 18,36 m².
   */
  describe("Attika-Streifen 0,30 m um 20×10", () => {
    const b = 0.3;
    const strip = (outer: number, inner: number) =>
      total(difference(offset([R], outer), offset([R], inner)));
    it("Offset nach außen (Miter) vergrößert auf 20,6 × 10,6", () => {
      const o = offset([R], b);
      expect(o).toHaveLength(1);
      expect(polygonArea(o[0]!)).toBeCloseTo(20.6 * 10.6, 9);
    });
    it("Offset nach innen verkleinert auf 19,4 × 9,4", () => {
      expect(total(offset([R], -b))).toBeCloseTo(19.4 * 9.4, 9);
    });
    it("Streifen außen 18,36 m², innen 17,64 m²", () => {
      expect(strip(b, 0)).toBeCloseTo(18.36, 9);
      expect(strip(0, -b)).toBeCloseTo(17.64, 9);
    });
    it("Streifen symmetrisch um Kontur = Länge × b = 18,0 m²", () => {
      expect(strip(b / 2, -b / 2)).toBeCloseTo(18.0, 9);
      expect(strip(b / 2, -b / 2)).toBeCloseTo(60 * b, 9);
    });
    it("Streifen ist Ring mit Loch", () => {
      const s = difference(offset([R], b), [R]);
      expect(s).toHaveLength(1);
      expect(s[0]!.holes).toHaveLength(1);
    });
    it("Round-Join außen: 200 + 60·b + π·b² (Toleranz Sehnenfehler)", () => {
      expect(total(offset([R], b, { join: "round" }))).toBeCloseTo(200 + 60 * b + Math.PI * b * b, 2);
    });
  });
  it("Flächenbilanz der Booleschen Operationen (fast-check, Raster 1 cm)", () => {
    const r = fc.tuple(
      fc.integer({ min: -2000, max: 2000 }), fc.integer({ min: -2000, max: 2000 }),
      fc.integer({ min: 1, max: 2000 }), fc.integer({ min: 1, max: 2000 }),
    ).map(([x, y, w, h]) => poly(rect(x / 100, y / 100, w / 100, h / 100)));
    fc.assert(fc.property(r, r, (a, b) => {
      const A = polygonArea(a), B = polygonArea(b);
      const U = total(union([a], [b])), I = total(intersection([a], [b])), D = total(difference([a], [b]));
      return Math.abs(U + I - A - B) <= 1e-6 && Math.abs(D - (A - I)) <= 1e-6;
    }));
  });
  it("Offset nach innen bis zum Verschwinden → leer", () => {
    expect(offset([R], -6)).toEqual([]);
  });
});
