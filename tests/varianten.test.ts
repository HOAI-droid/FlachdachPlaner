import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  addDachflaeche, aktiviereVariante, ausfuehren, aufVariante, befehlVarianteAnlegen, befehlVarianteLoeschen, befehlVarianteUmbenennen,
  benenneVarianteUm, computeCatchments, computeSlope, createProject, createProjekt, findeAbweichungenProjekt, idsDerDachflaechen,
  istProjektGeaendert, legeVarianteAn, loesche, loescheVariante, mitModell, modellFuerVariante, neuerVerlauf, neueIds, parseProject,
  parseProjekt, projektAusModell, pruefeVariantenName, rueckgaengig, wiederholen, serializeProject, serializeProjekt, setGullyVerbindung,
  uebernehmeVorschlaegeProjekt, validateProjekt, setzeProjektangaben, istIsoDatum, PROJEKTANGABEN_FELDER, variantenListe, vorschlagVariantenName, wechsleVariante,
  type Dachflaeche, type Entwaesserung, type Kontur, type ProjectModel, type Projekt,
} from "../src/core/index";

const pt = (id: string, x: number, y: number) => ({ id, x, y });
const rechteck = (pre: string, x0: number, y0: number, w: number, h: number): Kontur =>
  [pt(`${pre}1`, x0, y0), pt(`${pre}2`, x0 + w, y0), pt(`${pre}3`, x0 + w, y0 + h), pt(`${pre}4`, x0, y0 + h)];

/** v2-Modell mit allen Objektarten und Bezügen (Kante, Lage, verbundenMit). */
function beispielV2(): ProjectModel {
  const d1: Dachflaeche = {
    id: "d1", name: "Hauptdach", typ: "dach", kontur: rechteck("k", 0, 0, 20, 10),
    aufbauten: [{ id: "a1", name: "Lichtkuppel", kontur: rechteck("ak", 8, 6, 1.2, 1.2) }],
    zonen: [{ id: "z1", name: "Technik", kontur: rechteck("zk", 14, 0, 6, 4), hoehenversatz: -0.05 }],
    vorgaben: { maxHochpunkt: 0.4 },
    attika: [{ id: "at1", kante: "k1", breite: 0.3 }, { id: "at2", kante: "k2", breite: 0.25 }],
    tuerschwellen: [{ id: "t1", name: "Tür", lage: { kante: "k4", abstand: 2 }, breite: 1, barrierefrei: false }],
    entwaesserung: [
      { id: "e1", art: "gully", name: "G1", typ: null, position: { x: 5, y: 5 }, z: 0, verbundenMit: "e2" },
      { id: "e2", art: "gully", name: "G2", typ: null, position: { x: 12, y: 5 }, z: 0 },
      { id: "e3", art: "notablauf", name: "N1", typ: null, position: { x: 10, y: 3 }, z: 0.035 },
      { id: "e4", art: "dachreiter", name: "DR", typ: null, lage: { kante: "k3", abstand: 4 }, z: 0 },
    ],
  };
  const d2: Dachflaeche = {
    id: "d2", name: "Nebendach", typ: "terrasse", kontur: rechteck("m", 30, 0, 8, 6), aufbauten: [], zonen: [], vorgaben: {},
    attika: [], tuerschwellen: [], entwaesserung: [{ id: "e5", art: "gully", name: "G3", typ: null, position: { x: 34, y: 3 }, z: -0.02 }],
    daemmdickeTiefpunkt: 30,
  };
  return { ...createProject("Muster", "2026-11-22T10:00:00Z"), schemaVersion: 2, gefaelleStandard: 0.025, dachflaechen: [d1, d2] };
}
const alsText = (m: ProjectModel, sv: number) => JSON.stringify({ ...m, schemaVersion: sv });
/** v1-Datei: ohne Kote z an den Abläufen (Migration v1→v2 setzt 0). */
function alsV1(m: ProjectModel): string {
  const d = JSON.parse(alsText(m, 1)) as { dachflaechen: { entwaesserung: Record<string, unknown>[] }[] };
  for (const f of d.dachflaechen) for (const e of f.entwaesserung) delete e["z"];
  return JSON.stringify(d);
}
const nullKoten = (m: ProjectModel): ProjectModel =>
  ({ ...m, dachflaechen: m.dachflaechen.map((d) => ({ ...d, entwaesserung: d.entwaesserung.map((e) => ({ ...e, z: 0 })) })) });
