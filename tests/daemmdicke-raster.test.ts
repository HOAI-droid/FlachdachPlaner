import { describe, expect, it } from "vitest";
import { dickeRaster } from "../src/core/layout";

describe("Dämmdicke im 5-mm-Raster", () => {
  it("rundet auf, nie ab", () => {
    expect(dickeRaster(81)).toBe(85);
    expect(dickeRaster(85.4)).toBe(90);
    expect(dickeRaster(20.1)).toBe(25);
  });
  it("Rechenrauschen um ein Vielfaches bleibt stabil", () => {
    expect(dickeRaster(85)).toBe(85);
    expect(dickeRaster(85.0000001)).toBe(85);
    expect(dickeRaster(84.9999999)).toBe(85);
  });
});
