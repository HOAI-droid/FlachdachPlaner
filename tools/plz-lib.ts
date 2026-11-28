/**
 * PLZ-/Orte-Pack-Erzeugung (PLAN Schritt 11), reine Logik.
 * Eingabe: GeoNames-Postleitzahlen "DE.txt" (tabulatorgetrennt, UTF-8; Spalten: Land, PLZ, Ort, Bundesland, Code,
 * Kreis, Code, Gemeinde, Code, Breite, Länge, Genauigkeit). Lizenz CC BY 4.0 (https://www.geonames.org).
 * Je (PLZ, Ort) ein Eintrag mit der Koordinate des Ortes (WGS84); doppelte Zeilen werden gemittelt.
 */
export interface OrtEintrag { plz: string; ort: string; lat: number; lon: number }

export function parseGeonamesPlz(text: string): OrtEintrag[] {
  const summen = new Map<string, { plz: string; ort: string; lat: number; lon: number; n: number }>();
  for (const zeile of text.split(/\r?\n/)) {
    if (!zeile.trim()) continue;
    const s = zeile.split("\t");
    const plz = (s[1] ?? "").trim(), ort = (s[2] ?? "").trim(), lat = Number(s[9]), lon = Number(s[10]);
    if (!/^\d{5}$/.test(plz) || !ort || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    const k = `${plz}\u0000${ort}`;
    const a = summen.get(k);
    if (a) { a.lat += lat; a.lon += lon; a.n++; } else summen.set(k, { plz, ort, lat, lon, n: 1 });
  }
  const r = (v: number) => Math.round(v * 1e4) / 1e4;
  return [...summen.values()]
    .map((a) => ({ plz: a.plz, ort: a.ort, lat: r(a.lat / a.n), lon: r(a.lon / a.n) }))
    .sort((x, y) => x.plz.localeCompare(y.plz) || x.ort.localeCompare(y.ort, "de"));
}

export interface PlzOptionen {
  readonly version: string; readonly ausgabe: string; readonly gueltigAb: string; readonly geprueft?: boolean;
}

export const PLZ_LIZENZ =
  "GeoNames Postal Codes (https://www.geonames.org), Creative Commons Attribution 4.0 (CC BY 4.0); Namensnennung: „GeoNames, geonames.org“.";

export function baueOrtePack(eintraege: readonly OrtEintrag[], o: PlzOptionen): Record<string, unknown> {
  return {
    $schema: "../schema/orte.schema.json",
    id: "orte-plz",
    typ: "orte",
    version: o.version,
    titel: "PLZ/Orte Deutschland (GeoNames)",
    quelle: "GeoNames Postal Codes, Datei DE.zip (download.geonames.org/export/zip/DE.zip)",
    ausgabe: o.ausgabe,
    gueltigAb: o.gueltigAb,
    geprueft: o.geprueft ?? false,
    lizenz: PLZ_LIZENZ,
    hinweis: "Erzeugt mit tools/plz-build.ts. Koordinate = Ortspunkt laut GeoNames (bei mehrfach vorkommenden PLZ/Ort-Paaren gemittelt), kein amtlicher PLZ-Flächenschwerpunkt; Genauigkeit einige hundert Meter bis wenige km. Für die Regenspende ausreichend (5-km-Raster).",
    daten: { eintraege },
  };
}
