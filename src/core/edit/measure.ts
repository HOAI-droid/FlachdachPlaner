/** Flächen und Längen für das Eigenschaften-Panel (rein). Attika = Länge × Breite, Horizontalprojektion (wie `catchment`). */
import { dist } from "../geometry/segment";
import { polygonArea, ringArea } from "../geometry/polygon";
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
export const attikaSegmentFlaeche = (d: Dachflaeche, a: AttikaSegment): number => attikaLaenge(d, a) * a.breite;
export const attikaGesamtFlaeche = (d: Dachflaeche): number => d.attika.reduce((s, a) => s + attikaSegmentFlaeche(d, a), 0);
export const attikaGesamtLaenge = (d: Dachflaeche): number => d.attika.reduce((s, a) => s + attikaLaenge(d, a), 0);
