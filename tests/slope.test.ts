import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  computeSlope, createProject, dachachse, hoeheAm, polygonArea, polygonCentroid, pointInPolygon,
  type Dachflaeche, type DachGefaelle, type Entwaesserung, type Kontur, type ProjectModel, type Vec2,
} from "../src/core/index";

const pt = (id: string, x: number, y: number) => ({ id, x, y });
const rechteck = (pre: string, w: number, h: number): Kontur =>
  [pt(`${pre}1`, 0, 0), pt(`${pre}2`, w, 0), pt(`${pre}3`, w, h), pt(`${pre}4`, 0, h)];
const gully = (id: string, x: number, y: number, z = 0): Entwaesserung =>
  ({ id, art: "gully", name: id, typ: null, position: { x, y }, z });

function projekt(dach: Partial<Dachflaeche> & Pick<Dachflaeche, "kontur" | "entwaesserung">, gefaelle = 0.02): ProjectModel {
  const d: Dachflaeche = {
    id: "d1", name: "Dach", typ: "dach", aufbauten: [], zonen: [], vorgaben: {}, attika: [], tuerschwellen: [], ...dach,
  };
  return { ...createProject("Test", "2026-01-01T00:00:00Z"), gefaelleStandard: gefaelle, dachflaechen: [d] };
}
const erstes = (m: ProjectModel): DachGefaelle => computeSlope(m).dachflaechen[0]!;
const koteAn = (g: DachGefaelle, p: Vec2) => g.koten.find((k) => Math.hypot(k.position.x - p.x, k.position.y - p.y) < 1e-9);
/** Liegt p (bis auf tol) auf der Strecke a–b? */
const aufStrecke = (p: Vec2, a: Vec2, b: Vec2, tol = 1e-9) => {
  const l = Math.hypot(b.x - a.x, b.y - a.y);
  const t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (l * l);
  const q = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
  return t >= -tol && t <= 1 + tol && Math.hypot(q.x - p.x, q.y - p.y) <= tol;
};

