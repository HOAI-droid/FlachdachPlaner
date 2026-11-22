import { describe, expect, it } from "vitest";
import { ausrichten, winkelGrad } from "../src/core/snap";

describe("ausrichten", () => {
  it("rastet auf senkrechter und waagerechter Spur ein", () => {
    const a = ausrichten([{ x: 2, y: 5 }], { x: 2.03, y: 9 }, 0.05);
    expect(a?.punkt).toEqual({ x: 2, y: 9 });
    expect(a?.spuren).toEqual([{ von: { x: 2, y: 5 }, richtung: "x" }]);
  });
  it("kombiniert Spuren zweier Punkte zum Schnittpunkt", () => {
    const a = ausrichten([{ x: 2, y: 5 }, { x: 8, y: 1 }], { x: 2.02, y: 1.04 }, 0.05);
    expect(a?.punkt).toEqual({ x: 2, y: 1 });
    expect(a?.spuren).toHaveLength(2);
  });
  it("liefert null außerhalb der Toleranz", () => {
    expect(ausrichten([{ x: 0, y: 0 }], { x: 1, y: 1 }, 0.05)).toBeNull();
  });
});
describe("winkelGrad", () => {
  it("90° und schiefer Winkel", () => {
    expect(winkelGrad({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(90, 9);
    expect(winkelGrad({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 })).toBeCloseTo(45, 9);
  });
});
