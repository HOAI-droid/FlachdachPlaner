import { describe, expect, it } from "vitest";
import { anschlussLabel, anschlussStatus, notLabel } from "../src/ui/anschluss-label";

describe("Anschluss-Labels", () => {
  it("formatiert AH mit Soll", () => {
    expect(anschlussLabel(0.13, 0.15)).toBe("AH 130 mm (soll 150)");
    expect(anschlussLabel(null, 0.15)).toBe("AH – (soll 150)");
    expect(anschlussLabel(0.2, null)).toBe("AH 200 mm (soll –)");
  });
  it("formatiert ÜK und NW", () => {
    expect(notLabel(0.085, 0.146)).toBe("ÜK +0,085 · NW +0,146");
    expect(notLabel(null, null)).toBe("ÜK – · NW –");
    expect(notLabel(-0.02, null)).toBe("ÜK −0,020 · NW –");
  });
  it("Status", () => {
    expect(anschlussStatus(0.13, 0.15)).toBe("niedrig");
    expect(anschlussStatus(0.15, 0.15)).toBe("ok");
    expect(anschlussStatus(null, 0.15)).toBe("unbekannt");
    expect(anschlussStatus(0.2, null)).toBe("unbekannt");
  });
});
