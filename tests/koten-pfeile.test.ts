import { describe, expect, it } from "vitest";
import {
  KOTEN_BUENDEL_HOEHE, KOTEN_BUENDEL_LAGE, buendleKoten, computeSlope, createProject, kotenMarken, pfeilLage,
  pointInPolygon, type Dachflaeche, type DachGefaelle, type Kontur, type ProjectModel, type Vec2,
} from "../src/core/index";

/** Szenario Nutzer: Rechteck, E1 oben-Mitte, E2 unten-Mitte, Kehlen als Raute, Teilung waagerecht in der Mitte. */
const pt = (id: string, x: number, y: number) => ({ id, x, y });
const RECHTECK: Kontur = [pt("k1", 0, 0), pt("k2", 8.84, 0), pt("k3", 8.84, 4.35), pt("k4", 0, 4.35)];
const SCHIEF: Kontur = [pt("k1", 0, 0), pt("k2", 8.84, 0), pt("k3", 8.84, 4.35), pt("k4", 0.04, 4.31)];

function rechnen(kontur: Kontur, g1x = 4.44): DachGefaelle {
  const d: Dachflaeche = {
    id: "d1", name: "Dach", typ: "dach", aufbauten: [], zonen: [], vorgaben: {}, attika: [], tuerschwellen: [], kontur,
    entwaesserung: [
      { id: "g0", art: "gully", name: "E1", typ: null, position: { x: 4.42, y: 0.2 }, z: 0 },
      { id: "g1", art: "gully", name: "E2", typ: null, position: { x: g1x, y: 4.13 }, z: 0 },
    ],
  };
  const m: ProjectModel = { ...createProject("T", "2026-01-01T00:00:00Z"), gefaelleStandard: 0.02, dachflaechen: [d] };
  return computeSlope(m).dachflaechen[0]!;
}
const abst = (p: Vec2, q: Vec2) => Math.hypot(p.x - q.x, p.y - q.y);

describe("Koten an Kehlen-Ecken (Raute)", () => {
  for (const [name, k] of [["Rechteck", RECHTECK], ["schief", SCHIEF]] as const) {
    it(`${name}: Kehlen enden exakt am Grat, je Ecke genau eine Kote`, () => {
      const g = rechnen(k);
      const grat = g.linien.find((l) => l.art === "grat")!;
      for (const ende of [grat.von, grat.bis]) {
        // Kehlen von beiden Abläufen treffen das Gratende (Bisektion statt Rasterende, früher bis 9 cm davor).
        const treffer = g.linien.filter((l) => l.art === "kehle" && (abst(l.von, ende) < 1e-4 || abst(l.bis, ende) < 1e-4));
        expect(treffer.length).toBe(2);
        expect(g.koten.filter((x) => abst(x.position, ende) < KOTEN_BUENDEL_LAGE).length).toBe(1);
      }
      // Angezeigte Marken: keine zwei innerhalb 5 cm mit ≤ 5 mm Höhenunterschied.
      const mk = kotenMarken([g]);
      for (const a of mk) for (const b of mk) {
        if (a === b) continue;
        expect(abst(a.position, b.position) > KOTEN_BUENDEL_LAGE || Math.abs(a.kote - b.kote) > KOTEN_BUENDEL_HOEHE).toBe(true);
      }
    });
  }

  it("Teilung zwischen den Abläufen: Kote links und rechts auf der Kontur", () => {
    const g = rechnen(RECHTECK);
    const y = (0.2 + 4.13) / 2;
    for (const x of [0, 8.84]) {
      const k = g.koten.find((q) => abst(q.position, { x, y }) < 0.02);
      expect(k, `Kote bei x=${x}`).toBeDefined();
      expect(k!.art).toBe("teilung");
      expect(k!.kote).toBeCloseTo(0.02 * 4.42, 3);
    }
  });

  it("schiefe Kontur: Teilungskoten liegen auf der Kontur", () => {
    const g = rechnen(SCHIEF);
    const t = g.koten.filter((k) => k.art === "teilung");
    expect(t.length).toBe(2);
    expect(t.some((k) => k.position.x < 0.05)).toBe(true);
    expect(t.some((k) => Math.abs(k.position.x - 8.84) < 1e-6)).toBe(true);
  });
});

