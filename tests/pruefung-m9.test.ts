/// <reference types="vite/client" />
/** PLAN M9 Schritt 44: Prüfregeln auf Basis computeAnschluesse / computeNotwasserstaende. */
import { describe, expect, it } from "vitest";
import {
  computeAnschluesse, computeSlope, createProject, loadRulePack, okFertigAm, runChecks,
  type Befund, type Dachflaeche, type EmergencyEstimate, type Entwaesserung, type Kontur, type ProjectModel, type RulePack,
  type Tuerschwelle, type Vec2, type Wandanschluss,
} from "../src/core/index";

const lade = (roh: unknown): RulePack => {
  const r = loadRulePack(roh);
  if (!r.ok) throw new Error(JSON.stringify(r.fehler));
  return r.pack;
};
const kopf = { version: "1.0.0", quelle: "Testregelwerk", ausgabe: "Test", gueltigAb: "2026-01-01", geprueft: true };
const p = (wert: number) => ({ wert, einheit: "m" });
interface Soll { attikaMin?: number; wandMin?: number; tuerMin?: number; tuerMitRinneMin?: number; aufbauMin?: number; freibordNot?: number; bfMin?: number }
/** Testwerte frei gewählt (entsprechen F3-Vermutung, ungeprüft). */
function regelPack(s: Soll = {}, ohne: readonly string[] = []): RulePack {
  const anschluss: Record<string, { wert: number; einheit: string }> = {};
  const werte = { attikaMin: 0.15, wandMin: 0.15, tuerMin: 0.15, tuerMitRinneMin: 0.05, aufbauMin: 0.15, ...s };
  for (const k of ["attikaMin", "wandMin", "tuerMin", "tuerMitRinneMin", "aufbauMin"] as const) if (!ohne.includes(k)) anschluss[k] = p(werte[k]);
  return lade({ id: "test-regeln", typ: "regeln", ...kopf, daten: { regeln: [
    { id: "anschlusshoehe", titel: "A", fundstelle: "S. 2", parameter: anschluss },
    { id: "notentwaesserung-anstau", titel: "N", parameter: { max: p(0.035), freibordNot: p(s.freibordNot ?? 0), ueberfallbeiwert: { wert: 0.6, einheit: "1" } } },
    { id: "barrierefrei-schwelle", titel: "B", parameter: { sicherheitsbeiwertNot: { wert: 2, einheit: "1" },
      maxAbstandEntwaesserung: p(10), ueberflutungskanteUnterOkFk: p(0.05), anschlusshoeheMin: p(s.bfMin ?? 0.05) } },
  ] } });
}
const ABL = lade({ id: "t-ab", typ: "ablaeufe", ...kopf, daten: { eintraege: [
  { id: "na", hersteller: "T", produkt: "Notablauf", art: "notablauf", wehrhoehe: 0.03, anstauBeiQ: 0.03, abflussleistung: [{ anstau: 0.035, q: 6 }] },
  { id: "na-ohne", hersteller: "T", produkt: "Notablauf ohne Wehrhöhe", art: "notablauf", abflussleistung: [{ anstau: 0.035, q: 6 }] },
] } });
const DR = lade({ id: "t-dr", typ: "dachreiter", ...kopf, daten: { eintraege: [
  { id: "sp", hersteller: "T", produkt: "Speier", art: "not", breite: 0.3, hoehe: 0.1, einbaulaenge: 0.4, einlaufhoehe: 0.035, ueberlaufBreite: 0.3 },
] } });
const PACKS = [regelPack(), ABL, DR];

const pt = (id: string, x: number, y: number) => ({ id, x, y });
const rechteck = (pre: string, w: number, h: number, x0 = 0, y0 = 0): Kontur =>
  [pt(`${pre}1`, x0, y0), pt(`${pre}2`, x0 + w, y0), pt(`${pre}3`, x0 + w, y0 + h), pt(`${pre}4`, x0, y0 + h)];