describe("Höhenfeld: ein Gully mittig (20×10, 2 %)", () => {
  const g = erstes(projekt({ kontur: rechteck("k", 20, 10), entwaesserung: [gully("g1", 10, 5)] }));
  it("Ecken +0,200 m, Ablauf ±0,000", () => {
    for (const p of [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 0, y: 10 }]) {
      expect(koteAn(g, p)?.kote).toBeCloseTo(0.2, 12);
      expect(koteAn(g, p)?.art).toBe("ecke");
    }
    expect(koteAn(g, { x: 10, y: 5 })).toMatchObject({ art: "ablauf", kote: 0 });
    expect(g.hochpunkt?.kote).toBeCloseTo(0.2, 12);
    expect(g.tiefpunkt?.kote).toBe(0);
    expect(g.tiefpunkt?.orte).toEqual([{ x: 10, y: 5 }]);
  });
  it("4 Facetten (Summe = Dachfläche), 4 Kehlen, keine Grate", () => {
    expect(g.facetten).toHaveLength(4);
    expect(g.facetten.reduce((s, f) => s + f.flaeche, 0)).toBeCloseTo(200, 3);
    expect(g.linien.filter((l) => l.art === "kehle")).toHaveLength(4);
    expect(g.linien.filter((l) => l.art === "grat")).toHaveLength(0);
    // Kehlen unter 45° vom Gully zum Rand
    for (const l of g.linien) {
      const [a, b] = [l.von, l.bis];
      expect(Math.abs(Math.abs(b.x - a.x) - Math.abs(b.y - a.y))).toBeLessThan(1e-9);
      expect([a, b].some((p) => Math.hypot(p.x - 10, p.y - 5) < 1e-9)).toBe(true);
    }
  });
  it("Gefällepfeile: einer je Facette, im Inneren, bergab Richtung Gully", () => {
    expect(g.pfeile).toHaveLength(4);
    for (const p of g.pfeile) {
      const f = g.facetten.find((x) => x.id === p.facetteId)!;
      expect(pointInPolygon(p.start, f.polygon)).toBe("inside");
      expect(Math.hypot(p.richtung.x, p.richtung.y)).toBeCloseTo(1, 12);
      expect(p.gefaelle).toBe(0.02);
      const weiter = { x: p.start.x + p.richtung.x * 0.01, y: p.start.y + p.richtung.y * 0.01 };
      expect(hoeheAm(g.feld, weiter)).toBeLessThan(hoeheAm(g.feld, p.start));
    }
  });
  it("Facettenebene = Höhenfeld im Facetteninneren", () => {
    for (const f of g.facetten) {
      const c = polygonCentroid(f.polygon);
      expect(f.ebene.a * c.x + f.ebene.b * c.y + f.ebene.c).toBeCloseTo(hoeheAm(g.feld, c), 12);
    }
  });
  it("mittlere Gefälledämmdicke 108,3 mm (±0,5) ohne Vorgabe d_TP", () => {
    expect(g.daemmung).not.toBeNull();
    expect(Math.abs(g.daemmung!.mittel - 108.333)).toBeLessThan(0.5);
    expect(g.daemmung!.min).toBe(0);
    expect(g.daemmung!.max).toBeCloseTo(200, 9);
    expect(g.daemmung!.tiefpunktVorgegeben).toBe(false);
    expect(g.daemmung!.flaeche).toBeCloseTo(200, 3);
  });
  it("mit daemmdickeTiefpunkt 20 mm → d_m = 128,3 mm, min 20, max 220", () => {
    const h = erstes(projekt({ kontur: rechteck("k", 20, 10), entwaesserung: [gully("g1", 10, 5)], daemmdickeTiefpunkt: 20 }));
    expect(Math.abs(h.daemmung!.mittel - 128.333)).toBeLessThan(0.5);
    expect(h.daemmung!.min).toBe(20);
    expect(h.daemmung!.max).toBeCloseTo(220, 9);
    expect(h.daemmung!.tiefpunktVorgegeben).toBe(true);
  });
  it("Standard für d_TP über Optionen (z. B. aus Pack)", () => {
    const m = projekt({ kontur: rechteck("k", 20, 10), entwaesserung: [gully("g1", 10, 5)] });
    expect(computeSlope(m, { daemmdickeTiefpunktStandard: 30 }).dachflaechen[0]!.daemmung!.min).toBe(30);
  });
  it("Gefälle aus dem Projekt (kein fester Wert im Kern): 3 % → Ecken +0,300 m", () => {
    const h = erstes(projekt({ kontur: rechteck("k", 20, 10), entwaesserung: [gully("g1", 10, 5)] }, 0.03));
    expect(koteAn(h, { x: 0, y: 0 })?.kote).toBeCloseTo(0.3, 12);
  });
});

