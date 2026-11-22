/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { ebeneFacetten } from "../src/core/slope/index";
import {
  computeSlope, createProject, daemmBasis, meshDach, meshDaemmung, hoeheDachflaeche, layoutInsulation, plattenDaemmdicke, loadRulePack, polygonArea, pruefeVerlegeplan,
  validateRulePack,
  type Dachflaeche, type DachGefaelle, type DaemmplattenPack, type Entwaesserung, type Facette, type InsulationLayout,
  type Kontur, type ProjectModel, type SlopeResult, type Vec2,
} from "../src/core/index";

const packTexte = import.meta.glob("../rulepacks/*/pack.json", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;
const roh = () => JSON.parse(packTexte["../rulepacks/daemmplatten/pack.json"]!) as Record<string, unknown>;
function ladeKatalog(raw: unknown = roh()): DaemmplattenPack {
  const r = loadRulePack(raw);
  if (!r.ok) throw new Error(JSON.stringify(r.fehler));
  return r.pack as DaemmplattenPack;
}
const KAT = ladeKatalog();

const pt = (id: string, x: number, y: number) => ({ id, x, y });
const rechteck = (w: number, h: number): Kontur => [pt("k1", 0, 0), pt("k2", w, 0), pt("k3", w, h), pt("k4", 0, h)];
const gully = (id: string, x: number, y: number, z = 0): Entwaesserung => ({ id, art: "gully", name: id, typ: null, position: { x, y }, z });
const les = (id: string, von: Vec2, bis: Vec2, z = 0): Entwaesserung => ({ id, art: "les", name: id, typ: null, von, bis, z });

function projekt(dach: Partial<Dachflaeche> & Pick<Dachflaeche, "kontur" | "entwaesserung">, gefaelle = 0.02): ProjectModel {
  const d: Dachflaeche = { id: "d1", name: "Dach", typ: "dach", aufbauten: [], zonen: [], vorgaben: {}, attika: [], tuerschwellen: [], ...dach };
  return { ...createProject("Test", "2026-01-01T00:00:00Z"), gefaelleStandard: gefaelle, dachflaechen: [d] };
}
/** Referenz-L-Dach (docs/referenz/gefaelledaemmplan-2d.jpg): 10,60 × 15,30 m, Abläufe in drei Ecken. */
const L_DACH = projekt({
  kontur: [pt("a", 0, 0), pt("b", 10.6, 0), pt("c", 10.6, 15.3), pt("d", 4.15, 15.3), pt("e", 4.15, 7.1), pt("f", 0, 7.1)],
  entwaesserung: [gully("g1", 0, 0), gully("g2", 10.6, 0), gully("g3", 10.6, 15.3)],
});

const plan = (m: ProjectModel) => {
  const s = computeSlope(m, { daemmdickeTiefpunktStandard: 20 });
  return { s, l: layoutInsulation(m, s, KAT) };
};
const MM = 0.001;

describe("Schritt 23: Plattenformat-Pack", () => {
  it("Beispielpack validiert, fiktiv (geprueft:false), Format 1,00 × 1,00 m, Kehlkeile L/R je Typ", () => {
    expect(validateRulePack(roh())).toEqual([]);
    expect(KAT.geprueft).toBe(false);
    expect(KAT.daten.format).toEqual({ laenge: 1, breite: 1 });
    for (const t of KAT.daten.typen) for (const s of ["L", "R"]) expect(KAT.daten.kehlkeile!.some((k) => k.typ === t.typ && k.seite === s)).toBe(true);
  });
  it("Loader meldet Lücke Enddicke Typ n ≠ Anfangsdicke Typ n+1", () => {
    const raw = roh() as { daten: { typen: { dickeEnde: number }[] } };
    raw.daten.typen[0]!.dickeEnde = 0.039;
    const f = validateRulePack(raw);
    expect(f.some((e) => e.pfad === "/daten/typen/1/dickeAnfang" && /^Lücke: Enddicke Typ 1/.test(e.meldung))).toBe(true);
  });
  it("Loader meldet Lücke bei Zusatzlage ≠ Enddicke höchster Typ − Anfangsdicke Typ 1", () => {
    const raw = roh() as { daten: { zusatzlage: { dicke: number } } };
    raw.daten.zusatzlage.dicke = 0.18;
    expect(validateRulePack(raw)).toEqual([{ pfad: "/daten/zusatzlage/dicke", meldung: expect.stringMatching(/^Lücke: Zusatzlage/) as unknown as string }]);
  });
  it("Kehlkeil-Winkel muss zwischen 0 und 90° liegen", () => {
    const raw = roh() as { daten: { kehlkeile: { winkel: number }[] } };
    raw.daten.kehlkeile[0]!.winkel = 90;
    expect(validateRulePack(raw).map((e) => e.pfad)).toEqual(["/daten/kehlkeile/0/winkel"]);
  });
  it("Hinweis 'Katalog ungeprüft' im Layout", () => {
    expect(plan(projekt({ kontur: rechteck(2, 2), entwaesserung: [gully("g", 0, 0)] })).l.befunde.map((b) => b.code)).toContain("katalog-ungeprueft");
  });
});

/** Dämmdicke laut Höhenfeld (A2b): d_TP + h − h_min der Hauptfläche. */
function hoehenfeldDicke(g: DachGefaelle, p: Vec2, dtp = 0.02): number {
  return dtp + hoeheDachflaeche(g, p) - g.tiefpunkt!.kote;
}
function eckenStimmen(s: SlopeResult, l: InsulationLayout): number {
  const g = s.dachflaechen[0]!;
  let max = 0;
  for (const p of l.dachflaechen[0]!.platten) {
    for (const v of p.polygon.outer) {
      const d = p.dicke.a * v.x + p.dicke.b * v.y + p.dicke.c;
      max = Math.max(max, Math.abs(d - hoehenfeldDicke(g, v)));
    }
  }
  return max;
}

describe("Schritt 24: layoutInsulation", () => {
  it("10 × 5 m, LES an der Längsseite → 5 Reihen Typ 1–5 zu je 10 ganzen Platten", () => {
    const { s, l } = plan(projekt({ kontur: rechteck(10, 5), entwaesserung: [les("l1", { x: 0, y: 0 }, { x: 10, y: 0 })] }));
    const pl = l.dachflaechen[0]!.platten;
    expect(pl).toHaveLength(50);
    expect([...new Set(pl.map((p) => p.bezeichnung))].sort()).toEqual(["1", "2", "3", "4", "5"]);
    for (const t of ["1", "2", "3", "4", "5"]) expect(pl.filter((p) => p.bezeichnung === t && !p.zuschnitt && p.art === "platte")).toHaveLength(10);
    // Typ n liegt in Reihe n − 1 (y ∈ [n − 1, n])
    for (const p of pl) {
      const ys = p.polygon.outer.map((v) => v.y);
      expect(Math.min(...ys)).toBeCloseTo(Number(p.typ) - 1, 9);
      expect(Math.max(...ys)).toBeCloseTo(Number(p.typ), 9);
    }
    expect(eckenStimmen(s, l)).toBeLessThan(MM);
    expect(l.dachflaechen[0]!.pfeile.every((f) => Math.abs(f.richtung.y + 1) < 1e-12)).toBe(true);
  });

  it("Gully mittig → Kehlkeile L/R symmetrisch gleich viele, Dicke an allen Ecken ± 1 mm", () => {
    const { s, l } = plan(projekt({ kontur: rechteck(10, 5), entwaesserung: [gully("g", 5, 2.5)] }));
    const pl = l.dachflaechen[0]!.platten;
    const keile = pl.filter((p) => p.art === "kehlkeil");
    const L = keile.filter((p) => p.seite === "L"), R = keile.filter((p) => p.seite === "R");
    expect(L.length).toBeGreaterThan(0);
    expect(L.length).toBe(R.length);
    // je Typ gleich viele L und R; volle Keile sind Dreiecke 1 × 1 m (0,5 m²)
    for (const t of ["1", "2", "3"]) expect(L.filter((p) => p.typ === t).length).toBe(R.filter((p) => p.typ === t).length);
    expect(keile.filter((p) => !p.zuschnitt).every((p) => Math.abs(p.flaeche - 0.5) < 1e-3)).toBe(true);
    expect(keile.find((p) => p.typ === "1")!.bezeichnung).toMatch(/^K1 [LR]$/);
    expect(l.befunde.filter((b) => b.code === "kehlkeil-nicht-im-katalog")).toEqual([]);
    expect(eckenStimmen(s, l)).toBeLessThan(MM);
    expect(pruefeVerlegeplan(projekt({ kontur: rechteck(10, 5), entwaesserung: [gully("g", 5, 2.5)] }), l, KAT).ok).toBe(true);
  });

  it("Gefällelänge über Typ 8 → Zusatzlage und Neustart, Bezeichnung '1+1'", () => {
    const m = projekt({ kontur: rechteck(4, 10), entwaesserung: [les("l1", { x: 0, y: 0 }, { x: 4, y: 0 })] });
    const { s, l } = plan(m);
    const pl = l.dachflaechen[0]!.platten;
    const reihe9 = pl.filter((p) => p.reihe === 8);
    expect(reihe9.length).toBe(4);
    expect(reihe9.every((p) => p.bezeichnung === "1+1" && p.typ === "1" && p.zusatzlagen === 1)).toBe(true);
    expect(pl.filter((p) => p.reihe === 9).every((p) => p.bezeichnung === "2+1")).toBe(true);
    expect(pl.filter((p) => p.reihe === 7).every((p) => p.bezeichnung === "8")).toBe(true);
    // Dicke über die Zusatzlage hinweg stetig = Höhenfeld
    expect(eckenStimmen(s, l)).toBeLessThan(MM);
  });

  it("Referenz-L-Dach: keine Lücken/Überlappungen, Flächensumme = Dachfläche ± 0,01 m²", () => {
    const { s, l } = plan(L_DACH);
    const flaeche = polygonArea({ outer: L_DACH.dachflaechen[0]!.kontur, holes: [] });
    expect(flaeche).toBeCloseTo(10.6 * 15.3 - 4.15 * 8.2, 9);
    const summe = l.dachflaechen[0]!.platten.reduce((a, p) => a + p.flaeche, 0);
    expect(Math.abs(summe - flaeche)).toBeLessThan(0.01);
    const r = pruefeVerlegeplan(L_DACH, l, KAT);
    expect(r.befunde).toEqual([]);
    expect(r.ok).toBe(true);
    const d = r.dachflaechen[0]!;
    expect(d.luecken).toBeLessThan(0.01);
    expect(d.ueberlappungen).toBeLessThan(0.01);
    expect(d.kehlkeile).toBeGreaterThan(0);
    expect(eckenStimmen(s, l)).toBeLessThan(MM);
    // Gratstücke vorhanden (drei Abläufe), N0 am Tiefpunkt, Verlegestart je Facette am Ablauf
    expect(l.dachflaechen[0]!.platten.some((p) => p.gratschnitt)).toBe(true);
    expect(l.dachflaechen[0]!.n0!.kote).toBe(0);
    expect(l.dachflaechen[0]!.verlegestarts).toHaveLength(ebeneFacetten(s.dachflaechen[0]!.facetten).length);
  });

  it("Referenz-L-Dach: keine Naht und kein Kehlkeil im Gleichstandsbereich (5,3|5,3)–(7,65|7,65)", () => {
    const { s, l } = plan(L_DACH);
    const g = s.dachflaechen[0]!;
    // gleiche Ebene → eine Facette, Plattenkanten laufen nicht entlang der Diagonale
    const f = ebeneFacetten(g.facetten);
    expect(f.length).toBeLessThan(g.facetten.length);
    const naht = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      [a, b].every((v) => Math.abs(v.x - v.y) < 1e-6 && v.x > 5.3 - 1e-6 && v.x < 7.65 + 1e-6);
    for (const p of l.dachflaechen[0]!.platten) {
      const r = p.polygon.outer;
      for (let i = 0; i < r.length; i++) {
        const a = r[i]!, b = r[(i + 1) % r.length]!;
        if (Math.hypot(b.x - a.x, b.y - a.y) > 0.05 && naht(a, b)) throw new Error(`Naht in ${p.id}`);
      }
    }
  });

  it("Kehle ≠ 45° (ungleiche Gefälle) → Befund 'Kehlkeil nicht im Katalog'", () => {
    // Synthetisches Höhenfeld: Ablauf in (0,0), Facette A h = 0,02·x, Facette B h = 0,04·y, Kehle (0,0)–(4,2).
    const m = projekt({ kontur: rechteck(4, 4), entwaesserung: [gully("g", 0, 0)] });
    const echt = computeSlope(m).dachflaechen[0]!;
    const fac = (id: string, seite: 0 | 1, ring: Vec2[], a: number, b: number, fall: Vec2, gef: number): Facette => ({
      id, ablaufId: "g", seite, polygon: { outer: ring, holes: [] }, flaeche: polygonArea({ outer: ring, holes: [] }),
      ebene: { a, b, c: 0 }, gefaelle: gef, fallrichtung: fall,
    });
    const A = fac("g/0/0", 0, [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }], 0.02, 0, { x: -1, y: 0 }, 0.02);
    const B = fac("g/1/0", 1, [{ x: 0, y: 0 }, { x: 4, y: 2 }, { x: 4, y: 4 }, { x: 0, y: 4 }], 0, 0.04, { x: 0, y: -1 }, 0.04);
    const g: DachGefaelle = {
      ...echt, facetten: [A, B],
      linien: [{ art: "kehle", von: { x: 0, y: 0 }, bis: { x: 4, y: 2 }, ablaufIds: ["g", "g"] }],
    };
    const l = layoutInsulation(m, { dachflaechen: [g], hinweise: [] }, KAT);
    const b = l.befunde.filter((x) => x.code === "kehlkeil-nicht-im-katalog");
    expect(b.length).toBeGreaterThan(0);
    expect(b[0]!.meldung).toMatch(/^Kehlkeil nicht im Katalog/);
    expect(l.befunde.map((x) => x.code)).toContain("gefaelle-abweichend");
    expect(l.dachflaechen[0]!.platten.some((p) => p.art === "kehlkeil")).toBe(false);
    // Lückenlos trotz Zuschnitt
    expect(pruefeVerlegeplan(m, l, KAT).dachflaechen[0]!.luecken).toBeLessThan(0.01);
  });

  it("Tiefpunktdicke unter Typ 1 → Befund; höhere Vorgabe → Grundlage", () => {
    const m = projekt({ kontur: rechteck(3, 3), entwaesserung: [gully("g", 0, 0)], daemmdickeTiefpunkt: 10 });
    expect(layoutInsulation(m, computeSlope(m), KAT).befunde.map((b) => b.code)).toContain("tiefpunktdicke-unter-typ1");
    const m2 = projekt({ kontur: rechteck(3, 3), entwaesserung: [gully("g", 0, 0)], daemmdickeTiefpunkt: 60 });
    const s2 = computeSlope(m2);
    const l2 = layoutInsulation(m2, s2, KAT);
    expect(l2.dachflaechen[0]!.grundlage).toBeCloseTo(0.04, 12);
    const g = s2.dachflaechen[0]!;
    for (const p of l2.dachflaechen[0]!.platten) {
      for (const v of p.polygon.outer) expect(Math.abs(p.dicke.a * v.x + p.dicke.b * v.y + p.dicke.c - hoehenfeldDicke(g, v, 0.06))).toBeLessThan(MM);
    }
  });

  it("Abläufe mit unterschiedlicher Kote: Dicke folgt dem Höhenfeld", () => {
    const m = projekt({ kontur: rechteck(12, 6), entwaesserung: [gully("g1", 3, 3, 0), gully("g2", 9, 3, 0.03)] });
    const { s, l } = plan(m);
    expect(eckenStimmen(s, l)).toBeLessThan(MM);
    expect(pruefeVerlegeplan(m, l, KAT).ok).toBe(true);
  });

  it("Eigenschaft: Rechteck mit Gully → lückenlos, ohne Überlappung, Dicke ± 1 mm", () => {
    fc.assert(fc.property(
      fc.integer({ min: 2, max: 9 }), fc.integer({ min: 2, max: 7 }), fc.double({ min: 0.05, max: 0.95, noNaN: true }), fc.double({ min: 0.05, max: 0.95, noNaN: true }),
      (w, h, fx, fy) => {
        const m = projekt({ kontur: rechteck(w, h), entwaesserung: [gully("g", w * fx, h * fy)] });
        const { s, l } = plan(m);
        const r = pruefeVerlegeplan(m, l, KAT);
        return r.ok && eckenStimmen(s, l) < MM;
      },
    ), { numRuns: 15, seed: 4711 });
  });
});

