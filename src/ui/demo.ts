import type { LayerDraw } from "./canvas/stage";

/** Erzeugt eine Test-Unterlage mit n Linien (nur für Leistungsprüfung, Aufruf mit ?demo=5000). */
export function demoUnderlay(n: number): { draw: LayerDraw; bounds: [number, number, number, number] } {
  const path = new Path2D();
  const cols = Math.ceil(Math.sqrt(n));
  for (let i = 0; i < n; i++) {
    const x = (i % cols) * 0.5, y = Math.floor(i / cols) * 0.5;
    path.moveTo(x, y);
    path.lineTo(x + 0.4, y + ((i * 7) % 5) * 0.08);
  }
  const size = cols * 0.5;
  return {
    bounds: [0, 0, size, size],
    draw(ctx, vp) {
      ctx.globalAlpha = Number(getComputedStyle(document.documentElement).getPropertyValue("--underlay-opacity")) || 0.45;
      ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--text-muted") || "#888";
      ctx.lineWidth = 1 / vp.scale;
      ctx.stroke(path);
    },
  };
}
