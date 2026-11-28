import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  FARBEN_ANZAHL, computeCatchments, computeSlope, createProject, intersection, loadRulePack, offset, polygonArea,
  type AttikaSegment, type CatchmentResult, type Dachflaeche, type Entwaesserung, type Kontur, type ProjectModel,
  type RegelPack,
} from "../src/core/index";

const pt = (id: string, x: number, y: number) => ({ id, x, y });
const rechteck = (pre: string, w: number, h: number, x0 = 0, y0 = 0): Kontur =>
  [pt(`${pre}1`, x0, y0), pt(`${pre}2`, x0 + w, y0), pt(`${pre}3`, x0 + w, y0 + h), pt(`${pre}4`, x0, y0 + h)];
const gully = (id: string, x: number, y: number, z = 0): Entwaesserung =>
  ({ id, art: "gully", name: id, typ: null, position: { x, y }, z });
const umlaufend = (k: Kontur, breite: number): AttikaSegment[] => k.map((p) => ({ id: `a-${p.id}`, kante: p.id, breite }));

function projekt(...dach: (Partial<Dachflaeche> & Pick<Dachflaeche, "kontur" | "entwaesserung">)[]): ProjectModel {
  const ds = dach.map((x, i): Dachflaeche => ({
    id: `d${i + 1}`, name: "Dach", typ: "dach", aufbauten: [], zonen: [], vorgaben: {}, attika: [], tuerschwellen: [], ...x,
  }));
  return { ...createProject("Test", "2026-01-01T00:00:00Z"), gefaelleStandard: 0.02, dachflaechen: ds };
}
const rechne = (m: ProjectModel, regeln?: RegelPack): CatchmentResult =>
  computeCatchments(m, computeSlope(m), regeln ? { regeln } : {});

const kopf = { version: "1.0.0", quelle: "Test", ausgabe: "Test", gueltigAb: "2026-01-01", geprueft: true };
function regelPack(hinweisAb: number, fehlerUeber: number): RegelPack {
  const r = loadRulePack({
    id: "test-regeln", typ: "regeln", ...kopf,
    daten: { regeln: [{ id: "flaeche-je-ablauf", titel: "Fläche je Ablauf", parameter: {
      hinweisAb: { wert: hinweisAb, einheit: "m2" }, fehlerUeber: { wert: fehlerUeber, einheit: "m2" } } }] },
  });
  if (!r.ok) throw new Error(JSON.stringify(r.fehler));
  return r.pack as RegelPack;
}

/** Gleichfarbige Flächen dürfen sich höchstens in Punkten berühren (unabhängige Prüfung per Puffer). */
function pruefeFarben(r: CatchmentResult) {
  const f = r.flaechen.filter((x) => x.dachFlaeche > 0);
  for (const x of f) {
    expect(x.farbe).toBeGreaterThanOrEqual(0);
    expect(x.farbe).toBeLessThan(FARBEN_ANZAHL);
  }
  for (let i = 0; i < f.length; i++) {
    for (let j = i + 1; j < f.length; j++) {
      if (f[i]!.farbe !== f[j]!.farbe) continue;
      const a = offset(f[i]!.polygone, 0.01), b = offset(f[j]!.polygone, 0.01);
      const kontakt = intersection(a, b).reduce((s, p) => s + polygonArea(p), 0);
      expect(kontakt, `${f[i]!.id} / ${f[j]!.id}`).toBeLessThan(0.002);
    }
  }
  for (const [a, b] of r.nachbarn) {
    expect(r.flaechen.find((x) => x.id === a)!.farbe).not.toBe(r.flaechen.find((x) => x.id === b)!.farbe);
  }
}

