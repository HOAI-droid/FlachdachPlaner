/**
 * Planblätter als PDF (PLAN Schritt 28, DESIGN §10 Punkt 13 und §11): Gefälleplan und Gefälledämmplan.
 * A3 quer, weißer Grund, ISO-128-Strichstärken, Schriftfeld 180 × 50 mm, Legende, Nordpfeil, Maßstabsbalken.
 * Reine Funktion von Modell und Ergebnissen; keine UI-Farben.
 */
import {
  attikaStreifen, dickeAn, kotenMarken, plattenDaemmdicke, polygonCentroid,
  type CatchmentResult, type Dachflaeche, type Entwaesserung, type InsulationLayout, type ProjectModel, type SlopeResult, type Vec2,
} from "../../core/index";
import { PdfDokument, textBreite, type PdfSeite, type Punkt } from "./pdf";

export interface PlanEingabe {
  readonly modell: ProjectModel;
  readonly slope: SlopeResult;
  readonly catchments: CatchmentResult;
  /** Einzugsflächen-ID → „E3“. */
  readonly eids: ReadonlyMap<string, string>;
  readonly plan: InsulationLayout | null;
  /** Füllfarbe (#rrggbb) je Farbindex der Einzugsfläche. */
  readonly farbe: (i: number) => string;
  /** Datum im Schriftfeld, z. B. „22.11.2026“. */
  readonly datum: string;
  /** Regelwerk samt Version, z. B. „DIN 18531 · Pack 1.0“. */
  readonly regelwerk: string;
}

export interface PlanErgebnis {
  readonly bytes: Uint8Array;
  readonly massstab: number;
}

// ---------- Blatt ----------
export const BLATT = { b: 420, h: 297, rand: 10 } as const;
const PLAN = { x0: 15, y0: 67, x1: 300, y1: 282 } as const;
const SEITE = { x0: 305, x1: 405 } as const;
/** Genormte Maßstäbe (1 : n). */
export const MASSSTAEBE = [20, 25, 50, 75, 100, 125, 150, 200, 250, 500, 1000] as const;
const LW = { fein: 0.18, normal: 0.25, mittel: 0.35, stark: 0.5, kontur: 0.7 } as const;
const T = { klein: 2.5, normal: 3.5, gross: 5 } as const;

/** Weltkoordinate (m) → Blattkoordinate (mm). */
export class Abbildung {
  constructor(readonly massstab: number, readonly x0: number, readonly y0: number, readonly ox: number, readonly oy: number) {}
  x(m: number): number { return this.ox + ((m - this.x0) * 1000) / this.massstab; }
  y(m: number): number { return this.oy + ((m - this.y0) * 1000) / this.massstab; }
  p(v: Vec2): Punkt { return { x: this.x(v.x), y: this.y(v.y) }; }
  /** Länge in Metern → mm auf dem Blatt. */
  mm(m: number): number { return (m * 1000) / this.massstab; }
}

/** Kleinster genormter Maßstab, bei dem die Zeichnung (m) in die verfügbare Fläche (mm) passt. */
export function waehleMassstab(breiteM: number, hoeheM: number, verfBreite: number, verfHoehe: number): number {
  for (const n of MASSSTAEBE) if ((breiteM * 1000) / n <= verfBreite && (hoeheM * 1000) / n <= verfHoehe) return n;
  return MASSSTAEBE[MASSSTAEBE.length - 1]!;
}

const zahl = (w: number, st = 2): string => {
  const s = Math.abs(w) < 0.5 * 10 ** -st ? (0).toFixed(st) : w.toFixed(st);
  return s.replace(".", ",");
};
const kote = (w: number): string => (w < 0 && Math.abs(w) >= 0.0005 ? "-" : "+") + zahl(Math.abs(w), 3);

/** Mischt Farbe mit Weiß (anteil = Farbanteil). */
function tint(hex: string, anteil: number): string {
  const v = parseInt(hex.slice(1), 16);
  const k = (s: number) => Math.round(255 - (255 - ((v >> s) & 255)) * anteil).toString(16).padStart(2, "0");
  return `#${k(16)}${k(8)}${k(0)}`;
}

/** Belegte Rechtecke gegen überlappende Beschriftung. */
class Frei {
  private readonly r: [number, number, number, number][] = [];
  belege(x: number, y: number, w: number, h: number): boolean {
    if (this.r.some(([a, b, c, d]) => x < c && x + w > a && y < d && y + h > b)) return false;
    this.r.push([x, y, x + w, y + h]);
    return true;
  }
}

