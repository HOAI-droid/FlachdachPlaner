/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import {
  PACK_TYPEN, bewerteEinzugsflaeche, loadRulePack, packHinweise, parseRulePack, regelParameter, validateRulePack,
  type RegelPack, type RulePack,
} from "../src/core/index";

// Dateien als Text über Vite (ohne Node-Typen): Beispiel-Packs und Kernquellen.
const roh = (m: Record<string, unknown>) => m as Record<string, string>;
const packTexte = roh(import.meta.glob("../rulepacks/*/pack.json", { eager: true, query: "?raw", import: "default" }));
const kernQuellen = roh(import.meta.glob("../src/core/**/*.ts", { eager: true, query: "?raw", import: "default" }));
const packText = (ordner: string): string => packTexte[`../rulepacks/${ordner}/pack.json`]!;
const packOrdner: string[] = Object.keys(packTexte).map((k) => k.split("/")[2]!).sort();
const lies = (ordner: string): Record<string, unknown> => JSON.parse(packText(ordner));
const kopie = <T>(v: T): T => structuredClone(v);

function lade<T extends RulePack>(raw: unknown): T {
  const r = loadRulePack(raw);
  if (!r.ok) throw new Error(JSON.stringify(r.fehler));
  return r.pack as T;
}

const kopf = { version: "1.0.0", quelle: "Test", ausgabe: "Test", gueltigAb: "2026-01-01", geprueft: true };
const regelPack = (hinweisAb: number, fehlerUeber: number): unknown => ({
  id: "test-regeln", typ: "regeln", ...kopf,
  daten: { regeln: [{ id: "flaeche-je-ablauf", titel: "Fläche je Ablauf", parameter: {
    hinweisAb: { wert: hinweisAb, einheit: "m2" }, fehlerUeber: { wert: fehlerUeber, einheit: "m2" } } }] },
});
const dachreiterPack = (): Record<string, unknown> => ({
  id: "test-dr", typ: "dachreiter", ...kopf,
  daten: { eintraege: [{ id: "dr-1", hersteller: "Test", produkt: "Test-DR", art: "haupt", breite: 0.2, hoehe: 0.1, einbaulaenge: 0.4,
    abflussleistung: [{ anstau: 0.035, q: 5 }] }] },
});

describe("Beispiel-Packs", () => {
  it("es gibt je Pack-Typ mindestens ein Beispiel", () => {
    const typen = new Set(packOrdner.map((o) => lies(o)["typ"]));
    for (const t of PACK_TYPEN) expect(typen, t).toContain(t);
  });

  it.each(packOrdner)("%s validiert, Ordner = id, $schema passt zum Typ", (ordner) => {
    const raw = lies(ordner);
    expect(validateRulePack(raw)).toEqual([]);
    expect(raw["id"]).toBe(ordner);
    expect(raw["$schema"]).toBe(`../schema/${String(raw["typ"])}.schema.json`);
  });

  it.each(packOrdner)("%s ist ungeprüft und erzeugt den Hinweis \"Regelwerk ungeprüft\"", (ordner) => {
    const r = loadRulePack(lies(ordner));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pack.geprueft).toBe(false);
    expect(r.hinweise).toHaveLength(1);
    expect(r.hinweise[0]).toMatchObject({ code: "pack-ungeprueft", packId: ordner });
    expect(r.hinweise[0]!.meldung).toMatch(/^Regelwerk ungeprüft/);
  });

  it("geprüftes Pack erzeugt keinen Hinweis", () => {
    const r = loadRulePack(regelPack(300, 350));
    expect(r.ok && r.hinweise).toEqual([]);
  });

  it("Bauder-LES: längs 1 %, quer 4 %, diagonal 3,5 %, Keil 6,00 × 1,50 m, 10→70 mm", () => {
    const p = lade<Extract<RulePack, { typ: "les" }>>(lies("bauder-les"));
    const e = p.daten.eintraege.find((x) => x.id === "pir-t-les")!;
    expect(e.gefaelle).toEqual({ laengs: 0.01, quer: 0.04, diagonal: 0.035 });
    expect(e.keil).toEqual({ laenge: 6.0, breiteJeSeite: 1.5, dickeMin: 0.01, dickeMax: 0.07 });
  });

  it("Dämmplatten: Format 1,00 × 1,00 m, Dickenstufen lückenlos", () => {
    const p = lade<Extract<RulePack, { typ: "daemmplatten" }>>(lies("daemmplatten"));
    expect(p.daten.format).toEqual({ laenge: 1, breite: 1 });
    expect(p.daten.typen.length).toBeGreaterThan(1);
  });
});

