import { readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ermittleRegen } from "../src/core/rain/rain";
import { loadRulePack, validateRulePack } from "../src/core/rules/loader";
import type { OrtePack, RegenspendenPack } from "../src/core/rules/types";
import { baueKostraPack, laea, parseAsc, STANDARD_OPTIONEN } from "../tools/kostra-lib";
import { baueOrtePack, parseGeonamesPlz } from "../tools/plz-lib";

// TESTDATEN (synthetisch, keine echten KOSTRA-Werte): 4×4-Raster, 5 km, Mitte = Rasterzentrum (52° N, 10° O) in EPSG:3035.
const nodata = "-99.9";
const ascTest = (basis: number) => [
  "ncols 4", "nrows 4", "xllcorner 4311000", "yllcorner 3200000", "cellsize 5000", `nodata_value ${nodata}`,
  `${nodata} ${basis + 1} ${basis + 2} ${nodata}`,
  `${basis + 3} ${basis + 4} ${basis + 5} ${basis + 6}`,
  `${basis + 7} ${basis + 8} ${basis + 9} ${basis + 10}`,
  `${nodata} ${basis + 11} ${nodata} ${nodata}`,
].join("\n");
const optTest = { lonMin: 9.9, latMin: 51.9, lonMax: 10.1, latMax: 52.1, zelle: 0.05, version: "0.0.1-test", ausgabe: "Testdaten", gueltigAb: "2026-01-01" };

describe("KOSTRA-Werkzeug: ASC-Parsing", () => {
  it("liest Kopf, Zeilenordnung (0 = Norden) und nodata", () => {
    const r = parseAsc(ascTest(100));
    expect([r.ncols, r.nrows, r.xll, r.yll, r.cellsize]).toEqual([4, 4, 4311000, 3200000, 5000]);
    expect(r.werte[0]).toBeNull();
    expect(r.werte[1]).toBe(101);
    expect(r.werte[15]).toBeNull();
  });
  it("lehnt falsche Wertanzahl, fehlenden Kopf und Nicht-Zahlen ab", () => {
    expect(() => parseAsc(ascTest(1).split("\n").slice(0, 8).join("\n"))).toThrow(/Werte/);
    expect(() => parseAsc("ncols 2\nnrows 2\n1 2\n3 4")).toThrow();
    expect(() => parseAsc(ascTest(1).replace("2 3", "x 3"))).toThrow();
  });
});

describe("KOSTRA-Werkzeug: Projektion und Raster", () => {
  it("LAEA: Projektionszentrum und bekannter Ort", () => {
    const o = laea(52, 10);
    expect(o.x).toBeCloseTo(4_321_000, 3);
    expect(o.y).toBeCloseTo(3_210_000, 3);
    const b = laea(52.52, 13.405); // Berlin: grobe Plausibilität (Rastermitte liegt bei ca. 4,55 / 3,27 Mio. m)
    expect(Math.abs(b.x - 4_552_000)).toBeLessThan(2000);
    expect(Math.abs(b.y - 3_273_000)).toBeLessThan(2000);
  });
  it("Raster: Zellen wie im Quellraster, nodata → null, SW-Ecke, Länge", () => {
    const pack = baueKostraPack(parseAsc(ascTest(100)), parseAsc(ascTest(200)), optTest) as { daten: RegenspendenPack["daten"] };
    const { raster, werte } = pack.daten;
    expect(raster).toMatchObject({ crs: "EPSG:4326", x0: 9.9, y0: 51.9, zellgroesse: 0.05, spalten: 4, zeilen: 4 });
    expect(werte.r5_5).toHaveLength(16);
    // Zentrum (52°N, 10°O) liegt an der Ecke der vier mittleren Quellzellen; Zelle (i=2, j=2) = (10,00–10,05 / 52,00–52,05)
    // ⇒ Mittelpunkt östlich/nördlich des Zentrums ⇒ Quellzeile 1 (von Norden), Spalte 2 ⇒ Wert basis + 5.
    expect(werte.r5_5[2 * 4 + 2]).toBe(105);
    expect(werte.r5_100[2 * 4 + 2]).toBe(205);
    expect(werte.r5_5.some((v) => v === null)).toBe(true); // Quell-nodata bleibt null (kein Auffüllen)
  });
  it("Pack validiert gegen das Schema und ergibt über resolveRain die Quellwerte", () => {
    const pack = baueKostraPack(parseAsc(ascTest(100)), parseAsc(ascTest(200)), optTest);
    const res = loadRulePack(pack);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const r = ermittleRegen({ lat: 52.02, lon: 10.02 }, res.pack as RegenspendenPack);
    expect(r.rain?.r5_5).toBe(105);
    expect(r.rain?.r5_100).toBe(205);
  });
  it("Pflichtfelder Quelle/Stand/Lizenz im erzeugten Pack; ohne Quelle abgelehnt", () => {
    const pack = baueKostraPack(parseAsc(ascTest(1)), parseAsc(ascTest(2)), optTest) as Record<string, unknown>;
    expect(String(pack["quelle"])).toContain("Deutscher Wetterdienst");
    expect(String(pack["lizenz"])).toMatch(/Quellenvermerk/);
    expect(pack["ausgabe"]).toBe("Testdaten");
    expect(validateRulePack({ ...pack, quelle: undefined }).length).toBeGreaterThan(0);
  });
});