describe("buendleKoten", () => {
  it("fasst 3 Marken mit 1 mm Abweichung zu einer zusammen (häufigste mm-Höhe)", () => {
    const r = buendleKoten([
      { position: { x: 6.32, y: 2.1 }, kote: 0.0431, art: "kehle" },
      { position: { x: 6.36, y: 2.12 }, kote: 0.0442, art: "grat" },
      { position: { x: 6.33, y: 2.14 }, kote: 0.0428, art: "kehle" },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]!.art).toBe("grat");
    expect(r[0]!.position).toEqual({ x: 6.36, y: 2.12 });
    expect(r[0]!.kote).toBeCloseTo(0.043, 9);
  });
  it("trennt bei größerem Abstand oder Höhenunterschied; HP behält seinen Wert", () => {
    const r = buendleKoten([
      { position: { x: 0, y: 0 }, kote: 0.1, art: "ecke" },
      { position: { x: 0.2, y: 0 }, kote: 0.1, art: "ecke" },
      { position: { x: 0.01, y: 0 }, kote: 0.11, art: "kehle" },
      { position: { x: 0, y: 0.01 }, kote: 0.1004, art: "hochpunkt" },
    ]);
    expect(r).toHaveLength(3);
    expect(r[0]).toEqual({ position: { x: 0, y: 0.01 }, kote: 0.1004, art: "hochpunkt" });
  });
  it("Ablauf hat Vorrang (Marke wird nicht beschriftet)", () => {
    const r = buendleKoten([{ position: { x: 1, y: 1 }, kote: 0, art: "kehle" }, { position: { x: 1.03, y: 1 }, kote: 0.0006, art: "ablauf" }]);
    expect(r).toHaveLength(1);
    expect(r[0]!.art).toBe("ablauf");
  });
});

describe("Gefällepfeile in jeder Facette", () => {
  it("jede Facette mit Gefälle hat einen Pfeil in Fallrichtung, auch die Dreiecke zwischen den Kehlen", () => {
    const g = rechnen(RECHTECK);
    const mitGefaelle = g.facetten.filter((f) => f.gefaelle > 0);
    expect(g.pfeile.map((p) => p.facetteId).sort()).toEqual(mitGefaelle.map((f) => f.id).sort());
    // Dreiecke ober-/unterhalb der Raute (zwischen den Kehlen): Pfeil zeigt zum eigenen Ablauf.
    for (const id of ["g0/1/0", "g1/3/0"]) {
      const f = g.facetten.find((x) => x.id === id)!;
      const p = g.pfeile.find((x) => x.facetteId === id)!;
      const ziel = g.feld.quellen.find((q) => q.ablaufId === f.ablaufId)!.position;
      const vorher = abst(p.start, ziel), nachher = abst({ x: p.start.x + p.richtung.x * 0.1, y: p.start.y + p.richtung.y * 0.1 }, ziel);
      expect(nachher).toBeLessThan(vorher);
      // Anzeige: bei 50 px/m passt ein 44-px-Pfeil in das Dreieck (früher ausgeblendet, < 120 px zum Ablauf).
      const lage = pfeilLage(p.start, p.richtung, f.polygon, 44 / 50, [ziel], 14 / 50);
      expect(lage).not.toBeNull();
      expect(pointInPolygon(lage!.von, f.polygon)).toBe("inside");
      expect(pointInPolygon(lage!.bis, f.polygon)).toBe("inside");
    }
  });
  it("pfeilLage: zu kleine Facette → null, Ablauf zu nah → null", () => {
    const klein = { outer: [{ x: 0, y: 0 }, { x: 0.1, y: 0 }, { x: 0, y: 0.1 }], holes: [] };
    expect(pfeilLage({ x: 0.03, y: 0.03 }, { x: 1, y: 0 }, klein, 1)).toBeNull();
    const gross = { outer: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }], holes: [] };
    expect(pfeilLage({ x: 2, y: 2 }, { x: 1, y: 0 }, gross, 1)).not.toBeNull();
    expect(pfeilLage({ x: 2, y: 2 }, { x: 1, y: 0 }, gross, 1, [{ x: 2.1, y: 2 }], 0.2)).toBeNull();
  });
});
