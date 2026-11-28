import { describe, expect, it } from "vitest";
import { version } from "../src/core/index";

describe("Setup", () => {
  it("Kern ist importierbar", () => {
    expect(version).toBe("0.0.1");
  });
});