describe("Schritt 25: Maß- und Lückenprüfung", () => {
  it("ganze Platten exakt im Katalogformat, Zuschnitte ≤ Rohplatte", () => {
    const { l } = plan(L_DACH);
    const pl = l.dachflaechen[0]!.platten;
    const ganze = pl.filter((p) => p.art === "platte" && !p.zuschnitt);
    expect(ganze.length).toBeGreaterThan(50);
    for (const p of ganze) { expect(p.laenge).toBeCloseTo(1, 9); expect(p.breite).toBeCloseTo(1, 9); expect(p.flaeche).toBe(1); }
    for (const p of pl) { expect(p.laenge).toBeLessThanOrEqual(1 + 1e-3); expect(p.breite).toBeLessThanOrEqual(1 + 1e-3); }
  });

  it("erkennt Lücke, Überlappung und falsches Plattenmaß", () => {
    const { l } = plan(L_DACH);
    const d = l.dachflaechen[0]!;
    const ohne = { ...l, dachflaechen: [{ ...d, platten: d.platten.filter((p) => !(p.art === "platte" && !p.zuschnitt)).slice(0) }] };
    const ganz = d.platten.find((p) => p.art === "platte" && !p.zuschnitt)!;
    const luecke = { ...l, dachflaechen: [{ ...d, platten: d.platten.filter((p) => p !== ganz) }] };
    const doppelt = { ...l, dachflaechen: [{ ...d, platten: [...d.platten, ganz] }] };
    const r1 = pruefeVerlegeplan(L_DACH, luecke, KAT);
    expect(r1.ok).toBe(false);
    expect(r1.befunde.map((b) => b.code).sort()).toEqual(["flaeche", "luecke"]);
    const r2 = pruefeVerlegeplan(L_DACH, doppelt, KAT);
    expect(r2.befunde.map((b) => b.code).sort()).toEqual(["flaeche", "ueberlappung"]);
    expect(pruefeVerlegeplan(L_DACH, ohne, KAT).ok).toBe(false);
    // Plattenformat im Katalog geändert → ganze Platten passen nicht mehr
    const raw = roh() as { daten: { format: { breite: number } } };
    raw.daten.format.breite = 1.2;
    const r3 = pruefeVerlegeplan(L_DACH, l, ladeKatalog(raw));
    expect(r3.befunde.some((b) => b.code === "platte-mass")).toBe(true);
  });

  it("Ergebnis deterministisch (Snapshot)", () => {
    const a = plan(L_DACH).l, b = plan(L_DACH).l;
    expect(b).toEqual(a);
    const d = a.dachflaechen[0]!;
    const zaehler: Record<string, number> = {};
    for (const p of d.platten) zaehler[p.bezeichnung] = (zaehler[p.bezeichnung] ?? 0) + 1;
    const r = pruefeVerlegeplan(L_DACH, a, KAT).dachflaechen[0]!;
    expect({
      platten: d.platten.length,
      ganze: r.ganzePlatten, zuschnitte: r.zuschnitte, kehlkeile: r.kehlkeile,
      flaeche: Math.round(r.plattenflaeche * 1e3) / 1e3,
      bezeichnungen: Object.fromEntries(Object.entries(zaehler).sort(([x], [y]) => x.localeCompare(y, "de"))),
      ids: d.platten.slice(0, 5).map((p) => p.id),
    }).toMatchSnapshot();
  });
});

