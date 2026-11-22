import { describe, expect, it } from "vitest";
import { LAGE_TOL, achseEingerastet, ebeneFacetten } from "../src/core/slope/index";
import {
  computeSlope, createProject, dachachse, type Dachflaeche, type DachGefaelle, type Entwaesserung, type Kontur, type ProjectModel, type Vec2,
} from "../src/core/index";

/**
 * Regression „Scheinkehlen“: zwei Gullys mit fast gleichem x (Δx = 2 cm) erzeugten parallele, aber um
 * s·Δx = 0,4 mm versetzte Pyramidenseiten und damit lange diagonale Kehlen/Grate quer über das Dach und
 * Pseudo-Facetten. Lagetoleranz 5 cm (LAGE_TOL): Lagen bis 5 cm gelten als gleich; Höhen bleiben exakt.
 */
const pt = (id: string, x: number, y: number) => ({ id, x, y });
const gully = (id: string, x: number, y: number, z = 0): Entwaesserung =>
  ({ id, art: "gully", name: id, typ: null, position: { x, y }, z });
const SCHIEF: Kontur = [pt("k1", 0, 0), pt("k2", 8.84, 0), pt("k3", 8.84, 4.35), pt("k4", 0.04, 4.31)];
const RECHTECK: Kontur = [pt("k1", 0, 0), pt("k2", 8.84, 0), pt("k3", 8.84, 4.35), pt("k4", 0, 4.35)];

function dach(kontur: Kontur, g: readonly [Vec2, Vec2], z = 0): DachGefaelle {
  const d: Dachflaeche = {
    id: "d1", name: "Dach", typ: "dach", aufbauten: [], zonen: [], vorgaben: {}, attika: [], tuerschwellen: [],
    kontur, entwaesserung: [gully("g0", g[0].x, g[0].y, z), gully("g1", g[1].x, g[1].y, z)], daemmdickeTiefpunkt: 20,
  };
  const m: ProjectModel = { ...createProject("Test", "2026-01-01T00:00:00Z"), gefaelleStandard: 0.02, dachflaechen: [d] };
  return computeSlope(m).dachflaechen[0]!;
}

const nah = (p: Vec2, q: Vec2, tol = 1e-6) => Math.hypot(p.x - q.x, p.y - q.y) <= tol;
const zaehle = (g: DachGefaelle) => ({
  kehlen: g.linien.filter((l) => l.art === "kehle").length,
  grate: g.linien.filter((l) => l.art === "grat").length,
  platten: ebeneFacetten(g.facetten).length,
});

