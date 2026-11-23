/** Unterlagen in der UI (PLAN Schritte 15/16): DXF (Vektor, fangbar) und PDF (Bitmap, kalibrierbar). */
import { ausNenner, anwenden, zuPasspunkten, type Aehnlichkeit, type SnapSegment, type Unterlage } from "../core/index";
import { flatten, parseDxf, type DxfDokument } from "../io/dxf";
import type { LayerDraw } from "./canvas/stage";

export interface UnterlageUI {
  readonly art: "dxf" | "pdf";
  readonly name: string;
  readonly pruefsumme: string;
  /** DXF-Layer (leer bei PDF). */
  readonly layer: readonly string[];
  readonly sichtbar: ReadonlySet<string>;
  /** Einheit laut `$INSUNITS` unbekannt (Annahme 1 Einheit = 1 m). */
  readonly einheitUnbekannt: boolean;
  setLayer(name: string, an: boolean): void;
  /** Fangbare Strecken in Welt-Metern (nur sichtbare Layer). */
  segmente(): readonly SnapSegment[];
  readonly draw: LayerDraw;
  /** minX, minY, maxX, maxY in Welt-Metern; null, wenn leer. */
  bounds(): [number, number, number, number] | null;
  /** Nur PDF: Abbildung Seite (pt, y nach oben) → Welt (m). */
  /** Nur DXF: Ausrichtung der Zeichnung (Zwei-Punkt-Zuordnung, Schritt 22a). */
  readonly ausrichtung?: { get(): Aehnlichkeit; set(t: Aehnlichkeit): void };
  /** Nur PDF: gewählte Seite (1-basiert). */
  readonly seite?: number;
  readonly kalibrierung?: {
    get(): Aehnlichkeit;
    set(t: Aehnlichkeit): void;
    /** Seitengröße in pt. */
    readonly breite: number;
    readonly hoehe: number;
  };
}

export async function sha256(bytes: ArrayBuffer): Promise<string> {
  try {
    const h = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch { return "0".repeat(64); }
}

const css = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

export async function ladeDxf(file: File): Promise<UnterlageUI> {
  const buf = await file.arrayBuffer();
  const doc: DxfDokument = parseDxf(new TextDecoder("utf-8").decode(buf));
  const sichtbar = new Set(doc.layer);
  let cache: { segmente: readonly SnapSegment[]; pfad: Path2D; bounds: [number, number, number, number] | null } | null = null;
  let tr: Aehnlichkeit = { a: 1, b: 0, tx: 0, ty: 0 };
  const bauen = () => {
    const r = flatten(doc, { layerSichtbar: sichtbar });
    const pfad = new Path2D();
    let b: [number, number, number, number] | null = null;
    const segmente = r.segmente.map((s0) => ({ a: anwenden(tr, s0.a), b: anwenden(tr, s0.b) }));
    for (const s of segmente) {
      pfad.moveTo(s.a.x, s.a.y); pfad.lineTo(s.b.x, s.b.y);
      for (const p of [s.a, s.b]) {
        b = b ? [Math.min(b[0], p.x), Math.min(b[1], p.y), Math.max(b[2], p.x), Math.max(b[3], p.y)] : [p.x, p.y, p.x, p.y];
      }
    }
    return { segmente, pfad, bounds: b, einheitBekannt: r.einheitBekannt };
  };
  const erst = bauen();
  cache = erst;
  return {
    art: "dxf", name: file.name, pruefsumme: await sha256(buf), layer: doc.layer, sichtbar,
    einheitUnbekannt: !erst.einheitBekannt,
    ausrichtung: { get: () => tr, set(t) { tr = t; cache = null; } },
    setLayer(name, an) { if (an) sichtbar.add(name); else sichtbar.delete(name); cache = null; },
    segmente() { cache ??= bauen(); return cache.segmente; },
    bounds() { cache ??= bauen(); return cache.bounds; },
    draw(ctx, vp) {
      cache ??= bauen();
      ctx.globalAlpha = Number(css("--underlay-opacity", "0.45"));
      ctx.strokeStyle = css("--text-muted", "#888");
      ctx.lineWidth = 1 / vp.scale;
      ctx.stroke(cache.pfad);
    },
  };
}

/** Modell-Eintrag für die Unterlage (Verweis; DXF liegt bereits in Metern, Passpunkte = Identität). */
export function dxfModell(u: UnterlageUI): Unterlage {
  return {
    dateiname: u.name, art: "dxf", pruefsumme: { algorithmus: "sha-256", wert: u.pruefsumme },
    passpunkte: zuPasspunkten(u.ausrichtung?.get() ?? { a: 1, b: 0, tx: 0, ty: 0 }),
  };
}

const PDF_MAX_PX = 6000;
const PDF_STANDARD_NENNER = 100;

/** PDF-Seite als Bitmap (pdf.js lokal gebündelt, Worker ohne CDN). Standardmaßstab 1:100 bis zur Kalibrierung. */
export async function ladePdf(file: File, seite = 1): Promise<UnterlageUI> {
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const buf = await file.arrayBuffer();
  const pruefsumme = await sha256(buf);
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise;
  const seiteNr = Math.min(Math.max(1, Math.round(seite)), doc.numPages);
  const page = await doc.getPage(seiteNr);
  const base = page.getViewport({ scale: 1 });
  const rs = Math.min(4, PDF_MAX_PX / Math.max(base.width, base.height));
  const vpR = page.getViewport({ scale: rs });
  const bitmap = document.createElement("canvas");
  bitmap.width = Math.ceil(vpR.width); bitmap.height = Math.ceil(vpR.height);
  const bctx = bitmap.getContext("2d");
  if (!bctx) throw new Error("Canvas 2D nicht verfügbar");
  bctx.fillStyle = "#ffffff"; bctx.fillRect(0, 0, bitmap.width, bitmap.height);
  await page.render({ canvas: bitmap, canvasContext: bctx, viewport: vpR }).promise;

  let t: Aehnlichkeit = ausNenner(PDF_STANDARD_NENNER)!;
  const W = base.width, H = base.height;
  return {
    art: "pdf", name: file.name, pruefsumme, seite: seiteNr, layer: [], sichtbar: new Set(), einheitUnbekannt: false,
    setLayer() {}, segmente: () => [],
    bounds() {
      const c = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }].map((p) => anwenden(t, p));
      return [Math.min(...c.map((p) => p.x)), Math.min(...c.map((p) => p.y)), Math.max(...c.map((p) => p.x)), Math.max(...c.map((p) => p.y))];
    },
    kalibrierung: { get: () => t, set: (n) => { t = n; }, breite: W, hoehe: H },
    draw(ctx) {
      ctx.globalAlpha = Number(css("--underlay-opacity", "0.45"));
      ctx.transform(t.a, t.b, -t.b, t.a, t.tx, t.ty);          // Seite (pt, y oben) → Welt
      ctx.transform(1 / rs, 0, 0, -1 / rs, 0, H);               // Bitmap-px → Seite
      ctx.drawImage(bitmap, 0, 0);
    },
  };
}

/** Modell-Eintrag (PDF): Passpunkte aus der aktuellen Abbildung, optional Maßstabsnenner. */
export function pdfModell(u: UnterlageUI, passpunkte: Unterlage["passpunkte"], massstab?: number): Unterlage {
  return {
    dateiname: u.name, art: "pdf", pruefsumme: { algorithmus: "sha-256", wert: u.pruefsumme }, seite: u.seite ?? 1,
    ...(massstab ? { massstab } : {}), passpunkte,
  };
}
