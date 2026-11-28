import { describe, expect, it } from "vitest";
import {
  abbrechen, abschliessen, addDachflaeche, attikaGesamtFlaeche, attikaUmlaufend, ausfuehren, computeCatchments,
  computeSlope, createProject, entfernePunkt, kannRueckgaengig, kannWiederholen, klick, konturFlaeche, konturUmfang,
  loesche, neuerVerlauf, neuerZustand, pruefePolygon, rueckgaengig, setAttikaBreite, validateProject, waehle,
  waehleWerkzeug, wiederholen, setzeAttikaBreite, type Entwaesserung, type ProjectModel, type Befehl,
} from "../src/core/index";

const P = (x: number, y: number) => ({ x, y });
const L = [P(0, 0), P(10, 0), P(10, 4), P(4, 4), P(4, 10), P(0, 10)]; // 10*4 + 4*6 = 64
const R = [P(0, 0), P(20, 0), P(20, 10), P(0, 10)];
const leer = (): ProjectModel => createProject("T", "2026-01-01T00:00:00Z");
const mit = (m: ProjectModel, ...bs: Befehl[]) => bs.reduce((v, b) => ausfuehren(v, b), neuerVerlauf(m));
const gueltig = (m: ProjectModel) => expect(validateProject(m)).toEqual([]);

/** Werkzeug-Klicksequenz bis zum Abschluss. */
function zeichne(m: ProjectModel, tool: "contour" | "aufbau" | "terrasse", pts: { x: number; y: number }[]) {
  let z = waehleWerkzeug(neuerZustand(), tool);
  for (const p of pts) {
    const r = klick(z, m, p, 0.1);
    expect(r.befehl).toBeUndefined();
    z = r.zustand;
  }
  return abschliessen(z, m);
}

describe("Verlauf", () => {
  it("Undo/Redo stellt Zustände exakt wieder her", () => {
    const m0 = leer();
    let v = neuerVerlauf(m0);
    expect(kannRueckgaengig(v)).toBe(false);
    v = ausfuehren(v, addDachflaeche(L));
    const m1 = v.aktuell;
    v = ausfuehren(v, addDachflaeche(R));
    expect(v.aktuell.dachflaechen).toHaveLength(2);
    v = rueckgaengig(v);
    expect(v.aktuell).toBe(m1);
    expect(kannWiederholen(v)).toBe(true);
    v = rueckgaengig(v);
    expect(v.aktuell).toBe(m0);
    v = wiederholen(wiederholen(v));
    expect(v.aktuell.dachflaechen).toHaveLength(2);
    // neuer Befehl leert Redo
    v = rueckgaengig(v);
    v = ausfuehren(v, addDachflaeche(L));
    expect(kannWiederholen(v)).toBe(false);
  });
});

describe("Kontur und Fläche", () => {
  it("L-Dach: Fläche 64 m², Umfang 40 m, Modell gültig", () => {
    const r = zeichne(leer(), "contour", L);
    expect(r.befehl).toBeDefined();
    const m = mit(leer(), r.befehl!).aktuell;
    gueltig(m);
    expect(konturFlaeche(m.dachflaechen[0]!.kontur)).toBeCloseTo(64, 9);
    expect(konturUmfang(m.dachflaechen[0]!.kontur)).toBeCloseTo(40, 9);
  });
  it("Klick auf ersten Punkt schließt", () => {
    let z = waehleWerkzeug(neuerZustand(), "contour");
    for (const p of [P(0, 0), P(5, 0), P(5, 5)]) z = klick(z, leer(), p, 0.1).zustand;
    expect(klick(z, leer(), P(0.05, 0), 0.1).befehl).toBeDefined();
  });
  it("Rücktaste und Esc", () => {
    let z = waehleWerkzeug(neuerZustand(), "contour");
    z = klick(z, leer(), P(0, 0), 0.1).zustand;
    z = klick(z, leer(), P(1, 0), 0.1).zustand;
    expect(entfernePunkt(z).entwurf).toHaveLength(1);
    expect(abbrechen(z).entwurf).toHaveLength(0);
  });
  it("lehnt Selbstschnitt und zu wenig Punkte ab", () => {
    expect(pruefePolygon([P(0, 0), P(1, 1), P(1, 0), P(0, 1)])).not.toBeNull();
    expect(pruefePolygon([P(0, 0), P(1, 0)])).not.toBeNull();
    expect(pruefePolygon(R)).toBeNull();
    expect(zeichne(leer(), "contour", [P(0, 0), P(1, 1), P(1, 0), P(0, 1)]).befehl).toBeUndefined();
  });
});

