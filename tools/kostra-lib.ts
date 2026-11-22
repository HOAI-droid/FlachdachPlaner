/**
 * KOSTRA-Pack-Erzeugung (PLAN Schritt 11), reine Logik ohne Datei-Zugriff.
 *
 * Eingabe: ESRI-ASCII-Raster "Rn_KOSTRA-DWD-2020_D00005_T005.asc" und "..._T100.asc" (Regenspende in l/(s·ha),
 * Dauerstufe 5 min). Format: sechs Kopfzeilen (ncols, nrows, xllcorner, yllcorner, cellsize, nodata_value), danach
 * nrows Zeilen mit ncols Werten, Zeile 0 = Norden. Das Quellraster liegt in ETRS89-LAEA (EPSG:3035; DWD-.prj:
 * Mittelpunkt 52° N / 10° O, FE 4 321 000 m, FN 3 210 000 m), 5 km Zellen. Der Kern (src/core/rain) kennt nur
 * EPSG:4326 und EPSG:3034; deshalb wird auf ein regelmäßiges WGS84-Gitter umgetastet (Nächster-Nachbar am Zellmittelpunkt).
 */
export interface AscRaster {
  readonly ncols: number;
  readonly nrows: number;
  readonly xll: number;
  readonly yll: number;
  readonly cellsize: number;
  /** Zeile 0 = Norden; null = nodata. Index row·ncols + col. */
  readonly werte: readonly (number | null)[];
}

export function parseAsc(text: string): AscRaster {
  const zeilen = text.split(/\r?\n/);
  const kopf = new Map<string, number>();
  let k = 0;
  for (; k < zeilen.length && kopf.size < 6; k++) {
    const t = (zeilen[k] ?? "").trim();
    if (!t) continue;
    const m = /^([A-Za-z_]+)\s+(-?[\d.eE+-]+)$/.exec(t);
    if (!m) throw new Error(`ASC-Kopfzeile ungültig: „${t}“`);
    kopf.set((m[1] ?? "").toLowerCase(), Number(m[2]));
  }
  const get = (n: string) => {
    const v = kopf.get(n);
    if (v === undefined || !Number.isFinite(v)) throw new Error(`ASC-Kopf: ${n} fehlt`);
    return v;
  };
  const ncols = get("ncols"), nrows = get("nrows"), xll = get("xllcorner"), yll = get("yllcorner");
  const cellsize = get("cellsize"), nodata = get("nodata_value");
  if (!Number.isInteger(ncols) || !Number.isInteger(nrows) || ncols < 1 || nrows < 1 || cellsize <= 0) {
    throw new Error("ASC-Kopf: ncols/nrows/cellsize ungültig");
  }
  const werte: (number | null)[] = [];
  for (; k < zeilen.length; k++) {
    const t = (zeilen[k] ?? "").trim();
    if (!t) continue;
    for (const s of t.split(/\s+/)) {
      const v = Number(s);
      if (!Number.isFinite(v)) throw new Error(`ASC-Wert ungültig: „${s}“`);
      werte.push(v === nodata || v < 0 ? null : v);
    }
  }
  if (werte.length !== ncols * nrows) throw new Error(`ASC: ${werte.length} Werte, erwartet ${ncols * nrows}`);
  return { ncols, nrows, xll, yll, cellsize, werte };
}

// ETRS89-LAEA (EPSG:3035), Snyder / EPSG-Methode 9820, GRS80.
const A = 6378137, F = 1 / 298.257222101, E2 = F * (2 - F), E = Math.sqrt(E2), RAD = Math.PI / 180;
const qFn = (phi: number) => {
  const s = Math.sin(phi);
  return (1 - E2) * (s / (1 - E2 * s * s) - Math.log((1 - E * s) / (1 + E * s)) / (2 * E));
};
const QP = qFn(Math.PI / 2);
const LAEA = (() => {
  const phi0 = 52 * RAD, b0 = Math.asin(qFn(phi0) / QP), rq = A * Math.sqrt(QP / 2);
  const d = (A * Math.cos(phi0) / Math.sqrt(1 - E2 * Math.sin(phi0) ** 2)) / (rq * Math.cos(b0));
  return { b0, rq, d, lon0: 10 * RAD, fe: 4_321_000, fn: 3_210_000 };
})();

/** WGS84/ETRS89 (Grad) → EPSG:3035 (Meter). */
export function laea(lat: number, lon: number): { x: number; y: number } {
  const b = Math.asin(qFn(lat * RAD) / QP), dl = lon * RAD - LAEA.lon0;
  const bb = LAEA.rq * Math.sqrt(2 / (1 + Math.sin(LAEA.b0) * Math.sin(b) + Math.cos(LAEA.b0) * Math.cos(b) * Math.cos(dl)));
  return {
    x: LAEA.fe + bb * LAEA.d * Math.cos(b) * Math.sin(dl),
    y: LAEA.fn + (bb / LAEA.d) * (Math.cos(LAEA.b0) * Math.sin(b) - Math.sin(LAEA.b0) * Math.cos(b) * Math.cos(dl)),
  };
}

