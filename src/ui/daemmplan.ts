/** 2D-Ansicht Gefälledämmplan (PLAN Schritt 26, DESIGN §11): nur Linien und Schrift, Doppelplatten gelb getönt. */
import {
  layoutInsulation, plattenDaemmdicke, dickeAn, dickeRaster, type DaemmplattenPack, type DachGefaelle, type InsulationLayout,
  type ProjectModel, type SlopeResult, type Vec2, type VerlegtePlatte,
} from "../core/index";
import type { Viewport } from "./canvas/viewport";
import { meter, millimeter, zahl } from "./format";
import { daemmStandard, packs } from "./packs";
import { css, dunkel, geteilteBelegung, text, textBreite } from "./zeichnen";

export function berechnePlan(m: ProjectModel, slope: SlopeResult): InsulationLayout | null {
  const kat = packs.find((x): x is DaemmplattenPack => x.typ === "daemmplatten");
  if (!kat) return null;
  const std = daemmStandard();
  return layoutInsulation(m, slope, kat, std !== undefined ? { daemmdickeTiefpunktStandard: std } : {});
}

function pfeil(ctx: CanvasRenderingContext2D, von: Vec2, bis: Vec2, kopf: number): void {
  const dx = bis.x - von.x, dy = bis.y - von.y, l = Math.hypot(dx, dy);
  if (l <= 0) return;
  const ux = dx / l, uy = dy / l;
  ctx.beginPath(); ctx.moveTo(von.x, von.y); ctx.lineTo(bis.x, bis.y);
  for (const sg of [1, -1]) {
    ctx.moveTo(bis.x - (ux * Math.cos(0.45) - sg * uy * Math.sin(0.45)) * kopf, bis.y - (uy * Math.cos(0.45) + sg * ux * Math.sin(0.45)) * kopf);
    ctx.lineTo(bis.x, bis.y);
  }
  ctx.stroke();
}

function polygonPfad(ctx: CanvasRenderingContext2D, p: VerlegtePlatte["polygon"]): void {
  ctx.beginPath();
  for (const r of [p.outer, ...p.holes]) r.forEach((v, i) => (i ? ctx.lineTo(v.x, v.y) : ctx.moveTo(v.x, v.y)));
}

/** Kleinste Ausdehnung des Stücks auf dem Bildschirm (px) – kleine Stücke bekommen keine Beschriftung. */
const ausdehnung = (p: VerlegtePlatte, s: number) => Math.min(p.laenge, p.breite) * s;