const gully = (id: string, x: number, y: number, z = 0): Entwaesserung => ({ id, art: "gully", name: id, typ: null, position: { x, y }, z });
const notablauf = (id: string, x: number, y: number, z = 0, eintrag: string | null = "na", ueberlaufKante?: number): Entwaesserung => ({
  id, art: "notablauf", name: id, typ: eintrag ? { packId: "t-ab", eintragId: eintrag } : null, position: { x, y }, z,
  ...(ueberlaufKante !== undefined ? { ueberlaufKante } : {}),
});
const tuer = (x: Partial<Tuerschwelle> = {}): Tuerschwelle =>
  ({ id: "t1", name: "Tür", lage: { kante: "k1", abstand: 9 }, breite: 2, barrierefrei: false, ...x });
const wand = (x: Partial<Wandanschluss> = {}): Wandanschluss => ({ id: "w1", name: "Wand", lage: { kante: "k2", abstand: 0 }, laenge: 10, ...x });

function dach(x: Partial<Dachflaeche> = {}): Dachflaeche {
  return {
    id: "d1", name: "Dach", typ: "dach", aufbauten: [], zonen: [], vorgaben: {}, attika: [], tuerschwellen: [],
    kontur: rechteck("k", 20, 10), entwaesserung: [gully("g1", 10, 5)], ...x,
  };
}
const projekt = (...d: Dachflaeche[]): ProjectModel =>
  ({ ...createProject("Test", "2026-01-01T00:00:00Z"), gefaelleStandard: 0.02, dachflaechen: d.length ? d : [dach()] });

const NEUE_CODES = /^(anschlusshoehe-|attika-oberkante|wand-oberkante|schwelle-oberkante|aufbau-oberkante|notentwaesserung-|notwasserstand-|barrierefrei-)/;
function pruefe(m: ProjectModel, packs: readonly RulePack[] = PACKS, notfall?: readonly EmergencyEstimate[]): Befund[] {
  const b = runChecks(m, { slope: computeSlope(m, { packs }), ...(notfall ? { notfall } : {}) }, packs);
  for (const x of b) {
    expect(x.regelId, x.meldung).toMatch(/\S/);
    expect(x.quelle, x.meldung).toMatch(/\S/);
    if (NEUE_CODES.test(x.code) || (x.code === "regel-fehlt" && x.regelId === "anschlusshoehe")) expect(x.ort, `${x.code}: ort`).toBeDefined();
  }
  return b;
}
const code = (b: Befund[], c: string) => b.filter((x) => x.code === c);
const anschlussBefunde = (b: Befund[]) => b.filter((x) => x.code.startsWith("anschlusshoehe-") || x.code.endsWith("-oberkante-fehlt"));