describe("PLZ-Werkzeug", () => {
  const txt = [
    "DE\t10115\tBerlin\tBerlin\tBE\t\t00\tBerlin, Stadt\t11000\t52.5323\t13.3846\t4",
    "DE\t10115\tBerlin\tBerlin\tBE\t\t00\tBerlin, Stadt\t11000\t52.5325\t13.3848\t4",
    "DE\t01945\tTettau\tBrandenburg\tBB\t\t00\tLK\t12066\t51.4333\t13.7333\t4",
    "DE\tABCDE\tFehler\t\t\t\t\t\t\t50\t10\t4",
    "DE\t12345\tKaputt\t\t\t\t\t\t\tx\t10\t4",
    "",
  ].join("\n");
  it("parst GeoNames-Zeilen, mittelt Duplikate, verwirft ungültige", () => {
    const e = parseGeonamesPlz(txt);
    expect(e.map((x) => x.plz)).toEqual(["01945", "10115"]);
    expect(e[1]).toEqual({ plz: "10115", ort: "Berlin", lat: 52.5324, lon: 13.3847 });
  });
  it("Pack validiert und trägt Lizenz/Quelle/Stand", () => {
    const pack = baueOrtePack(parseGeonamesPlz(txt), { version: "0.0.1-test", ausgabe: "Testdaten", gueltigAb: "2026-01-01" });
    const res = loadRulePack(pack);
    expect(res.ok).toBe(true);
    expect(String(pack["lizenz"])).toContain("CC BY 4.0");
    expect(String(pack["quelle"])).toContain("GeoNames");
  });
});

describe("Gelieferte Packs (rulepacks/)", () => {
  const lade = (pfad: string) => {
    const text = readFileSync(pfad, "utf8");
    const res = loadRulePack(JSON.parse(text));
    if (!res.ok) throw new Error(JSON.stringify(res.fehler));
    return { pack: res.pack, bytes: statSync(pfad).size };
  };
  it("kostra-dwd-2020: gültig, < 5 MB, echte Daten mit Quelle/Stand/Lizenz", () => {
    const { pack, bytes } = lade("rulepacks/kostra-dwd-2020/pack.json");
    expect(bytes).toBeLessThan(5 * 1024 * 1024);
    expect(pack.quelle).toContain("KOSTRA-DWD-2020");
    expect(pack.ausgabe).not.toMatch(/Platzhalter/);
    expect(pack.lizenz).toBeTruthy();
    expect(STANDARD_OPTIONEN.zelle).toBe((pack as RegenspendenPack).daten.raster.zellgroesse);
  });
  // Referenzorte: Sollwerte stammen aus den DWD-Quelldateien (Rn_KOSTRA-DWD-2020_D00005_T005/T100.asc bzw. der davon
  // unabhängigen CSV-Tabelle StatRR_..._D00005.csv, Zelle am Ortspunkt), l/(s·ha).
  it.each([
    ["Berlin", 52.52, 13.405, 353.3, 690.0],
    ["München", 48.137, 11.575, 356.7, 636.7],
    ["Hamburg", 53.551, 9.994, 280.0, 506.7],
  ])("Referenzort %s", (_n, lat, lon, r5, r100) => {
    const { pack } = lade("rulepacks/kostra-dwd-2020/pack.json");
    const r = ermittleRegen({ lat, lon }, pack as RegenspendenPack);
    expect(r.rain?.r5_5).toBe(r5);
    expect(r.rain?.r5_100).toBe(r100);
  });
  it("außerhalb Deutschlands → null + Befund", () => {
    const { pack } = lade("rulepacks/kostra-dwd-2020/pack.json");
    expect(ermittleRegen({ lat: 48.85, lon: 2.35 }, pack as RegenspendenPack).rain).toBeNull();
  });
  it("orte-plz: gültig, < 5 MB, Lizenz, Berlin auffindbar", () => {
    const { pack, bytes } = lade("rulepacks/orte-plz/pack.json");
    expect(bytes).toBeLessThan(5 * 1024 * 1024);
    expect(pack.lizenz).toContain("CC BY 4.0");
    const e = (pack as OrtePack).daten.eintraege;
    expect(e.length).toBeGreaterThan(10000);
    expect(e.some((x) => x.plz === "10115" && Math.abs(x.lat - 52.53) < 0.1)).toBe(true);
  });
});
