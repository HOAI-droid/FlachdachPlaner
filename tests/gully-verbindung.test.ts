import { describe, expect, it } from "vitest";
import {
  ausfuehren, computeCatchments, computeSlope, createProject, hoeheDachflaeche, loadRulePack, loesche, neuerVerlauf, parseProject,
  pruefeVorgaben, rueckgaengig, serializeProject, setGullyVerbindung, validateProject,
  type Dachflaeche, type Entwaesserung, type Gully, type Kontur, type ProjectModel, type RegelPack, type RulePack,
} from "../src/core/index";

/** Verbundene Gullys (`verbundenMit`): eine waagerechte Kehle A–B statt zweier Punktquellen. */
const packTexte = import.meta.glob("../rulepacks/*/pack.json", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;
const lade = (roh: unknown): RulePack => {
  const r = loadRulePack(roh);
  if (!r.ok) throw new Error(JSON.stringify(r.fehler));
  return r.pack;
};
const zvdh = lade(JSON.parse(packTexte["../rulepacks/zvdh-2026/pack.json"]!)) as RegelPack;
const pt = (id: string, x: number, y: number) => ({ id, x, y });
const rechteck = (w: number, h: number, p = "k"): Kontur => [pt(`${p}1`, 0, 0), pt(`${p}2`, w, 0), pt(`${p}3`, w, h), pt(`${p}4`, 0, h)];
const gully = (id: string, x: number, y: number, z = 0, verbundenMit?: string): Gully =>
  ({ id, art: "gully", name: id, typ: null, position: { x, y }, z, ...(verbundenMit ? { verbundenMit } : {}) });
const dach = (id: string, entwaesserung: Entwaesserung[], kontur = rechteck(20, 10)): Dachflaeche => ({
  id, name: id, typ: "dach", aufbauten: [], zonen: [], vorgaben: {}, attika: [], tuerschwellen: [], kontur, entwaesserung,
});
const projekt = (...d: Dachflaeche[]): ProjectModel =>
  ({ ...createProject("Test", "2026-01-01T00:00:00Z"), gefaelleStandard: 0.02, dachflaechen: d });
const gullys = (m: ProjectModel, i = 0) => m.dachflaechen[i]!.entwaesserung as Gully[];

describe("Verbundene Gullys: Gefälle", () => {
  const m = projekt(dach("d1", [gully("g1", 5, 5, 0.1, "g2"), gully("g2", 15, 5, 0.1)]));
  const r = computeSlope(m);
  const g = r.dachflaechen[0]!;

  it("eine Strecken-Quelle A–B, keine Punktquellen, kein Hinweis", () => {
    expect(g.feld.quellen).toEqual([
      { ablaufId: "g1", partnerId: "g2", position: { x: 5, y: 5 }, bis: { x: 15, y: 5 }, achse: { x: 1, y: 0 }, z: 0.1 },
    ]);
    expect(r.hinweise).toEqual([]);
  });

  it("waagerechte Kehle: Höhe auf A–B überall z, quer dazu Gefälle", () => {
    for (const x of [5, 7.5, 10, 15]) expect(hoeheDachflaeche(g, { x, y: 5 })).toBeCloseTo(0.1, 12);
    expect(hoeheDachflaeche(g, { x: 10, y: 0 })).toBeCloseTo(0.1 + 0.02 * 5, 12);
    expect(g.linien.some((l) => l.art === "grat")).toBe(false);
    expect(g.tiefpunkt?.kote).toBe(0.1);
    expect(g.koten.filter((k) => k.art === "ablauf").map((k) => k.position)).toEqual(expect.arrayContaining([{ x: 5, y: 5 }, { x: 15, y: 5 }]));
  });

  it("Einzugsfläche an der Mittelsenkrechten auf A und B geteilt", () => {
    const f = computeCatchments(m, r, { regeln: zvdh }).flaechen;
    expect(f.map((x) => x.ablaufId)).toEqual(["g1", "g2"]);
    for (const x of f) expect(x.dachFlaeche).toBeCloseTo(100, 6);
  });

  it("Vorgaben finden den Partner (Ort = Lage von B)", () => {
    const v = projekt(dach("d1", [gully("g1", 5, 5, 0.1, "g2"), gully("g2", 15, 5, 0.1)]));
    const d0 = { ...v.dachflaechen[0]!, vorgaben: { minTiefpunkt: 0.2 } };
    const b = pruefeVorgaben({ ...v, dachflaechen: [d0] }, computeSlope({ ...v, dachflaechen: [d0] }));
    expect(b.find((x) => x.objektId === "g2")?.ort).toEqual({ x: 15, y: 5 });
  });

  it("einseitiger Verweis genügt; Reihenfolge B vor A ergibt dieselbe Strecke", () => {
    const s = computeSlope(projekt(dach("d1", [gully("g2", 15, 5, 0.1), gully("g1", 5, 5, 0.1, "g2")])));
    expect(s.dachflaechen[0]!.feld.quellen.map((q) => [q.ablaufId, q.partnerId])).toEqual([["g1", "g2"]]);
  });
});

describe("Verbundene Gullys: Rückfall auf Einzelquellen", () => {
  const einzeln = (r: ReturnType<typeof computeSlope>) => r.dachflaechen[0]!.feld.quellen.map((q) => [q.ablaufId, q.partnerId]);

  it("unterschiedliche Kote → Hinweis gully-verbindung-hoehe, Koten exakt", () => {
    const r = computeSlope(projekt(dach("d1", [gully("g1", 5, 5, 0.1, "g2"), gully("g2", 15, 5, 0.12, "g1")])));
    expect(r.hinweise.map((h) => [h.code, h.objektId])).toEqual([["gully-verbindung-hoehe", "g1"]]);
    expect(einzeln(r)).toEqual([["g1", undefined], ["g2", undefined]]);
    expect(r.dachflaechen[0]!.koten.filter((k) => k.art === "ablauf").map((k) => k.kote).sort()).toEqual([0.1, 0.12]);
  });

  it("Partner auf anderer Dachfläche / gelöscht / kein Gully → Hinweis gully-verbindung-ungueltig", () => {
    const fremd = computeSlope(projekt(dach("d1", [gully("g1", 5, 5, 0, "g9"), gully("g2", 15, 5)]), dach("d2", [gully("g9", 2, 2)], rechteck(5, 5, "m"))));
    expect(fremd.hinweise.map((h) => [h.code, h.dachflaecheId, h.objektId])).toEqual([["gully-verbindung-ungueltig", "d1", "g1"]]);
    expect(einzeln(fremd)).toEqual([["g1", undefined], ["g2", undefined]]);
    const not = computeSlope(projekt(dach("d1", [gully("g1", 5, 5, 0, "n1"), { id: "n1", art: "notablauf", name: "N", typ: null, position: { x: 9, y: 9 }, z: 0 }])));
    expect(not.hinweise.map((h) => h.code)).toEqual(["gully-verbindung-ungueltig"]);
  });

  it("Partner anders verbunden → Hinweis, nur ein Paar", () => {
    const r = computeSlope(projekt(dach("d1", [gully("g1", 3, 5, 0, "g2"), gully("g2", 10, 5, 0, "g3"), gully("g3", 17, 5, 0, "g2")])));
    expect(r.hinweise.map((h) => [h.code, h.objektId])).toEqual([["gully-verbindung-ungueltig", "g1"]]);
    expect(einzeln(r)).toEqual([["g1", undefined], ["g2", "g3"]]);
  });
});

describe("Verbundene Gullys: Modell, Datei, Befehle", () => {
  const basis = projekt(dach("d1", [gully("g1", 5, 5), gully("g2", 15, 5), gully("g3", 10, 8)]));

  it("validate: verbundenMit nur am Gully und nur als Text", () => {
    const ok = projekt(dach("d1", [gully("g1", 5, 5, 0, "g2"), gully("g2", 15, 5)]));
    expect(validateProject(ok)).toEqual([]);
    const zahl = JSON.parse(serializeProject(ok)) as { dachflaechen: { entwaesserung: Record<string, unknown>[] }[] };
    zahl.dachflaechen[0]!.entwaesserung[0]!["verbundenMit"] = 3;
    expect(validateProject(zahl).map((e) => e.pfad)).toEqual(["/dachflaechen/0/entwaesserung/0/verbundenMit"]);
    const not = JSON.parse(serializeProject(ok)) as typeof zahl;
    not.dachflaechen[0]!.entwaesserung[1] = { id: "n1", art: "notablauf", name: "N", typ: null, position: { x: 1, y: 1 }, z: 0, verbundenMit: "g1" };
    expect(validateProject(not).length).toBeGreaterThan(0);
  });

  it("JSON: Roundtrip mit Feld; alte Datei ohne Feld bleibt unverändert", () => {
    const m = setGullyVerbindung("d1", "g1", "g2").anwenden(basis);
    const r = parseProject(serializeProject(m));
    expect(r.ok && r.projekt).toEqual(m);
    const alt = parseProject(serializeProject(basis));
    expect(alt.ok && serializeProject(alt.projekt)).toBe(serializeProject(basis));
    expect(serializeProject(basis)).not.toContain("verbundenMit");
  });

  it("setGullyVerbindung: beidseitig, Undo, Umhängen löst alte Verbindung", () => {
    const v = ausfuehren(neuerVerlauf(basis), setGullyVerbindung("d1", "g1", "g2"));
    expect(gullys(v.aktuell).map((e) => e.verbundenMit)).toEqual(["g2", "g1", undefined]);
    expect(rueckgaengig(v).aktuell).toBe(basis);
    const um = setGullyVerbindung("d1", "g3", "g1").anwenden(v.aktuell);
    expect(gullys(um).map((e) => e.verbundenMit)).toEqual(["g3", undefined, "g1"]);
    expect("verbundenMit" in gullys(um)[1]!).toBe(false);
    const los = setGullyVerbindung("d1", "g3", null).anwenden(um);
    expect(gullys(los).map((e) => e.verbundenMit)).toEqual([undefined, undefined, undefined]);
    expect(serializeProject(los)).toBe(serializeProject(basis));
  });

  it("setGullyVerbindung: ungültiger Partner oder keine Änderung → Modell unverändert", () => {
    const m = setGullyVerbindung("d1", "g1", "g2").anwenden(basis);
    expect(setGullyVerbindung("d1", "g1", "g2").anwenden(m)).toBe(m);
    expect(setGullyVerbindung("d1", "g1", "g1").anwenden(basis)).toBe(basis);
    expect(setGullyVerbindung("d1", "g1", "gx").anwenden(basis)).toBe(basis);
    expect(setGullyVerbindung("d1", "g1", null).anwenden(basis)).toBe(basis);
  });

  it("Löschen eines Gullys löst die Verbindung beim Partner (Undo stellt sie wieder her)", () => {
    const m = setGullyVerbindung("d1", "g1", "g2").anwenden(basis);
    const v = ausfuehren(neuerVerlauf(m), loesche({ art: "entwaesserung", id: "g2", dachId: "d1" }));
    expect(gullys(v.aktuell).map((e) => [e.id, e.verbundenMit])).toEqual([["g1", undefined], ["g3", undefined]]);
    expect(computeSlope(v.aktuell).hinweise).toEqual([]);
    expect(rueckgaengig(v).aktuell).toBe(m);
  });
});
