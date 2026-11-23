import { describe, expect, it } from "vitest";
import {
  attikaStreifen, ausfuehren, computeCatchments, computeSlope, createProject, klick, konturKante, neuerVerlauf, neuerZustand,
  ringArea, rueckgaengig, setzeTrennBreite, signedArea, STANDARD_ATTIKA_BREITE, trenneDachflaeche, validateProject, waehleWerkzeug,
  wiederholen, type Dachflaeche, type ProjectModel,
} from "../src/core/index";

const pt = (id: string, x: number, y: number) => ({ id, x, y });
const modell = (uhrzeiger = false): ProjectModel => {
  const k = [pt("p1", 0, 0), pt("p2", 20, 0), pt("p3", 20, 10), pt("p4", 0, 10)];
  const d: Dachflaeche = {
    id: "d1", name: "Dach", typ: "dach", zonen: [], vorgaben: { maxHochpunkt: 0.5 }, daemmdickeTiefpunkt: 60,
    kontur: uhrzeiger ? [...k].reverse() : k,
    aufbauten: [{ id: "au1", name: "LK", kontur: [pt("p5", 14, 4), pt("p6", 15, 4), pt("p7", 15, 5), pt("p8", 14, 5)] }],
    attika: [{ id: "at1", kante: uhrzeiger ? "p2" : "p1", breite: 0.3, oberkante: 0.6 }], // Kante y = 0
    tuerschwellen: [{ id: "ts1", name: "T", lage: { kante: "p3", abstand: 2 }, breite: 1, barrierefrei: false }], // y = 10, x 18..17
    entwaesserung: [
      { id: "en1", art: "gully", name: "G1", typ: null, position: { x: 5, y: 5 }, z: 0, verbundenMit: "en2" },
      { id: "en2", art: "gully", name: "G2", typ: null, position: { x: 15, y: 7 }, z: 0, verbundenMit: "en1" },
      { id: "en3", art: "gully", name: "G3", typ: null, position: { x: 10, y: 5 }, z: 0 }, // im Streifen
      { id: "en4", art: "dachreiter", name: "DR", typ: null, lage: { kante: uhrzeiger ? "p2" : "p1", abstand: uhrzeiger ? 16 : 4 }, z: 0 }, // (4, 0)
    ],
  };
  return { ...createProject("T", "2026-01-01T00:00:00Z"), dachflaechen: [d] };
};
const trenne = (m: ProjectModel, b = 0.4) => trenneDachflaeche("d1", { x: 10, y: -1 }, { x: 10, y: 11 }, b).anwenden(m);
const flaeche = (d: Dachflaeche) => ringArea(d.kontur);

