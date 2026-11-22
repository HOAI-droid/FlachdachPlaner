/** Flächen und Längen für das Eigenschaften-Panel (rein). Attika = Länge × Breite, Horizontalprojektion (wie `catchment`). */
import { dist } from "../geometry/segment";
import { polygonArea, ringArea, signedArea } from "../geometry/polygon";
import type { Vec2 } from "../geometry/types";
import { dachPolygon, konturKante } from "../model/model";
import type { Aufbau, AttikaSegment, Dachflaeche, Kontur, Zone } from "../model/types";

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
/**
 * Attikastreifen als Viereck [von, bis, bis + n·b, von + n·b] auf dem Kantenabschnitt von→bis (Standard:
 * ganze Kante); n zeigt bei Seite „innen“ ins Dachinnere, bei „aussen“ nach außen. Leer, wenn die Kante fehlt.
 */
export function attikaStreifen(d: Dachflaeche, a: AttikaSegment, abschnitt?: readonly [Vec2, Vec2]): Vec2[] {
  const k = konturKante(d.kontur, a.kante);
  if (!k) return [];
  const [von, bis] = abschnitt ?? k;
  const l = dist(k[0], k[1]);
  if (!(l > 0)) return [];
  // Linke Normale der Kante zeigt bei Gegenuhrzeigersinn (Fläche > 0) nach innen.
  const vz = (signedArea(d.kontur) > 0 ? 1 : -1) * (a.seite === "aussen" ? -1 : 1);
  const nx = (-(k[1].y - k[0].y) / l) * vz * a.breite, ny = ((k[1].x - k[0].x) / l) * vz * a.breite;
  return [von, bis, { x: bis.x + nx, y: bis.y + ny }, { x: von.x + nx, y: von.y + ny }];
}

export const attikaSegmentFlaeche = (d: Dachflaeche, a: AttikaSegment): number => attikaLaenge(d, a) * a.breite;
export const attikaGesamtFlaeche = (d: Dachflaeche): number => d.attika.reduce((s, a) => s + attikaSegmentFlaeche(d, a), 0);
export const attikaGesamtLaenge = (d: Dachflaeche): number => d.attika.reduce((s, a) => s + attikaLaenge(d, a), 0);