describe("Schritt 26: Ø Gefälledämmung aus dem Plattenlayout", () => {
  it("Referenz-L-Dach: Ø laut Plattenlayout weicht höchstens 2 mm vom Höhenfeld-Wert ab", () => {
    const { s, l } = plan(L_DACH);
    const k = plattenDaemmdicke(l.dachflaechen[0]!)!;
    expect(k).not.toBeNull();
    expect(Math.abs(k.mittel - s.dachflaechen[0]!.daemmung!.mittel)).toBeLessThanOrEqual(2);
  });

  it("Referenz-L-Dach: keine Kehlkeile K7/K8 dort, wo die Fläche einfach weiter ansteigt", () => {
    const { l } = plan(L_DACH);
    const namen = new Set(l.dachflaechen[0]!.platten.map((p) => p.bezeichnung));
    expect(namen.has("K6 L") || namen.has("K6 R")).toBe(true);
    for (const n of ["K8 L", "K8 R"]) expect(namen.has(n)).toBe(false);
  });
});

describe("Schritt 27: 3D-Netz", () => {
  it("Dachfläche: Eckhöhen = Koten (Überhöhung 1×), Überhöhung skaliert nur z über dem Tiefpunkt", () => {
    const { s } = plan(L_DACH);
    const g = s.dachflaechen[0]!;
    const netz = meshDach(s, 1);
    for (const k of g.koten) {
      const v = netz.flatMap((f) => f.outer).find((q) => Math.hypot(q.x - k.position.x, q.y - k.position.y) < 1e-6);
      if (v) expect(Math.abs(v.z - k.kote)).toBeLessThan(MM);
    }
    const z5 = meshDach(s, 5).flatMap((f) => f.outer), z1 = netz.flatMap((f) => f.outer);
    z1.forEach((v, i) => expect(Math.abs(z5[i]!.z - (g.tiefpunkt!.kote + 5 * (v.z - g.tiefpunkt!.kote)))).toBeLessThan(1e-9));
  });
  it("Dämmplatten: Blockhöhe = Plattendicke, Oberseite liegt auf der Dachoberfläche", () => {
    const { s, l } = plan(L_DACH);
    const g = s.dachflaechen[0]!, d = l.dachflaechen[0]!, basis = daemmBasis(g, d);
    const platten = meshDaemmung(s, l, 1).filter((f) => f.art === "platte");
    expect(platten.length).toBe(d.platten.length);
    d.platten.forEach((p, i) => {
      for (const v of platten[i]!.outer) {
        expect(Math.abs(v.z - basis - (p.dicke.a * v.x + p.dicke.b * v.y + p.dicke.c))).toBeLessThan(MM);
        expect(Math.abs(v.z - hoeheDachflaeche(g, v))).toBeLessThan(0.003);
      }
    });
  });
});

