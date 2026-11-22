/**
 * DXF-Export (PLAN Schritt 29): Layer je Objektart, Plattenraster, Texte. ASCII-DXF (AC1015), Einheit Meter ($INSUNITS = 6),
 * Koordinaten wie im Projektmodell (y nach oben). Reine Funktion; Sonderzeichen in Texten als \U+XXXX.
 */
import {
  konturKante, plattenDaemmdicke,
  type Dachflaeche, type InsulationLayout, type ProjectModel, type SlopeResult, type Vec2,
} from "../../core/index";

export const DXF_LAYER = {
  kontur: "FDP_KONTUR", aufbau: "FDP_AUFBAUTEN", zone: "FDP_ZONEN", attika: "FDP_ATTIKA", tuer: "FDP_TUERSCHWELLE",
  ablauf: "FDP_ENTWAESSERUNG", falt: "FDP_GRAT_KEHLE", platte: "FDP_DAEMM_PLATTEN", zusatz: "FDP_DAEMM_ZUSATZLAGE",
  pfeil: "FDP_VERLEGERICHTUNG", start: "FDP_VERLEGESTART", textPlatte: "FDP_TEXT_PLATTEN", textKote: "FDP_TEXT_KOTEN", textName: "FDP_TEXT_NAMEN",
} as const;

const FARBE: Readonly<Record<string, number>> = {
  FDP_KONTUR: 7, FDP_AUFBAUTEN: 8, FDP_ZONEN: 5, FDP_ATTIKA: 6, FDP_TUERSCHWELLE: 3, FDP_ENTWAESSERUNG: 1, FDP_GRAT_KEHLE: 4,
  FDP_DAEMM_PLATTEN: 8, FDP_DAEMM_ZUSATZLAGE: 2, FDP_VERLEGERICHTUNG: 7, FDP_VERLEGESTART: 1, FDP_TEXT_PLATTEN: 7, FDP_TEXT_KOTEN: 7, FDP_TEXT_NAMEN: 7,
};

export interface DxfExportEingabe {
  readonly modell: ProjectModel;
  readonly slope: SlopeResult;
  readonly plan: InsulationLayout | null;
}

const n = (v: number): string => (Math.round(v * 10000) / 10000).toString();
/** Text für DXF: Nicht-ASCII als \U+XXXX, Zeilenumbrüche entfernt. */
const txt = (s: string): string => Array.from(s.replace(/[\r\n]+/g, " ").slice(0, 250)).map((c) => { const cp = c.codePointAt(0) ?? 63; return cp > 0xffff ? "?" : cp > 126 ? `\\U+${cp.toString(16).toUpperCase().padStart(4, "0")}` : c; }).join("");

class Schreiber {
  private readonly z: string[] = [];
  private h = 0x100;
  g(code: number, wert: string | number): void { this.z.push(String(code), String(wert)); }
  handle(): void { this.g(5, (this.h++).toString(16).toUpperCase()); }
  text(): string { return `${this.z.join("\n")}\n`; }
}

function linie(w: Schreiber, layer: string, a: Vec2, b: Vec2): void {
  w.g(0, "LINE"); w.handle(); w.g(100, "AcDbEntity"); w.g(8, layer); w.g(100, "AcDbLine");
  w.g(10, n(a.x)); w.g(20, n(a.y)); w.g(30, 0); w.g(11, n(b.x)); w.g(21, n(b.y)); w.g(31, 0);
}
function ring(w: Schreiber, layer: string, pts: readonly Vec2[], geschlossen: boolean): void {
  if (pts.length < 2) return;
  w.g(0, "LWPOLYLINE"); w.handle(); w.g(100, "AcDbEntity"); w.g(8, layer); w.g(100, "AcDbPolyline");
  w.g(90, pts.length); w.g(70, geschlossen ? 1 : 0);
  for (const p of pts) { w.g(10, n(p.x)); w.g(20, n(p.y)); }
}
function kreis(w: Schreiber, layer: string, c: Vec2, r: number): void {
  w.g(0, "CIRCLE"); w.handle(); w.g(100, "AcDbEntity"); w.g(8, layer); w.g(100, "AcDbCircle");
  w.g(10, n(c.x)); w.g(20, n(c.y)); w.g(30, 0); w.g(40, n(r));
}
function beschriftung(w: Schreiber, layer: string, t: string, p: Vec2, hoehe: number, mitte = false): void {
  w.g(0, "TEXT"); w.handle(); w.g(100, "AcDbEntity"); w.g(8, layer); w.g(100, "AcDbText");
  w.g(10, n(p.x)); w.g(20, n(p.y)); w.g(30, 0); w.g(40, n(hoehe)); w.g(1, txt(t));
  if (mitte) { w.g(72, 1); w.g(11, n(p.x)); w.g(21, n(p.y)); w.g(31, 0); }
  w.g(100, "AcDbText");
  if (mitte) w.g(73, 2);
}