describe("Einzugsflächen: Zellen, Summe, Abzug Aufbauten", () => {
  it("ein Gully: eine Fläche = 200 m²", () => {
    const r = rechne(projekt({ kontur: rechteck("k", 20, 10), entwaesserung: [gully("g1", 10, 5)] }));
    expect(r.flaechen).toHaveLength(1);
    expect(r.flaechen[0]).toMatchObject({ id: "d1/g1", ablaufId: "g1", attikaFlaeche: 0 });
    expect(r.flaechen[0]!.dachFlaeche).toBeCloseTo(200, 2);
    expect(r.flaechen[0]!.gesamtFlaeche).toBeCloseTo(200, 2);
  });

  it("2 Gullys (5|5), (15|5): 2 × 100 m², benachbart, verschiedene Farben", () => {
    const r = rechne(projekt({ kontur: rechteck("k", 20, 10), entwaesserung: [gully("g1", 5, 5), gully("g2", 15, 5)] }));
    expect(r.flaechen.map((f) => f.ablaufId)).toEqual(["g1", "g2"]);
    for (const f of r.flaechen) expect(Math.abs(f.dachFlaeche - 100)).toBeLessThanOrEqual(0.01);
    expect(r.nachbarn).toEqual([["d1/g1", "d1/g2"]]);
    expect(r.flaechen[0]!.farbe).not.toBe(r.flaechen[1]!.farbe);
  });

  it("Ablauf-Kote verschiebt die Zellgrenze: z₂ = −0,05 → Zellfläche wie Rasterintegral", () => {
    const r = rechne(projekt({ kontur: rechteck("k", 20, 10), entwaesserung: [gully("g1", 5, 5), gully("g2", 15, 5, -0.05)] }));
    // unabhängig: Anteil der Rasterpunkte mit h1 < h2 (L∞, 2 %)
    let n = 0;
    const N = 400, M = 200;
    for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) {
      const x = ((i + 0.5) * 20) / N, y = ((j + 0.5) * 10) / M;
      if (0.02 * Math.max(Math.abs(x - 5), Math.abs(y - 5)) < -0.05 + 0.02 * Math.max(Math.abs(x - 15), Math.abs(y - 5))) n++;
    }
    expect(r.flaechen[0]!.dachFlaeche).toBeCloseTo((200 * n) / (N * M), 0);
    expect(r.flaechen[0]!.dachFlaeche).toBeLessThan(100);
    expect(r.flaechen[0]!.dachFlaeche + r.flaechen[1]!.dachFlaeche).toBeCloseTo(200, 2);
  });

  it("Summe = Dachfläche − Aufbauten (± 0,01 m²), Aufbau nicht in der Zelle", () => {
    const auf = { id: "a1", name: "Lichtkuppel", kontur: rechteck("l", 2, 1.5, 7, 6) };
    const r = rechne(projekt({ kontur: rechteck("k", 20, 10), aufbauten: [auf], entwaesserung: [gully("g1", 5, 5), gully("g2", 15, 5)] }));
    const summe = r.flaechen.reduce((s, f) => s + f.dachFlaeche, 0);
    expect(Math.abs(summe - (200 - 3))).toBeLessThanOrEqual(0.01);
    expect(Math.abs(r.flaechen[0]!.dachFlaeche - 97)).toBeLessThanOrEqual(0.01);
  });

  it("Eigenschaft: Summe = Dachfläche − Aufbauten, Nachbarn nie gleiche Farbe", () => {
    fc.assert(fc.property(
      fc.array(fc.record({ x: fc.double({ min: 0.5, max: 19.5, noNaN: true }), y: fc.double({ min: 0.5, max: 9.5, noNaN: true }),
        z: fc.double({ min: -0.1, max: 0, noNaN: true }) }), { minLength: 1, maxLength: 8 }),
      fc.boolean(),
      (gs, mitAufbau) => {
        const auf = { id: "a1", name: "Technik", kontur: rechteck("t", 1, 1, 9.3, 0.2) };
        const ent = gs.filter((g) => !(mitAufbau && g.x > 9.2 && g.x < 10.4 && g.y < 1.3)).map((g, i) => gully(`g${i}`, g.x, g.y, g.z));
        if (ent.length === 0) return;
        const m = projekt({ kontur: rechteck("k", 20, 10), aufbauten: mitAufbau ? [auf] : [], entwaesserung: ent });
        const r = rechne(m);
        const summe = r.flaechen.reduce((s, f) => s + f.dachFlaeche, 0);
        expect(Math.abs(summe - (mitAufbau ? 199 : 200))).toBeLessThanOrEqual(0.01);
        pruefeFarben(r);
      },
    ), { numRuns: 40, seed: 7 });
  });

  it("L-Dach mit 6 Gullys: Summe stimmt, Färbung gültig", () => {
    const kontur: Kontur = [pt("p1", 0, 0), pt("p2", 30, 0), pt("p3", 30, 10), pt("p4", 12, 10), pt("p5", 12, 25), pt("p6", 0, 25)];
    const ent = [gully("g1", 5, 5), gully("g2", 15, 5), gully("g3", 25, 5), gully("g4", 6, 12), gully("g5", 6, 18), gully("g6", 6, 23)];
    const r = rechne(projekt({ kontur, entwaesserung: ent }));
    const summe = r.flaechen.reduce((s, f) => s + f.dachFlaeche, 0);
    expect(Math.abs(summe - (300 + 180))).toBeLessThanOrEqual(0.01);
    expect(r.nachbarn.length).toBeGreaterThanOrEqual(5);
    pruefeFarben(r);
  });

  it("zwei getrennte Dachflächen: je eigene Zellen, angrenzende Dächer verschieden gefärbt", () => {
    const r = rechne(projekt(
      { kontur: rechteck("a", 10, 10), entwaesserung: [gully("g1", 5, 5)] },
      { kontur: rechteck("b", 10, 10, 10, 0), entwaesserung: [gully("g2", 15, 5)] },
    ));
    expect(r.flaechen.map((f) => f.id)).toEqual(["d1/g1", "d2/g2"]);
    expect(r.nachbarn).toHaveLength(1);
    pruefeFarben(r);
  });

  it("Dachfläche ohne Ablauf: keine Zelle, Attika nicht zugeordnet → Hinweis", () => {
    const k = rechteck("k", 20, 10);
    const r = rechne(projekt({ kontur: k, attika: umlaufend(k, 0.3), entwaesserung: [] }));
    expect(r.flaechen).toHaveLength(0);
    expect(r.hinweise.filter((h) => h.code === "attika-ohne-ablauf")).toHaveLength(4);
  });
});

