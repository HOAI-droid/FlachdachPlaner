import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  computeSlope, createProject, loadRulePack, runChecks,
  type Befund, type Dachflaeche, type Entwaesserung, type Kontur, type ProjectModel, type RulePack, type Tuerschwelle,
} from "../src/core/index";

const packTexte = import.meta.glob("../rulepacks/*/pack.json", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;
const lade = (roh: unknown): RulePack => {
  const r = loadRulePack(roh);
  if (!r.ok) throw new Error(JSON.stringify(r.fehler));
  return r.pack;
};
const zvdh = lade(JSON.parse(packTexte["../rulepacks/zvdh-2026/pack.json"]!));
const zvdhOhneAnschluss = (() => {
  const raw = JSON.parse(packTexte["../rulepacks/zvdh-2026/pack.json"]!) as { daten: { regeln: { id: string }[] } };
  raw.daten.regeln = raw.daten.regeln.filter((r) => r.id !== "anschlusshoehe");
  return lade(raw);
})();
const kopf = { version: "1.0.0", quelle: "Testregelwerk", ausgabe: "Test", gueltigAb: "2026-01-01", geprueft: true };
const p = (wert: number, einheit: string) => ({ wert, einheit });
const regeln = lade({
  id: "test-regeln", typ: "regeln", ...kopf, daten: { regeln: [
    { id: "flaeche-je-ablauf", titel: "F", fundstelle: "S. 1", parameter: { hinweisAb: p(300, "m2"), fehlerUeber: p(350, "m2") } },
    { id: "gefaelle-planungsziel", titel: "G", parameter: { regel: p(0.02, "m/m") } },
    { id: "anschlusshoehe", titel: "A", parameter: { attikaMin: p(0.15, "m"), tuerMin: p(0.15, "m") } },
    { id: "barrierefrei-schwelle", titel: "B", parameter: {
      maxAbstandEntwaesserung: p(10, "m"), ueberflutungskanteUnterOkFk: p(0.05, "m"), anschlusshoeheMin: p(0.05, "m") } },
  ] },
});
const ablaeufe = lade({
  id: "test-ablaeufe", typ: "ablaeufe", ...kopf, daten: { eintraege: [
    { id: "nr", hersteller: "H", produkt: "Notablauf 5 cm", art: "notablauf", wehrhoehe: 0.05, abflussleistung: [{ anstau: 0.035, q: 6 }] },
  ] },
});
const PACKS = [regeln, ablaeufe];

const pt = (id: string, x: number, y: number) => ({ id, x, y });
const rechteck = (pre: string, w: number, h: number, x0 = 0, y0 = 0): Kontur =>
  [pt(`${pre}1`, x0, y0), pt(`${pre}2`, x0 + w, y0), pt(`${pre}3`, x0 + w, y0 + h), pt(`${pre}4`, x0, y0 + h)];
const gully = (id: string, x: number, y: number, z = 0): Entwaesserung =>
  ({ id, art: "gully", name: id, typ: null, position: { x, y }, z });
const notablauf = (id: string, x: number, y: number, z: number, typ = true): Entwaesserung =>
  ({ id, art: "notablauf", name: id, typ: typ ? { packId: "test-ablaeufe", eintragId: "nr" } : null, position: { x, y }, z });
const tuer = (x: Partial<Tuerschwelle> = {}): Tuerschwelle =>
  ({ id: "t1", name: "Tür", lage: { kante: "k1", abstand: 9 }, breite: 2, barrierefrei: false, ...x });
function projekt(x: Partial<Dachflaeche> = {}, m: Partial<ProjectModel> = {}): ProjectModel {
  const d: Dachflaeche = {
    id: "d1", name: "Dach", typ: "dach", aufbauten: [], zonen: [], vorgaben: {}, attika: [], tuerschwellen: [],
    kontur: rechteck("k", 20, 10), entwaesserung: [gully("g1", 10, 5)], ...x,
  };
  return { ...createProject("Test", "2026-01-01T00:00:00Z"), gefaelleStandard: 0.02, dachflaechen: [d], ...m };
}
function pruefe(m: ProjectModel, packs: readonly RulePack[] = PACKS): Befund[] {
  const b = runChecks(m, { slope: computeSlope(m, { packs }) }, packs);
  for (const x of b) {
    expect(x.regelId, x.meldung).toMatch(/\S/);
    expect(x.quelle, x.meldung).toMatch(/\S/);
  }
  return b;
}
const mit = (b: Befund[], regelId: string) => b.filter((x) => x.regelId === regelId);

describe("Schritt 9: Regelprüfung", () => {
  it("Grundfall 20×10, Gully mittig, 2 %: keine Befunde", () => {
    expect(pruefe(projekt())).toEqual([]);
  });

  it("Mindestgefälle: 1,5 % → Warnung mit Pack-Quelle; 2 % → nichts; Zone 1 % → eigener Befund", () => {
    const b = mit(pruefe(projekt({}, { gefaelleStandard: 0.015 })), "gefaelle-planungsziel");
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ stufe: "warnung", objektId: "d1", quelle: "Testregelwerk", grenze: 0.02 });
    expect(b[0]!.differenz).toBeCloseTo(0.005, 9);
    const z = mit(pruefe(projekt({ zonen: [{ id: "z1", name: "Z", kontur: rechteck("z", 4, 10), hoehenversatz: 0, gefaelle: 0.01 }] })),
      "gefaelle-planungsziel");
    expect(z.map((x) => x.objektId)).toEqual(["z1"]);
  });

  it("Pfützen: Aufbau staut Wasser auf der abgewandten Seite → Befund; ohne Aufbau keiner", () => {
    const m = projekt({ aufbauten: [{ id: "a1", name: "Lichtkuppel", kontur: rechteck("a", 2, 6, 14, 2) }] });
    const b = mit(pruefe(m), "fdp-pfuetzen");
    expect(b).toHaveLength(1);
    expect(b[0]!.ort!.x).toBeCloseTo(16.05, 6);
    expect(b[0]!.ort!.y).toBeCloseTo(5, 1);
    expect(b[0]!.wert!).toBeGreaterThan(0.3);
    expect(b[0]!.quelle).toContain("0.10 m");
  });

  it("Pfützen (Eigenschaft): Rechteck ohne Aufbauten, beliebige Gullys → keine Pfütze", () => {
    fc.assert(fc.property(
      fc.array(fc.record({ x: fc.double({ min: 0.5, max: 7.5, noNaN: true }), y: fc.double({ min: 0.5, max: 4.5, noNaN: true }),
        z: fc.double({ min: -0.05, max: 0.05, noNaN: true }) }), { minLength: 1, maxLength: 3 }),
      (gs) => {
        const m = projekt({ kontur: rechteck("k", 8, 5), entwaesserung: gs.map((g, i) => gully(`g${i}`, g.x, g.y, g.z)) });
        expect(mit(runChecks(m, { slope: computeSlope(m) }, PACKS), "fdp-pfuetzen")).toEqual([]);
      }), { numRuns: 15 });
  });

  it("Fläche je Ablauf: 200 m² nichts, 320 m² Hinweis, 360 m² Fehler (Grenzen aus Pack)", () => {
    expect(mit(pruefe(projekt()), "flaeche-je-ablauf")).toEqual([]);
    const h = mit(pruefe(projekt({ kontur: rechteck("k", 20, 16), entwaesserung: [gully("g1", 10, 8)] })), "flaeche-je-ablauf");
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ stufe: "hinweis", objektId: "g1", grenze: 300, quelle: "Testregelwerk, S. 1" });
    const f = mit(pruefe(projekt({ kontur: rechteck("k", 20, 18), entwaesserung: [gully("g1", 10, 9)] })), "flaeche-je-ablauf");
    expect(f[0]).toMatchObject({ stufe: "fehler", grenze: 350 });
    expect(f[0]!.differenz).toBeCloseTo(10, 6);
  });

  it("Anschlusshöhe Attika: OK 0,40 (≥ 15 cm über HP 0,20) ok; OK 0,30 → Fehler 50 mm; ohne OK → Hinweis", () => {
    const att = (oberkante?: number) => projekt({ attika: [{ id: "at1", kante: "k1", breite: 0.3, ...(oberkante !== undefined ? { oberkante } : {}) }] });
    expect(mit(pruefe(att(0.4)), "anschlusshoehe")).toEqual([]);
    const b = mit(pruefe(att(0.3)), "anschlusshoehe");
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ stufe: "fehler", objektId: "at1", code: "anschlusshoehe-attika" });
    expect(b[0]!.differenz).toBeCloseTo(0.05, 4);
    expect(mit(pruefe(att()), "anschlusshoehe")[0]).toMatchObject({ stufe: "hinweis", code: "attika-oberkante-fehlt" });
  });

  it("Anschlusshöhe Tür: Dach an Schwelle 0,10; OK 0,25 ok, OK 0,20 → Fehler 50 mm", () => {
    expect(mit(pruefe(projekt({ tuerschwellen: [tuer({ oberkante: 0.25 })] })), "anschlusshoehe")).toEqual([]);
    const b = mit(pruefe(projekt({ tuerschwellen: [tuer({ oberkante: 0.2 })] })), "anschlusshoehe");
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ stufe: "fehler", objektId: "t1", code: "anschlusshoehe-tuer" });
    expect(b[0]!.differenz).toBeCloseTo(0.05, 4);
  });

  it("Regel fehlt im Pack (zvdh-2026 ohne „anschlusshoehe“, Regel entfernt) → einmaliger Befund statt Zahl", () => {
    const m = projekt({ attika: [{ id: "at1", kante: "k1", breite: 0.3, oberkante: 0.3 }, { id: "at2", kante: "k2", breite: 0.3, oberkante: 0.3 }] });
    const b = pruefe(m, [zvdhOhneAnschluss]).filter((x) => x.code === "regel-fehlt");
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ regelId: "anschlusshoehe", objektId: null });
    expect(b[0]!.differenz).toBeUndefined();
  });

  describe("barrierefreie Schwelle", () => {
    const bf = (x: Partial<Tuerschwelle> = {}) => tuer({ barrierefrei: true, oberkante: 0.2, ...x });

    it("eingehalten: Abstand 5 m, Anschluss 10 cm, Überflutungskante 10 cm unter OK", () => {
      const m = projekt({ tuerschwellen: [bf()], entwaesserung: [gully("g1", 10, 5), notablauf("n1", 18, 5, 0.05)] });
      expect(mit(pruefe(m), "barrierefrei-schwelle")).toEqual([]);
    });

    it("Abstand zur Entwässerung > 10,0 m → Fehler mit Differenz", () => {
      const m = projekt({ kontur: rechteck("k", 30, 10), tuerschwellen: [bf({ lage: { kante: "k1", abstand: 1 } })],
        entwaesserung: [gully("g1", 13, 5), notablauf("n1", 25, 5, 0.05)] });
      const b = mit(pruefe(m), "barrierefrei-schwelle").filter((x) => x.code === "barrierefrei-abstand");
      expect(b).toHaveLength(1);
      expect(b[0]!.wert).toBeCloseTo(Math.hypot(10, 5), 6);
      expect(b[0]!.differenz).toBeCloseTo(Math.hypot(10, 5) - 10, 6);
      // genau 10,0 m (Gully auf Kantenhöhe y = 0 ist nicht sinnvoll; daher Gully 10 m senkrecht vor der Schwelle)
      const grenz = projekt({ kontur: rechteck("k", 20, 12), tuerschwellen: [bf()], entwaesserung: [gully("g1", 10, 10), notablauf("n1", 18, 6, 0.05)] });
      expect(mit(pruefe(grenz), "barrierefrei-schwelle").filter((x) => x.code === "barrierefrei-abstand")).toEqual([]);
    });

    it("Überflutungskante < 5 cm unter OK → Fehler; unbekannte Wehrhöhe → Warnung; keine Notentwässerung → Fehler", () => {
      const hoch = projekt({ tuerschwellen: [bf()], entwaesserung: [gully("g1", 10, 5), notablauf("n1", 18, 5, 0.12)] });
      const b = mit(pruefe(hoch), "barrierefrei-schwelle");
      expect(b.map((x) => x.code)).toEqual(["barrierefrei-ueberflutungskante"]);
      expect(b[0]!.differenz).toBeCloseTo(0.02, 9);
      const ohneTyp = projekt({ tuerschwellen: [bf()], entwaesserung: [gully("g1", 10, 5), notablauf("n1", 18, 5, 0.05, false)] });
      expect(mit(pruefe(ohneTyp), "barrierefrei-schwelle")[0]).toMatchObject({ stufe: "warnung", code: "notentwaesserung-kante-unbekannt", objektId: "n1" });
      const ohneNot = projekt({ tuerschwellen: [bf()] });
      expect(mit(pruefe(ohneNot), "barrierefrei-schwelle")[0]).toMatchObject({ stufe: "fehler", code: "barrierefrei-keine-notentwaesserung" });
    });

    it("Anschlusshöhe barrierefrei aus Regel barrierefrei-schwelle (5 cm): OK 0,15 ok, OK 0,13 bei Dach 0,10 → 2 cm Fehler", () => {
      const m = (ok: number) => projekt({ tuerschwellen: [bf({ oberkante: ok })], entwaesserung: [gully("g1", 10, 5), notablauf("n1", 18, 5, 0)] });
      expect(mit(pruefe(m(0.15)), "barrierefrei-schwelle")).toEqual([]);
      const b = mit(pruefe(m(0.13)), "barrierefrei-schwelle");
      expect(b.map((x) => x.code)).toEqual(["anschlusshoehe-tuer"]);
      expect(b[0]!.differenz).toBeCloseTo(0.02, 4);
    });
  });

  it("Pack ungeprüft: Hinweis mit Pack-Quelle; geprüftes Pack → nichts", () => {
    const b = mit(pruefe(projekt(), [zvdh]), "pack-ungeprueft");
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ stufe: "hinweis", objektId: "zvdh-2026", quelle: zvdh.quelle });
    expect(mit(pruefe(projekt()), "pack-ungeprueft")).toEqual([]);
  });

  it("Regenspende manuell überschrieben: Hinweis mit Abweichung; nicht überschrieben → nichts", () => {
    const basis = createProject("x", "2026-01-01T00:00:00Z").standort;
    const m = projekt({}, { standort: { ...basis, regen: { r5_5: { packWert: 300, manuellWert: 330 }, r5_100: { packWert: 500 } } } });
    const b = mit(pruefe(m), "regenspende-manuell");
    expect(b).toHaveLength(1);
    expect(b[0]!.meldung).toContain("+10.0 %");
    expect(b[0]!.differenz).toBeCloseTo(30, 9);
    const ohne = projekt({}, { standort: { ...basis, regen: { r5_5: { packWert: 300 }, r5_100: { packWert: 500 } } } });
    expect(mit(pruefe(ohne), "regenspende-manuell")).toEqual([]);
  });

  it("enthält die Vorgabenprüfung (Schritt 8)", () => {
    expect(mit(pruefe(projekt({ vorgaben: { maxHochpunkt: 0.15 } })), "vorgabe-max-hochpunkt")).toHaveLength(1);
  });
});
