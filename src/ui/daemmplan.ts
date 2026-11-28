/** 2D-Ansicht Gefälledämmplan (PLAN Schritt 26, DESIGN §11): nur Linien und Schrift, Doppelplatten gelb getönt. */
import {
  layoutInsulation, plattenDaemmdicke, dickeAn, dickeRaster, type DaemmplattenPack, type DachGefaelle, type InsulationLayout,
  type ProjectModel, type SlopeResult, type Vec2, type VerlegtePlatte,
} from "../core/index";
import type { Viewport } from "./canvas/viewport";
import { meter, millimeter, zahl } from "./format";
import { daemmStandard, packs } from "./packs";
import { css, dunkel, geteilteBelegung, passtText, platziere, text, textBreite } from "./zeichnen";

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

/** Jede Dachfläche wird für sich bemaßt (Gesamtmaß + Teilketten bei Knicken) – keine Gesamtbemaßung über leere Bereiche. */
function bemasse(ctx: CanvasRenderingContext2D, vp: Viewport, m: ProjectModel, belegung: ReturnType<typeof geteilteBelegung>): void {
  const px = 1 / vp.scale, linie = css("--text", "#222");
  const eindeutig = (w: number[]) => [...new Set(w.map((v) => Math.round(v * 1000) / 1000))].sort((a, b) => a - b);
  ctx.save(); ctx.strokeStyle = linie; ctx.lineWidth = px; ctx.setLineDash([]);
  const maß = (a: Vec2, b: Vec2, s: string, hilfA: Vec2, hilfB: Vec2, h: boolean) => {
    // Band um die Maßlinie reservieren, damit Dämmdicken/Verlegestart/Labels nicht darauf landen
    const l = Math.hypot(b.x - a.x, b.y - a.y) * vp.scale, mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (h) belegung.sperre(mid, -l / 2, -14, l, 28); else belegung.sperre(mid, -14, -l / 2, 28, l);
    ctx.beginPath(); ctx.moveTo(hilfA.x, hilfA.y); ctx.lineTo(a.x, a.y); ctx.moveTo(hilfB.x, hilfB.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    pfeil(ctx, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, a, 7 * px); pfeil(ctx, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, b, 7 * px);
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    if (!passtText(l, textBreite(ctx, s, 12, true))) return; // Maßtext entfällt, wenn er nicht zwischen die Pfeile passt
    text(ctx, vp, s, h ? mx : mx - 5 * px, h ? my + 5 * px : my, { px: 12, mono: true, farbe: linie, ankerMitte: true, halo: true, winkel: h ? 0 : -Math.PI / 2 });
  };
  const o1 = 28 * px;
  for (const d of m.dachflaechen) {
    if (d.kontur.length === 0) continue;
    const xs = eindeutig(d.kontur.map((p) => p.x)), ys = eindeutig(d.kontur.map((p) => p.y));
    const x0 = xs[0]!, x1 = xs[xs.length - 1]!, y0 = ys[0]!, y1 = ys[ys.length - 1]!;
    maß({ x: x0, y: y0 - o1 }, { x: x1, y: y0 - o1 }, meter(x1 - x0, 2), { x: x0, y: y0 }, { x: x1, y: y0 }, true);
    maß({ x: x1 + o1, y: y0 }, { x: x1 + o1, y: y1 }, meter(y1 - y0, 2), { x: x1, y: y0 }, { x: x1, y: y1 }, false);
    // Teilmaße je Eckpunkt-Koordinate der Fläche (nur bei Knicken)
    if (xs.length > 2) for (let i = 0; i + 1 < xs.length; i++) maß({ x: xs[i]!, y: y1 + o1 }, { x: xs[i + 1]!, y: y1 + o1 }, meter(xs[i + 1]! - xs[i]!, 2), { x: xs[i]!, y: y1 }, { x: xs[i + 1]!, y: y1 }, true);
    if (ys.length > 2) for (let i = 0; i + 1 < ys.length; i++) maß({ x: x0 - o1, y: ys[i]! }, { x: x0 - o1, y: ys[i + 1]! }, meter(ys[i + 1]! - ys[i]!, 2), { x: x0, y: ys[i]! }, { x: x0, y: ys[i + 1]! }, false);
  }
  ctx.restore();
}

export function zeichneDaemmplan(ctx: CanvasRenderingContext2D, vp: Viewport, m: ProjectModel, slope: SlopeResult | null, plan: InsulationLayout | null): void {
  if (!plan || plan.dachflaechen.length === 0) return;
  const px = 1 / vp.scale, linie = css("--text", "#222"), fein = css("--text-muted", "#777");
  const gelb = dunkel() ? "rgba(214,176,40,0.30)" : "rgba(244,208,63,0.45)";
  const belegung = geteilteBelegung(vp);
  bemasse(ctx, vp, m, belegung); // zuerst: reserviert die Bänder der Maßlinien
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
    // Plan kleiner als ca. 60 px: nur Linien, keine Eckzahlen/Verlegestart-Texte (würden Nachbarn überdecken)
    const lesbar = Math.min(bx1 - bx0, by1 - by0) * vp.scale >= 60;
    for (const v of d.verlegestarts) { ctx.beginPath(); ctx.arc(v.punkt.x, v.punkt.y, 4 * px, 0, Math.PI * 2); ctx.fill(); }
    if (d.n0) {
      const { x, y } = d.n0.position;
      belegung.sperre({ x, y }, -5, -27, 28, 32); // Dicken-/Plattenlabels weichen dem N0-Kasten aus
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
    for (const q of lesbar ? punkte : []) {
      const mm = dickeAn(d.platten, q);
      if (mm === null) continue;
      const t = zahl(dickeRaster(mm), 0), w = textBreite(ctx, t, 12, true) + 4;
      const ox = q.x <= mx ? 1 : -1, oy = q.y <= my ? 1 : -1; // nach innen (außen liegen Maße und Verlegestart)
      const kand: [number, number][] = [];
      for (const [fx, fy] of [[ox, oy], [ox, -oy], [-ox, oy], [-ox, -oy]] as const) {
        kand.push([fx < 0 ? -(w + 5) : 5, fy < 0 ? -19 : 5]);
      }
      // Zahl nur, wenn Mitte und beide Enden im Dach liegen (bei L-/U-Formen zeigt „nach innen“ sonst ins Freie)
      const imDach = (dx: number, dy: number) => [0, w / 2, w].every((o) => liegtInPlatten(d.platten, { x: q.x + (dx + o) * px, y: q.y + (dy + 4) * px }));
      const z = kand.find(([dx, dy]) => imDach(dx, dy) && belegung.belege(q, dx - 2, dy - 2, w + 4, 18));
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
      // links vom Schwerpunkt beginnend, aber nie über den rechten Plattenrand hinaus (schmale „1+1“ bleiben innen)
      const xr = Math.max(...p.polygon.outer.map((q) => q.x));
      const dx = Math.min(4, (xr - c.x) * vp.scale - w - 3);
      const ok = frei && belegung.belege(c, dx - 2, -8, w + 4, 17);
      platz.set(p.id, ok);
      if (ok) text(ctx, vp, s, c.x + dx * px, c.y - 6 * px, { px: 13, farbe: linie });
    }
    // 4) Verlegepfeile je Reihe, nur wenn das zugehörige Label Platz hat
    ctx.strokeStyle = linie; ctx.lineWidth = px;
    const refL = Math.max(0.1, ...d.platten.map((q) => q.laenge));
    for (const a of d.pfeile) {
      const lenPx = Math.max(10, Math.min(22, 0.4 * refL * vp.scale)), len = lenPx * px, sx = a.start.x - (Math.abs(a.richtung.x) > 0.7 ? lenPx / 2 + 9 : 9) * px, sy = a.start.y;
      const ende = { x: sx + a.richtung.x * len, y: sy + a.richtung.y * len };
      const hor = Math.abs(a.richtung.x) > 0.7, bw = hor ? lenPx + 4 : 8, bh = hor ? 8 : lenPx + 4;
      if (belegung.belege({ x: sx, y: sy }, -bw / 2 - 3, -bh / 2 - 3, bw + 6, bh + 6)) pfeil(ctx, { x: sx, y: sy }, ende, 6 * px);
    }
    // 5c) „Verlegestart" nach Plattenzahlen und Pfeilen: nur auf freien Platz, nie über Plattenzahlen
    const vw = textBreite(ctx, "Verlegestart", 12, false) + 4;
    for (const v of lesbar ? d.verlegestarts : []) {
      const rechts = v.punkt.x <= (bx0 + bx1) / 2, unten = v.punkt.y <= (by0 + by1) / 2;
      const ox = rechts ? -(vw + 6) : 8, oy = unten ? -22 : 8;
      const kand: [number, number][] = [[ox, oy], [ox, unten ? 8 : -22], [rechts ? 8 : -(vw + 6), oy], [rechts ? 8 : -(vw + 6), unten ? 8 : -22]];
      const z = kand.find(([dx, dy]) => belegung.belege(v.punkt, dx - 2, dy - 2, vw, 18));
      if (z) text(ctx, vp, "Verlegestart", v.punkt.x + z[0] * px, v.punkt.y + z[1] * px, { px: 12, farbe: linie });
    }
  }
  titelUndLegende(ctx, vp, m, plan, belegung, linie);
  ctx.restore();
}

/** 6) Je Dach ein Titelblock „Name: Ø Gefälledämmung …“ (beim ersten Dach mit Platz samt Legende) – nach allen Labels,
 *  über der oberen Maßkette, sonst unter der unteren; ohne freien Platz entfällt er (Werte stehen auch im Ergebnis-Panel). */
function titelUndLegende(ctx: CanvasRenderingContext2D, vp: Viewport, m: ProjectModel, plan: InsulationLayout, belegung: ReturnType<typeof geteilteBelegung>, linie: string): void {
  const px = 1 / vp.scale, zh = 18, rand = 46; // rand: jenseits des Maßketten-Bands (14…42 px)
  let legende = ["blau: Dämmdicke in mm, auf 5 mm aufgerundet"];
  if (plan.dachflaechen.some((d) => d.platten.some((p) => p.zusatzlagen > 0))) legende.push("gelb: Zusatzlage (Bezeichnung n+1)");
  for (const d of plan.dachflaechen) {
    const k = plattenDaemmdicke(d), dach = m.dachflaechen.find((x) => x.id === d.dachflaecheId);
    if (!k || !dach || dach.kontur.length === 0) continue;
    const xs = dach.kontur.map((q) => q.x), ys = dach.kontur.map((q) => q.y), x0 = Math.min(...xs), yo = Math.max(...ys), yu = Math.min(...ys);
    const breitePx = (Math.max(...xs) - x0) * vp.scale;
    if (Math.min(breitePx, (yo - yu) * vp.scale) < 60) continue; // Plan zu klein: Titel wäre ein Vielfaches breiter als das Dach
    const titel = `${dach.name || dach.id}: Ø Gefälledämmung ${millimeter(k.mittel, 0)} (min ${millimeter(k.min, 0)} · max ${millimeter(k.max, 0)})`;
    const versuche = legende.length ? [[titel, ...legende], [titel]] : [[titel]];
    for (const zeilen of versuche) {
      const w = Math.max(...zeilen.map((z) => textBreite(ctx, z, 12, true))) + 4, h = zeilen.length * zh;
      const stufen = [0, 1, 2, 3, 4, 5].map((i) => i * zh);
      // Block links- oder rechtsbündig zum Dach; dy = Unterkante über (+) der Oberkante bzw. unter (−) der Unterkante
      // nächstgelegene freie Lage gewinnt: je Stufe oben links/rechts, dann unten links/rechts (kein Wandern weit über das Dach)
      let treffer: [number, number, number] | null = null;
      for (const s of stufen) {
        for (const [y, dys] of [[yo, [rand + s]], [yu, [-(rand + h + s)]]] as const) {
          for (const dx of [-2, breitePx - w + 2]) {
            const dy = platziere(belegung, { x: x0, y }, dx, [...dys], w, h);
            if (dy !== null) { treffer = [y, dx, dy]; break; }
          }
          if (treffer) break;
        }
        if (treffer) break;
      }
      if (!treffer) continue;
      const [basisY, dx, dy] = treffer;
      zeilen.forEach((z, i) => text(ctx, vp, z, x0 + (dx + 2) * px, basisY + (dy + h - (i + 1) * zh + 4) * px, { px: 12, mono: true, farbe: linie, halo: false }));
      if (zeilen.length > 1) legende = [];
      break;
    }
  }
}

/** Punkt in irgendeiner Platte (Strahlverfahren, Ränder zählen mit kleiner Toleranz als innen). */
function liegtInPlatten(platten: readonly VerlegtePlatte[], p: Vec2): boolean {
  return platten.some((pl) => {
    const o = pl.polygon.outer; let innen = false;
    for (let i = 0, j = o.length - 1; i < o.length; j = i++) {
      const a = o[i]!, b = o[j]!;
      if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) innen = !innen;
    }
    return innen;
  });
}

function schwerpunkt(p: VerlegtePlatte): Vec2 {
  const r = p.polygon.outer; let x = 0, y = 0;
  for (const v of r) { x += v.x; y += v.y; }
  return { x: x / r.length, y: y / r.length };
}
