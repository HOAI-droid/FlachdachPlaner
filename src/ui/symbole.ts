/** Plansymbole der Entwässerung nach DESIGN §6 (Gully, Notablauf, Dachreiter, LES) mit Ablauf-Kote. */
import { konturFlaeche, type Dachflaeche, type Entwaesserung, type Vec2 } from "../core/index";
import type { Viewport } from "./canvas/viewport";
import { kote, meter } from "./format";
import { Belegung, bahn, css, text } from "./zeichnen";

const links = (k: Dachflaeche["kontur"]) => konturFlaeche(k) > 0;

/** Kantenpunkt, Einheitsrichtung und Außennormale einer Dachkante. */
export function kantenLage(d: Dachflaeche, kanteId: string, abstand: number): { p: Vec2; u: Vec2; aussen: Vec2 } | null {
  const i = d.kontur.findIndex((q) => q.id === kanteId);
  if (i < 0) return null;
  const a = d.kontur[i]!, b = d.kontur[(i + 1) % d.kontur.length]!;
  const l = Math.hypot(b.x - a.x, b.y - a.y);
  if (l <= 0) return null;
  const u = { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
  const s = links(d.kontur) ? 1 : -1; // gegen den Uhrzeigersinn: Außen liegt rechts der Richtung
  return { p: { x: a.x + u.x * abstand, y: a.y + u.y * abstand }, u, aussen: { x: u.y * s, y: -u.x * s } };
}

export function zeichneEntwaesserung(
  ctx: CanvasRenderingContext2D, vp: Viewport, d: Dachflaeche, e: Entwaesserung, belegung: Belegung, id?: string, beschriftung = true,
): void {
  const px = 1 / vp.scale;
  const linie = css("--text", "#222"), grund = css("--surface", "#fff");
  ctx.save();
  ctx.setLineDash([]); ctx.lineWidth = 1.5 * px; ctx.strokeStyle = linie; ctx.fillStyle = grund; ctx.lineCap = "butt";
  let anker: Vec2;
  if (e.art === "gully" || e.art === "notablauf") {
    const { x, y } = e.position; anker = e.position;
    if (e.art === "notablauf") {
      ctx.save(); ctx.setLineDash([3 * px, 3 * px]); ctx.strokeStyle = css("--warn", "#8A5A00");
      ctx.beginPath(); ctx.arc(x, y, 10 * px, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    }
    ctx.beginPath(); ctx.arc(x, y, 6 * px, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (e.art === "gully") {
      const h = 6 * px / Math.SQRT2;
      ctx.beginPath(); ctx.moveTo(x - h, y - h); ctx.lineTo(x + h, y + h); ctx.moveTo(x - h, y + h); ctx.lineTo(x + h, y - h); ctx.stroke();
    } else text(ctx, vp, "N", x, y - 4 * px, { px: 11, farbe: linie, mono: true, ankerMitte: true });
  } else if (e.art === "dachreiter") {
    const k = kantenLage(d, e.lage.kante, e.lage.abstand);
    if (!k) { ctx.restore(); return; }
    anker = k.p;
    const lx = k.u.x * 7 * px, ly = k.u.y * 7 * px, nx = k.aussen.x * 3 * px, ny = k.aussen.y * 3 * px;
    const { x, y } = k.p;
    bahn(ctx, [{ x: x - lx - nx, y: y - ly - ny }, { x: x + lx - nx, y: y + ly - ny }, { x: x + lx + nx, y: y + ly + ny }, { x: x - lx + nx, y: y - ly + ny }]);
    ctx.fill(); ctx.stroke();
    const tx = k.aussen.x * 8 * px, ty = k.aussen.y * 8 * px, bx = k.u.x * 4 * px, by = k.u.y * 4 * px;
    bahn(ctx, [{ x: x + nx - bx, y: y + ny - by }, { x: x + nx + bx, y: y + ny + by }, { x: x + nx + tx, y: y + ny + ty }]);
    ctx.fillStyle = linie; ctx.fill();
  } else {
    const dx = e.bis.x - e.von.x, dy = e.bis.y - e.von.y, l = Math.hypot(dx, dy);
    anker = { x: (e.von.x + e.bis.x) / 2, y: (e.von.y + e.bis.y) / 2 };
    if (l > 0) {
      const ux = dx / l, uy = dy / l, nx = -uy * 3 * px, ny = ux * 3 * px;
      ctx.beginPath();
      for (const s of [1, -1]) { ctx.moveTo(e.von.x + s * nx, e.von.y + s * ny); ctx.lineTo(e.bis.x + s * nx, e.bis.y + s * ny); }
      const n = Math.max(1, Math.floor(l * vp.scale / 8));
      for (let i = 0; i <= n; i++) {
        const t = (l * i) / n;
        ctx.moveTo(e.von.x + ux * t + nx, e.von.y + uy * t + ny); ctx.lineTo(e.von.x + ux * t - nx, e.von.y + uy * t - ny);
      }
      ctx.stroke();
      text(ctx, vp, `LES ${meter(l, 2)}`, anker.x + nx * 2.2, anker.y + ny * 2.2, { px: 11, farbe: linie, mono: true, ankerMitte: true, winkel: Math.atan2(-uy, ux) });
    }
  }
  // Beschriftung rechts oben: ID + Tiefenlage z (Mono 12 px)
  const zt = `z ${kote(e.z).replace("+", "")}`;
  const s = id ? `${id} · ${zt}` : zt;
  const w = s.length * 7.2;
  if (beschriftung) {
    // Kandidaten: rechts oben, links oben, rechts unten, links unten (Bildschirm-px, dy nach oben)
    const kand: [number, number][] = [[10, 8], [-w - 10, 8], [10, -22], [-w - 10, -22]];
    const k = kand.find(([dx, dy]) => belegung.belege(anker, dx, dy, w, 14));
    if (k) text(ctx, vp, s, anker.x + k[0] * px, anker.y + k[1] * px, { px: 12, mono: true, farbe: linie });
  }
  ctx.restore();
}