describe("Dachfläche trennen", () => {
  for (const uz of [false, true]) {
    it(`Rechteck 20×10 → 2 Flächen, Flächensumme = Original − Streifen (Kontur ${uz ? "im" : "gegen"} Uhrzeigersinn)`, () => {
      const m = trenne(modell(uz));
      expect(validateProject(m)).toEqual([]);
      expect(m.dachflaechen).toHaveLength(2);
      const [a, b] = m.dachflaechen as [Dachflaeche, Dachflaeche];
      expect(flaeche(a) + flaeche(b)).toBeCloseTo(200 - 0.4 * 10, 3);
      expect(flaeche(a)).toBeCloseTo(98, 6);
      expect(a.name).toBe("Dach A");
      expect(b.name).toBe("Dach B");
      for (const d of [a, b]) {
        expect(Math.sign(signedArea(d.kontur))).toBe(uz ? -1 : 1);
        expect(d.typ).toBe("dach");
        expect(d.vorgaben).toEqual({ maxHochpunkt: 0.5 });
        expect(d.daemmdickeTiefpunkt).toBe(60);
      }
      // Neue, eindeutige IDs
      const ids = m.dachflaechen.flatMap((d) => [d.id, ...d.kontur.map((p) => p.id), ...d.attika.map((x) => x.id)]);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).not.toContain("d1");
    });
  }

  it("Schnittkanten tragen Attika breite/2, Original-Attika auf kollinearen Kanten übernommen", () => {
    const m = trenne(modell(), 0.4);
    for (const d of m.dachflaechen) {
      const schnitt = d.attika.filter((x) => x.breite === 0.2);
      expect(schnitt).toHaveLength(1);
      const k = konturKante(d.kontur, schnitt[0]!.kante)!;
      expect(k[0].x).toBeCloseTo(k[1].x, 9);
      expect([9.8, 10.2]).toContainEqual(Number(k[0].x.toFixed(9)));
      // Streifen der halben Attika liegt außen und füllt die Streifenhälfte
      const q = attikaStreifen(d, schnitt[0]!);
      const xs = q.map((p) => p.x);
      expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(0.2, 6);
      expect(Math.min(...xs) === 10 || Math.max(...xs) === 10 ? 10 : NaN).toBeCloseTo(10, 6); // Hälften treffen sich in der Mitte
      const alt = d.attika.filter((x) => x.breite === 0.3);
      expect(alt).toHaveLength(1);
      expect(alt[0]!.oberkante).toBe(0.6);
      const ka = konturKante(d.kontur, alt[0]!.kante)!;
      expect(ka[0].y).toBeCloseTo(0, 9);
      expect(ka[1].y).toBeCloseTo(0, 9);
    }
  });

  it("Abläufe, Aufbauten, Schwellen und Dachreiter werden dem richtigen Teil zugeordnet", () => {
    const m = trenne(modell());
    const [a, b] = m.dachflaechen as [Dachflaeche, Dachflaeche];
    const links = a.kontur.every((p) => p.x <= 10) ? a : b, rechts = links === a ? b : a;
    expect(links.entwaesserung.map((e) => e.id).sort()).toEqual(["en1", "en4"]);
    expect(rechts.entwaesserung.map((e) => e.id)).toEqual(["en2"]);
    // Verbindung über den Streifen hinweg entfällt
    for (const e of [...links.entwaesserung, ...rechts.entwaesserung]) if (e.art === "gully") expect(e.verbundenMit).toBeUndefined();
    expect(rechts.aufbauten.map((x) => x.id)).toEqual(["au1"]);
    expect(links.aufbauten).toEqual([]);
    expect(rechts.tuerschwellen).toHaveLength(1);
    const t = rechts.tuerschwellen[0]!, kt = konturKante(rechts.kontur, t.lage.kante)!;
    const u = { x: (kt[1].x - kt[0].x) / 9.8, y: (kt[1].y - kt[0].y) / 9.8 };
    expect(kt[0].x + u.x * t.lage.abstand).toBeCloseTo(18, 6);
    const dr = links.entwaesserung.find((e) => e.id === "en4")!;
    if (dr.art !== "dachreiter") throw new Error("Art");
    const kd = konturKante(links.kontur, dr.lage.kante)!;
    const l = Math.hypot(kd[1].x - kd[0].x, kd[1].y - kd[0].y), s = dr.lage.abstand / l;
    expect(kd[0].x + (kd[1].x - kd[0].x) * s).toBeCloseTo(4, 6);
    expect(kd[0].y + (kd[1].y - kd[0].y) * s).toBeCloseTo(0, 6);
  });

  it("Verbindung bleibt, wenn beide Gullys im selben Teil liegen", () => {
    const m0 = modell();
    const d = m0.dachflaechen[0]!;
    const m1 = { ...m0, dachflaechen: [{ ...d, entwaesserung: d.entwaesserung.map((e) => (e.id === "en2" && e.art === "gully" ? { ...e, position: { x: 5, y: 8 } } : e)) }] };
    const links = trenne(m1).dachflaechen.find((x) => x.entwaesserung.some((e) => e.id === "en1"))!;
    const g = links.entwaesserung.find((e) => e.id === "en2");
    expect(g?.art === "gully" && g.verbundenMit).toBe("en1");
  });

  it("Teilberechnung Gefälle und Einzugsflächen ohne 'ablauf-ausserhalb'", () => {
    const m = trenne(modell());
    const sl = computeSlope(m);
    expect(sl.hinweise.filter((h) => h.code === "ablauf-ausserhalb")).toEqual([]);
    const c = computeCatchments(m, sl);
    expect(c.hinweise.map((h) => h.code)).not.toContain("ablauf-ausserhalb");
  });

  it("Ungültige Eingaben und Linien ohne Trennung ändern nichts", () => {
    const m = modell();
    expect(trenneDachflaeche("d1", { x: 1, y: 1 }, { x: 1, y: 1 }).anwenden(m)).toBe(m);
    expect(trenneDachflaeche("d1", { x: 0, y: 0 }, { x: 1, y: 1 }, 0).anwenden(m)).toBe(m);
    expect(trenneDachflaeche("d1", { x: 0, y: 0 }, { x: 1, y: 1 }, Number.NaN).anwenden(m)).toBe(m);
    expect(trenneDachflaeche("xx", { x: 10, y: 0 }, { x: 10, y: 10 }).anwenden(m)).toBe(m);
    expect(trenneDachflaeche("d1", { x: 30, y: 0 }, { x: 30, y: 10 }).anwenden(m)).toBe(m); // außerhalb
  });

  it("Rückgängig stellt das Original her, Wiederholen die Teilung", () => {
    const m = modell();
    const v1 = ausfuehren(neuerVerlauf(m), trenneDachflaeche("d1", { x: 10, y: 0 }, { x: 10, y: 10 }));
    expect(v1.aktuell.dachflaechen).toHaveLength(2);
    const v0 = rueckgaengig(v1);
    expect(v0.aktuell).toBe(m);
    expect(wiederholen(v0).aktuell).toBe(v1.aktuell);
  });

  it("Schräge Trennlinie: Flächensumme = Original − Streifenfläche", () => {
    const m = trenneDachflaeche("d1", { x: 5, y: 0 }, { x: 15, y: 10 }, 0.3).anwenden(modell());
    expect(m.dachflaechen).toHaveLength(2);
    expect(validateProject(m)).toEqual([]);
    const sum = m.dachflaechen.reduce((n, d) => n + flaeche(d), 0);
    expect(sum).toBeCloseTo(200 - 0.3 * Math.hypot(10, 10), 3);
  });
});