describe("Pflichtfelder und Struktur", () => {
  it("Pack ohne quelle wird abgelehnt", () => {
    const raw = kopie(lies("zvdh-2026"));
    delete raw["quelle"];
    const r = loadRulePack(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fehler).toContainEqual({ pfad: "/quelle", meldung: "Pflichtfeld fehlt" });
  });

  it.each(["id", "version", "quelle", "ausgabe", "gueltigAb", "geprueft"])("fehlendes %s → Fehler am Feld (auch ohne Typ)", (feld) => {
    for (const ohneTyp of [false, true]) {
      const raw = kopie(lies("bauder-les"));
      delete raw[feld];
      if (ohneTyp) delete raw["typ"];
      const f = validateRulePack(raw);
      expect(f).toContainEqual({ pfad: `/${feld}`, meldung: "Pflichtfeld fehlt" });
      if (ohneTyp) expect(f).toContainEqual({ pfad: "/typ", meldung: "Pflichtfeld fehlt" });
    }
  });

  it("leere quelle (nur Leerzeichen) wird abgelehnt", () => {
    const raw = { ...lies("zvdh-2026"), quelle: "   " };
    expect(validateRulePack(raw)).toContainEqual({ pfad: "/quelle", meldung: "Darf nicht leer sein" });
  });

  it("geprueft muss Wahrheitswert sein, gueltigAb ISO-Datum", () => {
    const raw = { ...lies("zvdh-2026"), geprueft: "nein", gueltigAb: "01.01.2026" };
    const f = validateRulePack(raw);
    expect(f).toContainEqual({ pfad: "/geprueft", meldung: "Wahrheitswert erwartet" });
    expect(f).toContainEqual({ pfad: "/gueltigAb", meldung: "Ungültiges Format" });
  });

  it("unbekannter Typ → Fehler an /typ", () => {
    const f = validateRulePack({ ...lies("zvdh-2026"), typ: "foo" });
    expect(f.some((e) => e.pfad === "/typ" && e.meldung.startsWith("Erwartet: regeln"))).toBe(true);
  });

  it("unbekannte Felder auf jeder Ebene werden gemeldet", () => {
    const raw = kopie(lies("bauder-les")) as { extra?: number; daten: { eintraege: Record<string, unknown>[] } };
    raw.extra = 1;
    raw.daten.eintraege[0]!["farbe"] = "rot";
    const f = validateRulePack(raw);
    expect(f).toContainEqual({ pfad: "/extra", meldung: "Unbekanntes Feld" });
    expect(f).toContainEqual({ pfad: "/daten/eintraege/0/farbe", meldung: "Unbekanntes Feld" });
  });

  it("Fehlerpfade im JSON-Pointer-Format mit Wertebereich", () => {
    const raw = kopie(lies("bauder-les")) as { daten: { eintraege: { keil: Record<string, unknown>; gefaelle: Record<string, unknown> }[] } };
    raw.daten.eintraege[0]!.keil["laenge"] = -1;
    raw.daten.eintraege[0]!.gefaelle["quer"] = "4 %";
    const f = validateRulePack(raw);
    expect(f).toContainEqual({ pfad: "/daten/eintraege/0/keil/laenge", meldung: "Wert muss > 0 sein" });
    expect(f).toContainEqual({ pfad: "/daten/eintraege/0/gefaelle/quer", meldung: "Endliche Zahl erwartet" });
  });

  it("kein Objekt / kein JSON → Fehler an der Wurzel", () => {
    expect(validateRulePack([])).toEqual([{ pfad: "", meldung: "Pack muss ein JSON-Objekt sein" }]);
    const r = parseRulePack("{ kaputt");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fehler[0]!.pfad).toBe("");
  });

  it("parseRulePack liest Pack-Text", () => {
    const r = parseRulePack(packText("zvdh-2026"));
    expect(r.ok).toBe(true);
  });
});

