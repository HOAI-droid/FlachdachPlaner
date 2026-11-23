/// <reference types="vite/client" />
/** PLAN M9 Schritt 42: computeAnschluesse (exakte OK fertig max, Belag, Zone, LES, Sollwerte aus Pack). */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  computeAnschluesse, computeSlope, createProject, hoeheDachflaeche, loadRulePack, okFertigAm,
  type Anschluss, type Dachflaeche, type Entwaesserung, type Kontur, type ProjectModel, type RulePack, type Vec2, type Zone,
} from "../src/core/index";

const packTexte = import.meta.glob("../rulepacks/*/pack.json", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;
const lade = (raw: unknown): RulePack => {
  const r = loadRulePack(raw);
  if (!r.ok) throw new Error(JSON.stringify(r.fehler));
  return r.pack;
};
const roh = (o: string) => JSON.parse(packTexte[`../rulepacks/${o}/pack.json`]!) as { daten: { regeln: { id: string; parameter: Record<string, { wert: number }> }[] } };
const ZVDH = lade(roh("zvdh-2026"));
const BAUDER = lade(roh("bauder-les"));
const PACKS = [ZVDH, BAUDER];
/** Sollwerte zum Vergleich direkt aus dem Pack (kein Literal). */
const packWert = (regel: string, name: string) => roh("zvdh-2026").daten.regeln.find((r) => r.id === regel)!.parameter[name]!.wert;

const pt = (id: string, x: number, y: number) => ({ id, x, y });
const rechteck = (pre: string, w: number, h: number, x0 = 0, y0 = 0): Kontur =>
  [pt(`${pre}1`, x0, y0), pt(`${pre}2`, x0 + w, y0), pt(`${pre}3`, x0 + w, y0 + h), pt(`${pre}4`, x0, y0 + h)];
const gully = (id: string, x: number, y: number, z = 0): Entwaesserung => ({ id, art: "gully", name: id, typ: null, position: { x, y }, z });

function projekt(x: Partial<Dachflaeche> = {}, gefaelle = 0.02): ProjectModel {
  const d: Dachflaeche = {
    id: "d1", name: "Dach", typ: "dach", aufbauten: [], zonen: [], vorgaben: {}, attika: [], tuerschwellen: [],
    kontur: rechteck("k", 20, 10), entwaesserung: [gully("g1", 10, 5)], ...x,
  };
  return { ...createProject("Test", "2026-01-01T00:00:00Z"), gefaelleStandard: gefaelle, dachflaechen: [d] };
}
const rechne = (m: ProjectModel, packs: readonly RulePack[] = PACKS) => computeAnschluesse(m, computeSlope(m, { packs }), packs);
const eins = (m: ProjectModel, id: string, packs: readonly RulePack[] = PACKS): Anschluss => {
  const a = rechne(m, packs).find((x) => x.objektId === id);
  if (!a) throw new Error(`Anschluss ${id} fehlt`);
  return a;
};
const attika = (oberkante?: number) => [{ id: "a1", kante: "k1", breite: 0.3, ...(oberkante !== undefined ? { oberkante } : {}) }];
const MM = 0.001;

/** Abtastung der fertigen Oberfläche entlang der Linie (Schritt `schritt` m). */
function abtastung(m: ProjectModel, a: Vec2, b: Vec2, schritt: number): number {
  const s = computeSlope(m, { packs: PACKS });
  const d = m.dachflaechen[0]!, g = s.dachflaechen[0]!;
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / schritt));
  let h = -Infinity;
  for (let k = 0; k <= n; k++) h = Math.max(h, okFertigAm(d, g, { x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n }));
  return h;
}

