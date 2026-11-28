/** Unterlage in der Projektdatei: gzip-komprimiert, bei PDF nur die gewählte Seite. Ohne UI-Abhängigkeit. */
import { base64ZuBytes, bytesZuBase64 } from "./speicher";

type Roh = Uint8Array<ArrayBuffer>;

async function stroeme(daten: Roh, ts: CompressionStream | DecompressionStream): Promise<Roh> {
  const w = ts.writable.getWriter();
  void w.write(daten).then(() => w.close()).catch(() => undefined);
  return new Uint8Array(await new Response(ts.readable).arrayBuffer());
}
export const gzip = (d: Roh): Promise<Roh> => stroeme(d, new CompressionStream("gzip"));
export const gunzip = (d: Roh): Promise<Roh> => stroeme(d, new DecompressionStream("gzip"));

/** Einseitiges PDF aus Seite `seite` (1-basiert) eines PDFs. */
export async function einzelseitePdf(bytes: ArrayBuffer, seite: number): Promise<Roh> {
  const { PDFDocument } = await import("pdf-lib");
  const quelle = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const n = quelle.getPageCount();
  const ziel = await PDFDocument.create();
  const [s] = await ziel.copyPages(quelle, [Math.min(Math.max(1, Math.round(seite)), n) - 1]);
  ziel.addPage(s!);
  return new Uint8Array(await ziel.save()) as Roh;
}

export interface EingebetteteUnterlage { readonly base64: string; readonly komprimiert: "gzip" }

/** Bytes für die Projektdatei: PDF → nur die gewählte Seite; danach gzip + Base64. Liefert auch die Bytes vor der Kompression. */
export async function packeUnterlage(bytes: ArrayBuffer, art: "pdf" | "dxf", seite: number | undefined): Promise<{ eingebettet: EingebetteteUnterlage; roh: Roh }> {
  const roh = art === "pdf" ? await einzelseitePdf(bytes, seite ?? 1) : new Uint8Array(bytes.slice(0));
  const z = await gzip(roh);
  return { eingebettet: { base64: bytesZuBase64(z.buffer), komprimiert: "gzip" }, roh };
}

/** Rückweg; ältere Dateien ohne `komprimiert` enthalten die Originalbytes. */
export async function entpackeUnterlage(e: { base64: string; komprimiert?: "gzip" }): Promise<Roh> {
  const b = base64ZuBytes(e.base64);
  return e.komprimiert === "gzip" ? gunzip(b) : b;
}
