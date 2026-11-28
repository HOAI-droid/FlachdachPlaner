/** Grundtypen der Geometrie. Einheit überall: Meter, Koordinatensystem rechtshändig (y nach oben). */

/** 2D-Punkt bzw. -Vektor in m. */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/** Geschlossener, einfacher Linienzug (letzter Punkt wird NICHT wiederholt). */
export type Ring = readonly Vec2[];

/**
 * Polygon mit Löchern. Konvention für Ergebnisse des Kerns:
 * `outer` gegen den Uhrzeigersinn (Fläche > 0), `holes` im Uhrzeigersinn (Fläche < 0).
 * Eingaben dürfen beliebig orientiert sein.
 */
export interface Polygon {
  readonly outer: Ring;
  readonly holes: readonly Ring[];
}