describe("computeAnschluesse: Attika 20×10, Gully Mitte, 2 %", () => {
  it("okFertigMax +0,200 an der Ecke, vorhanden 200 mm", () => {
    const a = eins(projekt({ attika: attika(0.4) }), "a1");
    expect(a.art).toBe("attika");
    expect(a.okFertigMax).toBeCloseTo(0.2, 9);
    expect([0, 20]).toContain(a.ort.x);
    expect(a.ort.y).toBeCloseTo(0, 9);
    expect(a.vorhanden! / MM).toBeCloseTo(200, 6);
    expect(a.soll).toBe(packWert("anschlusshoehe", "attikaMin"));
    expect(a.regelId).toBe("anschlusshoehe");
    expect(a.quelle).toMatch(/ungeprüft/);
  });
  it("Belag 0,05 → 150 mm", () => {
    expect(eins(projekt({ attika: attika(0.4), belagDicke: 0.05 }), "a1").vorhanden! / MM).toBeCloseTo(150, 6);
  });
  it("OK +0,38 mit Belag 0,05 → 130 mm, erforderliche OK +0,400", () => {
    const a = eins(projekt({ attika: attika(0.38), belagDicke: 0.05 }), "a1");
    expect(a.vorhanden! / MM).toBeCloseTo(130, 6);
    expect(a.erforderlicheOberkante!).toBeCloseTo(0.25 + packWert("anschlusshoehe", "attikaMin"), 9);
    expect(a.erforderlicheOberkante!).toBeCloseTo(0.4, 9);
  });
  it("Gully z +0,05 → vorhanden sinkt um genau 50 mm", () => {
    const a = eins(projekt({ attika: attika(0.4) }), "a1");
    const b = eins(projekt({ attika: attika(0.4), entwaesserung: [gully("g1", 10, 5, 0.05)] }), "a1");
    expect((a.vorhanden! - b.vorhanden!) / MM).toBeCloseTo(50, 6);
  });
  it("ohne Oberkante → vorhanden null, erforderliche OK gesetzt", () => {
    const a = eins(projekt({ attika: attika() }), "a1");
    expect(a.oberkante).toBeNull();
    expect(a.vorhanden).toBeNull();
    expect(a.erforderlicheOberkante!).toBeCloseTo(0.2 + a.soll!, 9);
  });
  it("Regel fehlt im Pack → soll/erforderlich/regelId null, sollRegel benannt", () => {
    const raw = roh("zvdh-2026");
    raw.daten.regeln = raw.daten.regeln.filter((r) => r.id !== "anschlusshoehe");
    const a = eins(projekt({ attika: attika(0.4) }), "a1", [lade(raw)]);
    expect(a.soll).toBeNull();
    expect(a.erforderlicheOberkante).toBeNull();
    expect(a.regelId).toBeNull();
    expect(a.sollRegel).toEqual({ regelId: "anschlusshoehe", parameter: "attikaMin" });
    expect(a.vorhanden! / MM).toBeCloseTo(200, 6);
  });
  it("Dachfläche ohne Abläufe → keine Anschlüsse", () => {
    expect(rechne(projekt({ attika: attika(0.4), entwaesserung: [] }))).toEqual([]);
  });
});