describe("Typspezifische Prüfungen", () => {
  it("Dachreiter: Herstellermaße werden geladen, fehlende Breite abgelehnt", () => {
    const p = lade<Extract<RulePack, { typ: "dachreiter" }>>(dachreiterPack());
    expect(p.daten.eintraege[0]).toMatchObject({ breite: 0.2, hoehe: 0.1, einbaulaenge: 0.4 });
    const raw = dachreiterPack() as { daten: { eintraege: Record<string, unknown>[] } };
    delete raw.daten.eintraege[0]!["breite"];
    expect(validateRulePack(raw)).toContainEqual({ pfad: "/daten/eintraege/0/breite", meldung: "Pflichtfeld fehlt" });
  });

  it("doppelte Eintrags-IDs werden gemeldet", () => {
    const raw = dachreiterPack() as { daten: { eintraege: unknown[] } };
    raw.daten.eintraege.push(kopie(raw.daten.eintraege[0]));
    expect(validateRulePack(raw)).toEqual([{ pfad: "/daten/eintraege/1/id", meldung: 'Doppelte ID "dr-1" (wie Eintrag 0)' }]);
  });

  it("Dämmplatten: Lücke Enddicke Typ n ≠ Anfangsdicke Typ n+1", () => {
    const raw = kopie(lies("daemmplatten")) as { daten: { typen: { dickeAnfang: number }[] } };
    raw.daten.typen[3]!.dickeAnfang = 0.065;
    const f = validateRulePack(raw);
    expect(f).toHaveLength(1);
    expect(f[0]!.pfad).toBe("/daten/typen/3/dickeAnfang");
    expect(f[0]!.meldung).toMatch(/^Lücke: Enddicke Typ 3/);
  });

  it("Dämmplatten: Kehlkeil mit unbekanntem Plattentyp", () => {
    const raw = kopie(lies("daemmplatten")) as { daten: { kehlkeile: unknown[] } };
    raw.daten.kehlkeile = [{ id: "K9L", typ: "9", seite: "L", laenge: 1, breite: 1 }];
    expect(validateRulePack(raw)).toEqual([{ pfad: "/daten/kehlkeile/0/typ", meldung: 'Plattentyp "9" nicht in typen' }]);
  });

  it("Regenspenden: Werteanzahl muss spalten × zeilen sein", () => {
    const raw = kopie(lies("kostra-dwd-2020")) as { daten: { raster: { spalten: number } } };
    raw.daten.raster.spalten = 2;
    const f = validateRulePack(raw);
    expect(f.map((e) => e.pfad)).toEqual(["/daten/werte/r5_5", "/daten/werte/r5_100"]);
  });

  it("Orte: PLZ fünfstellig", () => {
    const raw = kopie(lies("orte-plz")) as { daten: { eintraege: unknown[] } };
    raw.daten.eintraege = [{ plz: "1234", ort: "X", lat: 52, lon: 13 }];
    expect(validateRulePack(raw)).toContainEqual({ pfad: "/daten/eintraege/0/plz", meldung: "Ungültiges Format" });
  });

  it("Regeln: hinweisAb > fehlerUeber wird abgelehnt", () => {
    expect(validateRulePack(regelPack(400, 350))).toEqual([
      { pfad: "/daten/regeln/0/parameter/hinweisAb", meldung: "hinweisAb muss ≤ fehlerUeber sein" },
    ]);
  });

  it("ungeprüftes Pack: packHinweise", () => {
    const p = lade<RegelPack>(lies("zvdh-2026"));
    expect(packHinweise(p)[0]!.meldung).toContain("Regelwerk ungeprüft");
  });
});

describe("Grenzwerte 300/350 m² nur aus Pack", () => {
  const zvdh = () => lade<RegelPack>(lies("zvdh-2026"));

  it("Beispiel-Pack: Grenzen 300 (Hinweis ab) und 350 (Fehler über)", () => {
    const st = (a: number) => bewerteEinzugsflaeche(a, zvdh())!.stufe;
    expect([st(299.99), st(300), st(350), st(350.01)]).toEqual(["ok", "hinweis", "hinweis", "fehler"]);
    const b = bewerteEinzugsflaeche(320, zvdh())!;
    expect(b.hinweisAb).toMatchObject({ wert: 300, regelId: "flaeche-je-ablauf", packId: "zvdh-2026" });
    expect(b.hinweisAb.quelle).toBe(zvdh().quelle);
  });

  it("Pack mit 250/280 ändert das Ergebnis", () => {
    const eigen = lade<RegelPack>(regelPack(250, 280));
    expect(bewerteEinzugsflaeche(240, zvdh())!.stufe).toBe("ok");
    expect(bewerteEinzugsflaeche(260, zvdh())!.stufe).toBe("ok");
    expect(bewerteEinzugsflaeche(290, zvdh())!.stufe).toBe("ok");
    expect(bewerteEinzugsflaeche(240, eigen)!.stufe).toBe("ok");
    expect(bewerteEinzugsflaeche(260, eigen)!.stufe).toBe("hinweis");
    expect(bewerteEinzugsflaeche(290, eigen)!.stufe).toBe("fehler");
  });

  it("fehlt die Regel im Pack → null (keine Ersatzwerte im Code)", () => {
    const leer = lade<RegelPack>({ id: "leer", typ: "regeln", ...kopf, daten: { regeln: [] } });
    expect(bewerteEinzugsflaeche(1000, leer)).toBeNull();
    expect(regelParameter(leer, "flaeche-je-ablauf", "hinweisAb")).toBeNull();
    expect(regelParameter(zvdh(), "flaeche-je-ablauf", "toString")).toBeNull();
  });

  it("src/core enthält keine Grenzwerte 300/350 als Zahl", () => {
    const dateien = Object.entries(kernQuellen);
    expect(dateien.some(([d]) => d.includes("/rules/"))).toBe(true);
    for (const [d, text] of dateien) expect(text, d).not.toMatch(/(?<![\w.])(300|350)(?![\w])/);
  });
});