const rechne = (m: ProjectModel) => { const s = computeSlope(m); return { s, c: computeCatchments(m, s) }; };
const lies = (text: string): Projekt => { const r = parseProjekt(text); if (!r.ok) throw new Error(JSON.stringify(r.fehler)); return r.projekt; };
const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => { expect(r.ok).toBe(true); return r as Extract<T, { ok: true }>; };

describe("Migration v1/v2 → v3", () => {
  it.each([["v2", (m: ProjectModel) => alsText(m, 2), (m: ProjectModel) => m], ["v1", alsV1, nullKoten]])(
    "%s-Datei lädt als genau 1 Variante; Rechenergebnis identisch", (_n, text, erwartet) => {
      const r = parseProjekt(text(beispielV2()));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const p = r.projekt;
      expect(p.schemaVersion).toBe(3);
      expect(variantenListe(p)).toEqual([{ id: "v1", name: "Variante 1", aktiv: true }]);
      expect(r.hinweise[0]).toMatch(/auf 3 migriert/);
      const alt = erwartet(beispielV2());
      const ansicht = modellFuerVariante(p);
      expect({ ...ansicht, schemaVersion: 2 }).toEqual(alt);
      expect(rechne(ansicht)).toEqual(rechne(alt));
      expect(validateProjekt(p)).toEqual([]);
    });
  it("Varianten-ID weicht aus, wenn v1 schon als Objekt-ID belegt ist", () => {
    const m = beispielV2();
    const kollision = { ...m, dachflaechen: [{ ...m.dachflaechen[1]!, id: "v1" }] };
    expect(lies(alsText(kollision, 2)).aktiveVariante).toBe("v2");
  });
  it("Übergangs-API: parseProject liefert die Ansicht, serializeProject schreibt v3 mit 1 Variante", () => {
    const r = parseProject(alsText(beispielV2(), 2));
    expect(r.ok && r.projekt.dachflaechen).toEqual(beispielV2().dachflaechen);
    const s = serializeProject(modellFuerVariante(lies(alsText(beispielV2(), 2))));
    expect(JSON.parse(s)).toMatchObject({ schemaVersion: 3, aktiveVariante: "v1", varianten: [{ id: "v1", name: "Variante 1" }] });
    expect(JSON.parse(s)).not.toHaveProperty("dachflaechen");
  });
  it("v3-Datei in einem alten Programm (Ziel v2) → Meldung „neuere Version“", () => {
    const r = parseProject(serializeProjekt(createProjekt("X", "2026-01-01T00:00:00Z")), { zielVersion: 2 });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.neuereVersion).toBe(true); expect(r.fehler[0]!.meldung).toMatch(/aktualisieren/); }
  });
});

describe("Round-Trip und Validierung v3", () => {
  const mehrere = (): Projekt => {
    let p = lies(alsText(beispielV2(), 2));
    p = ok(legeVarianteAn(p, "Mit Kehle", "v1")).projekt;
    p = ok(legeVarianteAn(p, "Leer")).projekt;
    p = ok(aktiviereVariante(p, "v2")).projekt;
    return mitModell(p, { ...modellFuerVariante(p), gefaelleStandard: 0.03 });
  };
  it("parse(serialize(p)) = p, Ausgabe stabil; Gefälle-Standard je Variante", () => {
    const p = mehrere();
    const s = serializeProjekt(p);
    const r = parseProjekt(s);
    expect(r.ok && r.projekt).toEqual(p);
    expect(r.ok && serializeProjekt(r.projekt)).toBe(s);
    expect(modellFuerVariante(p, "v2").gefaelleStandard).toBe(0.03);
    expect(modellFuerVariante(p, "v1").gefaelleStandard).toBe(0.025);
    expect(p.varianten.map((v) => v.name)).toEqual(["Variante 1", "Mit Kehle", "Leer"]);
  });
  it("leerer/doppelter Name, unbekannte aktiveVariante, keine Variante → strukturierte Fehler", () => {
    const roh = () => JSON.parse(serializeProjekt(mehrere())) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const pfade = (d: unknown) => validateProjekt(d).map((f) => f.pfad);
    const a = roh(); a["varianten"][1]["name"] = "  ";
    expect(pfade(a)).toEqual(["/varianten/1/name"]);
    const b = roh(); b["varianten"][2]["name"] = " variante 1 ";
    expect(validateProjekt(b)).toEqual([{ pfad: "/varianten/2/name", meldung: expect.stringMatching(/bereits vergeben/) }]);
    const c = roh(); c["aktiveVariante"] = "v9";
    expect(pfade(c)).toEqual(["/aktiveVariante"]);
    const d = roh(); d["varianten"] = [];
    expect(pfade(d)).toContain("/varianten");
    const e = roh(); e["varianten"][2]["id"] = "d1";
    expect(pfade(e)).toEqual(["/varianten/2/id"]);
    const f = roh(); f["dachflaechen"] = [];
    expect(pfade(f)).toEqual(["/dachflaechen"]);
    const g = roh(); g["varianten"][0]["dachflaechen"][0]["attika"][0]["kante"] = "nix";
    expect(pfade(g)).toEqual(["/varianten/0/dachflaechen/0/attika/0/kante"]);
  });
});

