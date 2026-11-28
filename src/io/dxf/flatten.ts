/**
 * DXF → Strecken in Metern (PLAN Schritt 15). ARC/CIRCLE/Bulge werden so in Sehnen zerlegt,
 * dass der Sehnenfehler (Pfeilhöhe) ≤ `sehnenfehler` bleibt. Rein, ohne DOM.
 */
import type { SnapSegment } from "../../core/snap";
import { type DxfDokument, type DxfEntitaet, type DxfPunkt, einheitFaktor } from "./parse";

export interface UnterlagenSegment extends SnapSegment { readonly layer: string }

export interface FlattenOptionen {
  /** Sichtbare Layer; ohne Angabe alle. Layer eines INSERT-Inhalts „0“ erbt den Layer des INSERT. */
  readonly layerSichtbar?: ReadonlySet<string>;
  /** Maximaler Sehnenfehler in m (Standard 0,001). */
  readonly sehnenfehler?: number;
  /** Faktor Zeichnungseinheit → m; Standard aus `$INSUNITS` (unbekannt → 1). */
  readonly faktor?: number;
}

export interface FlattenErgebnis {
  readonly segmente: readonly UnterlagenSegment[];
  /** false, wenn `$INSUNITS` fehlt/unbekannt ist (dann Annahme 1 Einheit = 1 m, Nutzer prüft per Kalibrierung). */
  readonly einheitBekannt: boolean;
  readonly faktor: number;
}

/** Affine Abbildung (Zeichnungsraum → Meter): x' = a x + c y + e, y' = b x + d y + f. */
interface Mat { a: number; b: number; c: number; d: number; e: number; f: number }
const MAX_TIEFE = 8;

const anwenden = (m: Mat, p: DxfPunkt): DxfPunkt => ({ x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f });
const mul = (m: Mat, n: Mat): Mat => ({ // m ∘ n (erst n, dann m)
  a: m.a * n.a + m.c * n.b, b: m.b * n.a + m.d * n.b, c: m.a * n.c + m.c * n.d, d: m.b * n.c + m.d * n.d,
  e: m.a * n.e + m.c * n.f + m.e, f: m.b * n.e + m.d * n.f + m.f,
});
const maxSkala = (m: Mat): number => Math.max(Math.hypot(m.a, m.b), Math.hypot(m.c, m.d));

/** Anzahl Sehnen für Bogen mit Radius r (m) und Öffnungswinkel `sweep` (rad), Pfeilhöhe ≤ tol. */
export function sehnenAnzahl(r: number, sweep: number, tol: number): number {
  if (!(r > tol) || !(sweep > 0)) return 1;
  const schritt = 2 * Math.acos(1 - tol / r);
  return Math.max(1, Math.ceil(sweep / schritt));
}

function bogenPunkte(mitte: DxfPunkt, r: number, a0: number, sweep: number, m: Mat, tol: number): DxfPunkt[] {
  const n = sehnenAnzahl(r * maxSkala(m), Math.abs(sweep), tol);
  const out: DxfPunkt[] = [];
  for (let i = 0; i <= n; i++) {
    const w = a0 + (sweep * i) / n;
    out.push(anwenden(m, { x: mitte.x + r * Math.cos(w), y: mitte.y + r * Math.sin(w) }));
  }
  return out;
}

/** Sweep von start nach ende (Grad, gegen den Uhrzeigersinn) in rad, in (0, 2π]. */
function sweepCCW(startGrad: number, endeGrad: number): number {
  let s = ((endeGrad - startGrad) % 360 + 360) % 360;
  if (s === 0) s = 360;
  return (s * Math.PI) / 180;
}

function ketten(punkte: readonly DxfPunkt[], layer: string, out: UnterlagenSegment[]): void {
  for (let i = 0; i + 1 < punkte.length; i++) out.push({ a: punkte[i]!, b: punkte[i + 1]!, layer });
}

