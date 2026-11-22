/**
 * Kennwerte des Verlegeplans (Schritt 26): Ø/min/max der Gesamtdämmdicke aus den verlegten Stücken.
 * Je Stück ist die Dicke eine Ebene → der Flächenmittelwert ist der Wert im Schwerpunkt (exakt).
 */
import { polygonArea, polygonCentroid } from "../geometry/polygon";
import type { DaemmplanDach } from "./types";

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