describe("Schritt 44: Anschlusshöhen", () => {
  it("Attika: OK 0,40 ok; OK 0,30 → Fehler 50 mm an der Ecke mit regelId/quelle/ort", () => {
    expect(anschlussBefunde(pruefe(projekt(dach({ attika: [{ id: "at1", kante: "k1", breite: 0.3, oberkante: 0.4 }] }))))).toEqual([]);
    const b = code(pruefe(projekt(dach({ attika: [{ id: "at1", kante: "k1", breite: 0.3, oberkante: 0.3 }] }))), "anschlusshoehe-attika");
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ stufe: "fehler", objektId: "at1", dachflaecheId: "d1", regelId: "anschlusshoehe", quelle: "Testregelwerk, S. 2" });
    expect(b[0]!.differenz).toBeCloseTo(0.05, 9);
    expect([0, 20]).toContain(b[0]!.ort!.x);
    expect(b[0]!.meldung).toContain("erforderliche OK +0.350 m");
  });

  it("attikaMin 0,10 statt 0,15 ändert den Befund (OK 0,32 → vorhanden 120 mm)", () => {
    const m = projekt(dach({ attika: [{ id: "at1", kante: "k1", breite: 0.3, oberkante: 0.32 }] }));
    expect(code(pruefe(m), "anschlusshoehe-attika")).toHaveLength(1);
    expect(code(pruefe(m, [regelPack({ attikaMin: 0.1 }), ABL]), "anschlusshoehe-attika")).toEqual([]);
  });

  it("Wandanschluss: OK 0,40 ok; OK 0,30 → anschlusshoehe-wand 50 mm; ohne OK → Hinweis mit erforderlicher OK", () => {
    expect(anschlussBefunde(pruefe(projekt(dach({ wandanschluesse: [wand({ oberkante: 0.4 })] }))))).toEqual([]);
    const b = code(pruefe(projekt(dach({ wandanschluesse: [wand({ oberkante: 0.3 })] }))), "anschlusshoehe-wand");
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ stufe: "fehler", objektId: "w1", regelId: "anschlusshoehe" });
    expect(b[0]!.differenz).toBeCloseTo(0.05, 9);
    expect(b[0]!.ort!.x).toBeCloseTo(20, 9);
    expect(b[0]!.meldung).toContain("Wandanschluss Wand");
    const h = code(pruefe(projekt(dach({ wandanschluesse: [wand()] }))), "wand-oberkante-fehlt");
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ stufe: "hinweis", objektId: "w1" });
    expect(h[0]!.grenze).toBeCloseTo(0.35, 9);
    expect(h[0]!.meldung).toContain("Erforderliche OK +0.350 m");
  });

  it("Aufbau: OK 0,30 ok (OK fertig max 0,12); OK 0,25 → anschlusshoehe-aufbau 20 mm; ohne OK → keine Prüfung (R14)", () => {
    const au = (oberkante?: number) => projekt(dach({ aufbauten: [{ id: "au1", name: "Lichtkuppel", kontur: rechteck("a", 2, 2, 14, 4),
      ...(oberkante !== undefined ? { oberkante } : {}) }] }));
    expect(anschlussBefunde(pruefe(au(0.3)))).toEqual([]);
    const b = code(pruefe(au(0.25)), "anschlusshoehe-aufbau");
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ stufe: "fehler", objektId: "au1", regelId: "anschlusshoehe" });
    expect(b[0]!.differenz).toBeCloseTo(0.02, 9);
    expect(b[0]!.ort!.x).toBeCloseTo(16, 9);
    expect(anschlussBefunde(pruefe(au()))).toEqual([]);
  });

  it("Tür mit Rinne (tuerMitRinneMin): OK 0,16 ok mit Rinne, Fehler ohne Rinne; OK 0,14 mit Rinne → 10 mm", () => {
    expect(anschlussBefunde(pruefe(projekt(dach({ tuerschwellen: [tuer({ oberkante: 0.16, rinne: true })] }))))).toEqual([]);
    expect(code(pruefe(projekt(dach({ tuerschwellen: [tuer({ oberkante: 0.16 })] }))), "anschlusshoehe-tuer")).toHaveLength(1);
    const b = code(pruefe(projekt(dach({ tuerschwellen: [tuer({ oberkante: 0.14, rinne: true })] }))), "anschlusshoehe-tuer");
    expect(b).toHaveLength(1);
    expect(b[0]!.differenz).toBeCloseTo(0.01, 9);
    expect(b[0]!.meldung).toContain("mit Rinne");
    expect(b[0]!.ort!.y).toBeCloseTo(0, 9);
  });

  it("Tür ohne OK → Hinweis schwelle-oberkante-fehlt mit erforderlicher OK; mit OK kein Hinweis", () => {
    const h = code(pruefe(projekt(dach({ tuerschwellen: [tuer()] }))), "schwelle-oberkante-fehlt");
    expect(h).toHaveLength(1);
    expect(h[0]!.grenze).toBeCloseTo(0.25, 9);
    expect(code(pruefe(projekt(dach({ tuerschwellen: [tuer({ oberkante: 0.3 })] }))), "schwelle-oberkante-fehlt")).toEqual([]);
  });

  it("fehlende Regel (wandMin fehlt) → Hinweis „Regel anschlusshoehe fehlt im Pack“ einmalig; vorhandene Regel prüft weiter", () => {
    const packs = [regelPack({}, ["wandMin"]), ABL];
    const m = projekt(dach({ wandanschluesse: [wand({ oberkante: 0.1 }), wand({ id: "w2", lage: { kante: "k4", abstand: 0 } })],
      attika: [{ id: "at1", kante: "k1", breite: 0.3, oberkante: 0.3 }] }));
    const b = pruefe(m, packs);
    const f = code(b, "regel-fehlt").filter((x) => x.regelId === "anschlusshoehe");
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ stufe: "hinweis", objektId: null });
    expect(f[0]!.meldung).toContain("Regel anschlusshoehe fehlt im Pack");
    expect(code(b, "anschlusshoehe-wand")).toEqual([]);
    expect(code(b, "anschlusshoehe-attika")).toHaveLength(1);
    // vollständige Regel → kein Hinweis
    expect(code(pruefe(m), "regel-fehlt").filter((x) => x.regelId === "anschlusshoehe")).toEqual([]);
  });
});