function verarbeite(
  e: DxfEntitaet, m: Mat, layerErbe: string | null, doc: DxfDokument, tol: number,
  sichtbar: ReadonlySet<string> | undefined, out: UnterlagenSegment[], tiefe: number,
): void {
  const layer = e.layer === "0" && layerErbe !== null ? layerErbe : e.layer;
  if (sichtbar && !sichtbar.has(layer)) return;
  switch (e.typ) {
    case "LINE": out.push({ a: anwenden(m, e.a), b: anwenden(m, e.b), layer }); break;
    case "CIRCLE": ketten(bogenPunkte(e.mitte, e.r, 0, 2 * Math.PI, m, tol), layer, out); break;
    case "ARC": ketten(bogenPunkte(e.mitte, e.r, (e.start * Math.PI) / 180, sweepCCW(e.start, e.ende), m, tol), layer, out); break;
    case "LWPOLYLINE": {
      const n = e.punkte.length;
      const kanten = e.geschlossen ? n : n - 1;
      const pts: DxfPunkt[] = [];
      for (let i = 0; i < kanten; i++) {
        const p = e.punkte[i]!, q = e.punkte[(i + 1) % n]!, b = e.bulge[i] ?? 0;
        if (pts.length === 0) pts.push(anwenden(m, p));
        if (Math.abs(b) < 1e-12) { pts.push(anwenden(m, q)); continue; }
        const sehne = Math.hypot(q.x - p.x, q.y - p.y);
        if (sehne === 0) continue;
        const theta = 4 * Math.atan(b);            // Öffnungswinkel, Vorzeichen = Richtung
        const r = sehne / (2 * Math.sin(Math.abs(theta) / 2));
        const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
        const h = r * Math.cos(theta / 2);          // Abstand Mitte–Sehne (vorzeichenbehaftet)
        const nx = -(q.y - p.y) / sehne, ny = (q.x - p.x) / sehne; // links der Sehne
        const mitte = { x: mx + nx * h * Math.sign(b), y: my + ny * h * Math.sign(b) };
        const ang = (pt: DxfPunkt) => Math.atan2(pt.y - mitte.y, pt.x - mitte.x);
        const bogen = bogenPunkte(mitte, r, ang(p), theta, m, tol);
        bogen[bogen.length - 1] = anwenden(m, q);   // Endpunkt exakt
        pts.push(...bogen.slice(1));
      }
      ketten(pts, layer, out);
      break;
    }
    case "INSERT": {
      const blk = doc.bloecke.get(e.block);
      if (!blk || tiefe >= MAX_TIEFE) return;
      const w = (e.drehung * Math.PI) / 180, co = Math.cos(w), si = Math.sin(w);
      // Blockpunkt → (Basis abziehen) → skalieren → drehen → verschieben → übergeordnet
      const lokal: Mat = {
        a: co * e.sx, b: si * e.sx, c: -si * e.sy, d: co * e.sy,
        e: e.pos.x - (co * e.sx * blk.basis.x - si * e.sy * blk.basis.y),
        f: e.pos.y - (si * e.sx * blk.basis.x + co * e.sy * blk.basis.y),
      };
      const mm = mul(m, lokal);
      for (const k of blk.entitaeten) verarbeite(k, mm, layer, doc, tol, sichtbar, out, tiefe + 1);
      break;
    }
  }
}

export function flatten(doc: DxfDokument, opt: FlattenOptionen = {}): FlattenErgebnis {
  const f0 = einheitFaktor(doc.insunits);
  const faktor = opt.faktor ?? f0 ?? 1;
  const tol = opt.sehnenfehler ?? 0.001;
  const m: Mat = { a: faktor, b: 0, c: 0, d: faktor, e: 0, f: 0 };
  const out: UnterlagenSegment[] = [];
  for (const e of doc.entitaeten) verarbeite(e, m, null, doc, tol, opt.layerSichtbar, out, 0);
  return { segmente: out, einheitBekannt: f0 !== null, faktor };
}
