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

/**
 * Lagetoleranz in m (Zeichengenauigkeit einer Planung im Maßstab 1:100: 0,5 mm auf dem Plan = 5 cm).
 * Lagen, die sich um höchstens diesen Wert unterscheiden, gelten für die Konstruktion des Höhenfelds als
 * gleich (Achse eingerastet, Quellkoordinaten angeglichen). Höhen (z, Dicken) bleiben exakt. Ohne diese
 * Toleranz erzeugen fast fluchtende Abläufe (z. B. Δx = 2 cm) Scheinkehlen quer über die Fläche.
 */
export const LAGE_TOL = 0.05;

/**
 * Dachachse auf 0°/90° einrasten, wenn die längste Konturkante über ihre Länge um höchstens LAGE_TOL
 * von der Waagerechten bzw. Senkrechten abweicht (L∞-Metrik: beide ergeben die Achse (1, 0)).
 */
export function achseEingerastet(kontur: Ring, achse: Vec2): Vec2 {
  let laenge = 0;
  for (let i = 0; i < kontur.length; i++) {
    const a = kontur[i]!, b = kontur[(i + 1) % kontur.length]!;
    laenge = Math.max(laenge, Math.hypot(b.x - a.x, b.y - a.y));
  }
  return laenge * Math.min(Math.abs(achse.y), Math.abs(achse.x)) <= LAGE_TOL ? { x: 1, y: 0 } : achse;
}

/**
 * Punktquellen in Dachachse: Koordinaten (längs t, quer v), die um höchstens LAGE_TOL auseinanderliegen,
 * auf den Wert der ersten Quelle der Gruppe (Eingabereihenfolge) angleichen. Nur intern für die
 * Konstruktion; z bleibt unverändert (Kote am Ablauf = z). Strecken (LES, Dachreiter) bleiben wie sie sind.
 */
export function quellenAngeglichen(quellen: readonly Hoehenquelle[], achse: Vec2): Hoehenquelle[] {
  const punkt = (q: Hoehenquelle) => quellLaenge(q) === 0 && q.achse.x === achse.x && q.achse.y === achse.y;
  const tv = quellen.map((q) => [q.position.x * achse.x + q.position.y * achse.y, -q.position.x * achse.y + q.position.y * achse.x]);
  const neu = tv.map((x) => [...x]);
  for (const ax of [0, 1]) {
    quellen.forEach((q, i) => {
      if (!punkt(q)) return;
      const j = quellen.findIndex((r, k) => k < i && punkt(r) && Math.abs(tv[k]![ax]! - tv[i]![ax]!) <= LAGE_TOL);
      if (j >= 0) neu[i]![ax] = neu[j]![ax]!;
    });
  }
  return quellen.map((q, i) => {
    if (neu[i]![0] === tv[i]![0] && neu[i]![1] === tv[i]![1]) return q;
    const [t, v] = neu[i]! as [number, number];
    const p = { x: t * achse.x - v * achse.y, y: t * achse.y + v * achse.x };
    return { ...q, position: p, bis: { ...p } };
  });
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

/**
 * Ebene, die im Punkt p die Höhe bestimmt (tiefste Pyramide, dort ihre höchste Seite); null ohne Quellen.
 * Gleichstand: erste Quelle bzw. erste Seite in SEITEN-Reihenfolge.
 */
export function aktiveEbene(f: Hoehenfeld, p: Vec2): Ebene | null {
  let best: Ebene | null = null, h = Infinity;
  f.quellen.forEach((q, i) => {
    const dx = p.x - q.position.x, dy = p.y - q.position.y;
    const t = dx * q.achse.x + dy * q.achse.y, v = dx * -q.achse.y + dy * q.achse.x;
    const terme = [t - quellLaenge(q), v, -t, -v]; // Index = Seite (0 = +Achse ab B, 1 = +Quer, 2 = −Achse, 3 = −Quer)
    let k = 0;
    for (const s of SEITEN) if (terme[s]! > terme[k]!) k = s;
    const hi = q.z + f.gefaelle * terme[k]!;
    if (hi < h) { h = hi; best = ebeneVon(f, i, k as Seite); }
  });
  return best;
}

/** Höhe des Felds im Punkt p (m); NaN, wenn das Feld keine Quellen hat. */
export function hoeheAm(f: Hoehenfeld, p: Vec2): number {
  let h = Number.NaN;
  for (const q of f.quellen) {
    const hi = q.z + f.gefaelle * quellAbstand(q, p);
    if (!(hi >= h)) h = hi; // erster Wert oder kleiner
  }
  return h;
}
