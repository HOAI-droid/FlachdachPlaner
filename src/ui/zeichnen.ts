/** Gemeinsame Zeichenhilfen (Canvas, Welt in m, y nach oben). Größen in Bildschirm-px über 1 / vp.scale. */
import type { Vec2 } from "../core/index";
import { worldToScreen, type Viewport } from "./canvas/viewport";

export const css = (n: string, fb: string): string => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || fb;
export const dunkel = (): boolean => document.documentElement.dataset.theme === "dark";

export function bahn(ctx: CanvasRenderingContext2D, pts: readonly Vec2[], zu = true): void {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  if (zu) ctx.closePath();
}

export interface TextOpt { px?: number; farbe?: string; mono?: boolean; winkel?: number; ankerMitte?: boolean }

/** Text aufrecht am Weltpunkt; `winkel` (Bildschirm, rad, y nach unten) wird so normiert, dass er nie kopfsteht. */
export function text(ctx: CanvasRenderingContext2D, vp: Viewport, s: string, x: number, y: number, o: TextOpt = {}): void {
  ctx.save();
  ctx.translate(x, y); ctx.scale(1 / vp.scale, -1 / vp.scale);
  let w = o.winkel ?? 0;
  if (w > Math.PI / 2) w -= Math.PI; else if (w < -Math.PI / 2) w += Math.PI;
  if (w) ctx.rotate(w);
  ctx.font = `${o.px ?? 11}px ${o.mono ? css("--font-mono", "monospace") : css("--font-ui", "sans-serif")}`;
  ctx.fillStyle = o.farbe ?? css("--text-muted", "#555");
  ctx.textBaseline = "alphabetic";
  if (o.ankerMitte) { ctx.textAlign = "center"; }
  ctx.fillText(s, 0, 0);
  ctx.restore();
}

export function textBreite(ctx: CanvasRenderingContext2D, s: string, px: number, mono: boolean): number {
  ctx.save();
  ctx.font = `${px}px ${mono ? css("--font-mono", "monospace") : css("--font-ui", "sans-serif")}`;
  const w = ctx.measureText(s).width;
  ctx.restore();
  return w;
}

/** Belegte Bildschirm-Rechtecke eines Zeichendurchgangs; Labels überlappen nicht (DESIGN §6). */
export class Belegung {
  private readonly r: [number, number, number, number][] = [];
  constructor(private readonly vp: Viewport) {}
  /** Reserviert ein Rechteck um den Weltpunkt (Bildschirm-px: dx, dy Versatz nach rechts/oben, Breite, Höhe); false bei Kollision. */
  belege(p: Vec2, dx: number, dy: number, w: number, h: number): boolean {
    const [sx, sy] = worldToScreen(this.vp, p.x, p.y);
    const a: [number, number, number, number] = [sx + dx, sy - dy - h, sx + dx + w, sy - dy];
    if (this.r.some((b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1])) return false;
    this.r.push(a);
    return true;
  }
}

/** Abgerundetes Badge (Pill) um einen Text, Mitte am Weltpunkt; liefert die Breite in px. */
export function badge(
  ctx: CanvasRenderingContext2D, vp: Viewport, zeilen: string[], mitte: Vec2,
  o: { grund: string; rand: string; farbe: string; symbol?: "dreieck" | "achteck" | null },
): { w: number; h: number } {
  const px = 12, pad = 6, zh = 15, ic = o.symbol ? 14 : 0;
  const w = Math.max(...zeilen.map((z) => textBreite(ctx, z, px, true))) + 2 * pad + ic;
  const h = zeilen.length * zh + 4;
  ctx.save();
  ctx.translate(mitte.x, mitte.y); ctx.scale(1 / vp.scale, -1 / vp.scale);
  const r = Math.min(h / 2, 10);
  ctx.beginPath();
  ctx.moveTo(-w / 2 + r, -h / 2); ctx.arcTo(w / 2, -h / 2, w / 2, h / 2, r); ctx.arcTo(w / 2, h / 2, -w / 2, h / 2, r);
  ctx.arcTo(-w / 2, h / 2, -w / 2, -h / 2, r); ctx.arcTo(-w / 2, -h / 2, w / 2, -h / 2, r); ctx.closePath();
  ctx.fillStyle = o.grund; ctx.fill(); ctx.strokeStyle = o.rand; ctx.lineWidth = 1; ctx.stroke();
  if (o.symbol) {
    const cx = -w / 2 + pad + 5, cy = 0;
    ctx.beginPath();
    if (o.symbol === "dreieck") { ctx.moveTo(cx, cy - 5); ctx.lineTo(cx + 5, cy + 4); ctx.lineTo(cx - 5, cy + 4); }
    else for (let i = 0; i < 8; i++) { const a = (Math.PI / 4) * i + Math.PI / 8; ctx[i ? "lineTo" : "moveTo"](cx + 5 * Math.cos(a), cy + 5 * Math.sin(a)); }
    ctx.closePath(); ctx.strokeStyle = o.farbe; ctx.lineWidth = 1.5; ctx.stroke();
  }
  ctx.fillStyle = o.farbe; ctx.font = `${px}px ${css("--font-mono", "monospace")}`; ctx.textBaseline = "middle"; ctx.textAlign = "left";
  zeilen.forEach((z, i) => ctx.fillText(z, -w / 2 + pad + ic, (i - (zeilen.length - 1) / 2) * zh));
  ctx.restore();
  return { w, h };
}
