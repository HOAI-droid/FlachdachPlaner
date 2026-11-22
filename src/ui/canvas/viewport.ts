// Ansichts-Transformation Welt (m, y nach oben) <-> Bildschirm (px, y nach unten). Rein mathematisch, ohne DOM.
export interface Viewport {
  /** Weltpunkt (m), der in der Mitte der Zeichenfläche liegt. */
  cx: number; cy: number;
  /** Pixel je Meter. */
  scale: number;
  /** Größe der Zeichenfläche in CSS-px. */
  w: number; h: number;
}
export const MIN_SCALE = 0.05;   // 1 px = 20 m
export const MAX_SCALE = 2000;   // 1 m = 2000 px

export const createViewport = (w: number, h: number): Viewport => ({ cx: 0, cy: 0, scale: 50, w, h });

export function worldToScreen(v: Viewport, x: number, y: number): [number, number] {
  return [v.w / 2 + (x - v.cx) * v.scale, v.h / 2 - (y - v.cy) * v.scale];
}
export function screenToWorld(v: Viewport, sx: number, sy: number): [number, number] {
  return [v.cx + (sx - v.w / 2) / v.scale, v.cy - (sy - v.h / 2) / v.scale];
}
export const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

/** Zoom um einen Bildschirmpunkt: der Weltpunkt darunter bleibt unverändert. */
export function zoomAt(v: Viewport, factor: number, sx: number, sy: number): Viewport {
  const scale = clampScale(v.scale * factor);
  const [wx, wy] = screenToWorld(v, sx, sy);
  return { ...v, scale, cx: wx - (sx - v.w / 2) / scale, cy: wy + (sy - v.h / 2) / scale };
}
/** Verschiebt die Ansicht um (dx, dy) Bildschirm-px (Inhalt folgt der Maus). */
export function panBy(v: Viewport, dx: number, dy: number): Viewport {
  return { ...v, cx: v.cx - dx / v.scale, cy: v.cy + dy / v.scale };
}
/** Passt eine Welt-Bounding-Box mit Rand (px) ein. */
export function fitBounds(v: Viewport, minX: number, minY: number, maxX: number, maxY: number, margin = 32): Viewport {
  const bw = Math.max(maxX - minX, 1e-6), bh = Math.max(maxY - minY, 1e-6);
  const scale = clampScale(Math.min((v.w - 2 * margin) / bw, (v.h - 2 * margin) / bh));
  return { ...v, scale, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}
/** Maßstabsnenner 1:n bei gegebener Bildschirmauflösung (px je mm, Standard 96 dpi). */
export function scaleDenominator(v: Viewport, pxPerMm = 96 / 25.4): number {
  return 1000 * pxPerMm / v.scale;
}