describe("Schritt 44: Notentwässerung (Schätzung)", () => {
  it("Kante ≤ höchste Hauptablauf-Kote → Warnung „springt vor der Hauptentwässerung an“; Kante darüber → nichts", () => {
    const m = (k: number) => projekt(dach({ entwaesserung: [gully("g1", 10, 5), gully("g2", 4, 5, 0.02), notablauf("n1", 18, 5, 0, null, k)] }));
    const b = code(pruefe(m(0.02)), "notentwaesserung-vor-haupt");
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ stufe: "warnung", objektId: "n1", regelId: "notentwaesserung-kante", ort: { x: 18, y: 5 } });
    expect(b[0]!.meldung).toContain("springt vor der Hauptentwässerung an");
    expect(b[0]!.quelle).toContain("Nutzereingabe");
    expect(code(pruefe(m(0.03)), "notentwaesserung-vor-haupt")).toEqual([]);
  });

  it("Kante − z_TP > Anstau max → Warnung; ≤ max → nichts", () => {
    const m = (k: number) => projekt(dach({ entwaesserung: [gully("g1", 10, 5), notablauf("n1", 18, 5, 0, null, k)] }));
    const b = code(pruefe(m(0.05)), "notentwaesserung-anstau");
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ stufe: "warnung", objektId: "n1", regelId: "notentwaesserung-anstau", quelle: expect.stringContaining("Testregelwerk") });
    expect(b[0]!.differenz).toBeCloseTo(0.015, 9);
    expect(code(pruefe(m(0.03)), "notentwaesserung-anstau")).toEqual([]);
  });

  it("W + freibordNot > OK Anschluss → Fehler „Notwasserstand erreicht Anschluss“ (Schätzung); darunter → nichts", () => {
    // Kante 0,20 (Nutzer) + Anstau Produkt 0,03 = W 0,23; Tür mit Rinne OK 0,25 (Anschlusshöhe 150 mm ≥ 50 mm)
    const m = (ok: number) => projekt(dach({ tuerschwellen: [tuer({ oberkante: ok, rinne: true })],
      entwaesserung: [gully("g1", 10, 5), notablauf("n1", 18, 5, 0, "na", 0.2)] }));
    expect(code(pruefe(m(0.25)), "notwasserstand-anschluss")).toEqual([]);
    const b = code(pruefe(m(0.22)), "notwasserstand-anschluss");
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ stufe: "fehler", objektId: "t1", regelId: "notentwaesserung-anstau" });
    expect(b[0]!.meldung).toContain("Notwasserstand erreicht Anschluss Türschwelle Tür");
    expect(b[0]!.meldung).toContain("Schätzung");
    expect(b[0]!.quelle).toContain("Schätzung");
    expect(b[0]!.differenz).toBeCloseTo(0.01, 9);
    expect(b[0]!.ort!.y).toBeCloseTo(0, 9);
    // Freibord 0,03 aus dem Pack: 0,23 + 0,03 > 0,25 → Fehler
    expect(code(pruefe(m(0.25), [regelPack({ freibordNot: 0.03 }), ABL]), "notwasserstand-anschluss")).toHaveLength(1);
  });

  it("Speier: W aus übergebener Notentwässerungs-Schätzung (Poleni) erreicht Attika", () => {
    const m = projekt(dach({ attika: [{ id: "at1", kante: "k3", breite: 0.3, oberkante: 0.36 }],
      entwaesserung: [gully("g1", 10, 5), { id: "s1", art: "dachreiter", name: "s1", typ: { packId: "t-dr", eintragId: "sp" }, lage: { kante: "k1", abstand: 10 }, z: 0.25 }] }));
    const e = (q: number): EmergencyEstimate => ({ einzugsflaecheId: "e1", dachflaecheId: "d1", ablaufId: "g1", flaeche: 200,
      r: null, c: null, q, sicherheitsbeiwert: 2, anstau: null, qAblauf: null, anzahl: null, bereich: [] });
    // Kante 0,285; Q_not = 7,95 l/s → h_ü ≈ 60,7 mm → W ≈ 0,346 < 0,36
    expect(code(pruefe(m, PACKS, [e(7.95 / 2)]), "notwasserstand-anschluss")).toEqual([]);
    // Q_not = 15 l/s → h_ü ≈ 92 mm → W ≈ 0,377 > 0,36
    expect(code(pruefe(m, PACKS, [e(7.5)]), "notwasserstand-anschluss").map((x) => x.objektId)).toEqual(["at1"]);
  });

  it("barrierefrei-ueberflutungskante nutzt dieselbe Kante inkl. Nutzerwert", () => {
    const bf = tuer({ barrierefrei: true, oberkante: 0.2 });
    const m = (eintrag: string | null, k?: number) => projekt(dach({ tuerschwellen: [bf], entwaesserung: [gully("g1", 10, 5), notablauf("n1", 18, 5, 0, eintrag, k)] }));
    // ohne Produkt, Nutzerkante 0,12 → 80 mm unter OK: ok (keine Warnung „Kante unbekannt“)
    expect(pruefe(m(null, 0.12)).filter((x) => x.regelId === "barrierefrei-schwelle")).toEqual([]);
    const b = code(pruefe(m(null, 0.17)), "barrierefrei-ueberflutungskante");
    expect(b).toHaveLength(1);
    expect(b[0]!.differenz).toBeCloseTo(0.02, 9);
    expect(b[0]!.quelle).toContain("Nutzereingabe");
    expect(b[0]!.ort).toEqual({ x: 18, y: 5 });
    // Pack-Kante 0,03 wird durch Nutzerwert 0,17 überschrieben
    expect(code(pruefe(m("na", 0.17)), "barrierefrei-ueberflutungskante")).toHaveLength(1);
    expect(code(pruefe(m("na")), "barrierefrei-ueberflutungskante")).toEqual([]);
  });
});