describe("Varianten-Befehle", () => {
  const basis = () => lies(alsText(beispielV2(), 2));
  it("Name: leer, zu lang, doppelt (ohne Groß-/Kleinschreibung) → Fehlercode", () => {
    const p = basis();
    expect(pruefeVariantenName(p, " ")?.code).toBe("name-leer");
    expect(pruefeVariantenName(p, "x".repeat(201))?.code).toBe("name-zu-lang");
    expect(pruefeVariantenName(p, "VARIANTE 1")?.code).toBe("name-doppelt");
    expect(pruefeVariantenName(p, "Variante 1", "v1")).toBeNull();
    const r = legeVarianteAn(p, "variante 1");
    expect(!r.ok && r.fehler.code).toBe("name-doppelt");
    expect(!benenneVarianteUm(p, "v9", "A").ok).toBe(true);
    expect(benenneVarianteUm(p, "v1", " Variante 1 ").ok && benenneVarianteUm(p, "v1", "Variante 1")).toMatchObject({ projekt: p });
  });
  it("Löschen: nie die letzte; aktive gelöscht → Nachbar aktiv", () => {
    let p = basis();
    const r = loescheVariante(p, "v1");
    expect(!r.ok && r.fehler.code).toBe("letzte-variante");
    p = ok(legeVarianteAn(p, "B")).projekt;
    p = ok(legeVarianteAn(p, "C")).projekt;
    p = ok(aktiviereVariante(p, "v2")).projekt;
    const l = ok(loescheVariante(p, "v2"));
    expect(l.projekt.aktiveVariante).toBe("v3");
    expect(ok(loescheVariante(l.projekt, "v3")).projekt.aktiveVariante).toBe("v1");
    expect(ok(loescheVariante(p, "v1")).projekt.aktiveVariante).toBe("v2");
  });
  it("Vorschlagsnamen", () => {
    let p = basis();
    expect(vorschlagVariantenName(p)).toBe("Variante 2");
    expect(vorschlagVariantenName(p, "v1")).toBe("Variante 1 (Kopie)");
    // Review M8: sehr lange Namen dürfen die Namenssuche nicht endlos laufen lassen
    const lang = legeVarianteAn(p, "x".repeat(200));
    if (lang.ok) { const n = vorschlagVariantenName(lang.projekt, lang.projekt.aktiveVariante); expect(n.length).toBeLessThanOrEqual(200); expect(pruefeVariantenName(lang.projekt, n)).toBeNull(); }
    p = ok(legeVarianteAn(p, "Variante 1 (Kopie)", "v1")).projekt;
    expect(vorschlagVariantenName(p, "v1")).toBe("Variante 1 (Kopie 2)");
  });
  it("Undo: Anlegen/Umbenennen/Löschen sind Schritte; Umschalten nicht und zählt nicht als Änderung", () => {
    const p0 = basis();
    let v = neuerVerlauf<Projekt>(p0);
    v = ausfuehren(v, befehlVarianteAnlegen("B", "v1"));
    expect(v.aktuell.aktiveVariante).toBe("v2");
    v = ausfuehren(v, befehlVarianteUmbenennen("v2", "B2"));
    const vorUmschalten = v.aktuell;
    v = wechsleVariante(v, "v1");
    expect(v.zurueck).toHaveLength(2);
    expect(istProjektGeaendert(v, vorUmschalten)).toBe(false);
    expect(istProjektGeaendert(v, p0)).toBe(true);
    expect(ausfuehren(v, befehlVarianteLoeschen("v9"))).toBe(v);
    expect(ausfuehren(v, befehlVarianteAnlegen(""))).toBe(v);
    v = ausfuehren(v, befehlVarianteLoeschen("v2"));
    expect(variantenListe(v.aktuell).map((x) => x.name)).toEqual(["Variante 1"]);
    v = rueckgaengig(rueckgaengig(rueckgaengig(v)));
    expect(v.aktuell).toBe(p0);
    expect(istProjektGeaendert(v, p0)).toBe(false);
  });
  it("Review M8 (3): Undo/Redo-Roundtrip für Anlegen, Duplizieren, Umbenennen, Löschen", () => {
    const p0 = basis();
    const schritte = [befehlVarianteAnlegen("Leer"), befehlVarianteAnlegen("Kopie", "v1"), befehlVarianteUmbenennen("v2", "L"), befehlVarianteLoeschen("v1")];
    let v = neuerVerlauf<Projekt>(p0);
    const staende: Projekt[] = [p0];
    for (const b of schritte) { v = ausfuehren(v, b); staende.push(v.aktuell); }
    expect(variantenListe(v.aktuell).map((x) => x.name)).toEqual(["L", "Kopie"]);
    expect(v.zurueck.map((s) => s.label)).toEqual(["Variante anlegen", "Variante duplizieren", "Variante umbenennen", "Variante löschen"]);
    for (let i = staende.length - 2; i >= 0; i--) { v = rueckgaengig(v); expect(v.aktuell).toBe(staende[i]); }
    expect(istProjektGeaendert(v, p0)).toBe(false);
    for (let i = 1; i < staende.length; i++) { v = wiederholen(v); expect(v.aktuell).toBe(staende[i]); }
    expect(istProjektGeaendert(v, staende[staende.length - 1]!)).toBe(false);
    expect(istProjektGeaendert(v, p0)).toBe(true);
    expect(serializeProjekt(lies(serializeProjekt(v.aktuell)))).toBe(serializeProjekt(v.aktuell));
  });
  it("Review M8 (3): Umschalten behält den Verlauf; Undo stellt Inhalt und die damals aktive Variante her", () => {
    const quadrat = (x: number) => [{ x, y: 0 }, { x: x + 5, y: 0 }, { x: x + 5, y: 5 }, { x, y: 5 }];
    const p0 = basis();
    const n = modellFuerVariante(p0).dachflaechen.length;
    let v = ausfuehren(neuerVerlauf<Projekt>(p0), befehlVarianteAnlegen("B", "v1")); // aktiv: v2
    const nachAnlegen = v.aktuell;
    v = ausfuehren(v, aufVariante(addDachflaeche(quadrat(30)))); // Änderung in v2
    const inB = v.aktuell;
    v = wechsleVariante(v, "v1");
    expect(v.zurueck).toHaveLength(2);
    v = ausfuehren(v, aufVariante(addDachflaeche(quadrat(40)))); // Änderung in v1
    expect(v.aktuell.varianten[1]).toBe(inB.varianten[1]);
    expect(modellFuerVariante(v.aktuell).dachflaechen).toHaveLength(n + 1);
    // Undo 1: Änderung in v1 zurück, v1 bleibt aktiv (Stand direkt nach dem Umschalten)
    v = rueckgaengig(v);
    expect(v.aktuell.aktiveVariante).toBe("v1");
    expect(v.aktuell.varianten).toBe(inB.varianten);
    // Undo 2: Änderung in v2 zurück, Ansicht springt in die Variante, in der sie geschah
    v = rueckgaengig(v);
    expect(v.aktuell).toBe(nachAnlegen);
    expect(v.aktuell.aktiveVariante).toBe("v2");
    // Umschalten während Redo-Liste offen: Redo bleibt erhalten
    v = wechsleVariante(v, "v1");
    expect(v.vor).toHaveLength(2);
    v = wiederholen(wiederholen(v));
    expect(modellFuerVariante(v.aktuell, "v1").dachflaechen).toHaveLength(n + 1);
    expect(modellFuerVariante(v.aktuell, "v2").dachflaechen).toHaveLength(n + 1);
    v = rueckgaengig(rueckgaengig(rueckgaengig(v)));
    expect(v.aktuell).toBe(p0);
  });
  it("Review M8 (3): Dirty-Status: Umschalten und Undo bis zum gespeicherten Stand gelten als unverändert", () => {
    const gespeichert = ok(legeVarianteAn(basis(), "B")).projekt;
    let v = neuerVerlauf<Projekt>(gespeichert);
    v = wechsleVariante(v, "v1");
    expect(istProjektGeaendert(v, gespeichert)).toBe(false);
    expect(wechsleVariante(v, "v9")).toBe(v);
    expect(wechsleVariante(v, "v1")).toBe(v);
    v = ausfuehren(v, befehlVarianteUmbenennen("v2", "C"));
    expect(istProjektGeaendert(v, gespeichert)).toBe(true);
    v = wechsleVariante(rueckgaengig(v), "v2");
    expect(istProjektGeaendert(v, gespeichert)).toBe(false);
    v = ausfuehren(v, aufVariante({ label: "Angaben", anwenden: (m) => { const r = setzeProjektangaben(m, { bauherr: "X" }); return r.ok ? r.modell : m; } }));
    expect(v.aktuell.varianten).toBe(gespeichert.varianten); // projektweites Feld, Varianten unberührt
    expect(istProjektGeaendert(v, gespeichert)).toBe(true);
  });
  it("aufVariante: wirkt nur auf die aktive Variante; neue IDs projektweit eindeutig", () => {
    let p = ok(legeVarianteAn(basis(), "Leer")).projekt;
    const vorher = p.varianten[0]!;
    const quadrat = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 5 }];
    p = ausfuehren(neuerVerlauf<Projekt>(p), aufVariante(addDachflaeche(quadrat))).aktuell;
    expect(p.varianten[0]).toBe(vorher);
    const neu = p.varianten[1]!.dachflaechen[0]!;
    expect(idsDerDachflaechen(vorher.dachflaechen)).not.toContain(neu.id);
    expect(validateProjekt(p)).toEqual([]);
    expect(neueIds(modellFuerVariante(p), "d")).toEqual(["d4"]);
    const nichts = aufVariante({ label: "nichts", anwenden: (m) => m });
    expect(nichts.anwenden(p)).toBe(p);
    expect(mitModell(p, modellFuerVariante(p))).toBe(p);
  });
  it("findeAbweichungen läuft über alle Varianten und übernimmt je Variante", () => {
    let p = ok(legeVarianteAn(basis(), "Kopie", "v1")).projekt;
    const alt = [{ a: { x: 0, y: 0 }, b: { x: 20, y: 0 } }];
    const neu = [{ a: { x: 0.3, y: 0 }, b: { x: 20, y: 0 } }];
    const ab = findeAbweichungenProjekt(p, alt, neu);
    expect(ab.map((a) => a.ref.varianteId)).toEqual(["v1", "v2"]);
    expect(new Set(ab.map((a) => a.id)).size).toBe(2);
    p = uebernehmeVorschlaegeProjekt(ab).anwenden(p);
    for (const v of p.varianten) expect(v.dachflaechen[0]!.kontur[0]).toMatchObject({ x: 0.3, y: 0 });
  });
});