/** Wert der Quellzelle, die den Punkt (lat, lon) enthält; null außerhalb oder bei nodata. */
export function stichprobe(r: AscRaster, lat: number, lon: number): number | null {
  const p = laea(lat, lon);
  const col = Math.floor((p.x - r.xll) / r.cellsize), rowS = Math.floor((p.y - r.yll) / r.cellsize);
  if (col < 0 || col >= r.ncols || rowS < 0 || rowS >= r.nrows) return null;
  return r.werte[(r.nrows - 1 - rowS) * r.ncols + col] ?? null;
}

export interface KostraOptionen {
  /** Südwestecke und Ausdehnung des Ausgaberasters (Grad). */
  readonly lonMin: number; readonly latMin: number; readonly lonMax: number; readonly latMax: number;
  /** Zellgröße in Grad (quadratisch). */
  readonly zelle: number;
  readonly version: string;
  /** Stand der Quelle (z. B. Veröffentlichungsdatum der Dateien) und Erstellungsdatum JJJJ-MM-TT. */
  readonly ausgabe: string;
  readonly gueltigAb: string;
  readonly geprueft?: boolean;
  /** Freitext zur Herkunft der Dateien (z. B. Download-URL). */
  readonly quelleDetail?: string;
  readonly titel?: string;
  readonly lizenz?: string;
  readonly hinweis?: string;
}

export const STANDARD_OPTIONEN: Pick<KostraOptionen, "lonMin" | "latMin" | "lonMax" | "latMax" | "zelle"> = {
  lonMin: 5.8, latMin: 47.2, lonMax: 15.2, latMax: 55.1, zelle: 0.02,
};

export const KOSTRA_LIZENZ =
  "Deutscher Wetterdienst (DWD), KOSTRA-DWD-2020 (Climate Data Center). Rasterdaten als Geodaten entgeltfrei und ohne " +
  "Nutzungseinschränkung bereitgestellt (GeoNutzV); Quellenvermerk: „Datenbasis: Deutscher Wetterdienst, KOSTRA-DWD-2020“. " +
  "Umgetastet auf ein WGS84-Gitter (Nächster-Nachbar); OpenKOSTRA verwendet dieselben DWD-Daten.";

export function baueKostraPack(rn5: AscRaster, rn100: AscRaster, o: KostraOptionen): Record<string, unknown> {
  const spalten = Math.ceil((o.lonMax - o.lonMin) / o.zelle - 1e-9), zeilen = Math.ceil((o.latMax - o.latMin) / o.zelle - 1e-9);
  if (spalten < 1 || zeilen < 1) throw new Error("Ausgaberaster leer");
  const r5_5: (number | null)[] = [], r5_100: (number | null)[] = [];
  for (let j = 0; j < zeilen; j++) {
    const lat = o.latMin + (j + 0.5) * o.zelle;
    for (let i = 0; i < spalten; i++) {
      const lon = o.lonMin + (i + 0.5) * o.zelle;
      r5_5.push(stichprobe(rn5, lat, lon));
      r5_100.push(stichprobe(rn100, lat, lon));
    }
  }
  return {
    $schema: "../schema/regenspenden.schema.json",
    id: "kostra-dwd-2020",
    typ: "regenspenden",
    version: o.version,
    titel: o.titel ?? "KOSTRA-DWD-2020 r(5,5) / r(5,100), Dauerstufe 5 min",
    quelle: `Deutscher Wetterdienst, KOSTRA-DWD-2020, Rn (Regenspende l/(s·ha)), D = 5 min, T = 5 a und T = 100 a, 5-km-Raster ETRS89-LAEA${o.quelleDetail ? `; ${o.quelleDetail}` : ""}`,
    ausgabe: o.ausgabe,
    gueltigAb: o.gueltigAb,
    geprueft: o.geprueft ?? false,
    lizenz: o.lizenz ?? KOSTRA_LIZENZ,
    hinweis: o.hinweis ?? `Erzeugt mit tools/kostra-build.ts. Umtastung auf WGS84-Gitter ${o.zelle}° (Zellmittelpunkt, Nächster-Nachbar) aus dem 5-km-LAEA-Quellraster; Positionsunschärfe bis ca. 1,5 km. Zellen ohne Wert = außerhalb Deutschlands.`,
    daten: {
      raster: { crs: "EPSG:4326", x0: o.lonMin, y0: o.latMin, zellgroesse: o.zelle, spalten, zeilen },
      werte: { r5_5, r5_100 },
    },
  };
}
