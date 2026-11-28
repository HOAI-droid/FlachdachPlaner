/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  computeSlope, createProject, hoeheAm, keilDickeAm, loadRulePack, polygonArea,
  type Dachflaeche, type DachGefaelle, type Entwaesserung, type Kontur, type ProjectModel, type RulePack,
  type SlopeOptionen, type Vec2,
} from "../src/core/index";

const packTexte = import.meta.glob("../rulepacks/*/pack.json", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;
const roh = (ordner: string) => JSON.parse(packTexte[`../rulepacks/${ordner}/pack.json`]!) as Record<string, unknown>;
function lade(raw: unknown): RulePack {
  const r = loadRulePack(raw);
  if (!r.ok) throw new Error(JSON.stringify(r.fehler));
  return r.pack;
}
const BAUDER = lade(roh("bauder-les"));
const DR_PLATZHALTER = lade(roh("dachreiter"));
/** Test-Pack mit frei gewählten Testmaßen (keine Herstellerwerte). */
const drPack = (geprueft: boolean): RulePack => lade({
  id: "test-dr", typ: "dachreiter", version: "1.0.0", quelle: "Test", ausgabe: "Test", gueltigAb: "2026-01-01", geprueft,
  daten: { eintraege: [{ id: "dr-1", hersteller: "Test", produkt: "Test-DR", art: "haupt", breite: 0.3, hoehe: 0.1, einbaulaenge: 0.4, einlaufhoehe: 0.01 }] },
});

const pt = (id: string, x: number, y: number) => ({ id, x, y });
const rechteck = (w: number, h: number): Kontur => [pt("k1", 0, 0), pt("k2", w, 0), pt("k3", w, h), pt("k4", 0, h)];
const les = (id: string, von: Vec2, bis: Vec2, z = 0, typ: { packId: string; eintragId: string } | null = { packId: "bauder-les", eintragId: "pir-t-les" }): Entwaesserung =>
  ({ id, art: "les", name: id, typ, von, bis, z });
const dachreiter = (id: string, kante: string, abstand: number, typ: { packId: string; eintragId: string } | null, z = 0): Entwaesserung =>
  ({ id, art: "dachreiter", name: id, typ, lage: { kante, abstand }, z });
const gully = (id: string, x: number, y: number, z = 0): Entwaesserung => ({ id, art: "gully", name: id, typ: null, position: { x, y }, z });

function projekt(dach: Partial<Dachflaeche> & Pick<Dachflaeche, "kontur" | "entwaesserung">, gefaelle = 0.02): ProjectModel {
  const d: Dachflaeche = { id: "d1", name: "Dach", typ: "dach", aufbauten: [], zonen: [], vorgaben: {}, attika: [], tuerschwellen: [], ...dach };
  return { ...createProject("Test", "2026-01-01T00:00:00Z"), gefaelleStandard: gefaelle, dachflaechen: [d] };
}
const opt: SlopeOptionen = { packs: [BAUDER, DR_PLATZHALTER, drPack(false)] };
const rechne = (m: ProjectModel, o: SlopeOptionen = opt) => computeSlope(m, o);
const erstes = (m: ProjectModel, o: SlopeOptionen = opt): DachGefaelle => rechne(m, o).dachflaechen[0]!;
const codes = (m: ProjectModel, o: SlopeOptionen = opt) => rechne(m, o).hinweise.map((h) => h.code).sort();
const summe = (g: DachGefaelle) => g.facetten.reduce((s, f) => s + f.flaeche, 0);
const MM = 0.001;

describe("LES 6 m (Bauder-Pack): Keil", () => {
  const m = projekt({ kontur: rechteck(20, 10), entwaesserung: [les("l1", { x: 7, y: 5 }, { x: 13, y: 5 })] });
  const g = erstes(m);
  const k = g.les[0]!;
  it("Keil 6,00 m × 1,50 m je Seite, Dicke 10 → 70 mm (± 1 mm)", () => {
    expect(g.les).toHaveLength(1);
    expect(k.laenge).toBeCloseTo(6, 9);
    expect(Math.abs(k.breiteJeSeite - 1.5)).toBeLessThan(MM);
    expect(Math.abs(k.dickeTief - 0.01)).toBeLessThan(MM);
    expect(Math.abs(k.dickeHoch - 0.07)).toBeLessThan(MM);
    expect(Math.abs(keilDickeAm(k, { x: 7, y: 5 }) - 0.01)).toBeLessThan(MM);
    expect(Math.abs(keilDickeAm(k, { x: 13, y: 5 }) - 0.07)).toBeLessThan(MM);
    expect(Math.abs(keilDickeAm(k, { x: 13, y: 6.5 }) - 0.01)).toBeLessThan(MM);
    expect(Math.abs(keilDickeAm(k, { x: 13, y: 3.5 }) - 0.01)).toBeLessThan(MM);
    for (const s of k.seiten) expect(s.flaechen.reduce((a, p) => a + polygonArea(p), 0)).toBeCloseTo(4.5, 4);
  });
  it("längs 1 %, quer 4 %", () => {
    for (let t = 0; t < 6; t++) expect(keilDickeAm(k, { x: 8 + t * 0.9, y: 5 }) - keilDickeAm(k, { x: 7 + t * 0.9, y: 5 })).toBeCloseTo(0.01 * 1, 9);
    expect(keilDickeAm(k, { x: 13, y: 5 }) - keilDickeAm(k, { x: 13, y: 6 })).toBeCloseTo(0.04, 9);
    expect(keilDickeAm(k, { x: 12, y: 4.5 }) - keilDickeAm(k, { x: 12, y: 4 })).toBeCloseTo(0.02, 9);
    // Dickenebenen der Seiten: Gradient (+1 % längs, ∓4 % quer)
    expect(k.seiten[0].dicke).toMatchObject({ a: 0.01, b: -0.04 });
    expect(k.seiten[1].dicke).toMatchObject({ a: 0.01, b: 0.04 });
  });
  it("außerhalb des Keils Dicke 0", () => {
    expect(keilDickeAm(k, { x: 6.9, y: 5 })).toBe(0);
    expect(keilDickeAm(k, { x: 13.1, y: 5 })).toBe(0);
    expect(keilDickeAm(k, { x: 10, y: 5.8 })).toBe(0); // Breite bei t = 3: 0,75 m
  });
  it("z am tieferen Ende, Gegenende aus Längsgefälle", () => {
    const h = erstes(projekt({ kontur: rechteck(20, 10), entwaesserung: [les("l1", { x: 7, y: 5 }, { x: 13, y: 5 }, -0.05)] })).les[0]!;
    expect(h.koteTief).toBeCloseTo(-0.05 + 0.01, 12);
    expect(h.koteHoch - h.koteTief).toBeCloseTo(0.01 * 6, 12);
    // Richtung zählt: von = tieferes Ende
    const r = erstes(projekt({ kontur: rechteck(20, 10), entwaesserung: [les("l1", { x: 13, y: 5 }, { x: 7, y: 5 })] })).les[0]!;
    expect(keilDickeAm(r, { x: 13, y: 5 })).toBeCloseTo(0.01, 12);
    expect(keilDickeAm(r, { x: 7, y: 5 })).toBeCloseTo(0.07, 12);
  });
  it("Hinweise: nur Pack ungeprüft (Maße stimmig, Länge = Pack)", () => {
    const r = rechne(m);
    expect(r.hinweise.map((h) => [h.code, h.objektId])).toEqual([["pack-ungeprueft", "l1"]]);
  });
});

describe("LES im Höhenfeld (Segment-Distanz)", () => {
  it("Facetten senkrecht zur LES; Kehle entlang der LES; Koten an beiden Enden = z", () => {
    const g = erstes(projekt({ kontur: rechteck(20, 10), entwaesserung: [les("l1", { x: 7, y: 5 }, { x: 13, y: 5 })] }));
    expect(summe(g)).toBeCloseTo(200, 3);
    const seitlich = g.facetten.filter((f) => f.seite === 1 || f.seite === 3);
    expect(seitlich).toHaveLength(2);
    for (const f of seitlich) expect(f.fallrichtung.x).toBeCloseTo(0, 12);
    expect(hoeheAm(g.feld, { x: 10, y: 9 })).toBeCloseTo(0.08, 12);
    expect(hoeheAm(g.feld, { x: 0, y: 5 })).toBeCloseTo(0.14, 12);
    expect(g.linien.some((l) => l.art === "kehle" && Math.abs(l.von.y - 5) < 1e-9 && Math.abs(l.bis.y - 5) < 1e-9
      && Math.abs(Math.abs(l.bis.x - l.von.x) - 6) < 1e-9)).toBe(true);
    for (const p of [{ x: 7, y: 5 }, { x: 13, y: 5 }]) {
      expect(g.koten.find((k) => Math.hypot(k.position.x - p.x, k.position.y - p.y) < 1e-9)).toMatchObject({ art: "ablauf", kote: 0 });
    }
  });
  it("schräge LES (30°): Seitenfacetten fallen senkrecht zur LES", () => {
    const w = Math.PI / 6, d = { x: Math.cos(w), y: Math.sin(w) };
    const von = { x: 10, y: 10 }, bis = { x: 10 + 6 * d.x, y: 10 + 6 * d.y };
    const g = erstes(projekt({ kontur: rechteck(30, 25), entwaesserung: [les("l1", von, bis)] }));
    const seitlich = g.facetten.filter((f) => f.seite === 1 || f.seite === 3);
    expect(seitlich.length).toBeGreaterThanOrEqual(2);
    for (const f of seitlich) expect(f.fallrichtung.x * d.x + f.fallrichtung.y * d.y).toBeCloseTo(0, 12);
    const mitte = { x: von.x + 3 * d.x - 2 * d.y, y: von.y + 3 * d.y + 2 * d.x };
    expect(hoeheAm(g.feld, mitte)).toBeCloseTo(0.04, 12);
    expect(summe(g)).toBeCloseTo(750, 2);
    const k = g.les[0]!;
    expect(keilDickeAm(k, bis)).toBeCloseTo(0.07, 12);
    expect(keilDickeAm(k, { x: bis.x - 1.5 * d.y, y: bis.y + 1.5 * d.x })).toBeCloseTo(0.01, 9);
  });
  it("LES und Gully: tieferer Ablauf zieht den Grat zu sich", () => {
    const a = erstes(projekt({ kontur: rechteck(30, 10), entwaesserung: [les("l1", { x: 2, y: 5 }, { x: 8, y: 5 }), gully("g1", 25, 5)] }));
    const b = erstes(projekt({ kontur: rechteck(30, 10), entwaesserung: [les("l1", { x: 2, y: 5 }, { x: 8, y: 5 }), gully("g1", 25, 5, -0.1)] }));
    const gratX = (g: DachGefaelle) => g.linien.find((l) => l.art === "grat" && Math.abs(l.von.x - l.bis.x) < 1e-9)!.von.x;
    expect(gratX(a)).toBeCloseTo(16.5, 9);
    expect(gratX(b)).toBeCloseTo(14, 9);
    expect(summe(b)).toBeCloseTo(300, 3);
  });
});

describe("LES: Gefälledämmung additiv, Pack-Abweichungen", () => {
  it("d_m enthält das Keilvolumen (2 × 4,5 m² × 30 mm Mittel = 0,27 m³)", () => {
    const ohne = erstes(projekt({ kontur: rechteck(20, 10), entwaesserung: [les("l1", { x: 7, y: 5 }, { x: 13, y: 5 }, 0, null)] }));
    const mit = erstes(projekt({ kontur: rechteck(20, 10), entwaesserung: [les("l1", { x: 7, y: 5 }, { x: 13, y: 5 })] }));
    expect(ohne.les).toEqual([]);
    expect(mit.daemmung!.mittel - ohne.daemmung!.mittel).toBeCloseTo((1000 * 0.27) / 200, 3);
    expect(mit.daemmung!.max).toBeCloseTo(ohne.daemmung!.max, 9); // Ecken (140 mm) höher als Keil
  });
  it("Max. Dicke am hohen Keilende, wenn der Keil überwiegt", () => {
    const g = erstes(projekt({ kontur: rechteck(14, 4), entwaesserung: [les("l1", { x: 4, y: 2 }, { x: 10, y: 2 })] }, 0.01));
    expect(g.daemmung!.max).toBeCloseTo(70, 3);
    expect(g.hochpunkt!.kote).toBeCloseTo(0.04, 12); // HP der Gefälledämmung ohne Keil
  });
  it("ohne Produkt → les-typ-fehlt, Höhenfeld trotzdem", () => {
    const m = projekt({ kontur: rechteck(20, 10), entwaesserung: [les("l1", { x: 7, y: 5 }, { x: 13, y: 5 }, 0, null)] });
    expect(codes(m)).toEqual(["les-typ-fehlt"]);
    expect(summe(erstes(m))).toBeCloseTo(200, 3);
  });
  it("Länge ≠ Pack → Hinweis, Keil aus Gefällen (4 m: 1,00 m, 50 mm); über Systemlänge → Hinweis", () => {
    const m = projekt({ kontur: rechteck(20, 10), entwaesserung: [les("l1", { x: 7, y: 5 }, { x: 11, y: 5 })] });
    expect(codes(m)).toEqual(["les-laenge-abweichend", "pack-ungeprueft"]);
    const k = erstes(m).les[0]!;
    expect(k.breiteJeSeite).toBeCloseTo(1, 9);
    expect(k.dickeHoch).toBeCloseTo(0.05, 9);
    const lang = projekt({ kontur: rechteck(20, 10), entwaesserung: [les("l1", { x: 2, y: 5 }, { x: 13, y: 5 })] });
    expect(codes(lang)).toEqual(["les-laenge-abweichend", "les-zu-lang", "pack-ungeprueft"]);
  });
  it("in sich widersprüchliches Pack → les-pack-inkonsistent; geprüftes Pack → kein Ungeprüft-Hinweis", () => {
    const raw = structuredClone(roh("bauder-les")) as { geprueft: boolean; daten: { eintraege: { keil: { breiteJeSeite: number } }[] } };
    raw.daten.eintraege[0]!.keil.breiteJeSeite = 1.2;
    raw.geprueft = true;
    const m = projekt({ kontur: rechteck(20, 10), entwaesserung: [les("l1", { x: 7, y: 5 }, { x: 13, y: 5 })] });
    expect(codes(m, { packs: [lade(raw)] })).toEqual(["les-pack-inkonsistent"]);
  });
  it("LES ohne Länge → Punktablauf + Hinweis; LES außerhalb → Hinweis", () => {
    const m = projekt({ kontur: rechteck(20, 10), entwaesserung: [les("l1", { x: 7, y: 5 }, { x: 7, y: 5 })] });
    expect(codes(m)).toEqual(["les-laenge-null"]);
    expect(erstes(m).facetten).toHaveLength(4);
    const aus = projekt({ kontur: rechteck(20, 10), entwaesserung: [les("l1", { x: 17, y: 5 }, { x: 23, y: 5 })] });
    expect(codes(aus)).toContain("ablauf-ausserhalb");
  });
});

describe("Dachreiter (Randquelle)", () => {
  const ref = { packId: "test-dr", eintragId: "dr-1" };
  it("Maße aus Pack: Öffnung 0,30 m mittig auf der Kante, Pack-Eintrag unverändert im Ergebnis", () => {
    const m = projekt({ kontur: rechteck(20, 10), entwaesserung: [dachreiter("r1", "k1", 10, ref)] });
    const g = erstes(m);
    const d = g.dachreiter[0]!;
    const eintrag = (drPack(false) as Extract<RulePack, { typ: "dachreiter" }>).daten.eintraege[0];
    expect(d.masse).toEqual(eintrag);
    expect(d.breite).toBeCloseTo(0.3, 12);
    expect(d.von.x).toBeCloseTo(9.85, 12);
    expect(d.bis.x).toBeCloseTo(10.15, 12);
    expect(d.mitte).toEqual({ x: 10, y: 0 });
    expect(hoeheAm(g.feld, { x: 10, y: 0 })).toBe(0);
    expect(hoeheAm(g.feld, { x: 10.1, y: 2 })).toBeCloseTo(0.04, 12);
    expect(hoeheAm(g.feld, { x: 0, y: 0 })).toBeCloseTo(0.02 * 9.85, 12);
    expect(summe(g)).toBeCloseTo(200, 3);
    expect(g.facetten.some((f) => Math.abs(f.fallrichtung.y + 1) < 1e-12)).toBe(true); // fällt senkrecht zur Kante
    expect(codes(m)).toEqual(["pack-ungeprueft"]);
  });
  it("geprüftes Pack → kein Hinweis", () => {
    const m = projekt({ kontur: rechteck(20, 10), entwaesserung: [dachreiter("r1", "k1", 10, ref)] });
    expect(codes(m, { packs: [drPack(true)] })).toEqual([]);
  });
  it("Maße fehlen (Platzhalter-Pack, kein Typ) → Randpunkt + Hinweis, keine erfundenen Werte", () => {
    for (const typ of [{ packId: "dachreiter", eintragId: "gibt-es-nicht" }, null]) {
      const m = projekt({ kontur: rechteck(20, 10), entwaesserung: [dachreiter("r1", "k2", 4, typ)] });
      const g = erstes(m);
      expect(codes(m)).toEqual(["dachreiter-masse-fehlen"]);
      expect(g.dachreiter[0]).toMatchObject({ masse: null, breite: 0, von: { x: 20, y: 4 }, bis: { x: 20, y: 4 } });
      expect(hoeheAm(g.feld, { x: 20, y: 4 })).toBe(0);
      expect(hoeheAm(g.feld, { x: 0, y: 4 })).toBeCloseTo(0.4, 12);
      expect(summe(g)).toBeCloseTo(200, 3);
    }
  });
  it("Lage ungültig → Hinweis, nicht berücksichtigt; Öffnung über Kantenende → begrenzt + Hinweis", () => {
    const m = projekt({ kontur: rechteck(20, 10), entwaesserung: [dachreiter("r1", "xx", 1, ref)] });
    expect(codes(m)).toEqual(["dachreiter-lage-ungueltig", "keine-ablaeufe"]);
    const rand = projekt({ kontur: rechteck(20, 10), entwaesserung: [dachreiter("r1", "k1", 0.05, ref)] });
    expect(codes(rand)).toEqual(["dachreiter-lage-ungueltig", "pack-ungeprueft"]);
    expect(erstes(rand).dachreiter[0]!.breite).toBeCloseTo(0.2, 12);
  });
  it("z des Dachreiters verschiebt Koten", () => {
    const g = erstes(projekt({ kontur: rechteck(20, 10), entwaesserung: [dachreiter("r1", "k1", 10, ref, -0.03)] }));
    expect(g.tiefpunkt!.kote).toBeCloseTo(-0.03, 12);
    expect(hoeheAm(g.feld, { x: 10, y: 2 })).toBeCloseTo(0.01, 12);
  });
});

// ---------- Eigenschaften ----------

const zahl = (min: number, max: number) => fc.double({ min, max, noNaN: true, noDefaultInfinity: true });
const lesFall = fc.record({
  w: zahl(12, 40), h: zahl(8, 30), fx: zahl(0.1, 0.9), fy: zahl(0.1, 0.9), winkel: zahl(0, 2 * Math.PI), l: zahl(1, 10),
  z: zahl(-0.1, 0.1), s: zahl(0.01, 0.05), gfx: zahl(0.05, 0.95), gfy: zahl(0.05, 0.95), gz: zahl(-0.1, 0.1),
});

describe("Eigenschaften LES", () => {
  it("Facetten partitionieren das Dach, Koten = Höhenfeld, Seitenfacetten ⟂ LES, d_TP ≤ d_m ≤ Max, Keildicke im Bereich", () => {
    fc.assert(fc.property(lesFall, (f) => {
      const d = { x: Math.cos(f.winkel), y: Math.sin(f.winkel) };
      const von = { x: f.fx * f.w, y: f.fy * f.h };
      const bis = { x: von.x + f.l * d.x, y: von.y + f.l * d.y };
      const m = projekt({ kontur: rechteck(f.w, f.h), entwaesserung: [les("l1", von, bis, f.z), gully("g1", f.gfx * f.w, f.gfy * f.h, f.gz)] }, f.s);
      const g = erstes(m);
      expect(Math.abs(summe(g) - f.w * f.h)).toBeLessThan(0.01);
      for (const k of g.koten) expect(k.kote).toBeCloseTo(hoeheAm(g.feld, k.position), 9);
      for (const x of g.facetten.filter((x) => x.ablaufId === "l1" && x.seite % 2 === 1)) {
        expect(Math.abs(x.fallrichtung.x * d.x + x.fallrichtung.y * d.y)).toBeLessThan(1e-9);
      }
      const dm = g.daemmung!;
      expect(dm.mittel).toBeGreaterThanOrEqual(dm.min - 1e-9);
      expect(dm.mittel).toBeLessThanOrEqual(dm.max + 1e-9);
      const k = g.les[0]!;
      for (const u of [0, 0.3, 0.7, 1]) {
        const p = { x: von.x + u * f.l * d.x, y: von.y + u * f.l * d.y };
        expect(keilDickeAm(k, p)).toBeCloseTo(k.dickeTief + k.gefaelleLaengs * u * f.l, 9);
        const rand = { x: p.x - d.y * u * k.breiteJeSeite, y: p.y + d.x * u * k.breiteJeSeite };
        expect(keilDickeAm(k, rand)).toBeCloseTo(k.dickeTief, 9);
      }
    }), { numRuns: 80 });
  });
  it("deterministisch", () => {
    const m = projekt({ kontur: rechteck(20, 10), entwaesserung: [les("l1", { x: 3, y: 2 }, { x: 8, y: 6 }), dachreiter("r1", "k3", 5, { packId: "test-dr", eintragId: "dr-1" })] });
    expect(JSON.stringify(rechne(m))).toBe(JSON.stringify(rechne(m)));
  });
});