function dachObjekte(w: Schreiber, d: Dachflaeche): void {
  ring(w, DXF_LAYER.kontur, d.kontur, true);
  for (const a of d.aufbauten) ring(w, DXF_LAYER.aufbau, a.kontur, true);
  for (const z of d.zonen) ring(w, DXF_LAYER.zone, z.kontur, true);
  for (const a of d.attika) { const k = konturKante(d.kontur, a.kante); if (k) linie(w, DXF_LAYER.attika, k[0], k[1]); }
  for (const t of d.tuerschwellen) {
    const k = konturKante(d.kontur, t.lage.kante);
    if (!k) continue;
    const len = Math.hypot(k[1].x - k[0].x, k[1].y - k[0].y);
    if (len < 1e-9) continue;
    const ux = (k[1].x - k[0].x) / len, uy = (k[1].y - k[0].y) / len, a0 = t.lage.abstand, a1 = a0 + t.breite;
    linie(w, DXF_LAYER.tuer, { x: k[0].x + ux * a0, y: k[0].y + uy * a0 }, { x: k[0].x + ux * a1, y: k[0].y + uy * a1 });
  }
}

/** Baut die DXF-Datei als Text. */
export function baueProjektDxf(e: DxfExportEingabe): string {
  const w = new Schreiber();
  const layer = Object.values(DXF_LAYER);
  w.g(0, "SECTION"); w.g(2, "HEADER");
  w.g(9, "$ACADVER"); w.g(1, "AC1015");
  w.g(9, "$INSUNITS"); w.g(70, 6);
  w.g(0, "ENDSEC");
  w.g(0, "SECTION"); w.g(2, "TABLES");
  w.g(0, "TABLE"); w.g(2, "LAYER"); w.g(70, layer.length);
  for (const l of layer) { w.g(0, "LAYER"); w.g(2, l); w.g(70, 0); w.g(62, FARBE[l] ?? 7); w.g(6, "CONTINUOUS"); }
  w.g(0, "ENDTAB"); w.g(0, "ENDSEC");
  w.g(0, "SECTION"); w.g(2, "ENTITIES");

  for (const d of e.modell.dachflaechen) {
    dachObjekte(w, d);
    for (const en of d.entwaesserung) {
      const bez = `${en.name} z=${n(en.z)}`;
      if (en.art === "les") { linie(w, DXF_LAYER.ablauf, en.von, en.bis); beschriftung(w, DXF_LAYER.textKote, bez, { x: (en.von.x + en.bis.x) / 2, y: (en.von.y + en.bis.y) / 2 }, 0.15); continue; }
      if (en.art === "dachreiter") {
        const k = konturKante(d.kontur, en.lage.kante);
        if (!k) continue;
        const len = Math.hypot(k[1].x - k[0].x, k[1].y - k[0].y);
        if (len < 1e-9) continue;
        const p = { x: k[0].x + (k[1].x - k[0].x) * en.lage.abstand / len, y: k[0].y + (k[1].y - k[0].y) * en.lage.abstand / len };
        kreis(w, DXF_LAYER.ablauf, p, 0.1); beschriftung(w, DXF_LAYER.textKote, bez, p, 0.15);
        continue;
      }
      kreis(w, DXF_LAYER.ablauf, en.position, en.art === "notablauf" ? 0.15 : 0.1);
      beschriftung(w, DXF_LAYER.textKote, bez, en.position, 0.15);
    }
  }
  for (const g of e.slope.dachflaechen) {
    for (const l of [...g.linien, ...g.zonen.flatMap((z) => z.linien)]) linie(w, DXF_LAYER.falt, l.von, l.bis);
  }
  if (e.plan) {
    for (const d of e.plan.dachflaechen) {
      for (const p of d.platten) {
        const l = p.zusatzlagen > 0 ? DXF_LAYER.zusatz : DXF_LAYER.platte;
        ring(w, l, p.polygon.outer, true);
        for (const h of p.polygon.holes) ring(w, l, h, true);
        const o = p.polygon.outer;
        if (o.length >= 3) {
          const c = { x: o.reduce((s, q) => s + q.x, 0) / o.length, y: o.reduce((s, q) => s + q.y, 0) / o.length };
          beschriftung(w, DXF_LAYER.textPlatte, p.bezeichnung, c, 0.1, true);
        }
      }
      for (const pf of d.pfeile) linie(w, DXF_LAYER.pfeil, pf.start, { x: pf.start.x + pf.richtung.x * 0.4, y: pf.start.y + pf.richtung.y * 0.4 });
      for (const v of d.verlegestarts) { kreis(w, DXF_LAYER.start, v.punkt, 0.1); beschriftung(w, DXF_LAYER.textName, "Verlegestart", v.punkt, 0.12); }
      const dk = plattenDaemmdicke(d);
      if (d.n0) { kreis(w, DXF_LAYER.start, d.n0.position, 0.06); beschriftung(w, DXF_LAYER.textName, `N0 z=${n(d.n0.kote)}${dk ? ` Ø ${Math.round(dk.mittel)} mm` : ""}`, d.n0.position, 0.12); }
    }
  }
  w.g(0, "ENDSEC");
  w.g(0, "EOF");
  return w.text();
}