describe("Aufbau, Terrasse, Schwelle", () => {
  const basis = () => mit(leer(), addDachflaeche(R)).aktuell;
  it("Aufbau innerhalb legt Aufbau an, außerhalb wird abgelehnt", () => {
    const m = basis();
    const ok = zeichne(m, "aufbau", [P(2, 2), P(4, 2), P(4, 4), P(2, 4)]);
    const m2 = mit(m, ok.befehl!).aktuell;
    gueltig(m2);
    expect(m2.dachflaechen[0]!.aufbauten).toHaveLength(1);
    expect(zeichne(m, "aufbau", [P(18, 2), P(24, 2), P(24, 4), P(18, 4)]).befehl).toBeUndefined();
    // Startpunkt außerhalb
    const r = klick(waehleWerkzeug(neuerZustand(), "aufbau"), m, P(30, 30), 0.1);
    expect(r.zustand.hinweis).not.toBeNull();
  });
  it("Terrasse wird Zone mit Versatz", () => {
    const m = mit(basis(), zeichne(basis(), "terrasse", [P(2, 2), P(6, 2), P(6, 5), P(2, 5)]).befehl!).aktuell;
    gueltig(m);
    expect(m.dachflaechen[0]!.zonen[0]!.kontur).toHaveLength(4);
  });
  it("Türschwelle auf Kante, gültig, Auswahl und Löschen", () => {
    const m = basis();
    const r = klick(waehleWerkzeug(neuerZustand(), "schwelle"), m, P(10, 0.02), 0.1);
    expect(r.befehl).toBeDefined();
    const v = mit(m, r.befehl!);
    gueltig(v.aktuell);
    expect(v.aktuell.dachflaechen[0]!.tuerschwellen).toHaveLength(1);
    expect(r.auswahl?.art).toBe("tuerschwelle");
    const w = waehle(v.aktuell, P(10, 0), 0.1);
    expect(w?.art).toBe("tuerschwelle");
    const gel = ausfuehren(v, loesche(w!));
    expect(gel.aktuell.dachflaechen[0]!.tuerschwellen).toHaveLength(0);
    gueltig(gel.aktuell);
  });
  it("Schwelle nahe der Ecke bleibt auf der Kante", () => {
    const r = klick(waehleWerkzeug(neuerZustand(), "schwelle"), basis(), P(0.05, 0), 0.1);
    gueltig(mit(basis(), r.befehl!).aktuell);
  });
});

describe("Attika", () => {
  const rechteckMit = () => mit(leer(), addDachflaeche(R)).aktuell;
  it("Umlaufend b = 0,25: Fläche = Umfang × 0,25", () => {
    let z = setzeAttikaBreite(waehleWerkzeug(neuerZustand(), "attika"), 0.25);
    const m0 = rechteckMit();
    const r = attikaUmlaufend(z, m0.dachflaechen[0]!.id);
    const m = ausfuehren(neuerVerlauf(m0), r.befehl!).aktuell;
    gueltig(m);
    const d = m.dachflaechen[0]!;
    expect(d.attika).toHaveLength(4);
    expect(attikaGesamtFlaeche(d)).toBeCloseTo(konturUmfang(d.kontur) * 0.25, 9);
    z = r.zustand;
  });
  it("Einzelklick je Kante, Breite je Segment änderbar, erneuter Klick aktualisiert", () => {
    const m0 = rechteckMit();
    let z = setzeAttikaBreite(waehleWerkzeug(neuerZustand(), "attika"), 0.25);
    let v = neuerVerlauf(m0);
    for (const p of [P(10, 0), P(20, 5), P(10, 10), P(0, 5)]) {
      const r = klick(z, v.aktuell, p, 0.1);
      v = ausfuehren(v, r.befehl!);
    }
    const d = v.aktuell.dachflaechen[0]!;
    expect(d.attika).toHaveLength(4);
    expect(attikaGesamtFlaeche(d)).toBeCloseTo(60 * 0.25, 9);
    v = ausfuehren(v, setAttikaBreite(d.id, d.attika[0]!.id, 0.5));
    expect(attikaGesamtFlaeche(v.aktuell.dachflaechen[0]!)).toBeCloseTo(20 * 0.5 + 10 * 0.25 + 20 * 0.25 + 10 * 0.25, 9);
    z = setzeAttikaBreite(z, 0.3);
    v = ausfuehren(v, klick(z, v.aktuell, P(10, 0), 0.1).befehl!);
    expect(v.aktuell.dachflaechen[0]!.attika).toHaveLength(4);
    gueltig(v.aktuell);
  });
  it("stimmt mit der Einzugsflächen-Logik überein", () => {
    const g: Entwaesserung = { id: "e1", art: "gully", name: "G", typ: null, position: P(10, 5), z: 0 };
    const m0 = rechteckMit();
    const z = setzeAttikaBreite(waehleWerkzeug(neuerZustand(), "attika"), 0.25);
    const m = { ...ausfuehren(neuerVerlauf(m0), attikaUmlaufend(z, "d1").befehl!).aktuell };
    const mg: ProjectModel = { ...m, dachflaechen: [{ ...m.dachflaechen[0]!, entwaesserung: [g] }] };
    const r = computeCatchments(mg, computeSlope(mg), {});
    const summe = r.flaechen.reduce((s, f) => s + f.attikaFlaeche, 0);
    expect(summe).toBeCloseTo(attikaGesamtFlaeche(mg.dachflaechen[0]!), 6);
    expect(summe).toBeCloseTo(60 * 0.25, 6);
  });
});
