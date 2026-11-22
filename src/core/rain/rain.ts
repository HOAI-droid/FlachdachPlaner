/**
 * Regenspende am Standort (PLAN Schritt 10): Koordinate (WGS84) → Rasterzelle des Regenspenden-Packs.
 * Raster: (x0, y0) = Südwestecke der Zelle (0, 0), Index j·spalten + i, Zeile 0 = Süden. Unterstützte KBS:
 * "EPSG:4326" (x = Länge, y = Breite in Grad) und "EPSG:3034" (ETRS89 / LCC Europe, Meter).
 * Außerhalb des Rasters oder Zelle ohne Wert → null + Befund (keine erfundene Zahl).
 */
import type { Befund } from "../checks/types";
import type { Koordinate } from "../model/types";
import type { RegenspendenPack } from "../rules/types";

export const REGEL_REGENSPENDE = "regenspende-kostra";

export interface RainData {
  /** l/(s·ha); null, wenn die Zelle für diese Wiederkehrzeit keinen Wert hat. */
  readonly r5_5: number | null;
  readonly r5_100: number | null;
  readonly zelle: { readonly i: number; readonly j: number; readonly index: number };
  readonly packId: string;
  readonly packVersion: string;
  readonly quelle: string;
}

export interface RegenErmittlung {
  readonly rain: RainData | null;
  readonly befunde: readonly Befund[];
}

/** Projektion WGS84 → Raster-KBS; null bei unbekanntem KBS. */
export function projiziere(crs: string, k: Koordinate): { x: number; y: number } | null {
  const c = crs.trim().toUpperCase();
  if (c === "EPSG:4326") return { x: k.lon, y: k.lat };
  if (c === "EPSG:3034") return lccEtrs89(k);
  return null;
}

// EPSG:3034 (ETRS89-extended / LCC Europe): GRS80, φ0 52°, λ0 10°, φ1 35°, φ2 65°, FE 4 000 000 m, FN 2 800 000 m.
const GRS80_A = 6378137, GRS80_F = 1 / 298.257222101;
const E = Math.sqrt(GRS80_F * (2 - GRS80_F));
const RAD = Math.PI / 180;
const mFn = (phi: number) => Math.cos(phi) / Math.sqrt(1 - E * E * Math.sin(phi) ** 2);
const tFn = (phi: number) => Math.tan(Math.PI / 4 - phi / 2) / ((1 - E * Math.sin(phi)) / (1 + E * Math.sin(phi))) ** (E / 2);
const LCC = (() => {
  const p0 = 52 * RAD, p1 = 35 * RAD, p2 = 65 * RAD;
  const n = (Math.log(mFn(p1)) - Math.log(mFn(p2))) / (Math.log(tFn(p1)) - Math.log(tFn(p2)));
  const F = mFn(p1) / (n * tFn(p1) ** n);
  return { n, aF: GRS80_A * F, rho0: GRS80_A * F * tFn(p0) ** n, lon0: 10 * RAD, fe: 4_000_000, fn: 2_800_000 };
})();

/** Lambert-Kegelprojektion mit zwei Breitenkreisen (Snyder 1987, Gl. 15-7 ff.). */
function lccEtrs89(k: Koordinate): { x: number; y: number } {
  const rho = LCC.aF * tFn(k.lat * RAD) ** LCC.n;
  const theta = LCC.n * (k.lon * RAD - LCC.lon0);
  return { x: LCC.fe + rho * Math.sin(theta), y: LCC.fn + LCC.rho0 - rho * Math.cos(theta) };
}

/** PLAN §5: Rasterzelle und Regenspenden; null außerhalb des Rasters oder ohne Werte. */
export function resolveRain(loc: Koordinate, kostra: RegenspendenPack): RainData | null {
  return ermittleRegen(loc, kostra).rain;
}

export function ermittleRegen(loc: Koordinate | null, kostra: RegenspendenPack): RegenErmittlung {
  const befund = (code: string, meldung: string): RegenErmittlung => ({
    rain: null,
    befunde: [{ stufe: "warnung", code, objektId: null, regelId: REGEL_REGENSPENDE, quelle: kostra.quelle,
      meldung: `${meldung} Regenspende bitte manuell eingeben.` }],
  });
  if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lon)) return befund("standort-fehlt", "Kein Standort gesetzt.");
  const { raster, werte } = kostra.daten;
  const p = projiziere(raster.crs, loc);
  if (!p) return befund("regen-kbs-unbekannt", `Koordinatenbezugssystem „${raster.crs}“ des Packs ${kostra.id} wird nicht unterstützt.`);
  const i = Math.floor((p.x - raster.x0) / raster.zellgroesse), j = Math.floor((p.y - raster.y0) / raster.zellgroesse);
  const ort = `(${loc.lat.toFixed(4)}° N, ${loc.lon.toFixed(4)}° O)`;
  if (i < 0 || j < 0 || i >= raster.spalten || j >= raster.zeilen) {
    return befund("regen-ausserhalb", `Standort ${ort} liegt außerhalb des Regenspenden-Rasters (Deutschland).`);
  }
  const index = j * raster.spalten + i;
  const r5_5 = werte.r5_5[index] ?? null, r5_100 = werte.r5_100[index] ?? null;
  if (r5_5 === null && r5_100 === null) {
    return befund("regen-ohne-wert", `Rasterzelle ${i}/${j} am Standort ${ort} hat keine Regenspende (außerhalb Deutschlands?).`);
  }
  const rain: RainData = { r5_5, r5_100, zelle: { i, j, index }, packId: kostra.id, packVersion: kostra.version, quelle: kostra.quelle };
  const fehlt = r5_5 === null ? "r(5,5)" : r5_100 === null ? "r(5,100)" : null;
  return {
    rain,
    befunde: fehlt
      ? [{ stufe: "warnung", code: "regen-teilweise", objektId: null, regelId: REGEL_REGENSPENDE, quelle: kostra.quelle,
          meldung: `Rasterzelle ${i}/${j}: ${fehlt} fehlt im Pack; bitte manuell eingeben.` }]
      : [],
  };
}
