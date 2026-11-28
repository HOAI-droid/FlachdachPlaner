import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  IDENTITAET, PAPIER_M_PRO_PT, anwenden, ausNenner, ausPasspunkten, drehung, dreheUm, faktor, invertiere,
  kalibriereStrecke, nennerAusFaktor, nennerSetzen, zuPasspunkten, type Vec2,
} from "../src/core/index";

const d = (a: Vec2, b: Vec2) => Math.hypot(b.x - a.x, b.y - a.y);
// PDF 1:100, Linie von 10 m = 100 mm Papier = 100/25,4·72 pt
const PT_10M = (100 / 25.4) * 72;

describe("Kalibrierung", () => {
  it("1:n: 10 m bei 1:100 messen ± 0,5 %", () => {
    const t = ausNenner(100)!;
    const m = d(anwenden(t, { x: 100, y: 100 }), anwenden(t, { x: 100 + PT_10M, y: 100 }));
    expect(Math.abs(m - 10) / 10).toBeLessThan(0.005);
    expect(m).toBeCloseTo(10, 9);
    expect(nennerAusFaktor(faktor(t))).toBeCloseTo(100, 9);
    expect(faktor(t)).toBeCloseTo(100 * PAPIER_M_PRO_PT, 12);
  });
  it("Zwei-Punkt: bekannte Strecke 8 m bei falschem Anfangsmaßstab, danach 5 m ± 0,5 %", () => {
    const t0 = ausNenner(50)!; // falsch angenommen
    const a = { x: 3, y: 2 }, b = { x: 3 + 0.2, y: 2 + 0.1 };
    const t1 = kalibriereStrecke(t0, a, b, 8)!;
    const ua = anwenden(invertiere(t0)!, a), ub = anwenden(invertiere(t0)!, b);
    expect(d(anwenden(t1, ua), anwenden(t1, ub))).toBeCloseTo(8, 9);
    expect(anwenden(t1, ua).x).toBeCloseTo(a.x, 9); // Punkt A bleibt
    // zweite, anders orientierte Strecke derselben Unterlage: Verhältnis bleibt
    const c = { x: ub.x, y: ub.y + (5 / 8) * d(ua, ub) };
    expect(d(anwenden(t1, ub), anwenden(t1, c))).toBeCloseTo(5, 9);
    expect(kalibriereStrecke(t0, a, a, 5)).toBeNull();
    expect(kalibriereStrecke(t0, a, b, -1)).toBeNull();
    expect(kalibriereStrecke(t0, a, b, Number.NaN)).toBeNull();
  });
  it("Passpunkte ↔ Abbildung (Maßstab, Drehung, Verschiebung)", () => {
    const t = ausPasspunkten([
      { unterlage: { x: 0, y: 0 }, welt: { x: 10, y: 20 } },
      { unterlage: { x: 100, y: 0 }, welt: { x: 10, y: 22 } }, // 90° gedreht, s = 0,02
    ])!;
    expect(faktor(t)).toBeCloseTo(0.02, 12);
    expect(drehung(t)).toBeCloseTo(Math.PI / 2, 12);
    const p = anwenden(t, { x: 50, y: 10 });
    expect(p.x).toBeCloseTo(10 - 0.2, 9); expect(p.y).toBeCloseTo(21, 9);
    expect(ausPasspunkten([
      { unterlage: { x: 1, y: 1 }, welt: { x: 0, y: 0 } }, { unterlage: { x: 1, y: 1 }, welt: { x: 1, y: 0 } },
    ])).toBeNull();
    expect(nennerSetzen(t, 200, { x: 10, y: 20 })).not.toBeNull();
    expect(nennerAusFaktor(faktor(nennerSetzen(t, 200, { x: 10, y: 20 })!))).toBeCloseTo(200, 9);
    expect(invertiere({ a: 0, b: 0, tx: 1, ty: 1 })).toBeNull();
    expect(ausNenner(0)).toBeNull();
  });
  it("Eigenschaften: Rundlauf Passpunkte, Inverse, Drehung erhält Maßstab", () => {
    const v = fc.record({ x: fc.double({ min: -1e3, max: 1e3, noNaN: true }), y: fc.double({ min: -1e3, max: 1e3, noNaN: true }) });
    fc.assert(fc.property(
      fc.double({ min: 0.001, max: 50, noNaN: true }), fc.double({ min: -3, max: 3, noNaN: true }), v, v,
      (s, w, t0, p) => {
        const t = { a: s * Math.cos(w), b: s * Math.sin(w), tx: t0.x, ty: t0.y };
        const r = ausPasspunkten(zuPasspunkten(t, 7))!;
        const q = anwenden(r, p), q2 = anwenden(t, p);
        expect(Math.abs(q.x - q2.x)).toBeLessThan(1e-6 * (1 + Math.abs(q2.x)));
        const back = anwenden(invertiere(t)!, q2);
        expect(Math.abs(back.x - p.x)).toBeLessThan(1e-6 * (1 + Math.abs(p.x)));
        expect(faktor(dreheUm(t, 0.7, p))).toBeCloseTo(s, 9);
      }), { numRuns: 100 });
    expect(anwenden(IDENTITAET, { x: 1, y: 2 })).toEqual({ x: 1, y: 2 });
  });
});
