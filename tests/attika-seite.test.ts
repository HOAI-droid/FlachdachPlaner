import { describe, expect, it } from "vitest";
import {
  ausfuehren, attikaSegmentFlaeche, attikaStreifen, computeCatchments, computeSlope, createProject, neuerVerlauf, pointInPolygon,
  rueckgaengig, setAttikaSeite, validateProject, type Dachflaeche, type ProjectModel,
} from "../src/core/index";
import { baueProjektDxf, DXF_LAYER, flatten, parseDxf } from "../src/io/dxf";

const pt = (id: string, x: number, y: number) => ({ id, x, y });
const modell = (uhrzeiger = false): ProjectModel => {
  const k = [pt("a", 0, 0), pt("b", 10, 0), pt("c", 10, 6), pt("d", 0, 6)];
  const d: Dachflaeche = {
    id: "d1", name: "Dach", typ: "dach", aufbauten: [], zonen: [], vorgaben: {}, tuerschwellen: [],
    kontur: uhrzeiger ? [...k].reverse() : k, attika: [{ id: "at1", kante: "a", breite: 0.3, oberkante: 0.5 }],
    entwaesserung: [{ id: "g1", art: "gully", name: "G1", typ: null, position: { x: 5, y: 3 }, z: 0 }],
  };
  return { ...createProject("T", "2026-01-01T00:00:00Z"), gefaelleStandard: 0.02, dachflaechen: [d] };
};
const dach = (m: ProjectModel) => m.dachflaechen[0]!;
const innen = (m: ProjectModel, p: { x: number; y: number }) => pointInPolygon(p, { outer: dach(m).kontur, holes: [] }) === "inside";

describe("Attika innen/außen", () => {
  it("setAttikaSeite: ein Befehl, Undo, Standard ohne Feld, gültig", () => {
    let v = neuerVerlauf(modell());
    v = ausfuehren(v, setAttikaSeite("d1", "at1", "aussen"));
    expect(dach(v.aktuell).attika[0]!.seite).toBe("aussen");
    expect(validateProject(v.aktuell)).toEqual([]);
    v = ausfuehren(v, setAttikaSeite("d1", "at1", "innen"));
    expect(dach(v.aktuell).attika[0]).toEqual({ id: "at1", kante: "a", breite: 0.3, oberkante: 0.5 });
    v = rueckgaengig(v);
    expect(dach(v.aktuell).attika[0]!.seite).toBe("aussen");
    // Gleicher Wert / unbekanntes Segment: Modell unverändert.
    const m = v.aktuell;
    expect(setAttikaSeite("d1", "at1", "aussen").anwenden(m)).toBe(m);
    expect(setAttikaSeite("d1", "xx", "innen").anwenden(m)).toBe(m);
  });

  it("validate: ungültige Seite wird gemeldet", () => {
    const m = modell();
    const kaputt = { ...m, dachflaechen: [{ ...dach(m), attika: [{ ...dach(m).attika[0]!, seite: "oben" }] }] };
    expect(validateProject(kaputt).some((f) => f.pfad.includes("seite"))).toBe(true);
  });

  for (const uz of [false, true]) {
    it(`attikaStreifen liegt innen bzw. außen (Kontur ${uz ? "im" : "gegen"} Uhrzeigersinn)`, () => {
      const m = modell(uz);
      const a = dach(m).attika[0]!;
      const qi = attikaStreifen(dach(m), a);
      // Mitte der Streifen-Außenkante (Endpunkte liegen auf der Kontur).
      const mitte = (q: readonly { x: number; y: number }[]) => ({ x: (q[2]!.x + q[3]!.x) / 2, y: (q[2]!.y + q[3]!.y) / 2 });
      expect(innen(m, mitte(qi))).toBe(true);
      const qa = attikaStreifen(dach(m), { ...a, seite: "aussen" });
      expect(innen(m, mitte(qa))).toBe(false);
      expect(Math.min(Math.abs(mitte(qa).x), Math.abs(mitte(qa).y))).toBeCloseTo(0.3, 9); // Kante a liegt auf einer Achse
    });
  }

  it("Einzugsfläche und Attikafläche bleiben gleich (Länge × Breite)", () => {
    const m = modell();
    const aus: ProjectModel = { ...m, dachflaechen: [{ ...dach(m), attika: [{ ...dach(m).attika[0]!, seite: "aussen" }] }] };
    const f = (x: ProjectModel) => computeCatchments(x, computeSlope(x)).flaechen[0]!.attikaFlaeche;
    expect(f(aus)).toBeCloseTo(f(m), 9);
    expect(attikaSegmentFlaeche(dach(aus), dach(aus).attika[0]!)).toBeCloseTo(3, 9);
  });

  it("DXF: Streifenkante auf der gewählten Seite", () => {
    const m = modell();
    const aus: ProjectModel = { ...m, dachflaechen: [{ ...dach(m), attika: [{ ...dach(m).attika[0]!, seite: "aussen" }] }] };
    const ys = (x: ProjectModel) => flatten(parseDxf(baueProjektDxf({ modell: x, slope: computeSlope(x), plan: null })), { layerSichtbar: new Set([DXF_LAYER.attika]) })
      .segmente.map((s) => Math.round(s.a.y * 1000) / 1000).sort();
    expect(ys(m)).toEqual([0, 0.3]);
    expect(ys(aus)).toEqual([-0.3, 0]);
  });
});
