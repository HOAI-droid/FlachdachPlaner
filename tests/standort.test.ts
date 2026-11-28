import { describe, expect, it } from "vitest";
import {
  ausfuehren, createProject, ermittleRegen, loadRulePack, neuerVerlauf, regenAbweichung, regenWirksam, setRegenManuell,
  setStandort, sucheOrte, utmZuWgs84, validateProject, type OrtEintrag, type RegenspendenPack,
} from "../src/core/index";

const orte: OrtEintrag[] = [
  { plz: "10115", ort: "Berlin", lat: 52.53, lon: 13.38 }, { plz: "10117", ort: "Berlin", lat: 52.52, lon: 13.39 },
  { plz: "80331", ort: "München", lat: 48.13, lon: 11.57 }, { plz: "50667", ort: "Köln", lat: 50.94, lon: 6.95 },
];
const kopf = { version: "1.0.0", quelle: "t", ausgabe: "t", gueltigAb: "2026-01-01", geprueft: false };
const kostra = (): RegenspendenPack => {
  const r = loadRulePack({ id: "k", typ: "regenspenden", ...kopf, daten: {
    raster: { crs: "EPSG:4326", x0: 13, y0: 52, zellgroesse: 1, spalten: 2, zeilen: 2 },
    werte: { r5_5: [300, 310, 320, 330], r5_100: [500, 510, 520, 530] } } });
  if (!r.ok) throw new Error(JSON.stringify(r.fehler));
  return r.pack as RegenspendenPack;
};

describe("Ortssuche", () => {
  it("PLZ-Anfang, Ort ohne Umlautunterschied, Reihenfolge", () => {
    expect(sucheOrte(orte, "101").map((o) => o.plz)).toEqual(["10115", "10117"]);
    expect(sucheOrte(orte, "10117")[0]!.ort).toBe("Berlin");
    expect(sucheOrte(orte, "muenchen")[0]!.plz).toBe("80331");
    expect(sucheOrte(orte, "Köln")[0]!.plz).toBe("50667");
    expect(sucheOrte(orte, "")).toEqual([]);
    expect(sucheOrte(orte, "zzz")).toEqual([]);
  });
});

describe("UTM → WGS84", () => {
  it("Zentralmeridian und Äquator", () => {
    const a = utmZuWgs84(32, 500000, 0)!;
    expect(a.lat).toBeCloseTo(0, 9); expect(a.lon).toBeCloseTo(9, 9);
    const b = utmZuWgs84(32, 500000, 5800000)!;
    expect(b.lon).toBeCloseTo(9, 9); expect(b.lat).toBeGreaterThan(52.3); expect(b.lat).toBeLessThan(52.4);
  });
  it("Ost-Versatz verschiebt nach Osten; ungültig → null", () => {
    expect(utmZuWgs84(32, 600000, 5800000)!.lon).toBeGreaterThan(9);
    expect(utmZuWgs84(0, 500000, 5800000)).toBeNull();
    expect(utmZuWgs84(32, NaN, 1)).toBeNull();
    expect(utmZuWgs84(32, 50, 5800000)).toBeNull();
  });
});

describe("Standort-Befehle", () => {
  it("setStandort füllt Pack-Werte und packVersionen; Modell gültig; Reload-fest", () => {
    const rain = ermittleRegen({ lat: 52.5, lon: 13.5 }, kostra()).rain!;
    const m = ausfuehren(neuerVerlauf(createProject("T", "2026-01-01T00:00:00Z")), setStandort("Berlin", { lat: 52.5, lon: 13.5 }, rain)).aktuell;
    expect(validateProject(m)).toEqual([]);
    expect(m.standort.regen.r5_100.packWert).toBe(500);
    expect(m.packVersionen["k"]).toBe("1.0.0");
    expect(m.standort.bezeichnung).toBe("Berlin");
  });
  it("manuell überschreibt, Pack-Wert bleibt, Abweichung in %; Entfernen stellt Pack-Wert wieder her; Standortwechsel behält Nutzerwert", () => {
    const rain = ermittleRegen({ lat: 52.5, lon: 13.5 }, kostra()).rain!;
    let v = neuerVerlauf(createProject("T", "2026-01-01T00:00:00Z"));
    v = ausfuehren(v, setStandort(undefined, { lat: 52.5, lon: 13.5 }, rain));
    v = ausfuehren(v, setRegenManuell("r5_100", 550));
    const r = v.aktuell.standort.regen.r5_100;
    expect(r).toEqual({ packWert: 500, manuellWert: 550 });
    expect(regenWirksam(r)).toBe(550);
    expect(regenAbweichung(r)).toBeCloseTo(0.1, 12);
    expect(validateProject(v.aktuell)).toEqual([]);
    const rain2 = ermittleRegen({ lat: 53.5, lon: 14.5 }, kostra()).rain!;
    v = ausfuehren(v, setStandort(undefined, { lat: 53.5, lon: 14.5 }, rain2));
    expect(v.aktuell.standort.regen.r5_100).toEqual({ packWert: 530, manuellWert: 550 });
    v = ausfuehren(v, setRegenManuell("r5_100", undefined));
    expect(v.aktuell.standort.regen.r5_100).toEqual({ packWert: 530 });
    expect(setRegenManuell("r5_5", -1).anwenden(v.aktuell)).toBe(v.aktuell);
    expect(regenAbweichung({ packWert: null, manuellWert: 5 })).toBeNull();
  });
});