function bemasse(ctx: CanvasRenderingContext2D, vp: Viewport, m: ProjectModel): void {
  const px = 1 / vp.scale, linie = css("--text", "#222");
  const pts = m.dachflaechen.flatMap((d) => d.kontur);
  if (pts.length === 0) return;
  const eindeutig = (w: number[]) => [...new Set(w.map((v) => Math.round(v * 1000) / 1000))].sort((a, b) => a - b);
  const xs = eindeutig(pts.map((p) => p.x)), ys = eindeutig(pts.map((p) => p.y));
  const x0 = xs[0]!, x1 = xs[xs.length - 1]!, y0 = ys[0]!, y1 = ys[ys.length - 1]!;
  ctx.save(); ctx.strokeStyle = linie; ctx.lineWidth = px; ctx.setLineDash([]);
  const maß = (a: Vec2, b: Vec2, s: string, hilfA: Vec2, hilfB: Vec2, h: boolean) => {
    ctx.beginPath(); ctx.moveTo(hilfA.x, hilfA.y); ctx.lineTo(a.x, a.y); ctx.moveTo(hilfB.x, hilfB.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    pfeil(ctx, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, a, 7 * px); pfeil(ctx, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, b, 7 * px);
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    text(ctx, vp, s, h ? mx : mx - 5 * px, h ? my + 5 * px : my, { px: 12, mono: true, farbe: linie, ankerMitte: true, halo: true, winkel: h ? 0 : -Math.PI / 2 });
  };
  const o1 = 28 * px;
  // außen unten/rechts: Gesamtmaße; oben/links: Teilmaße je Eckpunkt-Koordinate (nur bei Mehrfachketten)
  maß({ x: x0, y: y0 - o1 }, { x: x1, y: y0 - o1 }, meter(x1 - x0, 2), { x: x0, y: y0 }, { x: x1, y: y0 }, true);
  maß({ x: x1 + o1, y: y0 }, { x: x1 + o1, y: y1 }, meter(y1 - y0, 2), { x: x1, y: y0 }, { x: x1, y: y1 }, false);
  if (xs.length > 2) for (let i = 0; i + 1 < xs.length; i++) maß({ x: xs[i]!, y: y1 + o1 }, { x: xs[i + 1]!, y: y1 + o1 }, meter(xs[i + 1]! - xs[i]!, 2), { x: xs[i]!, y: y1 }, { x: xs[i + 1]!, y: y1 }, true);
  if (ys.length > 2) for (let i = 0; i + 1 < ys.length; i++) maß({ x: x0 - o1, y: ys[i]! }, { x: x0 - o1, y: ys[i + 1]! }, meter(ys[i + 1]! - ys[i]!, 2), { x: x0, y: ys[i]! }, { x: x0, y: ys[i + 1]! }, false);
  ctx.restore();
}

export function zeichneDaemmplan(ctx: CanvasRenderingContext2D, vp: Viewport, m: ProjectModel, slope: SlopeResult | null, plan: InsulationLayout | null): void {
  if (!plan || plan.dachflaechen.length === 0) return;
  const px = 1 / vp.scale, linie = css("--text", "#222"), fein = css("--text-muted", "#777");
  const gelb = dunkel() ? "rgba(214,176,40,0.30)" : "rgba(244,208,63,0.45)";
  const belegung = geteilteBelegung(vp);
  ctx.save(); ctx.setLineDash([]); ctx.lineJoin = "round";
  for (const d of plan.dachflaechen) {
    // 1) Platten: Tint für Zusatzlagen, dünnes Raster
    for (const p of d.platten) {
      if (p.zusatzlagen > 0) { polygonPfad(ctx, p.polygon); ctx.fillStyle = gelb; ctx.fill("evenodd"); }
    }
    ctx.strokeStyle = fein; ctx.lineWidth = 0.8 * px;
    for (const p of d.platten) { polygonPfad(ctx, p.polygon); ctx.stroke(); }
    // 2) Kehl- und Gratlinien
    const g: DachGefaelle | undefined = slope?.dachflaechen.find((x) => x.dachflaecheId === d.dachflaecheId);
    if (g) {
      ctx.strokeStyle = linie; ctx.lineWidth = 1.1 * px;
      for (const l of [...g.linien, ...g.zonen.flatMap((z) => z.linien)]) { ctx.beginPath(); ctx.moveTo(l.von.x, l.von.y); ctx.lineTo(l.bis.x, l.bis.y); ctx.stroke(); }
    }
    // 5) Verlegestart + N0
    ctx.fillStyle = linie;
    const ex = d.platten.flatMap((q) => q.polygon.outer), bx0 = Math.min(...ex.map((q) => q.x)), bx1 = Math.max(...ex.map((q) => q.x)), by0 = Math.min(...ex.map((q) => q.y)), by1 = Math.max(...ex.map((q) => q.y));
    for (const v of d.verlegestarts) {
      ctx.beginPath(); ctx.arc(v.punkt.x, v.punkt.y, 4 * px, 0, Math.PI * 2); ctx.fill();
      const rechts = v.punkt.x <= (bx0 + bx1) / 2, unten = v.punkt.y <= (by0 + by1) / 2;
      const dx = rechts ? -86 : 8, dy = unten ? -22 : 8;
      if (belegung.belege(v.punkt, dx, dy, 78, 14)) text(ctx, vp, "Verlegestart", v.punkt.x + dx * px, v.punkt.y + dy * px, { px: 12, farbe: linie });
    }
    if (d.n0) {
      const { x, y } = d.n0.position;
      ctx.lineWidth = px; ctx.strokeStyle = linie; ctx.strokeRect(x, y - 22 * px, 18 * px, 22 * px);
      text(ctx, vp, "N0", x + 2 * px, y - 15 * px, { px: 11, farbe: linie, mono: true, halo: false });
    }
    // 5b) Dämmdicke an Ecken, Hoch-/Tiefpunkten und Knickpunkten der Kehlen/Grate (vor den Plattenlabels, damit sie Vorrang haben)
    const dachM = m.dachflaechen.find((x) => x.id === d.dachflaecheId);
    const punkte: Vec2[] = [];
    const merke = (q: Vec2) => { if (!punkte.some((r) => Math.hypot(r.x - q.x, r.y - q.y) < 0.05)) punkte.push(q); };
    if (dachM) dachM.kontur.forEach(merke);
    if (g) {
      for (const k of g.koten) merke(k.position);
      for (const l of [...g.linien, ...g.zonen.flatMap((z) => z.linien)]) { merke(l.von); merke(l.bis); }
      for (const e of [g.hochpunkt, g.tiefpunkt]) for (const o of e?.orte ?? []) merke(o);
    }
    const mx = (bx0 + bx1) / 2, my = (by0 + by1) / 2;
    for (const q of punkte) {
      const mm = dickeAn(d.platten, q);
      if (mm === null) continue;
      const t = zahl(dickeRaster(mm), 0), w = textBreite(ctx, t, 12, true) + 4;
      const ox = q.x <= mx ? 1 : -1, oy = q.y <= my ? 1 : -1; // nach innen (außen liegen Maße und Verlegestart)
      const kand: [number, number][] = [];
      for (const [fx, fy] of [[ox, oy], [ox, -oy], [-ox, oy], [-ox, -oy]] as const) {
        kand.push([fx < 0 ? -(w + 5) : 5, fy < 0 ? -19 : 5]);
      }
      const z = kand.find(([dx, dy]) => belegung.belege(q, dx, dy, w, 14));
      ctx.fillStyle = linie; ctx.beginPath(); ctx.arc(q.x, q.y, 2.2 * px, 0, Math.PI * 2); ctx.fill();
      if (z) text(ctx, vp, t, q.x + z[0] * px, q.y + z[1] * px, { px: 12, mono: true, farbe: css("--accent", "#1F4FA3") });
    }
    // 3) Labels: große Stücke zuerst, keine Überlappung (DESIGN §6)
    const nachGroesse = [...d.platten].sort((a, b) => b.flaeche - a.flaeche || (a.id < b.id ? -1 : 1));
    const platz = new Map<string, boolean>();
    for (const p of nachGroesse) {
      const c = schwerpunkt(p);
      const s = p.bezeichnung, w = textBreite(ctx, s, 13, false);
      const frei = ausdehnung(p, vp.scale) >= 13 && Math.max(p.laenge, p.breite) * vp.scale >= w + 4;
      const ok = frei && belegung.belege(c, 4, -6, w, 13);
      platz.set(p.id, ok);
      if (ok) text(ctx, vp, s, c.x + 4 * px, c.y - 6 * px, { px: 13, farbe: linie });
    }
    // 4) Verlegepfeile je Reihe, nur wenn das zugehörige Label Platz hat
    ctx.strokeStyle = linie; ctx.lineWidth = px;
    const refL = Math.max(0.1, ...d.platten.map((q) => q.laenge));
    for (const a of d.pfeile) {
      const lenPx = Math.max(10, Math.min(22, 0.4 * refL * vp.scale)), len = lenPx * px, sx = a.start.x - (Math.abs(a.richtung.x) > 0.7 ? lenPx / 2 + 9 : 9) * px, sy = a.start.y;
      const ende = { x: sx + a.richtung.x * len, y: sy + a.richtung.y * len };
      const hor = Math.abs(a.richtung.x) > 0.7, bw = hor ? lenPx + 4 : 8, bh = hor ? 8 : lenPx + 4;
      if (belegung.belege({ x: sx, y: sy }, -bw / 2, -bh / 2, bw, bh)) pfeil(ctx, { x: sx, y: sy }, ende, 6 * px);
    }
    // 6) Ø Gefälledämmung aus dem Plattenlayout
    const k = plattenDaemmdicke(d);
    const dach = m.dachflaechen.find((x) => x.id === d.dachflaecheId);
    if (k && dach) {
      const zeilen = `Ø Gefälledämmung ${millimeter(k.mittel, 0)} (min ${millimeter(k.min, 0)} · max ${millimeter(k.max, 0)}) · blau: Dämmdicke in mm, auf 5 mm aufgerundet`;
      const ys = dach.kontur.map((q) => q.y), xs = dach.kontur.map((q) => q.x);
      text(ctx, vp, `${dach.name || dach.id}: ${zeilen}`, Math.min(...xs), Math.max(...ys) + 52 * px, { px: 12, mono: true, farbe: linie, halo: false });
    }
  }
  ctx.restore();
  bemasse(ctx, vp, m);
}

function schwerpunkt(p: VerlegtePlatte): Vec2 {
  const r = p.polygon.outer; let x = 0, y = 0;
  for (const v of r) { x += v.x; y += v.y; }
  return { x: x / r.length, y: y / r.length };
}
