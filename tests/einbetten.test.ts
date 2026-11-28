import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { entpackeUnterlage, einzelseitePdf, gunzip, gzip, packeUnterlage } from "../src/ui/einbetten";

const dreiSeiten = async (): Promise<ArrayBuffer> => {
  const d = await PDFDocument.create();
  for (const w of [200, 300, 400]) d.addPage([w, 100]);
  const b = await d.save();
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

describe("Unterlage einbetten (gzip, nur gewählte PDF-Seite)", () => {
  it("gzip-Roundtrip und echte Verkleinerung", async () => {
    const d = new TextEncoder().encode("0\nSECTION\n".repeat(2000)) as Uint8Array<ArrayBuffer>;
    const z = await gzip(d);
    expect(z.length).toBeLessThan(d.length / 10);
    expect(await gunzip(z)).toEqual(d);
  });

  it("PDF: nur die gewählte Seite landet in der Datei", async () => {
    const quelle = await dreiSeiten();
    const e = await einzelseitePdf(quelle, 2);
    const doc = await PDFDocument.load(e);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getPage(0).getWidth()).toBe(300);
  });

  it("packe/entpacke: DXF unverändert, PDF einseitig; ältere unkomprimierte Daten bleiben lesbar", async () => {
    const dxf = new TextEncoder().encode("0\nEOF\n");
    const p = await packeUnterlage(dxf.buffer.slice(0) as ArrayBuffer, "dxf", undefined);
    expect(p.eingebettet.komprimiert).toBe("gzip");
    expect(await entpackeUnterlage(p.eingebettet)).toEqual(dxf);
    const pdf = await packeUnterlage(await dreiSeiten(), "pdf", 3);
    expect((await PDFDocument.load(await entpackeUnterlage(pdf.eingebettet))).getPage(0).getWidth()).toBe(400);
    const alt = await entpackeUnterlage({ base64: btoa("hallo") });
    expect(new TextDecoder().decode(alt)).toBe("hallo");
  });
});

import { gunzip as _gunzip, gzip as _gzip, MAX_ENTPACKT as _MAX } from "../src/ui/einbetten";
describe("Entpacken (Review M10)", () => {
  it("kaputtes gzip wirft", async () => {
    await expect(_gunzip(new Uint8Array([1, 2, 3, 4]) as Uint8Array<ArrayBuffer>)).rejects.toBeDefined();
  });
  it("Grenze ist gesetzt", () => { expect(_MAX).toBeGreaterThan(1e7); });
  it("Rundlauf", async () => {
    const d = new Uint8Array([5, 6, 7]) as Uint8Array<ArrayBuffer>;
    expect(Array.from(await _gunzip(await _gzip(d)))).toEqual([5, 6, 7]);
  });
});
