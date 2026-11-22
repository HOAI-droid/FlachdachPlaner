import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version), __APP_BUILD__: JSON.stringify(new Date().toISOString().slice(0, 10)) },
  test: { include: ["tests/**/*.test.ts", "src/**/*.test.ts"] },
});
