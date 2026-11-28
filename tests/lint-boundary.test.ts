import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";

async function lint(code: string, filePath: string) {
  const eslint = new ESLint();
  const [res] = await eslint.lintText(code, { filePath });
  return res?.messages.filter((m) => m.severity === 2) ?? [];
}

describe("Kern-Grenze (ESLint)", () => {
  it("src/core darf src/ui importieren nicht", async () => {
    const m = await lint('import "../ui/main";\nexport const x = 1;\n', "src/core/x.ts");
    expect(m.some((e) => e.ruleId === "no-restricted-imports")).toBe(true);
  });
  it("src/core darf three nicht importieren", async () => {
    const m = await lint('import "three";\nexport const x = 1;\n', "src/core/x.ts");
    expect(m.some((e) => e.ruleId === "no-restricted-imports")).toBe(true);
  });
  it("src/core darf kein document nutzen", async () => {
    const m = await lint("export const x = document.title;\n", "src/core/x.ts");
    expect(m.some((e) => e.ruleId === "no-restricted-globals")).toBe(true);
  });
  it("sauberer Kerncode ist fehlerfrei", async () => {
    const m = await lint("export const x = 1;\n", "src/core/x.ts");
    expect(m).toEqual([]);
  });
});
