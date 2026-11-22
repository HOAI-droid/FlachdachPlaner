import { describe, expect, it } from "vitest";
import { kote, meter, prozent, quadratmeter, zahl } from "../src/ui/format";

describe("Zahlenformat", () => {
  it("Dezimalkomma und Einheit mit schmalem Leerzeichen", () => {
    expect(meter(12.345)).toBe("12,345 m");
    expect(prozent(2)).toBe("2,0 %");
    expect(quadratmeter(318)).toBe("318 m²");
  });
  it("Koten mit Vorzeichen und 3 Stellen", () => {
    expect(kote(12.345)).toBe("+12,345");
    expect(kote(-0.05)).toBe("−0,050");
    expect(kote(0)).toBe("+0,000");
  });
  it("negative Null wird nicht angezeigt", () => {
    expect(zahl(-0.0001, 2)).toBe("0,00");
  });
});
