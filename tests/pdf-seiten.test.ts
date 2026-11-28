import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Fixture mehrseitig.pdf", () => {
  it("3 Seiten in unterschiedlichen Formaten", async () => {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs" as string) as typeof import("pdfjs-dist");
    const doc = await pdfjs.getDocument({ data: Uint8Array.from(readFileSync("tests/fixtures/mehrseitig.pdf", "utf8"), (c) => c.charCodeAt(0)), useWorkerFetch: false, isEvalSupported: false }).promise;
    expect(doc.numPages).toBe(3);
    const gr: number[][] = [];
    for (let i = 1; i <= 3; i++) { const v = (await doc.getPage(i)).getViewport({ scale: 1 }); gr.push([Math.round(v.width), Math.round(v.height)]); }
    expect(gr).toEqual([[595, 842], [842, 595], [300, 200]]);
  }, 30000); // pdfjs-Start ist unter Windows-CI/Last langsam (5 s reichten nicht)
});
