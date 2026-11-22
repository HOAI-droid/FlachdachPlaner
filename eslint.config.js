import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "tests/fixtures/lint"] },
  ...tseslint.configs.recommended,
  {
    // Der Kern ist UI-unabhängig: kein DOM, keine UI-/3D-Importe.
    files: ["src/core/**/*.ts"],
    languageOptions: { globals: {} },
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          { group: ["**/ui", "**/ui/*", "three", "three/*", "preact", "preact/*"], message: "src/core darf UI/3D nicht importieren." },
        ],
      }],
      "no-restricted-globals": ["error", "document", "window", "navigator", "localStorage"],
    },
  },
);
