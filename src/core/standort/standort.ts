/** Standort (PLAN Schritt 20): Orte suchen, UTM → WGS84, Abweichung Nutzerwert gegen Pack-Wert. Rein, ohne DOM und Netz. */
import type { Koordinate, Regenspende } from "../model/types";
import type { OrteEintragListe } from "./typen";

const norm = (s: string) =>
  s.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/\s+/g, " ").trim();

/** PLZ (Anfang) oder Ortsname (Teilstring, ohne Umlautunterschied); PLZ-Treffer zuerst, dann Ortsanfang, dann Teilstring. */
export function sucheOrte(eintraege: OrteEintragListe, text: string, max = 8): OrteEintragListe {
  const q = norm(text);
  if (q.length === 0) return [];
  const nurZiffern = /^\d+$/.test(q);
  const treffer: { e: OrteEintragListe[number]; rang: number }[] = [];
  for (const e of eintraege) {
    let rang = -1;
    if (nurZiffern) { if (e.plz.startsWith(q)) rang = e.plz === q ? 0 : 1; }
    else {
      const o = norm(e.ort);
      if (o === q) rang = 0; else if (o.startsWith(q)) rang = 1; else if (q.length >= 3 && o.includes(q)) rang = 2;
    }
    if (rang >= 0) treffer.push({ e, rang });
  }
  treffer.sort((a, b) => a.rang - b.rang || a.e.plz.localeCompare(b.e.plz));
  return treffer.slice(0, max).map((t) => t.e);
}

/** Inverse Transversale Mercator (Krüger-Reihe), GRS80/WGS84-Ellipsoid, UTM-Streifen 1–60. Null bei ungültiger Eingabe. */
export function utmZuWgs84(zone: number, ost: number, nord: number, suedhalbkugel = false): Koordinate | null {
  if (![zone, ost, nord].every(Number.isFinite) || !Number.isInteger(zone) || zone < 1 || zone > 60) return null;
  if (ost < 100000 || ost > 900000 || nord < 0 || nord > 10_000_000) return null;
  const a = 6378137, f = 1 / 298.257222101, k0 = 0.9996;
  const n = f / (2 - f), n2 = n * n, n3 = n2 * n;
  const A = (a / (1 + n)) * (1 + n2 / 4 + (n2 * n2) / 64);
  const b = [n / 2 - (2 * n2) / 3 + (37 * n3) / 96, n2 / 48 + n3 / 15, (17 * n3) / 480];
  const d = [2 * n - (2 * n2) / 3 - 2 * n3, (7 * n2) / 3 - (8 * n3) / 5, (26 * n3) / 15];
  const xi = (suedhalbkugel ? nord - 10_000_000 : nord) / (k0 * A), eta = (ost - 500000) / (k0 * A);
  let xi2 = xi, eta2 = eta;
  b.forEach((bj, i) => {
    const j = 2 * (i + 1);
    xi2 -= bj * Math.sin(j * xi) * Math.cosh(j * eta);
    eta2 -= bj * Math.cos(j * xi) * Math.sinh(j * eta);
  });
  const chi = Math.asin(Math.sin(xi2) / Math.cosh(eta2));
  let phi = chi;
  d.forEach((dj, i) => { phi += dj * Math.sin(2 * (i + 1) * chi); });
  const lam = Math.atan2(Math.sinh(eta2), Math.cos(xi2));
  const lat = (phi * 180) / Math.PI, lon = zone * 6 - 183 + (lam * 180) / Math.PI;
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

/** Relative Abweichung Nutzerwert gegen Pack-Wert (0,12 = +12 %); null ohne beides oder Pack-Wert 0. */
export function regenAbweichung(r: Regenspende): number | null {
  if (r.manuellWert === undefined || r.packWert === null || !(r.packWert > 0)) return null;
  return (r.manuellWert - r.packWert) / r.packWert;
}

/** Wirksamer Wert: Nutzerwert vor Pack-Wert. */
export const regenWirksam = (r: Regenspende): number | null => r.manuellWert ?? r.packWert;

/** Plausibler Bereich für Koordinaten (Deutschland und Umland); ohne Zahlenwerte außerhalb [−90,90]/[−180,180]. */
export const koordinateGueltig = (k: Koordinate): boolean =>
  Number.isFinite(k.lat) && Number.isFinite(k.lon) && Math.abs(k.lat) <= 90 && Math.abs(k.lon) <= 180;
