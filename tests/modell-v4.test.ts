import { describe, expect, it } from "vitest";
import {
  SCHEMA_VERSION, addWandanschluss, ausfuehren, belagDickeVon, computeCatchments, computeSlope, createProject, kopiereDachflaechen,
  loesche, modellFuerVariante, neuerVerlauf, parseProject, parseProjekt, projektAusModell, rueckgaengig, serializeProjekt,
  setAttikaOberkante, setAufbauOberkante, setBelagDicke, setTuerschwelleOberkante, setTuerschwelleRinne, setUeberlaufKante,
  setWandanschlussLaenge, setWandanschlussOberkante, trenneDachflaeche, validateProjekt, wandanschluesseVon, wiederholen,
  type Dachflaeche, type ProjectModel,
} from "../src/core/index";

const pt = (id: string, x: number, y: number) => ({ id, x, y });
type Roh = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const roh = (x: unknown) => JSON.parse(JSON.stringify(x)) as Roh;

/** v3-taugliches Dach (ohne v4-Felder): 20 × 10 m, Gully, Notablauf, Dachreiter, Zone, Aufbau, Attika, Tür. */
function dach(): Dachflaeche {
  return {
    id: "d1", name: "Dach", typ: "dach", vorgaben: {},
    kontur: [pt("p1", 0, 0), pt("p2", 20, 0), pt("p3", 20, 10), pt("p4", 0, 10)],
    aufbauten: [{ id: "au1", name: "Licht", kontur: [pt("p5", 14, 6), pt("p6", 15, 6), pt("p7", 15, 7), pt("p8", 14, 7)] }],
    zonen: [{ id: "zo1", name: "Z", kontur: [pt("p9", 1, 1), pt("p10", 4, 1), pt("p11", 4, 4), pt("p12", 1, 4)], hoehenversatz: 0 }],
    attika: [{ id: "at1", kante: "p1", breite: 0.3, oberkante: 0.4 }],
    tuerschwellen: [{ id: "ts1", name: "Tür", lage: { kante: "p3", abstand: 2 }, breite: 1, barrierefrei: false, oberkante: 0.2 }],
    entwaesserung: [
      { id: "en1", art: "gully", name: "G", typ: null, position: { x: 10, y: 5 }, z: 0 },
      { id: "en2", art: "notablauf", name: "N", typ: null, position: { x: 12, y: 5 }, z: 0 },
      { id: "en3", art: "dachreiter", name: "R", typ: null, lage: { kante: "p2", abstand: 3 }, z: 0 },
    ],
  };
}
const modell = (d: Dachflaeche = dach()): ProjectModel => ({ ...createProject("V4", "2026-01-01T00:00:00Z"), dachflaechen: [d] });
const rechne = (m: ProjectModel) => { const s = computeSlope(m); return roh({ s, c: computeCatchments(m, s) }); };
const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => { expect(r.ok).toBe(true); return r as Extract<T, { ok: true }>; };

/** Volles v4-Dach mit allen neuen Feldern. */
function dachV4(): Dachflaeche {
  const d = dach();
  return {
    ...d, belagDicke: 0.06,
    aufbauten: [{ ...d.aufbauten[0]!, oberkante: 0.5 }],
    zonen: [{ ...d.zonen[0]!, belagDicke: 0.1 }],
    tuerschwellen: [{ ...d.tuerschwellen[0]!, rinne: true }],
    entwaesserung: d.entwaesserung.map((e) => (e.art === "gully" ? e : { ...e, ueberlaufKante: 0.03 })),
    wandanschluesse: [{ id: "wa1", name: "Wand 1", lage: { kante: "p4", abstand: 1 }, laenge: 5, oberkante: 0.35 }],
  };
}