describe("computeAnschluesse: Tür, Wand, Aufbau, Zone", () => {
  const tuer = { id: "t1", name: "Tür", lage: { kante: "k1", abstand: 9 }, breite: 2, barrierefrei: false, oberkante: 0.3 };
  it("Tür: Teilstrecke, Soll tuerMin bzw. tuerMitRinneMin bzw. barrierefrei", () => {
    const a = eins(projekt({ tuerschwellen: [tuer] }), "t1");
    expect(a.von).toEqual({ x: 9, y: 0 });
    expect(a.bis).toEqual({ x: 11, y: 0 });
    expect(a.okFertigMax).toBeCloseTo(0.1, 9); // max(|dx|,|dy|) = 5 an der ganzen Schwelle
    expect(a.soll).toBe(packWert("anschlusshoehe", "tuerMin"));
    const r = eins(projekt({ tuerschwellen: [{ ...tuer, rinne: true }] }), "t1");
    expect(r.soll).toBe(packWert("anschlusshoehe", "tuerMitRinneMin"));
    expect(r.sollRegel.parameter).toBe("tuerMitRinneMin");
    const bf = eins(projekt({ tuerschwellen: [{ ...tuer, barrierefrei: true, rinne: true }] }), "t1");
    expect(bf.regelId).toBe("barrierefrei-schwelle");
    expect(bf.soll).toBe(packWert("barrierefrei-schwelle", "anschlusshoeheMin"));
  });
  it("Schwelle in einer Terrassenzone −0,10 nutzt die Zonenhöhe", () => {
    const zone: Zone = { id: "z1", name: "Terrasse", kontur: rechteck("z", 4, 3, 8, 0), hoehenversatz: -0.1 };
    const ohne = eins(projekt({ tuerschwellen: [tuer] }), "t1");
    const mit = eins(projekt({ tuerschwellen: [tuer], zonen: [zone] }), "t1");
    expect(mit.okFertigMax).toBeCloseTo(ohne.okFertigMax - 0.1, 9);
    const belag = eins(projekt({ tuerschwellen: [tuer], zonen: [{ ...zone, belagDicke: 0.04 }], belagDicke: 0.08 }), "t1");
    expect(belag.okFertigMax).toBeCloseTo(mit.okFertigMax + 0.04, 9); // Zonenbelag vor Dachbelag
  });
  it("Attika über einer Zonengrenze: höherer Bereich zählt, Ort an der ungünstigsten Stelle", () => {
    const zone: Zone = { id: "z1", name: "Hoch", kontur: rechteck("z", 4, 3, 8, 0), hoehenversatz: 0.3 };
    const a = eins(projekt({ attika: attika(0.6), zonen: [zone] }), "a1");
    expect(a.okFertigMax).toBeCloseTo(0.1 + 0.3, 9); // Zonenfeld: Abstand 5 → 0,1 + Versatz
    expect(a.ort.x).toBeGreaterThanOrEqual(8 - 1e-9);
    expect(a.ort.x).toBeLessThanOrEqual(12 + 1e-9);
  });
  it("Wandanschluss: Teilstrecke, wandMin", () => {
    const a = eins(projekt({ wandanschluesse: [{ id: "w1", name: "Wand", lage: { kante: "k2", abstand: 0 }, laenge: 10, oberkante: 0.5 }] }), "w1");
    expect(a.art).toBe("wand");
    expect(a.okFertigMax).toBeCloseTo(0.2, 9);
    expect(a.vorhanden!).toBeCloseTo(0.3, 9);
    expect(a.soll).toBe(packWert("anschlusshoehe", "wandMin"));
  });
  it("Aufbau nur mit Oberkante; ungünstigste Konturkante", () => {
    const kranz = { id: "au1", name: "Kuppel", kontur: rechteck("au", 2, 1, 14, 6) };
    expect(rechne(projekt({ aufbauten: [kranz] }))).toEqual([]);
    const a = eins(projekt({ aufbauten: [{ ...kranz, oberkante: 0.4 }] }), "au1");
    expect(a.art).toBe("aufbau");
    expect(a.linie).toHaveLength(4);
    expect(a.okFertigMax).toBeCloseTo(0.12, 9); // Ecke (16, y): |dx| = 6
    expect(a.ort.x).toBeCloseTo(16, 9);
    expect(a.soll).toBe(packWert("anschlusshoehe", "aufbauMin"));
  });
  it("LES-Keil erhöht die Oberfläche; exakt ≥ Abtastung und ≤ Abtastung + 0,1 mm", () => {
    const m = projekt({
      tuerschwellen: [{ ...tuer, lage: { kante: "k1", abstand: 10 }, breite: 3 }],
      entwaesserung: [{ id: "l1", art: "les", name: "l1", typ: { packId: "bauder-les", eintragId: "pir-t-les" }, von: { x: 7, y: 1 }, bis: { x: 13, y: 1 }, z: 0 }],
    });
    const a = eins(m, "t1");
    const g = computeSlope(m, { packs: PACKS }).dachflaechen[0]!;
    expect(g.les).toHaveLength(1);
    let hMax = -Infinity;
    for (let k = 0; k <= 3000; k++) hMax = Math.max(hMax, hoeheDachflaeche(g, { x: 10 + k / 1000, y: 0 }));
    expect(a.okFertigMax).toBeCloseTo(0.02 + 0.03, 6); // h(13,0) + Keil 0,01 + 1 % · 6 − 4 % · 1
    expect(a.okFertigMax).toBeGreaterThan(hMax + MM); // Keil liegt auf der Abdichtungsebene der Gefälledämmung
    const s = abtastung(m, a.von, a.bis, 0.001);
    expect(a.okFertigMax).toBeGreaterThanOrEqual(s - 1e-12);
    expect(a.okFertigMax).toBeLessThanOrEqual(s + 0.1 * MM);
  });
  it("deterministisch", () => {
    const m = projekt({ attika: attika(0.4), tuerschwellen: [tuer] });
    expect(rechne(m)).toEqual(rechne(m));
  });
});

