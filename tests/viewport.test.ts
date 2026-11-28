import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  MAX_SCALE, MIN_SCALE, createViewport, fitBounds, panBy, scaleDenominator, screenToWorld, worldToScreen, zoomAt,
} from "../src/ui/canvas/viewport";

const vp0 = { ...createViewport(1000, 600), cx: 12, cy: -3, scale: 40 };

describe("Viewport-Transformation", () => {
  it("Mitte der Fläche = (cx, cy); y zeigt nach oben", () => {
    expect(worldToScreen(vp0, 12, -3)).toEqual([500, 300]);
    expect(worldToScreen(vp0, 12, -2)[1]).toBeLessThan(300);
    expect(worldToScreen(vp0, 13, -3)[0]).toBe(540);
  });
  it("Hin- und Rücktransformation ist die Identität", () => {
    fc.assert(fc.property(fc.double({ min: -1e3, max: 1e3, noNaN: true }), fc.double({ min: -1e3, max: 1e3, noNaN: true }), (x, y) => {
      const [sx, sy] = worldToScreen(vp0, x, y);
      const [rx, ry] = screenToWorld(vp0, sx, sy);
      return Math.abs(rx - x) < 1e-9 && Math.abs(ry - y) < 1e-9;
    }));
  });
  it("Zoom hält den Weltpunkt unter dem Cursor fest", () => {
    fc.assert(fc.property(fc.double({ min: 0.2, max: 5, noNaN: true }), fc.integer({ min: 0, max: 1000 }), fc.integer({ min: 0, max: 600 }), (f, sx, sy) => {
      const before = screenToWorld(vp0, sx, sy);
      const v = zoomAt(vp0, f, sx, sy);
      const after = screenToWorld(v, sx, sy);
      return Math.abs(before[0] - after[0]) < 1e-9 && Math.abs(before[1] - after[1]) < 1e-9;
    }));
  });
  it("Zoom ist begrenzt", () => {
    expect(zoomAt(vp0, 1e9, 0, 0).scale).toBe(MAX_SCALE);
    expect(zoomAt(vp0, 1e-9, 0, 0).scale).toBe(MIN_SCALE);
  });
  it("Pan: Inhalt folgt der Maus", () => {
    const p0 = worldToScreen(vp0, 5, 5);
    const p1 = worldToScreen(panBy(vp0, 30, -20), 5, 5);
    expect(p1[0] - p0[0]).toBeCloseTo(30);
    expect(p1[1] - p0[1]).toBeCloseTo(-20);
  });
  it("fitBounds zeigt die Box vollständig mit Rand", () => {
    const v = fitBounds(vp0, 0, 0, 20, 10, 32);
    const [x0, y0] = worldToScreen(v, 0, 0), [x1, y1] = worldToScreen(v, 20, 10);
    expect(x0).toBeGreaterThanOrEqual(32 - 1e-9);
    expect(x1).toBeLessThanOrEqual(1000 - 32 + 1e-9);
    expect(y1).toBeGreaterThanOrEqual(32 - 1e-9);
    expect(y0).toBeLessThanOrEqual(600 - 32 + 1e-9);
  });
  it("Maßstab: 100 px/m bei 96 dpi ≈ 1:38", () => {
    expect(scaleDenominator({ ...vp0, scale: 100 })).toBeCloseTo(37.8, 1);
  });
});