describe("Höhenfeld: zwei Gullys (5|5), (15|5)", () => {
  const kontur = rechteck("k", 20, 10);
  const gleich = erstes(projekt({ kontur, entwaesserung: [gully("g1", 5, 5), gully("g2", 15, 5)] }));
  const tiefer = erstes(projekt({ kontur, entwaesserung: [gully("g1", 5, 5), gully("g2", 15, 5, -0.05)] }));

  it("beide z = 0: Grat bei x = 10 über die ganze Tiefe, HP +0,100 m", () => {
    const grate = gleich.linien.filter((l) => l.art === "grat");
    expect(grate).toHaveLength(1);
    const gr = grate[0]!;
    expect(gr.von.x).toBeCloseTo(10, 12);
    expect(gr.bis.x).toBeCloseTo(10, 12);
    expect(Math.abs(gr.bis.y - gr.von.y)).toBeCloseTo(10, 12);
    expect([...gr.ablaufIds].sort()).toEqual(["g1", "g2"]);
    expect(gleich.hochpunkt?.kote).toBeCloseTo(0.1, 12);
    expect(gleich.facetten.reduce((s, f) => s + f.flaeche, 0)).toBeCloseTo(200, 3);
    expect(gleich.linien.filter((l) => l.art === "kehle")).toHaveLength(8);
  });
  it("z₂ = −0,05 m: Grat wandert nach x = 8,75 m, Ecke (0|0) +0,100 m, Ecke (20|0) +0,050 m", () => {
    const grate = tiefer.linien.filter((l) => l.art === "grat");
    expect(grate.some((l) => aufStrecke({ x: 8.75, y: 5 }, l.von, l.bis))).toBe(true);
    expect(grate.some((l) => aufStrecke({ x: 10, y: 5 }, l.von, l.bis))).toBe(false);
    expect(hoeheAm(tiefer.feld, { x: 8.75, y: 5 })).toBeCloseTo(0.075, 12);
    expect(koteAn(tiefer, { x: 0, y: 0 })?.kote).toBeCloseTo(0.1, 12);
    expect(koteAn(tiefer, { x: 20, y: 0 })?.kote).toBeCloseTo(0.05, 12);
    expect(tiefer.tiefpunkt?.kote).toBeCloseTo(-0.05, 12);
    expect(tiefer.tiefpunkt?.orte).toEqual([{ x: 15, y: 5 }]);
    // Grat wird von beiden Seiten gleich hoch erreicht: Koten an Gratenden = Höhenfeld
    for (const l of grate) for (const p of [l.von, l.bis]) expect(koteAn(tiefer, p)?.kote).toBeCloseTo(hoeheAm(tiefer.feld, p), 12);
  });
  it("Änderung von z ändert Koten und Grat", () => {
    expect(koteAn(tiefer, { x: 20, y: 0 })?.kote).not.toBeCloseTo(koteAn(gleich, { x: 20, y: 0 })!.kote, 6);
    const lage = (g: DachGefaelle) => g.linien.filter((l) => l.art === "grat").map((l) => [l.von, l.bis]);
    expect(lage(tiefer)).not.toEqual(lage(gleich));
    // Fläche des tieferen Ablaufs wächst
    const flaeche = (g: DachGefaelle, id: string) => g.facetten.filter((f) => f.ablaufId === id).reduce((s, f) => s + f.flaeche, 0);
    expect(flaeche(gleich, "g2")).toBeCloseTo(100, 3);
    expect(flaeche(tiefer, "g2")).toBeGreaterThan(100);
    expect(flaeche(tiefer, "g1") + flaeche(tiefer, "g2")).toBeCloseTo(200, 3);
  });
});