describe("computeAnschluesse: Eigenschaften", () => {
  const arb = fc.record({
    gullies: fc.array(fc.record({ x: fc.double({ min: 1, max: 19, noNaN: true }), y: fc.double({ min: 1, max: 9, noNaN: true }),
      z: fc.double({ min: -0.05, max: 0.05, noNaN: true }) }), { minLength: 1, maxLength: 4 }),
    s: fc.double({ min: 0.005, max: 0.05, noNaN: true }),
    ds: fc.double({ min: 0, max: 0.03, noNaN: true }),
    zone: fc.option(fc.record({ x: fc.double({ min: 0, max: 15, noNaN: true }), v: fc.double({ min: -0.15, max: 0.15, noNaN: true }),
      belag: fc.double({ min: 0, max: 0.1, noNaN: true }) }), { nil: undefined }),
    kante: fc.constantFrom("k1", "k2", "k3", "k4"),
  });
  const modell = (x: typeof arb extends fc.Arbitrary<infer T> ? T : never, s: number) => projekt({
    entwaesserung: x.gullies.map((g, i) => gully(`g${i}`, g.x, g.y, g.z)),
    attika: [{ id: "a1", kante: x.kante, breite: 0.3, oberkante: 1 }],
    zonen: x.zone ? [{ id: "z1", name: "Z", kontur: rechteck("z", 5, 4, x.zone.x, 0), hoehenversatz: x.zone.v, belagDicke: x.zone.belag }] : [],
  }, s);

  it("exakte Lösung ≥ jede Abtastung und ≤ Abtastung + 0,1 mm", () => {
    fc.assert(fc.property(arb, (x) => {
      const m = modell(x, x.s);
      const a = eins(m, "a1");
      const s = abtastung(m, a.von, a.bis, 0.002);
      return a.okFertigMax >= s - 1e-12 && a.okFertigMax <= s + 0.1 * MM;
    }), { numRuns: 40, seed: 42 });
  });
  it("größeres Gefälle lässt vorhanden nie steigen", () => {
    fc.assert(fc.property(arb, (x) => eins(modell(x, x.s + x.ds), "a1").vorhanden! <= eins(modell(x, x.s), "a1").vorhanden! + 1e-12),
      { numRuns: 60, seed: 7 });
  });
});

describe("computeAnschluesse: Laufzeit", () => {
  it("1 000 Anschlüsse < 50 ms", () => {
    const dachflaechen: Dachflaeche[] = [];
    for (let i = 0; i < 10; i++) {
      const x0 = i * 30;
      const kontur = rechteck(`d${i}k`, 20, 10, x0, 0);
      dachflaechen.push({
        id: `d${i}`, name: `D${i}`, typ: "dach", aufbauten: [], vorgaben: {}, kontur, attika: kontur.map((p, j) => ({ id: `d${i}a${j}`, kante: p.id, breite: 0.3, oberkante: 0.4 })),
        zonen: [{ id: `d${i}z`, name: "Z", kontur: rechteck(`d${i}z`, 4, 3, x0 + 8, 0), hoehenversatz: -0.1 }],
        entwaesserung: [gully(`d${i}g1`, x0 + 5, 5), gully(`d${i}g2`, x0 + 15, 5, 0.02), gully(`d${i}g3`, x0 + 10, 8, 0.01)],
        tuerschwellen: Array.from({ length: 96 }, (_, j) => ({ id: `d${i}t${j}`, name: "T", lage: { kante: `d${i}k1`, abstand: (j % 19) }, breite: 1, barrierefrei: false, oberkante: 0.3 })),
      });
    }
    const m: ProjectModel = { ...createProject("Perf", "2026-01-01T00:00:00Z"), gefaelleStandard: 0.02, dachflaechen };
    const s = computeSlope(m, { packs: PACKS });
    computeAnschluesse(m, s, PACKS); // Aufwärmen
    const t0 = performance.now();
    const a = computeAnschluesse(m, s, PACKS);
    const dt = performance.now() - t0;
    expect(a).toHaveLength(1000);
    expect(dt, `${dt.toFixed(1)} ms`).toBeLessThan(50);
  });
});