describe("Werkzeug Trennen", () => {
  it("zwei Klicks erzeugen den Befehl mit eingestellter Breite", () => {
    const m = modell();
    let z = setzeTrennBreite(waehleWerkzeug(neuerZustand(), "trennen"), 0.5);
    expect(neuerZustand().trennBreite).toBe(STANDARD_ATTIKA_BREITE);
    const r1 = klick(z, m, { x: 10, y: 0 }, 0.1);
    expect(r1.befehl).toBeUndefined();
    z = r1.zustand;
    expect(z.entwurf).toHaveLength(1);
    const r2 = klick(z, m, { x: 10, y: 10 }, 0.1);
    expect(r2.zustand.entwurf).toEqual([]);
    const n = r2.befehl!.anwenden(m);
    expect(n.dachflaechen).toHaveLength(2);
    expect(n.dachflaechen.reduce((s, d) => s + flaeche(d), 0)).toBeCloseTo(195, 3);
    expect(r2.auswahl).toEqual({ art: "dach", id: n.dachflaechen[0]!.id, dachId: n.dachflaechen[0]!.id });
  });

  it("Klick außerhalb bzw. Linie ohne Trennung gibt Hinweis", () => {
    const m = modell();
    const z = waehleWerkzeug(neuerZustand(), "trennen");
    expect(klick(z, m, { x: 50, y: 50 }, 0.1).zustand.hinweis).toBeTruthy();
    const z1 = klick(z, m, { x: 1, y: 1 }, 0.1).zustand;
    const r = klick(z1, m, { x: 2, y: 2 }, 0.1);
    expect(r.befehl).toBeDefined(); // Gerade wird verlängert: trennt
    const z2 = klick(z, m, { x: 0, y: 0 }, 0.1).zustand;
    const r2 = klick(z2, m, { x: 20, y: 0 }, 0.1); // auf der Kante: kein zweiter Teil
    expect(r2.befehl).toBeUndefined();
    expect(r2.zustand.hinweis).toBeTruthy();
  });
});
