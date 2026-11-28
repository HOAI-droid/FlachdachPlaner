import { describe, expect, it } from "vitest";
import {
  attikaSegmentFlaeche, attikaStreifen, computeCatchments, computeSlope, createProject, pointInPolygon, validateProject,
  type Dachflaeche, type ProjectModel,
} from "../src/core/index";
import { baueProjektDxf, DXF_LAYER, flatten, parseDxf } from "../src/io/dxf";

const pt = (id: string, x: number, y: number) => ({ id, x, y });
const modell = (uhrzeiger = false, attika = true): ProjectModel => {
  const k = [pt("a", 0, 0), pt("b", 10, 0), pt("c", 10, 6), pt("d", 0, 6)];
  const d: Dachflaeche = {
    id: "d1", name: "Dach", typ: "dach", aufbauten: [], zonen: [], vorgaben: {}, tuerschwellen: [],
    kontur: uhrzeiger ? [...k].reverse() : k, attika: attika ? [{ id: "at1", kante: "a", breite: 0.3, oberkante: 0.5 }] : [],
    entwaesserung: [{ id: "g1", art: "gully", name: "G1", typ: null, position: { x: 5, y: 3 }, z: 0 }],
  };
  return { ...createProject("T", "2026-01-01T00:00:00Z"), gefaelleStandard: 0.02, dachflaechen: [d] };
};
const dach = (m: ProjectModel) => m.dachflaechen[0]!;
const innen = (m: ProjectModel, p: { x: number; y: number }) => pointInPolygon(p, { outer: dach(m).kontur, holes: [] }) === "inside";

describe("Attika immer außen, nur Entwässerungsfläche", () => {
  for (const uz of [false, true]) {
    it(`attikaStreifen liegt außerhalb der Kontur (Kontur ${uz ? "im" : "gegen"} Uhrzeigersinn)`, () => {
      const m = modell(uz);
      const q = attikaStreifen(dach(m), dach(m).attika[0]!);
      expect(q).toHaveLength(4);
      const mitte = { x: (q[0]!.x + q[1]!.x + q[2]!.x + q[3]!.x) / 4, y: (q[0]!.y + q[1]!.y + q[2]!.y + q[3]!.y) / 4 };
      expect(innen(m, mitte)).toBe(false);
      // Kante a liegt auf y = 0 (bzw. x = 0 bei umgekehrter Kontur), Streifen 0,3 m nach außen.
      expect(Math.min(mitte.x, mitte.y)).toBeCloseTo(-0.15, 9);
      expect(Math.min(...q.map((p) => Math.min(p.x, p.y)))).toBeCloseTo(-0.3, 9);
    });
  }

  it("Altdaten mit seite (innen/aussen/unbekannt) bleiben gültig, Streifen trotzdem außen", () => {
    const m = modell();
    for (const seite of ["innen", "aussen", "oben"]) {
      const alt = { ...m, dachflaechen: [{ ...dach(m), attika: [{ ...dach(m).attika[0]!, seite }] }] } as unknown as ProjectModel;
      expect(validateProject(alt)).toEqual([]);
      const q = attikaStreifen(dach(alt), dach(alt).attika[0]!);
      expect(Math.min(q[2]!.y, q[3]!.y)).toBeCloseTo(-0.3, 9);
    }
  });

  it("Gefälle, Facetten, Koten, Dämmung unabhängig von der Attika", () => {
    const mit = computeSlope(modell(false, true)).dachflaechen[0]!;
    const ohne = computeSlope(modell(false, false)).dachflaechen[0]!;
    expect(mit.facetten).toEqual(ohne.facetten);
    expect(mit.koten).toEqual(ohne.koten);
    expect(JSON.stringify(mit)).toBe(JSON.stringify(ohne));
  });

  it("Einzugsfläche = Dach + Attika (Länge × Breite), Dachanteil unverändert", () => {
    const f = (x: ProjectModel) => computeCatchments(x, computeSlope(x)).flaechen[0]!;
    const mit = f(modell()), ohne = f(modell(false, false));
    expect(mit.dachFlaeche).toBeCloseTo(60, 9);
    expect(mit.dachFlaeche).toBeCloseTo(ohne.dachFlaeche, 9);
    expect(mit.attikaFlaeche).toBeCloseTo(3, 9);
    expect(mit.gesamtFlaeche).toBeCloseTo(63, 9);
    expect(ohne.gesamtFlaeche).toBeCloseTo(60, 9);
    expect(attikaSegmentFlaeche(dach(modell()), dach(modell()).attika[0]!)).toBeCloseTo(3, 9);
  });

  it("DXF: Streifenkante außen", () => {
    const m = modell();
    const ys = flatten(parseDxf(baueProjektDxf({ modell: m, slope: computeSlope(m), plan: null })), { layerSichtbar: new Set([DXF_LAYER.attika]) })
      .segmente.map((s) => Math.round(s.a.y * 1000) / 1000).sort();
    expect(ys).toEqual([-0.3, 0]);
  });
});
