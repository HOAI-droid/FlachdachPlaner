/**
 * Höhenfeld (PLAN A2/A2a): h(x) = min_i (z_i + s · d∞(x, E_i)) mit der Maximumsnorm im
 * Achsensystem der Dachfläche. Jeder Ablauf erzeugt eine umgekehrte quadratische Pyramide aus
 * vier Ebenen; h ist die untere Hülle dieser Pyramiden.
 */
import type { Ring, Vec2 } from "../geometry/types";
import type { Ebene, Hoehenfeld } from "./types";

export type Seite = 0 | 1 | 2 | 3;
export const SEITEN: readonly Seite[] = [0, 1, 2, 3];

const VIERTELKREIS = Math.PI / 2;

/**
 * Achsrichtung der Dachfläche: Richtung der längsten Konturkante, auf [0°, 90°) reduziert
 * (die L∞-Metrik ist gegen Vierteldrehungen invariant). Bei gleich langen Kanten gilt die erste.
 */
export function dachachse(kontur: Ring): Vec2 {
  let best = -1, winkel = 0;
  for (let i = 0; i < kontur.length; i++) {
    const a = kontur[i]!, b = kontur[(i + 1) % kontur.length]!;
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    if (l > best) { best = l; winkel = Math.atan2(b.y - a.y, b.x - a.x); }
  }
  const w = ((winkel % VIERTELKREIS) + VIERTELKREIS) % VIERTELKREIS;
  return w === 0 ? { x: 1, y: 0 } : { x: Math.cos(w), y: Math.sin(w) };
}

/** Einheitsvektor der Pyramidenseite: 0 = +Achse, 1 = +Querachse, 2 = −Achse, 3 = −Querachse. */
export function seitenRichtung(achse: Vec2, seite: Seite): Vec2 {
  switch (seite) {
    case 0: return achse;
    case 1: return { x: -achse.y, y: achse.x };
    case 2: return { x: -achse.x, y: -achse.y };
    case 3: return { x: achse.y, y: -achse.x };
  }
}

/** Ebene der Seite `seite` der Pyramide von Quelle `i`. */
export function ebeneVon(f: Hoehenfeld, i: number, seite: Seite): Ebene {
  const g = seitenRichtung(f.achse, seite);
  const q = f.quellen[i]!;
  const a = f.gefaelle * g.x, b = f.gefaelle * g.y;
  return { a, b, c: q.z - a * q.position.x - b * q.position.y };
}

export const auswerten = (e: Ebene, p: Vec2): number => e.a * p.x + e.b * p.y + e.c;
export const differenz = (e: Ebene, f: Ebene): Ebene => ({ a: e.a - f.a, b: e.b - f.b, c: e.c - f.c });

/** Höhe des Felds im Punkt p (m); NaN, wenn das Feld keine Quellen hat. */
export function hoeheAm(f: Hoehenfeld, p: Vec2): number {
  const quer = seitenRichtung(f.achse, 1);
  let h = Number.NaN;
  for (const q of f.quellen) {
    const dx = p.x - q.position.x, dy = p.y - q.position.y;
    const d = Math.max(Math.abs(dx * f.achse.x + dy * f.achse.y), Math.abs(dx * quer.x + dy * quer.y));
    const hi = q.z + f.gefaelle * d;
    if (!(hi >= h)) h = hi; // erster Wert oder kleiner
  }
  return h;
}
