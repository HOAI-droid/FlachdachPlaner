/**
 * Darstellungshilfen für Gefällepläne (2D-Ansicht, PDF): Koten bündeln, Lage der Gefällepfeile.
 * Rein; ändert keine Höhen im Modell, nur die Liste der anzuzeigenden Marken.
 */
import { pointInPolygon } from "../geometry/polygon";
import { distPointSegment } from "../geometry/segment";
import type { Polygon, Vec2 } from "../geometry/types";
import { LAGE_TOL } from "./hoehenfeld";
import type { DachGefaelle, KotenArt } from "./types";

/** Koten, die höchstens so weit auseinanderliegen (m), gelten für die Anzeige als eine Stelle (wie LAGE_TOL). */
export const KOTEN_BUENDEL_LAGE = LAGE_TOL;
/** … und deren Höhen sich höchstens so viel unterscheiden (m, Mikroabweichung), werden zu einer Marke. */
export const KOTEN_BUENDEL_HOEHE = 0.005;

export type KotenMarkeArt = KotenArt | "hochpunkt" | "tiefpunkt";

export interface KotenMarke {
  readonly position: Vec2;
  /** Angezeigte Höhe in m. */
  readonly kote: number;
  readonly art: KotenMarkeArt;
}

/** Vorrang für Lage/Art der gebündelten Marke (kleiner = wichtiger). */
const VORRANG: Record<KotenMarkeArt, number> = { ablauf: 0, hochpunkt: 1, tiefpunkt: 2, ecke: 3, grat: 4, kehle: 5, teilung: 6 };

/**
 * Bündelt Marken an nahezu gleicher Stelle (≤ KOTEN_BUENDEL_LAGE) mit nur kleiner Höhenabweichung
 * (≤ KOTEN_BUENDEL_HOEHE) zu einer. Lage und Art von der wichtigsten Marke (Ablauf > HP > TP > Ecke >
 * Grat > Kehle > Teilung); Höhe: bei HP/TP deren Wert, sonst die häufigste auf mm gerundete, bei
 * Gleichstand die kleinste. Deterministisch (stabile Reihenfolge der Eingabe).
 */
export function buendleKoten(marken: readonly KotenMarke[]): KotenMarke[] {
  const sortiert = marken.map((m, i) => ({ m, i })).sort((a, b) => VORRANG[a.m.art] - VORRANG[b.m.art] || a.i - b.i);
  const gruppen: KotenMarke[][] = [];
  for (const { m } of sortiert) {
    const g = gruppen.find((x) => {
      const k = x[0]!;
      return Math.hypot(k.position.x - m.position.x, k.position.y - m.position.y) <= KOTEN_BUENDEL_LAGE + 1e-9 &&
        x.every((y) => Math.abs(y.kote - m.kote) <= KOTEN_BUENDEL_HOEHE + 1e-9);
    });
    if (g) g.push(m); else gruppen.push([m]);
  }
  return gruppen.map((g) => {
    const kopf = g[0]!;
    if (kopf.art === "hochpunkt" || kopf.art === "tiefpunkt" || g.length === 1) return kopf;
    const zaehler = new Map<number, number>();
    for (const x of g) { const mm = Math.round(x.kote * 1000); zaehler.set(mm, (zaehler.get(mm) ?? 0) + 1); }
    let best = Infinity, n = 0;
    for (const [mm, c] of zaehler) if (c > n || (c === n && mm < best)) { best = mm; n = c; }
    return { ...kopf, kote: best / 1000 };
  });
}

/** Alle Marken einer Dachfläche (Koten inkl. Zonen, HP/TP), gebündelt; Abläufe sind enthalten (Art „ablauf“). */
export function kotenMarken(dachflaechen: readonly DachGefaelle[]): KotenMarke[] {
  const roh: KotenMarke[] = [];
  for (const d of dachflaechen) {
    if (d.hochpunkt) for (const p of d.hochpunkt.orte) roh.push({ position: p, kote: d.hochpunkt.kote, art: "hochpunkt" });
    if (d.tiefpunkt) for (const p of d.tiefpunkt.orte) roh.push({ position: p, kote: d.tiefpunkt.kote, art: "tiefpunkt" });
    for (const k of [...d.koten, ...d.zonen.flatMap((z) => z.koten)]) roh.push(k);
  }
  return buendleKoten(roh);
}

/**
 * Lage eines Gefällepfeils der Länge `laenge` (m), mittig um `mitte` in Richtung `richtung`, ganz in
 * der Facette `polygon` und mit mindestens `abstand` (m) zu jedem Punkt in `frei` (z. B. Abläufe).
 * Probiert die volle und die halbe Länge; null, wenn die Facette dafür zu klein ist.
 */
export function pfeilLage(
  mitte: Vec2, richtung: Vec2, polygon: Polygon, laenge: number, frei: readonly Vec2[] = [], abstand = 0,
): { von: Vec2; bis: Vec2 } | null {
  for (const l of [laenge, laenge / 2]) {
    const von = { x: mitte.x - (richtung.x * l) / 2, y: mitte.y - (richtung.y * l) / 2 };
    const bis = { x: mitte.x + (richtung.x * l) / 2, y: mitte.y + (richtung.y * l) / 2 };
    if (pointInPolygon(von, polygon) !== "inside" || pointInPolygon(bis, polygon) !== "inside") continue;
    if (frei.some((p) => distPointSegment(p, von, bis) < abstand)) continue;
    return { von, bis };
  }
  return null;
}