// ---------- Eigenschaftstest Duplizieren ----------

const zahl = (min: number, max: number) => fc.double({ min, max, noNaN: true, noDefaultInfinity: true }).map((v) => Math.round(v * 100) / 100);
const dachArb = fc.record({
  x0: zahl(-50, 50), y0: zahl(-50, 50), w: zahl(4, 30), h: zahl(4, 20),
  gullys: fc.array(fc.record({ u: zahl(0.1, 0.9), v: zahl(0.1, 0.9), z: zahl(-0.05, 0.05) }), { minLength: 1, maxLength: 3 }),
  verbinden: fc.boolean(), attika: fc.array(fc.nat(3), { maxLength: 4 }), schwelle: fc.option(fc.nat(3), { nil: undefined }),
  reiter: fc.option(fc.nat(3), { nil: undefined }), aufbau: fc.boolean(),
});
const projektArb = fc.array(dachArb, { minLength: 1, maxLength: 3 }).map((ds): ProjectModel => {
  let n = 0;
  const id = (p: string) => `${p}${++n}`;
  const dachflaechen = ds.map((d): Dachflaeche => {
    const k = rechteck("", d.x0, d.y0, d.w, d.h).map((q) => ({ ...q, id: id("p") }));
    const g = d.gullys.map((q): Entwaesserung => ({ id: id("en"), art: "gully", name: "G", typ: null, position: { x: d.x0 + q.u * d.w, y: d.y0 + q.v * d.h }, z: 0 }));
    const entw: Entwaesserung[] = d.verbinden && g.length > 1 ? [{ ...g[0]!, verbundenMit: g[1]!.id } as Entwaesserung, ...g.slice(1)] : g;
    if (d.reiter !== undefined) entw.push({ id: id("en"), art: "dachreiter", name: "DR", typ: null, lage: { kante: k[d.reiter]!.id, abstand: 1 }, z: 0 });
    return {
      id: id("d"), name: "D", typ: "dach", kontur: k, zonen: [], vorgaben: {},
      aufbauten: d.aufbau ? [{ id: id("au"), name: "A", kontur: rechteck("", d.x0 + 1, d.y0 + 1, 1, 1).map((q) => ({ ...q, id: id("p") })) }] : [],
      attika: [...new Set(d.attika)].map((i) => ({ id: id("at"), kante: k[i]!.id, breite: 0.3 })),
      tuerschwellen: d.schwelle === undefined ? [] : [{ id: id("ts"), name: "T", lage: { kante: k[d.schwelle]!.id, abstand: 0.5 }, breite: 1, barrierefrei: true }],
      entwaesserung: entw,
    };
  });
  return { ...createProject("P", "2026-01-01T00:00:00Z"), dachflaechen };
});