describe("Sonderfälle und Hinweise", () => {
  it("Aufbau (Loch) zählt nicht zur Fläche; Ecken des Aufbaus erhalten Koten", () => {
    const g = erstes(projekt({
      kontur: rechteck("k", 20, 10), entwaesserung: [gully("g1", 10, 5)],
      aufbauten: [{ id: "a1", name: "LK", kontur: [pt("a1", 2, 2), pt("a2", 4, 2), pt("a3", 4, 4), pt("a4", 2, 4)] }],
    }));
    expect(g.daemmung!.flaeche).toBeCloseTo(196, 3);
    expect(koteAn(g, { x: 2, y: 2 })?.kote).toBeCloseTo(0.16, 12);
  });
  it("ohne Ablauf: keine Facetten, Hinweis keine-ablaeufe", () => {
    const r = computeSlope(projekt({ kontur: rechteck("k", 10, 10), entwaesserung: [] }));
    expect(r.dachflaechen[0]!.facetten).toEqual([]);
    expect(r.dachflaechen[0]!.daemmung).toBeNull();
    expect(r.hinweise.map((h) => h.code)).toEqual(["keine-ablaeufe"]);
  });
  it("Notablauf ist keine Höhenquelle; Ablauf außerhalb → Hinweis", () => {
    const m = projekt({
      kontur: rechteck("k", 10, 10),
      entwaesserung: [{ id: "n1", art: "notablauf", name: "N", typ: null, position: { x: 5, y: 5 }, z: -1 }, gully("g9", 30, 5)],
    });
    const r = computeSlope(m);
    expect(r.dachflaechen[0]!.feld.quellen.map((q) => q.ablaufId)).toEqual(["g9"]);
    expect(r.dachflaechen[0]!.facetten.every((f) => f.ablaufId === "g9")).toBe(true);
    expect(r.hinweise.map((h) => [h.code, h.objektId])).toEqual([["ablauf-ausserhalb", "g9"]]);
  });
  it("Gefälle 0 → Hinweis, keine Facetten", () => {
    const r = computeSlope(projekt({ kontur: rechteck("k", 10, 10), entwaesserung: [gully("g1", 5, 5)] }, 0));
    expect(r.dachflaechen[0]!.facetten).toEqual([]);
    expect(r.hinweise.map((h) => h.code)).toEqual(["gefaelle-null"]);
  });
  it("zwei Gullys an derselben Stelle: keine doppelten Facetten (Gleichstand → erster Ablauf)", () => {
    const g = erstes(projekt({ kontur: rechteck("k", 20, 10), entwaesserung: [gully("g1", 10, 5), gully("g2", 10, 5)] }));
    expect(g.facetten).toHaveLength(4);
    expect(g.facetten.every((f) => f.ablaufId === "g1")).toBe(true);
  });
  it("Gullys in einer Reihe (koplanare Seitenflächen): Partition ohne Überlappung", () => {
    const g = erstes(projekt({ kontur: rechteck("k", 30, 10), entwaesserung: [gully("g1", 5, 5), gully("g2", 15, 5), gully("g3", 25, 5)] }));
    expect(g.facetten.reduce((s, f) => s + f.flaeche, 0)).toBeCloseTo(300, 3);
    expect(g.linien.filter((l) => l.art === "grat")).toHaveLength(2);
    expect(Math.abs(g.daemmung!.mittel - 1000 * 0.02 * (10 / 3))).toBeLessThan(0.5); // Mittel von max(|u|,|v|) über 10×10 = 10/3
  });
  it("dachachse: längste Kante, auf [0°, 90°) reduziert", () => {
    expect(dachachse(rechteck("k", 20, 10))).toEqual({ x: 1, y: 0 });
    const w = Math.PI / 6;
    const r = rechteck("k", 20, 10).map((p) => ({ ...p, x: p.x * Math.cos(w) - p.y * Math.sin(w), y: p.x * Math.sin(w) + p.y * Math.cos(w) }));
    const a = dachachse(r);
    expect(a.x).toBeCloseTo(Math.cos(w), 12);
    expect(a.y).toBeCloseTo(Math.sin(w), 12);
  });
  it("deterministisch", () => {
    const m = projekt({ kontur: rechteck("k", 20, 10), entwaesserung: [gully("g1", 4, 3), gully("g2", 15, 7, -0.03)] });
    expect(JSON.stringify(computeSlope(m))).toBe(JSON.stringify(computeSlope(m)));
  });
});

// ---------- Eigenschaftstests ----------

const zahl = (min: number, max: number) => fc.double({ min, max, noNaN: true, noDefaultInfinity: true });
const fall = fc.record({
  w: zahl(4, 40), h: zahl(4, 30),
  gullys: fc.array(fc.record({ fx: zahl(0.05, 0.95), fy: zahl(0.05, 0.95), z: zahl(-0.1, 0.1) }), { minLength: 1, maxLength: 4 }),
  s: zahl(0.01, 0.05), dtp: fc.option(zahl(0, 120), { nil: undefined }),
  shift: zahl(-1, 1), winkel: zahl(0, Math.PI / 2),
});
type Fall = typeof fall extends fc.Arbitrary<infer T> ? T : never;
function ausFall(f: Fall, shift = 0, winkel = 0): ProjectModel {
  const rot = (x: number, y: number) => ({ x: x * Math.cos(winkel) - y * Math.sin(winkel), y: x * Math.sin(winkel) + y * Math.cos(winkel) });
  const kontur = rechteck("k", f.w, f.h).map((p) => ({ id: p.id, ...rot(p.x, p.y) }));
  const entwaesserung = f.gullys.map((g, i) => {
    const p = rot(g.fx * f.w, g.fy * f.h);
    return gully(`g${i}`, p.x, p.y, g.z + shift);
  });
  return projekt({ kontur, entwaesserung, daemmdickeTiefpunkt: f.dtp }, f.s);
}

