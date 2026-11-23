/** Flächen und Längen für das Eigenschaften-Panel (rein). Attika = Länge × Breite, Horizontalprojektion (wie `catchment`). */
import { dist } from "../geometry/segment";
import { polygonArea, ringArea, signedArea } from "../geometry/polygon";
import type { Vec2 } from "../geometry/types";
import { dachPolygon, konturKante } from "../model/model";
import type { Aufbau, AttikaSegment, Dachflaeche, Id, Kontur, Zone } from "../model/types";

export const konturFlaeche = (k: Kontur): number => ringArea(k);
export const konturUmfang = (k: Kontur): number => k.reduce((s, p, i) => s + dist(p, k[(i + 1) % k.length]!), 0);

/** Dachfläche netto (ohne Aufbauten), m². */
export const dachNetto = (d: Dachflaeche): number => polygonArea(dachPolygon(d));
export const aufbauFlaeche = (a: Aufbau): number => ringArea(a.kontur);
export const zonenFlaeche = (z: Zone): number => ringArea(z.kontur);

/** Länge eines Attikasegments (Konturkante) in m; 0, wenn die Kante fehlt. */
export function attikaLaenge(d: Dachflaeche, a: AttikaSegment): number {
  const k = konturKante(d.kontur, a.kante);
  return k ? dist(k[0], k[1]) : 0;
}
/** Gehrungslänge höchstens so viel mal Streifenbreite; spitzere Ecken werden stumpf (rechtwinklig) abgeschlossen. */
const GEHRUNG_MAX = 4;

/**
 * Attikastreifen als Viereck [von, bis, X_bis, X_von] auf dem Kantenabschnitt von→bis (Standard: ganze
 * Kante); er liegt immer außerhalb der Dachkontur (die Kontur bleibt die Gefällefläche). Bei der ganzen
 * Kante enden die Streifen an den Ecken auf Gehrung: X ist der Schnittpunkt der Außenkanten dieses und des
 * Nachbarstreifens (Breite 0, wenn der Nachbar keine Attika hat), für jeden Eckwinkel und unterschiedliche
 * Breiten. Abschnitte (Einzugsflächen-Teilstücke) und zu spitze Ecken enden rechtwinklig. Leer, wenn die
 * Kante fehlt.
 */
export function attikaStreifen(d: Dachflaeche, a: AttikaSegment, abschnitt?: readonly [Vec2, Vec2]): Vec2[] {
  const k = konturKante(d.kontur, a.kante);
  if (!k) return [];
  const [von, bis] = abschnitt ?? k;
  const l = dist(k[0], k[1]);
  if (!(l > 0)) return [];
  // Linke Normale der Kante zeigt bei Gegenuhrzeigersinn (Fläche > 0) nach innen; daher umgekehrt.
  const vz = signedArea(d.kontur) > 0 ? -1 : 1;
  const u = { x: (k[1].x - k[0].x) / l, y: (k[1].y - k[0].y) / l };
  const n = { x: -u.y * vz, y: u.x * vz };
  const eckeAm = (ecke: Vec2, nachbar: readonly [Vec2, Vec2], nachbarKante: Id): Vec2 => {
    const quadrat = { x: ecke.x + n.x * a.breite, y: ecke.y + n.y * a.breite };
    const nl = dist(nachbar[0], nachbar[1]);
    if (!(nl > 0)) return quadrat;
    const nu = { x: (nachbar[1].x - nachbar[0].x) / nl, y: (nachbar[1].y - nachbar[0].y) / nl };
    const nn = { x: -nu.y * vz, y: nu.x * vz };
    const nb = d.attika.find((x) => x.kante === nachbarKante)?.breite ?? 0;
    // Schnitt: ecke + n·b + t·u  =  ecke + nn·nb + s·nu
    const det = u.x * -nu.y - u.y * -nu.x;
    if (Math.abs(det) < 1e-9) return quadrat;
    const rx = nn.x * nb - n.x * a.breite, ry = nn.y * nb - n.y * a.breite;
    const t = (rx * -nu.y - ry * -nu.x) / det;
    const x = { x: ecke.x + n.x * a.breite + t * u.x, y: ecke.y + n.y * a.breite + t * u.y };
    const m = Math.hypot(x.x - ecke.x, x.y - ecke.y);
    const ref = Math.max(a.breite, nb);
    return m <= GEHRUNG_MAX * ref ? x : quadrat;
  };
  if (abschnitt) {
    const q = { x: n.x * a.breite, y: n.y * a.breite };
    return [von, bis, { x: bis.x + q.x, y: bis.y + q.y }, { x: von.x + q.x, y: von.y + q.y }];
  }
  const i = d.kontur.findIndex((p) => p.id === a.kante), nPts = d.kontur.length;
  const vor: readonly [Vec2, Vec2] = [d.kontur[(i - 1 + nPts) % nPts]!, d.kontur[i]!];
  const nach: readonly [Vec2, Vec2] = [d.kontur[(i + 1) % nPts]!, d.kontur[(i + 2) % nPts]!];
  return [von, bis, eckeAm(bis, nach, d.kontur[(i + 1) % nPts]!.id), eckeAm(von, vor, d.kontur[(i - 1 + nPts) % nPts]!.id)];
}

export const attikaSegmentFlaeche = (d: Dachflaeche, a: AttikaSegment): number => attikaLaenge(d, a) * a.breite;
export const attikaGesamtFlaeche = (d: Dachflaeche): number => d.attika.reduce((s, a) => s + attikaSegmentFlaeche(d, a), 0);
export const attikaGesamtLaenge = (d: Dachflaeche): number => d.attika.reduce((s, a) => s + attikaLaenge(d, a), 0);
