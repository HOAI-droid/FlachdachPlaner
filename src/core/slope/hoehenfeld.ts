/**
 * Höhenfeld (PLAN A2/A2a): h(x) = min_i (z_i + s · d(x, E_i)). E_i ist ein Punkt (Gully, Notablauf,
 * Dachreiter ohne Maße) oder eine Strecke A–B (LES, Dachreiter-Öffnung am Rand). d ist die
 * Maximumsnorm im eigenen Achsensystem der Quelle (Achse u = Streckenrichtung bzw. Dachachse,
 * Querachse v): d = max(|v|, −t, t − L) mit t = (x − A)·u, L = |B − A|. Jede Quelle erzeugt so eine
 * umgekehrte Pyramide (Strecke: gestreckt, „Walmdach“) aus vier Ebenen; h ist ihre untere Hülle.
 * Die Seitenflächen einer Strecke fallen senkrecht zu ihr.
 */
import type { Ring, Vec2 } from "../geometry/types";
import type { Ebene, Hoehenfeld, Hoehenquelle } from "./types";

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

/** Ebene der Seite `seite` der Pyramide von Quelle `i` (Seite 0 setzt am Streckenende B an, alle übrigen an A). */
export function ebeneVon(f: Hoehenfeld, i: number, seite: Seite): Ebene {
  const q = f.quellen[i]!;
  const g = seitenRichtung(q.achse, seite);
  const p = seite === 0 ? q.bis : q.position;
  const a = f.gefaelle * g.x, b = f.gefaelle * g.y;
  return { a, b, c: q.z - a * p.x - b * p.y };
}

/** Länge der Quelle (0 bei Punktquellen). */
export const quellLaenge = (q: Hoehenquelle): number => Math.hypot(q.bis.x - q.position.x, q.bis.y - q.position.y);

/** Abstand d(p, E) im Achsensystem der Quelle (m). */
export function quellAbstand(q: Hoehenquelle, p: Vec2): number {
  const dx = p.x - q.position.x, dy = p.y - q.position.y;
  const t = dx * q.achse.x + dy * q.achse.y;
  const v = dx * -q.achse.y + dy * q.achse.x;
  return Math.max(Math.abs(v), -t, t - quellLaenge(q));
}

export const auswerten = (e: Ebene, p: Vec2): number => e.a * p.x + e.b * p.y + e.c;
export const differenz = (e: Ebene, f: Ebene): Ebene => ({ a: e.a - f.a, b: e.b - f.b, c: e.c - f.c });

/** Höhe des Felds im Punkt p (m); NaN, wenn das Feld keine Quellen hat. */
export function hoeheAm(f: Hoehenfeld, p: Vec2): number {
  let h = Number.NaN;
  for (const q of f.quellen) {
    const hi = q.z + f.gefaelle * quellAbstand(q, p);
    if (!(hi >= h)) h = hi; // erster Wert oder kleiner
  }
  return h;
}