/** Ersetzt in einer (JSON-fähigen) Struktur alle IDs gemäß `map` (ganze Wörter, auch in Texten). */
function umbenannt<T>(x: T, map: ReadonlyMap<string, string>): T {
  if (map.size === 0) return x;
  const re = new RegExp(`\\b(${[...map.keys()].sort((a, b) => b.length - a.length).join("|")})\\b`, "g");
  return JSON.parse(JSON.stringify(x), (_k, v: unknown) => (typeof v === "string" ? v.replace(re, (t) => map.get(t)!) : v)) as T;
}

describe("Eigenschaftstest Duplizieren", () => {
  it("keine doppelte ID projektweit, gleiche Koten/Flächen, Kopie unabhängig vom Original", () => {
    fc.assert(fc.property(projektArb, fc.integer({ min: 1, max: 3 }), (m, kopien) => {
      let p = projektAusModell(m);
      for (let i = 0; i < kopien; i++) p = ok(legeVarianteAn(p, vorschlagVariantenName(p, "v1"), "v1")).projekt;
      const alle = p.varianten.flatMap((v) => [v.id, ...idsDerDachflaechen(v.dachflaechen)]);
      expect(new Set(alle).size).toBe(alle.length);
      expect(validateProjekt(p)).toEqual([]);
      const orig = p.varianten[0]!;
      const kopie = p.varianten[p.varianten.length - 1]!;
      // ID-Abbildung Kopie → Original (gleiche Traversierungsreihenfolge).
      const ki = idsDerDachflaechen(kopie.dachflaechen), oi = idsDerDachflaechen(orig.dachflaechen);
      const zurueck = new Map(ki.map((id, i) => [id, oi[i]!]));
      const json = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T; // -0 ≡ 0
      expect(umbenannt(kopie.dachflaechen, zurueck)).toEqual(json(orig.dachflaechen));
      expect(umbenannt(rechne(modellFuerVariante(p, kopie.id)), zurueck)).toEqual(json(rechne(modellFuerVariante(p, orig.id))));
      // Änderung in der Kopie (Ablauf löschen + Verbindung lösen) lässt das Original unverändert.
      const d = kopie.dachflaechen[0]!;
      const aen = ausfuehren(neuerVerlauf<Projekt>(p), aufVariante(loesche({ art: "entwaesserung", id: d.entwaesserung[0]!.id, dachId: d.id }), kopie.id)).aktuell;
      const aen2 = aufVariante(setGullyVerbindung(d.id, d.entwaesserung[0]!.id, null), kopie.id).anwenden(aen);
      expect(aen2.varianten[0]).toBe(orig);
      expect(aen2.varianten[aen2.varianten.length - 1]!.dachflaechen[0]!.entwaesserung).toHaveLength(d.entwaesserung.length - 1);
      expect(serializeProjekt(lies(serializeProjekt(aen2)))).toBe(serializeProjekt(aen2));
    }), { numRuns: 60 });
  });
});