describe("Scheinkehlen: Lagetoleranz 5 cm (Repro 8,84 × 4,35)", () => {
  const gleich: [Vec2, Vec2] = [{ x: 4.42, y: 0.2 }, { x: 4.42, y: 4.13 }];
  const ref = dach(SCHIEF, gleich);
  const refR = dach(RECHTECK, gleich);
  const faelle: [string, Kontur, [Vec2, Vec2]][] = [
    ["schief, Δx = 2 cm", SCHIEF, [{ x: 4.42, y: 0.2 }, { x: 4.44, y: 4.13 }]],
    ["schief, Δx = −3 cm", SCHIEF, [{ x: 4.45, y: 0.2 }, { x: 4.42, y: 4.13 }]],
    ["schief, Δx = 4 cm", SCHIEF, [{ x: 4.42, y: 0.2 }, { x: 4.46, y: 4.13 }]],
    ["Rechteck, Δx = 2 cm", RECHTECK, [{ x: 4.42, y: 0.2 }, { x: 4.44, y: 4.13 }]],
    ["Rechteck, gleiches x", RECHTECK, gleich],
  ];
  for (const [name, kontur, gs] of faelle) {
    it(`${name}: keine Scheinlinie, Bild wie Referenz, Kote am Ablauf = z`, () => {
      const g = dach(kontur, gs, 0.1);
      // Intern angeglichen (höchstens LAGE_TOL verschoben), Kehlen nur am eigenen Gully.
      g.feld.quellen.forEach((q, n) => expect(Math.hypot(q.position.x - gs[n]!.x, q.position.y - gs[n]!.y)).toBeLessThanOrEqual(LAGE_TOL));
      for (const l of g.linien.filter((x) => x.art === "kehle")) {
        const p = g.feld.quellen.find((q) => q.ablaufId === l.ablaufIds[0])!.position;
        expect(nah(l.von, p) || nah(l.bis, p), `Kehle ${JSON.stringify(l)}`).toBe(true);
      }
      const r = kontur === SCHIEF ? ref : refR;
      expect(zaehle(g)).toEqual(zaehle(r));
      // Jede Linie hat ihr Gegenstück in der Referenz (Lage bis auf Versatz/Abtastung, 10 cm).
      for (const l of g.linien) {
        const passt = r.linien.some((x) => x.art === l.art &&
          ((nah(x.von, l.von, 0.1) && nah(x.bis, l.bis, 0.1)) || (nah(x.von, l.bis, 0.1) && nah(x.bis, l.von, 0.1))));
        expect(passt, `Scheinlinie ${JSON.stringify(l)}`).toBe(true);
      }
      // Höhen exakt: Kote an jedem Ablauf = z (keine Höhentoleranz).
      const abl = g.koten.filter((k) => k.art === "ablauf");
      expect(abl).toHaveLength(2);
      for (const k of abl) expect(k.kote).toBe(0.1);
      expect(g.tiefpunkt?.kote).toBe(0.1);
    });
  }
  it("Referenz: 8 Kehlen, ein Grat zwischen den Gullys, ebene Platten zusammengefasst", () => {
    expect(zaehle(ref)).toEqual({ kehlen: 8, grate: 1, platten: 6 });
  });
  it("Δx = 6 cm (über der Toleranz): keine Angleichung, Verhalten wie bisher", () => {
    const gs: [Vec2, Vec2] = [{ x: 4.42, y: 0.2 }, { x: 4.48, y: 4.13 }];
    const g = dach(SCHIEF, gs);
    expect(g.feld.quellen.map((q) => q.position)).toEqual(gs);
    expect(zaehle(g)).not.toEqual(zaehle(ref));
    expect(g.linien.some((l) => l.art === "kehle" && l.ablaufIds[0] === "g1" && Math.min(l.von.y, l.bis.y) < 1e-9)).toBe(true);
  });
  it("Dachachse rastet ein: Kante 4 cm schief → (1, 0); 6 cm → bleibt schief", () => {
    const k = (dy: number): Kontur => [pt("a", 0, 0), pt("b", 8.84, dy), pt("c", 8.84, 4.35), pt("d", 0, 4.31)];
    expect(achseEingerastet(k(0.04), dachachse(k(0.04)))).toEqual({ x: 1, y: 0 });
    expect(dach(k(0.04), gleich).feld.achse).toEqual({ x: 1, y: 0 });
    expect(dach(k(0.06), gleich).feld.achse.y).toBeGreaterThan(0);
  });
  it("echte Grate bleiben: Höhenunterschied 5 cm zwischen den Gullys", () => {
    const d: Dachflaeche = {
      id: "d1", name: "Dach", typ: "dach", aufbauten: [], zonen: [], vorgaben: {}, attika: [], tuerschwellen: [],
      kontur: RECHTECK, entwaesserung: [gully("g0", 2, 2.175), gully("g1", 7, 2.175, 0.05)],
    };
    const m: ProjectModel = { ...createProject("Test", "2026-01-01T00:00:00Z"), gefaelleStandard: 0.02, dachflaechen: [d] };
    const g = computeSlope(m).dachflaechen[0]!;
    expect(g.linien.filter((l) => l.art === "grat").length).toBeGreaterThan(0);
    expect(g.linien.filter((l) => l.art === "kehle")).toHaveLength(8);
    expect(g.koten.filter((k) => k.art === "ablauf").map((k) => k.kote).sort()).toEqual([0, 0.05]);
  });
});