function umfang(m: ProjectModel): { x0: number; y0: number; x1: number; y1: number } | null {
  const pts = m.dachflaechen.flatMap((d) => [...d.kontur, ...d.attika.flatMap((a) => attikaStreifen(d, a))]);
  if (pts.length === 0) return null;
  return {
    x0: Math.min(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)),
    x1: Math.max(...pts.map((p) => p.x)), y1: Math.max(...pts.map((p) => p.y)),
  };
}

function abbildung(m: ProjectModel): Abbildung {
  const u = umfang(m) ?? { x0: 0, y0: 0, x1: 1, y1: 1 };
  const rand = 22; // Bemaßung, Beschriftung
  const vb = PLAN.x1 - PLAN.x0 - 2 * rand, vh = PLAN.y1 - PLAN.y0 - 2 * rand;
  const n = waehleMassstab(u.x1 - u.x0, u.y1 - u.y0, vb, vh);
  const bw = ((u.x1 - u.x0) * 1000) / n, bh = ((u.y1 - u.y0) * 1000) / n;
  const ox = PLAN.x0 + (PLAN.x1 - PLAN.x0 - bw) / 2, oy = PLAN.y0 + (PLAN.y1 - PLAN.y0 - bh) / 2;
  return new Abbildung(n, u.x0, u.y0, ox, oy);
}

// ---------- Rahmenteile ----------
function rahmen(s: PdfSeite): void {
  const { b, h, rand } = BLATT;
  s.linie([{ x: rand, y: rand }, { x: b - rand, y: rand }, { x: b - rand, y: h - rand }, { x: rand, y: h - rand }], { breite: LW.stark, zu: true });
}

