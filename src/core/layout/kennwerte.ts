/**
 * Kennwerte des Verlegeplans (Schritt 26): Ø/min/max der Gesamtdämmdicke aus den verlegten Stücken.
 * Je Stück ist die Dicke eine Ebene → der Flächenmittelwert ist der Wert im Schwerpunkt (exakt).
 */
import { polygonArea, polygonCentroid } from "../geometry/polygon";
import type { Vec2 } from "../geometry/types";
import type { DaemmplanDach, VerlegtePlatte } from "./types";

export interface PlattenDicke {
  /** Flächengewichtetes Mittel in mm. */
  readonly mittel: number;
  readonly min: number;
  readonly max: number;
  /** Bezugsfläche (Σ Stücke) in m². */
  readonly flaeche: number;
}

export function plattenDaemmdicke(dach: DaemmplanDach): PlattenDicke | null {
  let summe = 0, flaeche = 0, min = Infinity, max = -Infinity;
  for (const p of dach.platten) {
    const a = polygonArea(p.polygon);
    if (a <= 0) continue;
    const c = polygonCentroid(p.polygon);
    summe += a * (p.dicke.a * c.x + p.dicke.b * c.y + p.dicke.c);
    flaeche += a;
    for (const r of [p.polygon.outer]) for (const v of r) {
      const h = p.dicke.a * v.x + p.dicke.b * v.y + p.dicke.c;
      if (h < min) min = h;
      if (h > max) max = h;
    }
  }
  if (flaeche <= 0) return null;
  return { mittel: (summe / flaeche) * 1000, min: min * 1000, max: max * 1000, flaeche };
}

/** Dämmdicke in mm am Punkt: Ebene der nächstgelegenen Platte (Ecken/Kanten, daher Abstand zum Rand). */
export function dickeAn(platten: readonly VerlegtePlatte[], p: Vec2): number | null {
  let best: VerlegtePlatte | null = null, bd = Infinity;
  for (const pl of platten) {
    const o = pl.polygon.outer;
    for (let i = 0; i < o.length; i++) {
      const a = o[i]!, b = o[(i + 1) % o.length]!;
      const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
      const d = Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
      if (d < bd) { bd = d; best = pl; }
    }
  }
  if (!best || bd > 0.02) return null;
  return (best.dicke.a * p.x + best.dicke.b * p.y + best.dicke.c) * 1000;
}
