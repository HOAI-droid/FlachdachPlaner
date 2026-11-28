import { describe, expect, it } from "vitest";
import {
  addDachflaeche, addPunktablauf, ausfuehren, computeSlope, createProject, mitAbleitung, neuerVerlauf, rueckgaengig, setDachaufbau,
  setEntwaesserungZ, trenneDachflaeche, validateProject, type ProjectModel, type Verlauf,
} from "../src/core/index";

const P = (x: number, y: number) => ({ x, y });
const dach = (v: Verlauf) => v.aktuell.dachflaechen[0]!;
const start = (): Verlauf => ausfuehren(neuerVerlauf(createProject("T", "2026-01-01T00:00:00Z")), addDachflaeche([P(0, 0), P(20, 0), P(20, 10), P(0, 10)]));
const mit = (v: Verlauf, w: { daemmMittel?: number; minTiefpunkt?: number; maxHochpunkt?: number }): Verlauf => ausfuehren(v, setDachaufbau("d1", w));
const setze = (v: Verlauf, x: number, y: number): Verlauf => ausfuehren(v, mitAbleitung(addPunktablauf("d1", "gully", P(x, y)), "d1"));
const zMin = (m: ProjectModel) => Math.min(...m.dachflaechen[0]!.entwaesserung.map((e) => e.z));

describe("Dachaufbau (Dämmstärke im Mittel, min. Tiefpunkt, max. Hochpunkt)", () => {
  it("speichert die drei Werte und entfernt leere; Modell gültig, ein Undo-Schritt", () => {
    const v1 = mit(start(), { daemmMittel: 120, minTiefpunkt: 0.1, maxHochpunkt: 0.5 });
    expect(dach(v1)).toMatchObject({ daemmMittel: 120, vorgaben: { minTiefpunkt: 0.1, maxHochpunkt: 0.5 } });
    expect(validateProject(v1.aktuell)).toEqual([]);
    const v2 = mit(v1, { daemmMittel: 120, minTiefpunkt: 0.1 });
    expect(dach(v2).vorgaben.maxHochpunkt).toBeUndefined();
    expect(Object.hasOwn(dach(v2).vorgaben, "maxHochpunkt")).toBe(false);
    expect(dach(rueckgaengig(v2)).vorgaben.maxHochpunkt).toBe(0.5);
  });

  it("erster Ablauf: tiefster Ablauf liegt auf min. Tiefpunkt und mittlere Dämmstärke entspricht der Vorgabe", () => {
    let v = mit(start(), { daemmMittel: 200, minTiefpunkt: 0.1 });
    v = setze(v, 10, 5);
    expect(zMin(v.aktuell)).toBeCloseTo(0.1, 9);
    const dm = computeSlope(v.aktuell).dachflaechen[0]!.daemmung!;
    expect(dm.mittel).toBeCloseTo(200, 6);
    expect(dm.tiefpunktDicke).toBeGreaterThanOrEqual(20);
    expect(dach(v).daemmdickeTiefpunkt).toBeCloseTo(dm.tiefpunktDicke, 9);
  });

  it("zu kleine Mittelvorgabe: Tiefpunktdicke bleibt bei der Mindestdicke (Mittel liegt dann darüber)", () => {
    const v = setze(mit(start(), { daemmMittel: 30 }), 10, 5);
    expect(dach(v).daemmdickeTiefpunkt).toBe(20);
    expect(computeSlope(v.aktuell).dachflaechen[0]!.daemmung!.mittel).toBeGreaterThan(30);
  });

  it("ohne min. Tiefpunkt: Kote = OK Rohdecke (0) + Tiefpunktdicke", () => {
    const v = setze(mit(start(), { daemmMittel: 100 }), 10, 5);
    expect(zMin(v.aktuell)).toBeCloseTo(dach(v).daemmdickeTiefpunkt! / 1000, 9);
  });

  it("Parameteränderung leitet neu ab; Hochpunkt ohne Eingabe: kein Hinweis-Feld", () => {
    let v = setze(mit(start(), { daemmMittel: 120, minTiefpunkt: 0.1 }), 10, 5);
    v = mit(v, { daemmMittel: 150, minTiefpunkt: 0.2 });
    expect(zMin(v.aktuell)).toBeCloseTo(0.2, 9);
    expect(computeSlope(v.aktuell).dachflaechen[0]!.daemmung!.mittel).toBeCloseTo(150, 6);
  });

  it("manuell angehobener Ablauf bleibt beim Setzen weiterer Abläufe erhalten (wirkt auf alle Höhen)", () => {
    let v = setze(mit(start(), { daemmMittel: 120, minTiefpunkt: 0.1 }), 5, 5);
    v = ausfuehren(v, setEntwaesserungZ("d1", "en1", 0.3));
    const hoch0 = computeSlope(v.aktuell).dachflaechen[0]!.hochpunkt!.kote;
    v = setze(v, 15, 5);
    expect(dach(v).entwaesserung.find((e) => e.id === "en1")!.z).toBeCloseTo(0.3, 9);
    expect(dach(v).entwaesserung.find((e) => e.id === "en2")!.z).toBeCloseTo(0.3, 9);
    expect(computeSlope(v.aktuell).dachflaechen[0]!.hochpunkt!.kote).toBeGreaterThan(0.3);
    expect(hoch0).toBeGreaterThan(0.3);
  });

  it("ungültige Werte ändern nichts; ohne daemmMittel wird nichts abgeleitet", () => {
    const v = mit(start(), { daemmMittel: -5 });
    expect(dach(v).daemmMittel).toBeUndefined();
    const w = ausfuehren(start(), mitAbleitung(addPunktablauf("d1", "gully", P(10, 5), 0.42), "d1"));
    expect(zMin(w.aktuell)).toBe(0.42);
  });

  it("Trennen übernimmt daemmMittel in beide Teile", () => {
    const v = ausfuehren(mit(start(), { daemmMittel: 120 }), trenneDachflaeche("d1", P(10, -1), P(10, 11), 0.1));
    expect(v.aktuell.dachflaechen.length).toBeGreaterThanOrEqual(2);
    for (const d of v.aktuell.dachflaechen) expect(d.daemmMittel).toBe(120);
  });
});