describe("Schritt 44: Randfälle", () => {
  it("leere Dachfläche (keine Kontur, keine Abläufe) → keine Anschluss-/Not-Befunde, kein Absturz", () => {
    const m = projekt(dach({ kontur: [], entwaesserung: [], attika: [{ id: "at1", kante: "k1", breite: 0.3, oberkante: 0 }] }));
    expect(pruefe(m).filter((x) => NEUE_CODES.test(x.code))).toEqual([]);
  });

  it("Dachfläche ohne Höhenquellen (nur Notablauf) → keine Anschlussprüfung, keine Not-Warnungen", () => {
    const m = projekt(dach({ entwaesserung: [notablauf("n1", 18, 5, 0, "na", 0)], tuerschwellen: [tuer({ oberkante: 0 })],
      attika: [{ id: "at1", kante: "k1", breite: 0.3, oberkante: 0 }] }));
    expect(pruefe(m).filter((x) => NEUE_CODES.test(x.code))).toEqual([]);
  });

  it("Anschluss der Länge 0 (Wand/Tür) → kein Anschluss-Befund", () => {
    const m = projekt(dach({ wandanschluesse: [wand({ laenge: 0, oberkante: 0 })], tuerschwellen: [tuer({ breite: 0, oberkante: 0 })] }));
    expect(anschlussBefunde(pruefe(m))).toEqual([]);
  });

  it("Notablauf ohne Wehrhöhe → Kante unbekannt: keine Not-Warnung, barrierefrei meldet „Kante unbekannt“", () => {
    const m = (bf: boolean) => projekt(dach({ tuerschwellen: [tuer({ barrierefrei: bf, oberkante: 0.2 })],
      entwaesserung: [gully("g1", 10, 5), notablauf("n1", 18, 5, 0, "na-ohne")] }));
    expect(pruefe(m(false)).filter((x) => /^(notentwaesserung-|notwasserstand-)/.test(x.code))).toEqual([]);
    const b = code(pruefe(m(true)), "notentwaesserung-kante-unbekannt");
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ stufe: "warnung", objektId: "n1", ort: { x: 18, y: 5 } });
  });

  it("mehrere Dachflächen: Notwasserstand wirkt nur auf Anschlüsse derselben Dachfläche", () => {
    const d1 = dach({ tuerschwellen: [tuer({ oberkante: 0.12, rinne: true })] }); // W hier unbekannt (kein Notelement)
    const d2 = dach({ id: "d2", kontur: rechteck("m", 20, 10, 30, 0), entwaesserung: [gully("g2", 40, 5), notablauf("n2", 48, 5, 0, "na", 0.2)],
      attika: [{ id: "at2", kante: "m1", breite: 0.3, oberkante: 0.22 }] });
    const b = pruefe(projekt(d1, d2));
    expect(code(b, "notwasserstand-anschluss").map((x) => [x.objektId, x.dachflaecheId])).toEqual([["at2", "d2"]]);
    expect(code(b, "anschlusshoehe-attika").map((x) => x.dachflaecheId)).toEqual(["d2"]);
    expect(code(b, "notentwaesserung-anstau").map((x) => x.dachflaecheId)).toEqual(["d2"]);
  });

  it("Attika auf Knickkante (Grat in Kantenmitte): Maximum und ort an der Gratstelle", () => {
    const m = projekt(dach({ entwaesserung: [gully("g1", 2, 5), gully("g2", 18, 5)], attika: [{ id: "at1", kante: "k1", breite: 0.3, oberkante: 0.3 }] }));
    const b = code(pruefe(m), "anschlusshoehe-attika");
    expect(b).toHaveLength(1);
    expect(b[0]!.ort!.x).toBeCloseTo(10, 9);
    expect(b[0]!.wert).toBeCloseTo(0.14, 9); // OK fertig max 0,16
  });

  it("Tür-Teilstrecke über Zonengrenze: Befund an der höchsten Stelle, exakt ≥ Abtastung", () => {
    const zone = { id: "z1", name: "Stufe", kontur: rechteck("z", 10, 10, 10, 0), hoehenversatz: 0.05 };
    const m = projekt(dach({ zonen: [zone], tuerschwellen: [tuer({ oberkante: 0.2 })] }));
    const s = computeSlope(m, { packs: PACKS });
    const an = computeAnschluesse(m, s, PACKS).find((x) => x.objektId === "t1")!;
    const b = code(pruefe(m), "anschlusshoehe-tuer");
    expect(b).toHaveLength(1);
    expect(b[0]!.ort).toEqual(an.ort);
    expect(b[0]!.wert).toBeCloseTo(0.2 - an.okFertigMax, 12);
    expect(an.ort.x).toBeGreaterThanOrEqual(10 - 1e-9); // höherer Zonenteil
    let h = -Infinity;
    for (let k = 0; k <= 200; k++) {
      const q: Vec2 = { x: 9 + k * 0.01, y: 0 };
      h = Math.max(h, okFertigAm(m.dachflaechen[0]!, s.dachflaechen[0]!, q));
    }
    expect(an.okFertigMax).toBeGreaterThanOrEqual(h - 1e-9);
  });

  it("Rinne + barrierefrei: Sollwert aus barrierefrei-schwelle hat Vorrang", () => {
    const packs = [regelPack({ bfMin: 0.02 }), ABL];
    const m = (x: Partial<Tuerschwelle>) => projekt(dach({ tuerschwellen: [tuer({ oberkante: 0.13, ...x })],
      entwaesserung: [gully("g1", 10, 5), notablauf("n1", 18, 5, 0, "na")] }));
    expect(code(pruefe(m({ rinne: true, barrierefrei: true }), packs), "anschlusshoehe-tuer")).toEqual([]);
    const r = code(pruefe(m({ rinne: true }), packs), "anschlusshoehe-tuer");
    expect(r).toHaveLength(1);
    expect(r[0]!.regelId).toBe("anschlusshoehe");
    const bf = code(pruefe(m({ rinne: true, barrierefrei: true, oberkante: 0.11 }), packs), "anschlusshoehe-tuer");
    expect(bf).toHaveLength(1);
    expect(bf[0]).toMatchObject({ regelId: "barrierefrei-schwelle" });
    expect(bf[0]!.meldung).toContain("(barrierefrei)");
  });
});