describe("Guard (R9): Zugriff auf `.varianten` nur in core/model und core/edit", () => {
  it("kein anderes Modul unter src greift auf varianten zu", () => {
    // Dateien als Text über Vite (ohne Node-Typen).
    const quellen = import.meta.glob("../src/**/*.{ts,js}", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;
    expect(Object.keys(quellen).length).toBeGreaterThan(20);
    const verstoesse = Object.entries(quellen)
      .filter(([f]) => !/^\.\.\/src\/core\/(model|edit)\//.test(f))
      .filter(([, text]) => /(\.|\[["'`])varianten\b|\bvarianten\s*:/.test(text))
      .map(([f]) => f);
    expect(verstoesse).toEqual([]);
  });
});

describe("setzeProjektangaben / Plankopf-Felder", () => {
  const p0 = () => createProjekt("Haus A", "2026-01-01T00:00:00Z");
  const alle = {
    bauvorhaben: "Neubau MFH", bauherr: "Fa. Muster", planinhalt: "Gefälleplan", bueroName: "Büro X",
    bueroAnschrift: "Weg 1, 12345 Ort", bueroKontakt: "0123 / 4567", bearbeiter: "AB", geprueftVon: "CD",
    planNummer: "GP-01", planDatum: "2026-11-23", revision: "B", revisionDatum: "2026-12-01",
  };
  it("setzt alle Felder (getrimmt), Round-Trip v3, validateProjekt sauber", () => {
    const r = setzeProjektangaben(p0(), { ...alle, bauherr: "  Fa. Muster  ", notiz: "n".repeat(2000) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.modell.meta).toMatchObject({ ...alle, name: "Haus A" });
    expect(PROJEKTANGABEN_FELDER.every((f) => f in r.modell.meta)).toBe(true);
    expect(validateProjekt(r.modell)).toEqual([]);
    expect(lies(serializeProjekt(r.modell))).toEqual(r.modell);
  });
  it("entfernen mit \"\"/null; keine Änderung → dasselbe Objekt; geaendertAm unberührt", () => {
    const a = setzeProjektangaben(p0(), { bauherr: "X", revision: "A" });
    if (!a.ok) throw new Error();
    const b = setzeProjektangaben(a.modell, { bauherr: "", revision: null });
    expect(b.ok && b.modell.meta).toEqual(p0().meta);
    expect(b.ok && "bauherr" in b.modell.meta).toBe(false);
    const c = setzeProjektangaben(a.modell, { bauherr: " X ", planinhalt: "" });
    expect(c.ok && c.modell).toBe(a.modell);
    expect(a.modell.meta.geaendertAm).toBe(p0().meta.geaendertAm);
    // auch für die Ansicht (ProjectModel)
    const m = setzeProjektangaben(beispielV2(), { planNummer: "1" });
    expect(m.ok && m.modell.meta.planNummer).toBe("1");
  });
  it("Fehler: unbekanntes Feld, zu lang, kein Datum, leerer Name, kein Text → alles oder nichts", () => {
    const p = p0();
    const r = setzeProjektangaben(p, {
      bauherr: "x".repeat(201), planDatum: "2026-02-30", revisionDatum: "23.11.2026", name: "  ", notiz: "n".repeat(2001),
      bauvorhaben: "gültig", ...({ massstabText: "1:100", revision: 3 } as object),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fehler.map((f) => f.feld).sort()).toEqual(["bauherr", "massstabText", "name", "notiz", "planDatum", "revision", "revisionDatum"]);
    expect(r.fehler.find((f) => f.feld === "massstabText")?.meldung).toBe("Unbekanntes Feld");
    expect(p.meta).toEqual(p0().meta);
    expect(istIsoDatum("2024-02-29")).toBe(true);
    expect(istIsoDatum("2026-02-29")).toBe(false);
  });
  it("validateProjekt prüft meta: Typ, Länge, Datum", () => {
    const d = JSON.parse(serializeProjekt(p0())) as { meta: Record<string, unknown> };
    d.meta["bauherr"] = "x".repeat(201);
    d.meta["planDatum"] = "2026-13-01";
    d.meta["revision"] = 7;
    d.meta["notiz"] = "n".repeat(2001);
    expect(validateProjekt(d).map((f) => f.pfad).sort()).toEqual(["/meta/bauherr", "/meta/notiz", "/meta/planDatum", "/meta/revision"]);
  });
  it("Migration v2 → v3 behält vorhandene meta-Felder", () => {
    const m = beispielV2();
    const alt = { ...m, meta: { ...m.meta, projektnummer: "P-7", bearbeiter: "AB", notiz: "Alt" } };
    expect(lies(alsText(alt, 2)).meta).toEqual(alt.meta);
  });
});
