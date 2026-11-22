/**
 * Ausrichten an erfassten Punkten (Objektfang-Spur): Ein Punkt, über dem der Cursor kurz verweilt hat,
 * liefert eine waagerechte und eine senkrechte Spur (im Achsensystem `achse`, Standard x/y).
 * Liegt der Cursor innerhalb der Toleranz nahe einer Spur, rastet er darauf ein; passen zwei Spuren
 * (auch verschiedener Punkte), entsteht ihr Schnittpunkt. Rein, ohne DOM; Längen in Weltmetern.
 */
import type { Vec2 } from "../geometry/types";

export interface Ausrichtung {
  readonly punkt: Vec2;
  /** Erfasste Punkte, deren Spur wirkt (für die Hilfslinien der UI). */
  readonly spuren: readonly { readonly von: Vec2; readonly richtung: "x" | "y" }[];
}

/** `richtung` "x": gleiche x-Koordinate (senkrechte Spur); "y": gleiche y-Koordinate (waagerechte Spur). */
export function ausrichten(erfasst: readonly Vec2[], cursor: Vec2, toleranz: number): Ausrichtung | null {
  let bx: { d: number; p: Vec2 } | null = null, by: { d: number; p: Vec2 } | null = null;
  for (const p of erfasst) {
    const dx = Math.abs(cursor.x - p.x), dy = Math.abs(cursor.y - p.y);
    if (dx <= toleranz && (!bx || dx < bx.d)) bx = { d: dx, p };
    if (dy <= toleranz && (!by || dy < by.d)) by = { d: dy, p };
  }
  if (!bx && !by) return null;
  const punkt = { x: bx ? bx.p.x : cursor.x, y: by ? by.p.y : cursor.y };
  const spuren: { von: Vec2; richtung: "x" | "y" }[] = [];
  if (bx) spuren.push({ von: bx.p, richtung: "x" });
  if (by) spuren.push({ von: by.p, richtung: "y" });
  return { punkt, spuren };
}

/** Winkel am Scheitel `s` zwischen den Strahlen s→a und s→b in Grad (0…180). */
export function winkelGrad(a: Vec2, s: Vec2, b: Vec2): number {
  const ux = a.x - s.x, uy = a.y - s.y, vx = b.x - s.x, vy = b.y - s.y;
  const l = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  if (l === 0) return Number.NaN;
  return (Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / l))) * 180) / Math.PI;
}