describe("Attika-Fläche (Nutzeranforderung)", () => {
  const k = rechteck("k", 20, 10);
  const mitAttika = projekt({ kontur: k, attika: umlaufend(k, 0.3), entwaesserung: [gully("g1", 10, 5)] });

  it("20×10, b = 0,30 umlaufend, ein Gully: Dach 200 / Attika 18,0 / Gesamt 218,0 m²", () => {
    const f = rechne(mitAttika).flaechen[0]!;
    expect(f.dachFlaeche).toBeCloseTo(200, 2);
    expect(f.attikaFlaeche).toBeCloseTo(18, 9);
    expect(f.gesamtFlaeche).toBeCloseTo(218, 2);
    expect(f.attika).toHaveLength(4);
  });

  it("Pack-Grenze 215: Hinweis nur durch Attikaanteil", () => {
    const pack = regelPack(215, 250);
    const r = rechne(mitAttika, pack);
    const h = r.hinweise.filter((x) => x.code === "flaeche-je-ablauf");
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ objektId: "g1", stufe: "hinweis", durchAttika: true, regelId: "flaeche-je-ablauf", quelle: "Test" });
    expect(r.flaechen[0]!.bewertung?.stufe).toBe("hinweis");
    // ohne Attika: kein Hinweis
    const ohne = rechne(projekt({ kontur: k, entwaesserung: [gully("g1", 10, 5)] }), pack);
    expect(ohne.hinweise.filter((x) => x.code === "flaeche-je-ablauf")).toHaveLength(0);
    // Dach allein über der Grenze → durchAttika false
    const gross = rechne(mitAttika, regelPack(150, 300)).hinweise.find((x) => x.code === "flaeche-je-ablauf");
    expect(gross).toMatchObject({ stufe: "hinweis", durchAttika: false });
    // Fehlerstufe nur durch Attika
    expect(rechne(mitAttika, regelPack(150, 210)).hinweise.find((x) => x.code === "flaeche-je-ablauf"))
      .toMatchObject({ stufe: "fehler", durchAttika: true });
  });

  it("Attika geht an den Ablauf der angrenzenden Zelle (2 Gullys, Grat x = 10)", () => {
    const m = projekt({ kontur: k, attika: umlaufend(k, 0.3), entwaesserung: [gully("g1", 5, 5), gully("g2", 15, 5)] });
    const [a, b] = rechne(m).flaechen;
    // je 10 + 10 + 10 m Kante
    expect(a!.attikaFlaeche).toBeCloseTo(9, 6);
    expect(b!.attikaFlaeche).toBeCloseTo(9, 6);
    expect(a!.gesamtFlaeche).toBeCloseTo(109, 2);
    const unten = a!.attika.find((x) => x.attikaId === "a-k1")!;
    expect(unten.laenge).toBeCloseTo(10, 6);
    expect(unten.von).toEqual({ x: 0, y: 0 });
  });

  it("Breite je Segment, nur einzelne Kanten; fehlende Kante → Hinweis", () => {
    const m = projekt({ kontur: k, entwaesserung: [gully("g1", 10, 5)], attika: [
      { id: "s", kante: "k1", breite: 0.25 }, { id: "o", kante: "k3", breite: 0.4 }, { id: "x", kante: "fehlt", breite: 0.3 }] });
    const r = rechne(m);
    expect(r.flaechen[0]!.attikaFlaeche).toBeCloseTo(20 * 0.25 + 20 * 0.4, 9);
    expect(r.hinweise.map((h) => h.code)).toContain("attika-kante-fehlt");
  });

  it("Konturorientierung im Uhrzeigersinn ändert nichts", () => {
    const cw = [...k].reverse();
    const m = projekt({ kontur: cw, attika: umlaufend(cw, 0.3), entwaesserung: [gully("g1", 5, 5), gully("g2", 15, 5)] });
    const [a, b] = rechne(m).flaechen;
    expect(a!.attikaFlaeche).toBeCloseTo(9, 6);
    expect(b!.attikaFlaeche).toBeCloseTo(9, 6);
  });

  it("Attika nicht im Gefälle-/Dämmplan: Facetten und Dämmfläche unverändert", () => {
    const ohne = computeSlope(projekt({ kontur: k, entwaesserung: [gully("g1", 10, 5)] })).dachflaechen[0]!;
    const mit = computeSlope(mitAttika).dachflaechen[0]!;
    expect(mit.facetten).toEqual(ohne.facetten);
    expect(mit.daemmung).toEqual(ohne.daemmung);
    expect(mit.daemmung!.flaeche).toBeCloseTo(200, 3);
  });

  it("fehlende Regel im Pack → Hinweis regel-fehlt, keine Bewertung", () => {
    const r0 = loadRulePack({ id: "leer", typ: "regeln", ...kopf, daten: { regeln: [] } });
    if (!r0.ok) throw new Error("Pack");
    const r = rechne(mitAttika, r0.pack as RegelPack);
    expect(r.flaechen[0]!.bewertung).toBeNull();
    expect(r.hinweise.map((h) => h.code)).toContain("regel-fehlt");
  });
});