describe("Eigenschaften", () => {
  it("d_TP ≤ d_m ≤ Max; Facetten partitionieren die Dachfläche; Koten = Höhenfeld", () => {
    fc.assert(fc.property(fall, (f) => {
      const g = erstes(ausFall(f));
      const d = g.daemmung!;
      const dtp = f.dtp ?? 0;
      expect(d.min).toBe(dtp);
      expect(d.mittel).toBeGreaterThanOrEqual(dtp - 1e-9);
      expect(d.mittel).toBeLessThanOrEqual(d.max + 1e-9);
      const summe = g.facetten.reduce((s, x) => s + x.flaeche, 0);
      expect(Math.abs(summe - f.w * f.h)).toBeLessThan(0.01);
      expect(Math.abs(polygonArea({ outer: ausFall(f).dachflaechen[0]!.kontur, holes: [] }) - f.w * f.h)).toBeLessThan(1e-6);
      for (const k of g.koten) expect(k.kote).toBeCloseTo(hoeheAm(g.feld, k.position), 9);
      expect(g.hochpunkt!.kote).toBeGreaterThanOrEqual(Math.max(...g.koten.map((k) => k.kote)) - 1e-12);
    }), { numRuns: 120 });
  });
  it("gemeinsame Verschiebung aller z ändert d_m nicht (verschiebt nur die Koten)", () => {
    fc.assert(fc.property(fall, (f) => {
      const a = erstes(ausFall(f));
      const b = erstes(ausFall(f, f.shift));
      expect(Math.abs(a.daemmung!.mittel - b.daemmung!.mittel)).toBeLessThan(1e-3);
      expect(Math.abs(a.daemmung!.max - b.daemmung!.max)).toBeLessThan(1e-6);
      expect(b.hochpunkt!.kote - a.hochpunkt!.kote).toBeCloseTo(f.shift, 9);
    }), { numRuns: 80 });
  });
  it("Drehung von Dach samt Abläufen ändert d_m und HP nicht (L∞ in Dachachsrichtung)", () => {
    fc.assert(fc.property(fall, (f) => {
      const a = erstes(ausFall(f));
      const mb = ausFall(f, 0, f.winkel);
      // Im Einrastbereich der Lagetoleranz (Kante ≤ 5 cm schief) wird die Achse bewusst auf 0° gesetzt.
      // Nahe der Toleranzgrenze (Kantenabweichung ≈ 5 cm) ist die Lagetoleranz absichtlich unstetig: nur klar darüber prüfen.
      const m = Math.min(Math.abs(Math.sin(f.winkel)), Math.abs(Math.cos(f.winkel)));
      fc.pre(m === 0 || m * Math.min(f.w, f.h) > 0.1);
      const b = erstes(mb);
      // Die 5-cm-Lagetoleranz darf Höhen um höchstens s · 5 cm verschieben (Höhen in m, Dämmdicke in mm).
      const dh = f.s * 0.05 * 2;
      expect(Math.abs(a.daemmung!.mittel - b.daemmung!.mittel)).toBeLessThan(dh * 1000 + 0.05);
      expect(Math.abs(b.hochpunkt!.kote - a.hochpunkt!.kote)).toBeLessThan(dh + 1e-9);
      expect(b.facetten.reduce((s, x) => s + x.flaeche, 0)).toBeCloseTo(f.w * f.h, 2);
    }), { numRuns: 80 });
  });
});