function schriftfeld(s: PdfSeite, e: PlanEingabe, inhalt: string, massstab: number, blatt: string): void {
  const x1 = BLATT.b - BLATT.rand, x0 = x1 - 180, y0 = BLATT.rand, y1 = y0 + 50;
  s.linie([{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], { breite: LW.stark, zu: true });
  const spalte = x0 + 100;
  s.linie([{ x: spalte, y: y0 }, { x: spalte, y: y1 }], { breite: LW.normal });
  for (const dy of [12.5, 25, 37.5]) s.linie([{ x: x0, y: y0 + dy }, { x: x1, y: y0 + dy }], { breite: dy === 25 ? LW.normal : LW.fein });
  const feld = (kopf: string, wert: string, x: number, y: number, g: number = T.normal, fett = false, max = 96) => {
    s.text(kopf, x + 1.5, y + 7.6, { groesse: 1.8, farbe: "#555555" });
    let t = wert;
    while (t.length > 3 && textBreite(t, g, fett) > max) t = t.slice(0, -2) + "…";
    s.text(t, x + 1.5, y + 2.6, { groesse: g, fett });
  };
  const m = e.modell.meta;
  feld("PROJEKT", m.name || "–", x0, y0 + 37.5, T.normal, true);
  feld("PROJEKTNUMMER", m.projektnummer || "–", x0, y0 + 25);
  feld("PLANINHALT", inhalt, x0, y0 + 12.5, T.normal, true);
  feld("BEARBEITER", m.bearbeiter || "–", x0, y0);
  feld("MASSSTAB", `1 : ${massstab}`, spalte, y0 + 37.5, T.normal, true, 76);
  feld("DATUM", e.datum, spalte, y0 + 25, T.normal, false, 76);
  feld("REGELWERK / VERSION", e.regelwerk, spalte, y0 + 12.5, T.klein, false, 76);
  feld("INDEX · BLATT", `– · ${blatt}`, spalte, y0, T.normal, false, 76);
}

function nordpfeil(s: PdfSeite, x: number, y: number): void {
  s.linie([{ x, y }, { x, y: y + 16 }], { breite: LW.mittel });
  s.flaeche([[{ x, y: y + 18 }, { x: x - 2.2, y: y + 12 }, { x: x + 2.2, y: y + 12 }]], { fuell: "#000000", breite: LW.fein });
  s.kreis({ x, y }, 1.2, { breite: LW.normal });
  s.text("N", x, y + 20, { groesse: T.normal, fett: true, anker: "m" });
}

function massstabsbalken(s: PdfSeite, a: Abbildung, x: number, y: number): void {
  const laenge = [2, 4, 10, 20, 40, 100].find((l) => a.mm(l) >= 40) ?? 100;
  const hälfte = laenge / 2, w = a.mm(hälfte);
  s.flaeche([[{ x, y }, { x: x + w, y }, { x: x + w, y: y + 2 }, { x, y: y + 2 }]], { fuell: "#000000", breite: LW.normal });
  s.flaeche([[{ x: x + w, y }, { x: x + 2 * w, y }, { x: x + 2 * w, y: y + 2 }, { x: x + w, y: y + 2 }]], { fuell: "#FFFFFF", breite: LW.normal });
  s.text("0", x, y + 3, { groesse: T.klein, anker: "m" });
  s.text(zahl(hälfte, 0), x + w, y + 3, { groesse: T.klein, anker: "m" });
  s.text(`${zahl(laenge, 0)} m`, x + 2 * w, y + 3, { groesse: T.klein, anker: "m" });
}

function bemassung(s: PdfSeite, a: Abbildung, m: ProjectModel): void {
  const u = umfang(m);
  if (!u) return;
  const pfeil = (p: Punkt, q: Punkt) => {
    const dx = q.x - p.x, dy = q.y - p.y, l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l;
    for (const [pos, r] of [[p, 1], [q, -1]] as const) {
      s.flaeche([[pos, { x: pos.x + r * (ux * 2.4 - uy * 0.5), y: pos.y + r * (uy * 2.4 + ux * 0.5) }, { x: pos.x + r * (ux * 2.4 + uy * 0.5), y: pos.y + r * (uy * 2.4 - ux * 0.5) }]], { fuell: "#000000", breite: 0 });
    }
  };
  const xs = a.x(u.x0), xe = a.x(u.x1), ys = a.y(u.y0), ye = a.y(u.y1);
  const yb = ys - 9, xr = xe + 9;
  s.linie([{ x: xs, y: ys - 1 }, { x: xs, y: yb - 2 }], { breite: LW.fein });
  s.linie([{ x: xe, y: ys - 1 }, { x: xe, y: yb - 2 }], { breite: LW.fein });
  s.linie([{ x: xs, y: yb }, { x: xe, y: yb }], { breite: LW.fein });
  pfeil({ x: xs, y: yb }, { x: xe, y: yb });
  s.text(`${zahl(u.x1 - u.x0, 2)} m`, (xs + xe) / 2, yb + 1, { groesse: T.klein, anker: "m" });
  s.linie([{ x: xe + 1, y: ys }, { x: xr + 2, y: ys }], { breite: LW.fein });
  s.linie([{ x: xe + 1, y: ye }, { x: xr + 2, y: ye }], { breite: LW.fein });
  s.linie([{ x: xr, y: ys }, { x: xr, y: ye }], { breite: LW.fein });
  pfeil({ x: xr, y: ys }, { x: xr, y: ye });
  s.text(`${zahl(u.y1 - u.y0, 2)} m`, xr - 1, (ys + ye) / 2, { groesse: T.klein, anker: "m", winkel: Math.PI / 2 });
}

// ---------- Tabellen und Legende ----------
function tabelle(s: PdfSeite, x: number, y: number, kopf: string, spalten: { t: string; w: number; r?: boolean }[], zeilen: string[][]): number {
  const gesamt = spalten.reduce((a, c) => a + c.w, 0);
  s.text(kopf, x, y, { groesse: T.normal, fett: true });
  y -= 2;
  s.linie([{ x, y }, { x: x + gesamt, y }], { breite: LW.normal });
  y -= 3.6;
  const reihe = (zelle: string[], fett: boolean) => {
    let cx = x;
    zelle.forEach((t, i) => {
      const sp = spalten[i]!;
      let txt = t;
      while (txt.length > 3 && textBreite(txt, 2.5, fett) > sp.w - 1.5) txt = txt.slice(0, -2) + "…";
      if (sp.r) s.text(txt, cx + sp.w - 1, y, { groesse: 2.5, fett, anker: "r" });
      else s.text(txt, cx + 0.5, y, { groesse: 2.5, fett });
      cx += sp.w;
    });
  };
  reihe(spalten.map((c) => c.t), true);
  y -= 1.6;
  s.linie([{ x, y }, { x: x + gesamt, y }], { breite: LW.fein });
  y -= 3.4;
  for (const z of zeilen) { reihe(z, false); y -= 3.5; }
  s.linie([{ x, y: y + 2.2 }, { x: x + gesamt, y: y + 2.2 }], { breite: LW.normal });
  return y - 2;
}

function tabellen(s: PdfSeite, e: PlanEingabe, y: number): void {
  const rows: string[][] = [];
  for (const d of e.modell.dachflaechen) {
    for (const en of d.entwaesserung) rows.push([d.name || d.id, en.name || en.id, ART[en.art], kote(en.z)]);
  }
  y = tabelle(s, SEITE.x0, y, "Ablauf-Koten z (m)", [{ t: "Dachfläche", w: 32 }, { t: "Ablauf", w: 28 }, { t: "Art", w: 22 }, { t: "z [m]", w: 18, r: true }], rows.length ? rows : [["–", "", "", ""]]) - 4;
  const dz: string[][] = [];
  for (const d of e.modell.dachflaechen) {
    const pd = e.plan?.dachflaechen.find((x) => x.dachflaecheId === d.id);
    const k = pd ? plattenDaemmdicke(pd) : null;
    const g = e.slope.dachflaechen.find((x) => x.dachflaecheId === d.id)?.daemmung ?? null;
    const w = k ? [k.mittel, k.min, k.max] : g ? [g.mittel, g.min, g.max] : null;
    dz.push([d.name || d.id, ...(w ? w.map((v) => zahl(v, 0)) : ["–", "–", "–"])]);
  }
  tabelle(s, SEITE.x0, y, "Gefälledämmung (mm)", [{ t: "Dachfläche", w: 36 }, { t: "Ø", w: 20, r: true }, { t: "min", w: 20, r: true }, { t: "max", w: 20, r: true }], dz);
}

const ART: Record<Entwaesserung["art"], string> = { gully: "Gully", notablauf: "Notablauf", dachreiter: "Dachreiter", les: "LES" };

function symbol(s: PdfSeite, art: Entwaesserung["art"], c: Punkt, r = 2): void {
  if (art === "gully") {
    s.kreis(c, r, { breite: LW.mittel, fuell: "#FFFFFF" });
    s.linie([{ x: c.x - r, y: c.y }, { x: c.x + r, y: c.y }], { breite: LW.fein });
    s.linie([{ x: c.x, y: c.y - r }, { x: c.x, y: c.y + r }], { breite: LW.fein });
  } else if (art === "notablauf") {
    s.flaeche([[{ x: c.x, y: c.y + r * 1.2 }, { x: c.x + r * 1.2, y: c.y }, { x: c.x, y: c.y - r * 1.2 }, { x: c.x - r * 1.2, y: c.y }]], { breite: LW.mittel, fuell: "#FFFFFF" });
    s.kreis(c, r * 0.45, { fuell: "#000000", breite: 0 });
  } else if (art === "dachreiter") {
    s.flaeche([[{ x: c.x - r * 1.3, y: c.y - r * 0.7 }, { x: c.x + r * 1.3, y: c.y - r * 0.7 }, { x: c.x + r * 1.3, y: c.y + r * 0.7 }, { x: c.x - r * 1.3, y: c.y + r * 0.7 }]], { breite: LW.mittel, fuell: "#FFFFFF" });
    s.linie([{ x: c.x - r * 1.3, y: c.y - r * 0.7 }, { x: c.x + r * 1.3, y: c.y + r * 0.7 }], { breite: LW.fein });
  } else {
    s.linie([{ x: c.x - r * 1.5, y: c.y }, { x: c.x + r * 1.5, y: c.y }], { breite: LW.stark });
    for (const dx of [-r * 1.2, 0, r * 1.2]) s.linie([{ x: c.x + dx, y: c.y - r * 0.6 }, { x: c.x + dx, y: c.y + r * 0.6 }], { breite: LW.fein });
  }
}

function legendeZeile(s: PdfSeite, y: number, zeichne: (x: number, y: number) => void, t: string): number {
  zeichne(SEITE.x0 + 5, y + 0.9);
  s.text(t, SEITE.x0 + 13, y, { groesse: T.klein });
  return y - 5;
}

// ---------- Planinhalt ----------
function dachEntwaesserung(d: Dachflaeche, e: Entwaesserung): Vec2[] | null {
  if (e.art === "gully" || e.art === "notablauf") return [e.position];
  if (e.art === "les") return [e.von, e.bis];
  const i = d.kontur.findIndex((q) => q.id === e.lage.kante);
  if (i < 0) return null;
  const a = d.kontur[i]!, b = d.kontur[(i + 1) % d.kontur.length]!, l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return [{ x: a.x + ((b.x - a.x) / l) * e.lage.abstand, y: a.y + ((b.y - a.y) / l) * e.lage.abstand }];
}

function konturen(s: PdfSeite, a: Abbildung, m: ProjectModel): void {
  for (const d of m.dachflaechen) {
    for (const au of d.aufbauten) s.linie(au.kontur.map((p) => a.p(p)), { breite: LW.mittel, zu: true });
    for (const z of d.zonen) s.linie(z.kontur.map((p) => a.p(p)), { breite: LW.mittel, zu: true, strich: [3, 1.2] });
    // Attika immer außen an der Kante: Streifen-Außenkante und Stirnseiten (Kante selbst = Dachkontur).
    for (const at of d.attika) {
      const q = attikaStreifen(d, at);
      if (q.length === 4) s.linie([q[1]!, q[2]!, q[3]!, q[0]!].map((p) => a.p(p)), { breite: LW.mittel });
    }
  }
  for (const d of m.dachflaechen) s.linie(d.kontur.map((p) => a.p(p)), { breite: LW.kontur, zu: true });
}

function faltlinien(s: PdfSeite, a: Abbildung, slope: SlopeResult): void {
  for (const g of slope.dachflaechen) {
    for (const l of [...g.linien, ...g.zonen.flatMap((z) => z.linien)]) {
      s.linie([a.p(l.von), a.p(l.bis)], { breite: LW.mittel, ...(l.art === "kehle" ? { strich: [4, 1.2, 0.6, 1.2] } : {}) });
    }
  }
}

function gefaelleplan(s: PdfSeite, a: Abbildung, e: PlanEingabe): void {
  const frei = new Frei();
  // Einzugsflächen: Tint + Label mit ID und m² (im Graustufendruck unterscheidet das Label)
  for (const f of e.catchments.flaechen) {
    const fuell = tint(e.farbe(f.farbe), 0.25);
    for (const p of f.polygone) s.flaeche([p.outer, ...p.holes].map((r) => r.map((v) => a.p(v))), { fuell, breite: 0 });
  }
  konturen(s, a, e.modell);
  faltlinien(s, a, e.slope);
  for (const f of e.catchments.flaechen) {
    const gr = [...f.polygone].sort((p, q) => q.outer.length - p.outer.length)[0];
    if (!gr) continue;
    const c = a.p(polygonCentroid(gr)), t = `${e.eids.get(f.id) ?? ""} · ${zahl(f.gesamtFlaeche, 1)} m²`;
    const w = textBreite(t, T.normal, true);
    if (frei.belege(c.x - w / 2, c.y - 1, w, 4)) s.text(t, c.x, c.y, { groesse: T.normal, fett: true, anker: "m" });
  }
  // Gefällepfeile (bergab) mit Gefälle in %
  for (const g of e.slope.dachflaechen) {
    for (const p of g.pfeile) {
      const v = a.p(p.start), l = 7, ux = p.richtung.x, uy = p.richtung.y;
      const bis = { x: v.x + ux * l, y: v.y + uy * l };
      const t = `${zahl(p.gefaelle * 100, 1)} %`, w = textBreite(t, 2, false);
      if (!frei.belege(Math.min(v.x, bis.x) - 0.5, Math.min(v.y, bis.y) - 0.5, Math.abs(bis.x - v.x) + w + 1, Math.abs(bis.y - v.y) + 3)) continue;
      s.linie([v, bis], { breite: LW.fein });
      s.flaeche([[bis, { x: bis.x - ux * 2 - uy * 0.7, y: bis.y - uy * 2 + ux * 0.7 }, { x: bis.x - ux * 2 + uy * 0.7, y: bis.y - uy * 2 - ux * 0.7 }]], { fuell: "#000000", breite: 0 });
      s.text(t, v.x + (ux >= 0 ? 0.8 : -0.8) + (ux >= 0 ? 0 : -w), v.y - 2.4 * (uy >= 0 ? 1 : -1) * 0 - 2.2, { groesse: 2 });
    }
  }
  // Abläufe
  for (const d of e.modell.dachflaechen) {
    for (const en of d.entwaesserung) {
      const pts = dachEntwaesserung(d, en);
      if (!pts) continue;
      if (en.art === "les" && pts.length === 2) s.linie(pts.map((q) => a.p(q)), { breite: LW.stark });
      const c = a.p(pts[0]!);
      symbol(s, en.art, c);
      const t = `${en.name || en.id} ${kote(en.z)}`, w = textBreite(t, T.klein, true);
      frei.belege(c.x - 3, c.y - 3, 6, 6);
      for (const [dx, dy] of [[3, -1], [-3 - w, -1], [3, 3.5], [-3 - w, 3.5]] as const) {
        if (frei.belege(c.x + dx, c.y + dy, w, 3)) { s.text(t, c.x + dx, c.y + dy + 0.4, { groesse: T.klein, fett: true }); break; }
      }
    }
  }
  // Koten an Ecken, Linienenden, Abläufen (Abläufe sind oben beschriftet)
  // Gebündelt (kotenMarken): nahezu gleiche Stelle und Höhe → eine Kote, auch über Dachflächengrenzen.
  for (const k of kotenMarken(e.slope.dachflaechen)) {
    if (k.art === "ablauf") continue;
    const c = a.p(k.position), t = kote(k.kote), w = textBreite(t, 2, false);
    s.kreis(c, 0.6, { fuell: "#000000", breite: 0 });
    for (const [dx, dy] of [[1, 1], [-1 - w, 1], [1, -3], [-1 - w, -3]] as const) {
      if (frei.belege(c.x + dx, c.y + dy, w, 2.6)) { s.text(t, c.x + dx, c.y + dy + 0.4, { groesse: 2 }); break; }
    }
  }
}

function daemmplan(s: PdfSeite, a: Abbildung, e: PlanEingabe): void {
  const plan = e.plan;
  const gelb = "#F6DF7A";
  const frei = new Frei();
  if (plan) {
    for (const d of plan.dachflaechen) {
      for (const p of d.platten) {
        const ringe = [p.polygon.outer, ...p.polygon.holes].map((r) => r.map((v) => a.p(v)));
        s.flaeche(ringe, { breite: LW.fein, ...(p.zusatzlagen > 0 ? { fuell: gelb } : {}), farbe: "#555555" });
      }
    }
  }
  konturen(s, a, e.modell);
  faltlinien(s, a, e.slope);
  if (!plan) return;
  for (const d of plan.dachflaechen) {
    // Dämmdicke an Ecken, Hoch-/Tiefpunkten und Linienenden
    const dach = e.modell.dachflaechen.find((x) => x.id === d.dachflaecheId);
    const g = e.slope.dachflaechen.find((x) => x.dachflaecheId === d.dachflaecheId);
    const pts: Vec2[] = [];
    const merke = (q: Vec2) => { if (!pts.some((r) => Math.hypot(r.x - q.x, r.y - q.y) < 0.05)) pts.push(q); };
    dach?.kontur.forEach(merke);
    if (g) {
      g.koten.forEach((k) => merke(k.position));
      for (const l of [...g.linien, ...g.zonen.flatMap((z) => z.linien)]) { merke(l.von); merke(l.bis); }
      for (const x of [g.hochpunkt, g.tiefpunkt]) for (const o of x?.orte ?? []) merke(o);
    }
    const ex = d.platten.flatMap((q) => q.polygon.outer), mx = (Math.min(...ex.map((q) => q.x)) + Math.max(...ex.map((q) => q.x))) / 2, my = (Math.min(...ex.map((q) => q.y)) + Math.max(...ex.map((q) => q.y))) / 2;
    for (const q of pts) {
      const mm = dickeAn(d.platten, q);
      if (mm === null) continue;
      const c = a.p(q), t = zahl(mm, 0), w = textBreite(t, 2.2, true);
      s.kreis(c, 0.6, { fuell: "#000000", breite: 0 });
      const ox = q.x <= mx ? 1 : -1, oy = q.y <= my ? 1 : -1;
      const kand: [number, number][] = [];
      for (const [fx, fy] of [[ox, oy], [ox, -oy], [-ox, oy], [-ox, -oy]] as const) kand.push([fx < 0 ? -w - 1 : 1, fy < 0 ? -3.2 : 1]);
      const z = kand.find(([dx, dy]) => frei.belege(c.x + dx, c.y + dy, w, 2.6));
      if (z) s.text(t, c.x + z[0], c.y + z[1] + 0.4, { groesse: 2.2, fett: true });
    }
    // Plattenbezeichnung: große Stücke zuerst, nur wenn sie ins Stück passen
    for (const p of [...d.platten].sort((x, y) => y.flaeche - x.flaeche || (x.id < y.id ? -1 : 1))) {
      const c = a.p(polygonCentroid(p.polygon)), t = p.bezeichnung, w = textBreite(t, 2.5, false);
      if (a.mm(Math.min(p.laenge, p.breite)) < 3.2 || a.mm(Math.max(p.laenge, p.breite)) < w + 1) continue;
      if (frei.belege(c.x - w / 2, c.y - 1, w, 3)) s.text(t, c.x, c.y, { groesse: 2.5, anker: "m" });
    }
    // Verlegerichtung je Reihe
    const refL = Math.max(0.1, ...d.platten.map((q) => q.laenge));
    for (const pf of d.pfeile) {
      const v = a.p(pf.start), l = Math.max(4, Math.min(8, a.mm(0.4 * refL)));
      const ux = pf.richtung.x, uy = pf.richtung.y, bis = { x: v.x + ux * l, y: v.y + uy * l };
      if (!frei.belege(Math.min(v.x, bis.x) - 0.5, Math.min(v.y, bis.y) - 0.5, Math.abs(bis.x - v.x) + 1, Math.abs(bis.y - v.y) + 1)) continue;
      s.linie([v, bis], { breite: LW.fein });
      s.flaeche([[bis, { x: bis.x - ux * 1.8 - uy * 0.6, y: bis.y - uy * 1.8 + ux * 0.6 }, { x: bis.x - ux * 1.8 + uy * 0.6, y: bis.y - uy * 1.8 - ux * 0.6 }]], { fuell: "#000000", breite: 0 });
    }
    if (d.n0) {
      const c = a.p(d.n0.position);
      s.flaeche([[{ x: c.x, y: c.y }, { x: c.x + 5, y: c.y }, { x: c.x + 5, y: c.y - 5 }, { x: c.x, y: c.y - 5 }]], { breite: LW.normal });
      frei.belege(c.x, c.y - 5, 8, 5);
      s.text("N0", c.x + 0.8, c.y - 3.6, { groesse: 2.5 });
    }
    for (const v of d.verlegestarts) {
      const c = a.p(v.punkt);
      s.kreis(c, 1, { fuell: "#000000", breite: 0 });
      const w = textBreite("Verlegestart", 2.5, false);
      for (const [dx, dy] of [[2, 1.5], [-2 - w, 1.5], [2, -4], [-2 - w, -4]] as const) {
        if (frei.belege(c.x + dx, c.y + dy, w, 3)) { s.text("Verlegestart", c.x + dx, c.y + dy + 0.4, { groesse: 2.5 }); break; }
      }
    }
  }
}

function legendeGefaelle(s: PdfSeite, e: PlanEingabe, y: number): number {
  s.text("Legende", SEITE.x0, y, { groesse: T.normal, fett: true });
  y -= 6;
  y = legendeZeile(s, y, (x, yy) => s.linie([{ x: x - 4, y: yy }, { x: x + 4, y: yy }], { breite: LW.kontur }), "Dachkontur");
  y = legendeZeile(s, y, (x, yy) => s.linie([{ x: x - 4, y: yy }, { x: x + 4, y: yy }], { breite: LW.mittel }), "Grat (durchgezogen)");
  y = legendeZeile(s, y, (x, yy) => s.linie([{ x: x - 4, y: yy }, { x: x + 4, y: yy }], { breite: LW.mittel, strich: [2.4, 0.8, 0.5, 0.8] }), "Kehle (Strich-Punkt)");
  y = legendeZeile(s, y, (x, yy) => { s.linie([{ x: x - 4, y: yy }, { x: x + 3, y: yy }], { breite: LW.fein }); s.flaeche([[{ x: x + 4, y: yy }, { x: x + 1.6, y: yy + 0.8 }, { x: x + 1.6, y: yy - 0.8 }]], { fuell: "#000000", breite: 0 }); }, "Gefälle bergab, in %");
  for (const art of ["gully", "notablauf", "dachreiter", "les"] as const) y = legendeZeile(s, y, (x, yy) => symbol(s, art, { x, y: yy }, 1.6), ART[art]);
  y = legendeZeile(s, y, (x, yy) => { s.kreis({ x, y: yy }, 0.6, { fuell: "#000000", breite: 0 }); }, "Kote (m) an Ecke / Grat- und Kehlenende");
  y -= 1;
  s.text("Einzugsflächen (ID · m²)", SEITE.x0, y, { groesse: T.klein, fett: true });
  y -= 4.5;
  for (const f of e.catchments.flaechen.slice(0, 14)) {
    s.flaeche([[{ x: SEITE.x0 + 1, y: y - 0.6 }, { x: SEITE.x0 + 9, y: y - 0.6 }, { x: SEITE.x0 + 9, y: y + 2.6 }, { x: SEITE.x0 + 1, y: y + 2.6 }]], { fuell: tint(e.farbe(f.farbe), 0.25), breite: LW.fein });
    const warn = f.bewertung && f.bewertung.stufe !== "ok" ? `  (${f.bewertung.stufe})` : "";
    s.text(`${e.eids.get(f.id) ?? ""}  ${zahl(f.gesamtFlaeche, 1)} m²${warn}`, SEITE.x0 + 12, y, { groesse: T.klein });
    y -= 4;
  }
  return y - 2;
}

function legendeDaemmplan(s: PdfSeite, y: number): number {
  s.text("Legende", SEITE.x0, y, { groesse: T.normal, fett: true });
  y -= 6;
  y = legendeZeile(s, y, (x, yy) => s.linie([{ x: x - 4, y: yy }, { x: x + 4, y: yy }], { breite: LW.kontur }), "Dachkontur");
  y = legendeZeile(s, y, (x, yy) => s.linie([{ x: x - 4, y: yy }, { x: x + 4, y: yy }], { breite: LW.mittel }), "Kehl- und Gratlinie");
  y = legendeZeile(s, y, (x, yy) => s.linie([{ x: x - 4, y: yy }, { x: x + 4, y: yy }], { breite: LW.fein, farbe: "#555555" }), "Plattengrenze");
  y = legendeZeile(s, y, (x, yy) => s.flaeche([[{ x: x - 4, y: yy - 1 }, { x: x + 4, y: yy - 1 }, { x: x + 4, y: yy + 2 }, { x: x - 4, y: yy + 2 }]], { fuell: "#F6DF7A", breite: LW.fein }), "Zusatzlage (zusätzliche Platte)");
  y = legendeZeile(s, y, (x, yy) => { s.linie([{ x: x - 4, y: yy }, { x: x + 3, y: yy }], { breite: LW.fein }); s.flaeche([[{ x: x + 4, y: yy }, { x: x + 1.6, y: yy + 0.8 }, { x: x + 1.6, y: yy - 0.8 }]], { fuell: "#000000", breite: 0 }); }, "Verlegerichtung je Reihe");
  y = legendeZeile(s, y, (x, yy) => s.kreis({ x, y: yy }, 1, { fuell: "#000000", breite: 0 }), "Verlegestart");
  y = legendeZeile(s, y, (x, yy) => { s.text("3", x, yy - 0.3, { groesse: 2.5, anker: "m" }); }, "Plattentyp (1 … 8, 8A), 1+1 = mit Zusatzlage");
  y = legendeZeile(s, y, (x, yy) => { s.text("K2", x, yy - 0.3, { groesse: 2.5, anker: "m" }); }, "Kehlkeil (L/R: Blick zum Ablauf)");
  y = legendeZeile(s, y, (x, yy) => { s.text("85", x, yy - 0.3, { groesse: 2.2, anker: "m", fett: true }); }, "Dämmdicke in mm an Ecken, HP/TP");
  return y - 2;
}

/** Baut das PDF mit Gefälleplan (Blatt 1) und Gefälledämmplan (Blatt 2); Rückgabe samt Maßstab. */
export function baueProjektPdf(e: PlanEingabe): PlanErgebnis {
  const dok = new PdfDokument(`${e.modell.meta.name || "Projekt"} – Planunterlagen`);
  const a = abbildung(e.modell);
  const blaetter: { titel: string; zeichne: (s: PdfSeite) => void; legende: (s: PdfSeite, y: number) => number }[] = [
    { titel: "Gefälleplan", zeichne: (s) => gefaelleplan(s, a, e), legende: (s, y) => legendeGefaelle(s, e, y) },
    ...(e.plan ? [{ titel: "Gefälledämmplan", zeichne: (s: PdfSeite) => daemmplan(s, a, e), legende: (s: PdfSeite, y: number) => legendeDaemmplan(s, y) }] : []),
  ];
  blaetter.forEach((b, i) => {
    const s = dok.seite(BLATT.b, BLATT.h);
    rahmen(s);
    b.zeichne(s);
    bemassung(s, a, e.modell);
    nordpfeil(s, PLAN.x0 + 8, PLAN.y1 - 26);
    massstabsbalken(s, a, PLAN.x0 + 20, PLAN.y0 + 3);
    const y = b.legende(s, PLAN.y1 - 4);
    tabellen(s, e, y - 4);
    schriftfeld(s, e, b.titel, a.massstab, `${i + 1}/${blaetter.length}`);
  });
  return { bytes: dok.bytes(), massstab: a.massstab };
}