describe("Migration v1–v3 → v4", () => {
  const p3 = () => { const r = roh(projektAusModell(modell())); r["schemaVersion"] = 3; return r; };

  it.each([1, 2, 3])("v%i-Datei lädt, Dokument bis auf schemaVersion gleich, Ergebnis identisch", (v) => {
    let doc: Roh;
    if (v === 3) doc = p3();
    else {
      doc = roh(modell()); doc["schemaVersion"] = v;
      if (v === 1) for (const d of doc["dachflaechen"]) for (const e of d["entwaesserung"]) delete e["z"];
    }
    const r = ok(parseProjekt(JSON.stringify(doc)));
    expect(r.projekt.schemaVersion).toBe(4);
    expect(SCHEMA_VERSION).toBe(4);
    expect(r.hinweise[0]).toMatch(/auf 4 migriert/);
    expect({ ...r.projekt, schemaVersion: 3 }).toEqual(p3());
    expect(rechne(modellFuerVariante(r.projekt))).toEqual(rechne(modell()));
    expect(validateProjekt(r.projekt)).toEqual([]);
  });

  it("Validierung gegen v3: v4-Felder → „Unbekanntes Feld“ (v3 bleibt streng)", () => {
    const doc = roh(projektAusModell(modell(dachV4()))); doc["schemaVersion"] = 3;
    const pfade = validateProjekt(doc, 3).filter((f) => /Unbekannt/i.test(f.meldung)).map((f) => f.pfad).sort();
    const b = "/varianten/0/dachflaechen/0";
    expect(pfade).toEqual([`${b}/aufbauten/0/oberkante`, `${b}/belagDicke`, `${b}/entwaesserung/1/ueberlaufKante`, `${b}/entwaesserung/2/ueberlaufKante`,
      `${b}/tuerschwellen/0/rinne`, `${b}/wandanschluesse`, `${b}/zonen/0/belagDicke`].sort());
  });

  it("v4-Datei in einem Programm mit Ziel v3 → „neuere Version“", () => {
    const r = parseProject(serializeProjekt(projektAusModell(modell(dachV4()))), { zielVersion: 3 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.neuereVersion).toBe(true);
    expect(r.fehler[0]!.meldung).toMatch(/neuere|aktualisieren/i);
  });
});

describe("v4: Round-Trip und Validierung", () => {
  it("parse(serialize(p)) = p mit allen neuen Feldern, Ausgabe stabil", () => {
    const p = projektAusModell(modell(dachV4()));
    const s = serializeProjekt(p);
    const r = ok(parseProjekt(s));
    expect(r.projekt).toEqual(p);
    expect(serializeProjekt(r.projekt)).toBe(s);
    expect(validateProjekt(p)).toEqual([]);
  });

  const fehlerPfade = (f: (d: Roh) => void) => {
    const doc = roh(projektAusModell(modell(dachV4())));
    f(doc["varianten"][0]["dachflaechen"][0]);
    return validateProjekt(doc).map((e) => e.pfad);
  };
  const b = "/varianten/0/dachflaechen/0";

  it.each<[string, (d: Roh) => void, string]>([
    ["belagDicke Dach < 0", (d) => { d["belagDicke"] = -0.01; }, `${b}/belagDicke`],
    ["belagDicke Zone < 0", (d) => { d["zonen"][0]["belagDicke"] = -1; }, `${b}/zonen/0/belagDicke`],
    ["Wandanschluss laenge 0", (d) => { d["wandanschluesse"][0]["laenge"] = 0; }, `${b}/wandanschluesse/0/laenge`],
    ["Wandanschluss laenge < 0", (d) => { d["wandanschluesse"][0]["laenge"] = -2; }, `${b}/wandanschluesse/0/laenge`],
    ["Wandanschluss über Kantenende", (d) => { d["wandanschluesse"][0]["lage"]["abstand"] = 8; }, `${b}/wandanschluesse/0/lage/abstand`],
    ["Wandanschluss unbekannte Kante", (d) => { d["wandanschluesse"][0]["lage"]["kante"] = "pX"; }, `${b}/wandanschluesse/0/lage/kante`],
    ["Wandanschluss ohne name", (d) => { delete d["wandanschluesse"][0]["name"]; }, `${b}/wandanschluesse/0/name`],
    ["Wandanschluss oberkante kein Wert", (d) => { d["wandanschluesse"][0]["oberkante"] = "hoch"; }, `${b}/wandanschluesse/0/oberkante`],
    ["ueberlaufKante < 0", (d) => { d["entwaesserung"][1]["ueberlaufKante"] = -0.1; }, `${b}/entwaesserung/1/ueberlaufKante`],
    ["ueberlaufKante am Gully", (d) => { d["entwaesserung"][0]["ueberlaufKante"] = 0.1; }, `${b}/entwaesserung/0/ueberlaufKante`],
    ["rinne kein Boolean", (d) => { d["tuerschwellen"][0]["rinne"] = "ja"; }, `${b}/tuerschwellen/0/rinne`],
    ["Aufbau oberkante kein Wert", (d) => { d["aufbauten"][0]["oberkante"] = null; }, `${b}/aufbauten/0/oberkante`],
  ])("%s → strukturierter Fehler", (_n, f, pfad) => {
    expect(fehlerPfade(f)).toContain(pfad);
  });

  it("doppelte Wandanschluss-ID → Fehler", () => {
    const pf = fehlerPfade((d) => { d["wandanschluesse"].push({ ...d["wandanschluesse"][0], lage: { kante: "p1", abstand: 0 } }); });
    expect(pf.some((p) => p.startsWith(`${b}/wandanschluesse/1`))).toBe(true);
  });

  it("Standardwerte: ohne Wandanschlüsse [] und Belagdicke Zone → Dach → 0", () => {
    const d = dach(), v = dachV4();
    expect(wandanschluesseVon(d)).toEqual([]);
    expect(wandanschluesseVon(v)).toHaveLength(1);
    expect(belagDickeVon(d)).toBe(0);
    expect(belagDickeVon(v)).toBe(0.06);
    expect(belagDickeVon(v, v.zonen[0])).toBe(0.1);
    expect(belagDickeVon({ ...v, zonen: [] }, d.zonen[0])).toBe(0.06);
  });
});

describe("v4: Editierbefehle mit Undo", () => {
  const d0 = (m: ProjectModel) => m.dachflaechen[0]!;

  it("Wandanschluss setzen, Länge/OK ändern, löschen; Undo/Redo", () => {
    let v = neuerVerlauf(modell());
    const start = v.aktuell;
    v = ausfuehren(v, addWandanschluss("d1", "p4", 18, 5, 0.3));
    const w = wandanschluesseVon(d0(v.aktuell))[0]!;
    expect(w).toEqual({ id: "wa1", name: "Wandanschluss 1", lage: { kante: "p4", abstand: 5 }, laenge: 5, oberkante: 0.3 }); // Abstand begrenzt (10 − 5)
    v = ausfuehren(v, setWandanschlussLaenge("d1", "wa1", 8));
    expect(wandanschluesseVon(d0(v.aktuell))[0]).toMatchObject({ laenge: 8, lage: { abstand: 2 } });
    v = ausfuehren(v, setWandanschlussOberkante("d1", "wa1", undefined));
    expect(Object.hasOwn(wandanschluesseVon(d0(v.aktuell))[0]!, "oberkante")).toBe(false);
    v = ausfuehren(v, loesche({ art: "wandanschluss", id: "wa1", dachId: "d1" }));
    expect(wandanschluesseVon(d0(v.aktuell))).toEqual([]);
    v = rueckgaengig(rueckgaengig(rueckgaengig(rueckgaengig(v))));
    expect(v.aktuell).toBe(start);
    v = wiederholen(v);
    expect(wandanschluesseVon(d0(v.aktuell))[0]!.id).toBe("wa1");
    expect(validateProjekt(projektAusModell(v.aktuell))).toEqual([]);
  });

  it("ungültige Eingaben ändern nichts (kein Undo-Schritt)", () => {
    const m = modell(dachV4());
    for (const b of [
      addWandanschluss("d1", "p4", 0, 0), addWandanschluss("d1", "p4", 0, -1), addWandanschluss("d1", "p4", 0, 11), addWandanschluss("d1", "pX", 0, 1),
      setWandanschlussLaenge("d1", "wa1", 0), setWandanschlussLaenge("d1", "wa1", 99), setWandanschlussLaenge("d1", "wa1", 5),
      setBelagDicke("d1", null, -0.01), setBelagDicke("d1", "zo1", -1), setBelagDicke("d1", null, Number.NaN), setBelagDicke("d1", null, 0.06),
      setUeberlaufKante("d1", "en2", -0.1), setUeberlaufKante("d1", "en1", 0.1), setUeberlaufKante("d1", "en2", 0.03),
      setTuerschwelleRinne("d1", "ts1", true), setAufbauOberkante("d1", "au1", 0.5), setWandanschlussOberkante("d1", "wa9", 1),
      loesche({ art: "wandanschluss", id: "wa9", dachId: "d1" }),
    ]) {
      expect(b.anwenden(m)).toBe(m);
      const v = ausfuehren(neuerVerlauf(m), b);
      expect(v.zurueck).toHaveLength(0);
    }
  });

  it("Belagdicke, OK Aufbau/Attika/Tür, Rinne, Überlaufkante setzen und entfernen; Undo stellt wieder her", () => {
    let v = neuerVerlauf(modell());
    const start = v.aktuell;
    const befehle = [
      setBelagDicke("d1", null, 0.06), setBelagDicke("d1", "zo1", 0.1), setAufbauOberkante("d1", "au1", 0.5), setTuerschwelleRinne("d1", "ts1", true),
      setUeberlaufKante("d1", "en2", 0.03), setUeberlaufKante("d1", "en3", 0.03), setAttikaOberkante("d1", "at1", 0.45), setTuerschwelleOberkante("d1", "ts1", 0.25),
      addWandanschluss("d1", "p4", 1, 5, 0.35),
    ];
    for (const b of befehle) v = ausfuehren(v, b);
    expect(v.zurueck).toHaveLength(befehle.length);
    const d = d0(v.aktuell);
    expect(d.belagDicke).toBe(0.06);
    expect(d.zonen[0]!.belagDicke).toBe(0.1);
    expect(d.aufbauten[0]!.oberkante).toBe(0.5);
    expect(d.tuerschwellen[0]).toMatchObject({ rinne: true, oberkante: 0.25 });
    expect(d.attika[0]!.oberkante).toBe(0.45);
    expect(d.entwaesserung.map((e) => ("ueberlaufKante" in e ? e.ueberlaufKante : undefined))).toEqual([undefined, 0.03, 0.03]);
    // Entfernen: Felder verschwinden wieder ganz (Datei wie v3 bis auf Änderungen).
    let w = v;
    for (const b of [setBelagDicke("d1", null, undefined), setBelagDicke("d1", "zo1", undefined), setAufbauOberkante("d1", "au1", undefined),
      setTuerschwelleRinne("d1", "ts1", false), setUeberlaufKante("d1", "en2", undefined), setUeberlaufKante("d1", "en3", undefined),
      setAttikaOberkante("d1", "at1", 0.4), setTuerschwelleOberkante("d1", "ts1", 0.2), loesche({ art: "wandanschluss", id: "wa1", dachId: "d1" })]) w = ausfuehren(w, b);
    expect(roh(d0(w.aktuell))).toEqual({ ...roh(dach()), wandanschluesse: [] });
    for (let i = 0; i < befehle.length; i++) v = rueckgaengig(v);
    expect(v.aktuell).toBe(start);
  });
});

describe("v4: Duplizieren und Trennen", () => {
  it("kopiereDachflaechen vergibt neue wa-IDs und schreibt lage.kante um", () => {
    const d = dachV4();
    const [k] = kopiereDachflaechen([d], ["d1", "p12", "wa1", "en3", "zo1", "au1", "at1", "ts1"]);
    const w = k!.wandanschluesse![0]!;
    expect(w.id).toBe("wa2");
    const idx = d.kontur.findIndex((p) => p.id === "p4");
    expect(w.lage).toEqual({ kante: k!.kontur[idx]!.id, abstand: 1 });
    expect(w.lage.kante).not.toBe("p4");
    // ohne Wandanschlüsse kein neuer Schlüssel
    const [k2] = kopiereDachflaechen([dach()], ["d1", "p12"]);
    expect(Object.hasOwn(k2!, "wandanschluesse")).toBe(false);
  });

  it("Trennen erhält Wandanschluss (Kante umgeschrieben) und Belagdicke", () => {
    const d = { ...dachV4(), wandanschluesse: [{ id: "wa1", name: "W", lage: { kante: "p3", abstand: 13 }, laenge: 5 }] }; // x = 7 … 2 auf Oberkante y=10
    const m = trenneDachflaeche("d1", { x: 10, y: -1 }, { x: 10, y: 11 }).anwenden(modell(d));
    expect(m.dachflaechen).toHaveLength(2);
    const mit = m.dachflaechen.filter((x) => wandanschluesseVon(x).length > 0);
    expect(mit).toHaveLength(1);
    expect(m.dachflaechen.every((x) => x.belagDicke === 0.06)).toBe(true);
    const w = wandanschluesseVon(mit[0]!)[0]!;
    expect(mit[0]!.kontur.some((p) => p.id === w.lage.kante)).toBe(true);
    expect(validateProjekt(projektAusModell(m))).toEqual([]);
  });
});
