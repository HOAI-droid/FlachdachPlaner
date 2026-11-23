import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  MIGRATIONS, SCHEMA_VERSION, createProject, dachPolygon, konturKante, parseProject, polygonArea,
  serializeProject, validateProject,
  type Dachflaeche, type Entwaesserung, type Kontur, type MigrationChain, type ProjectModel,
} from "../src/core/index";

const pt = (id: string, x: number, y: number) => ({ id, x, y });
const rechteck = (pre: string, x0: number, y0: number, w: number, h: number): Kontur =>
  [pt(`${pre}1`, x0, y0), pt(`${pre}2`, x0 + w, y0), pt(`${pre}3`, x0 + w, y0 + h), pt(`${pre}4`, x0, y0 + h)];

/** Vollständiges Beispielprojekt: 20×10-Dach mit allen Objektarten. */
function beispiel(): ProjectModel {
  const dach: Dachflaeche = {
    id: "d1", name: "Hauptdach", typ: "dach",
    kontur: rechteck("k", 0, 0, 20, 10),
    aufbauten: [{ id: "a1", name: "Lichtkuppel", kontur: rechteck("ak", 8, 4, 1.2, 1.2) }],
    zonen: [
      { id: "z1", name: "Terrasse", kontur: rechteck("zk", 14, 0, 6, 4), hoehenversatz: -0.1, vorgaben: { minTiefpunkt: -0.2 } },
      { id: "z2", name: "Technik", kontur: rechteck("zt", 0, 6, 3, 4), hoehenversatz: 0, gefaelle: 0, begruendung: "Aufstellfläche Lüftungsgerät" },
    ],
    vorgaben: { maxHochpunkt: 0.25, minTiefpunkt: 0 },
    attika: [{ id: "at1", kante: "k1", breite: 0.3, oberkante: 0.5 }, { id: "at2", kante: "k2", breite: 0.25 }],
    tuerschwellen: [{ id: "t1", name: "Tür Treppenhaus", lage: { kante: "k4", abstand: 2 }, breite: 1.01, oberkante: 0.15, barrierefrei: true }],
    entwaesserung: [
      { id: "e1", art: "gully", name: "G1", typ: { packId: "loro", eintragId: "x-100" }, position: { x: 10, y: 5 }, z: 0 },
      { id: "e2", art: "notablauf", name: "N1", typ: null, position: { x: 12, y: 5 }, z: 0.035 },
      { id: "e3", art: "dachreiter", name: "DR1", typ: { packId: "loro", eintragId: "dr-1" }, lage: { kante: "k1", abstand: 5 }, z: -0.02 },
      { id: "e4", art: "les", name: "LES 6 m", typ: { packId: "bauder-les", eintragId: "pir-t-les" }, von: { x: 2, y: 1 }, bis: { x: 8, y: 1 }, z: 0 },
    ],
    daemmdickeTiefpunkt: 20,
  };
  return {
    ...createProject("Musterstraße 1", "2026-11-22T10:00:00Z"),
    meta: { name: "Musterstraße 1", projektnummer: "2026-042", erstelltAm: "2026-11-22T10:00:00Z", geaendertAm: "2026-11-22T11:30:00+01:00" },
    packVersionen: { "zvdh-2026": "1.0.0", loro: "2025.1", "bauder-les": "0.1.0" },
    standort: {
      bezeichnung: "12345 Musterstadt",
      koordinate: { lat: 52.52, lon: 13.405 },
      regen: { r5_5: { packWert: 266.7 }, r5_100: { packWert: 586.7, manuellWert: 600 } },
    },
    dachflaechen: [dach],
    unterlage: {
      dateiname: "Grundriss_DG.pdf", art: "pdf",
      pruefsumme: { algorithmus: "sha-256", wert: "a".repeat(64) },
      seite: 1, massstab: 100,
      passpunkte: [{ unterlage: { x: 10, y: 20 }, welt: { x: 0, y: 0 } }, { unterlage: { x: 210, y: 20 }, welt: { x: 20, y: 0 } }],
    },
  };
}

/** Tiefe Kopie in Dachflächen-Form (Ansicht bzw. v1/v2-Datei) als veränderbares Rohdokument (für Negativtests). */
const roh = (p: ProjectModel) => JSON.parse(JSON.stringify(p)) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const fehlerPfade = (doc: unknown) => validateProject(doc).map((f) => f.pfad);

describe("Modell", () => {
  it("createProject: gültig, Gefälle-Standard 2 %, aktuelle Schemaversion", () => {
    const p = createProject("Neu", "2026-01-01T00:00:00Z");
    expect(p.gefaelleStandard).toBe(0.02);
    expect(p.schemaVersion).toBe(SCHEMA_VERSION);
    expect(validateProject(p)).toEqual([]);
  });
  it("Beispielprojekt ist gültig", () => expect(validateProject(beispiel())).toEqual([]));
  it("dachPolygon: Aufbauten sind Löcher", () => {
    const d = beispiel().dachflaechen[0]!;
    expect(polygonArea(dachPolygon(d))).toBeCloseTo(200 - 1.44, 9);
  });
  it("konturKante: Kante bis zum nächsten Punkt, letzte Kante schließt", () => {
    const k = beispiel().dachflaechen[0]!.kontur;
    expect(konturKante(k, "k4")?.map((p) => p.id)).toEqual(["k4", "k1"]);
    expect(konturKante(k, "nix")).toBeUndefined();
  });
});

describe("Projekt-JSON Round-Trip", () => {
  it("Beispiel: parse(serialize(p)) = p und Ausgabe stabil", () => {
    const p = beispiel();
    const s = serializeProject(p);
    const r = parseProject(s);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.projekt).toEqual(p);
    expect(r.hinweise).toEqual([]);
    expect(serializeProject(r.projekt)).toBe(s);
  });
  it("Schlüsselreihenfolge unabhängig von der Eingabereihenfolge, schemaVersion zuerst", () => {
    const p = beispiel();
    const umgedreht = JSON.parse(JSON.stringify(p), (_k, v) =>
      v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v);
    expect(serializeProject(umgedreht)).toBe(serializeProject(p));
    expect(serializeProject(p).startsWith(`{\n  "schemaVersion": ${SCHEMA_VERSION},`)).toBe(true);
  });
  it("undefined-Felder entfallen", () => {
    const p = { ...beispiel(), meta: { ...beispiel().meta, notiz: undefined } };
    expect(serializeProject(p)).not.toContain("notiz");
  });
});

describe("Validierung: strukturierte Fehlerliste mit Pfaden (wirft nie)", () => {
  it("kein JSON / kein Objekt", () => {
    const r = parseProject("{kaputt");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fehler[0]!.pfad).toBe("");
    expect(validateProject(null)).toEqual([{ pfad: "", meldung: "Projekt muss ein JSON-Objekt sein" }]);
    expect(() => validateProject([1, 2])).not.toThrow();
  });
  it("mehrere Fehler auf einmal, je mit JSON-Pointer-Pfad", () => {
    const d = roh(beispiel());
    d["gefaelleStandard"] = "2%";
    d["dachflaechen"][0]["kontur"][2]["x"] = null;
    delete d["meta"]["name"];
    d["dachflaechen"][0]["typ"] = "balkon";
    d["dachflaechen"][0]["unbekannt"] = 1;
    const r = { fehler: validateProject(d) };
    expect(r.fehler.map((f) => f.pfad)).toEqual(expect.arrayContaining([
      "/gefaelleStandard", "/dachflaechen/0/kontur/2/x", "/meta/name", "/dachflaechen/0/typ", "/dachflaechen/0/unbekannt",
    ]));
    expect(r.fehler.every((f) => f.meldung.length > 0)).toBe(true);
    // fehlendes Pflichtfeld nur einmal gemeldet
    expect(r.fehler.filter((f) => f.pfad === "/meta/name")).toHaveLength(1);
  });
  it("doppelte ID", () => {
    const d = roh(beispiel());
    d["dachflaechen"][0]["zonen"][1]["id"] = "z1";
    expect(fehlerPfade(d)).toEqual(["/dachflaechen/0/zonen/1/id"]);
  });
  it("Kantenbezug unbekannt bzw. außerhalb der Kante", () => {
    const d = roh(beispiel());
    d["dachflaechen"][0]["attika"][0]["kante"] = "k9";
    d["dachflaechen"][0]["entwaesserung"][2]["lage"]["abstand"] = 20.5; // Kante k1 ist 20 m lang
    d["dachflaechen"][0]["tuerschwellen"][0]["lage"]["abstand"] = 9.5; // k4 10 m, Breite 1,01
    expect(fehlerPfade(d)).toEqual([
      "/dachflaechen/0/attika/0/kante",
      "/dachflaechen/0/tuerschwellen/0/lage/abstand",
      "/dachflaechen/0/entwaesserung/2/lage/abstand",
    ]);
  });
  it("0-%-Zone ohne Begründung", () => {
    const d = roh(beispiel());
    d["dachflaechen"][0]["zonen"][1]["begruendung"] = "  ";
    expect(fehlerPfade(d)).toEqual(["/dachflaechen/0/zonen/1/begruendung"]);
  });
  it("Pack-Referenz ohne eingetragene Pack-Version", () => {
    const d = roh(beispiel());
    delete d["packVersionen"]["loro"];
    expect(fehlerPfade(d)).toEqual(["/dachflaechen/0/entwaesserung/0/typ/packId", "/dachflaechen/0/entwaesserung/2/typ/packId"]);
  });
  it("entartete Kontur, LES Länge 0, Passpunkte, Prüfsumme, Regenwert, Koordinate", () => {
    const d = roh(beispiel());
    d["dachflaechen"][0]["aufbauten"][0]["kontur"] = [pt("q1", 0, 0), pt("q2", 1, 1), pt("q3", 2, 2)];
    d["dachflaechen"][0]["entwaesserung"][3]["bis"] = { x: 2, y: 1 };
    d["unterlage"]["passpunkte"][1]["welt"] = { x: 0, y: 0 };
    d["unterlage"]["pruefsumme"]["wert"] = "xyz";
    d["standort"]["regen"]["r5_100"]["manuellWert"] = -1;
    d["standort"]["koordinate"]["lat"] = 91;
    expect(fehlerPfade(d).sort()).toEqual([
      "/dachflaechen/0/aufbauten/0/kontur",
      "/dachflaechen/0/entwaesserung/3/bis",
      "/standort/koordinate/lat",
      "/standort/regen/r5_100/manuellWert",
      "/unterlage/passpunkte/1/welt",
      "/unterlage/pruefsumme/wert",
    ]);
  });
  it("NaN/Infinity werden abgelehnt (validateProject auf Objekten)", () => {
    const p = { ...beispiel(), gefaelleStandard: Number.NaN };
    expect(fehlerPfade(p)).toEqual(["/gefaelleStandard"]);
  });
  it("Ablauf-Kote z: Pflicht, endliche Zahl; daemmdickeTiefpunkt optional, ≥ 0", () => {
    const d = roh(beispiel());
    delete d["dachflaechen"][0]["entwaesserung"][0]["z"];
    d["dachflaechen"][0]["entwaesserung"][3]["z"] = "0,00";
    d["dachflaechen"][0]["daemmdickeTiefpunkt"] = -5;
    expect(fehlerPfade(d)).toEqual([
      "/dachflaechen/0/daemmdickeTiefpunkt",
      "/dachflaechen/0/entwaesserung/0/z",
      "/dachflaechen/0/entwaesserung/3/z",
    ]);
    const ohne = roh(beispiel());
    delete ohne["dachflaechen"][0]["daemmdickeTiefpunkt"];
    expect(fehlerPfade(ohne)).toEqual([]);
  });
  it("Schlüssel mit / und ~ werden im Pfad maskiert", () => {
    const d = roh(beispiel());
    d["packVersionen"]["a/b~c"] = "1";
    expect(fehlerPfade(d)).toEqual(["/packVersionen/a~1b~0c"]);
  });
});

describe("Schemaversion und Migration", () => {
  it("neuere schemaVersion → Hinweis, keine Validierung", () => {
    const d = roh(beispiel());
    d["schemaVersion"] = SCHEMA_VERSION + 1;
    const r = parseProject(JSON.stringify(d));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.neuereVersion).toBe(true);
    expect(r.fehler).toHaveLength(1);
    expect(r.fehler[0]!.pfad).toBe("/schemaVersion");
    expect(r.fehler[0]!.meldung).toMatch(/aktualisieren/);
  });
  it("fehlende oder ungültige schemaVersion", () => {
    for (const sv of [undefined, "1", 0, 1.5]) {
      const d = roh(beispiel());
      d["schemaVersion"] = sv;
      const r = parseProject(JSON.stringify(d));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.fehler[0]!.pfad).toBe("/schemaVersion");
    }
  });
  it("Migration v1→v2: Abläufe erhalten z = 0, Rest unverändert", () => {
    const neu = beispiel();
    const v1 = roh(neu);
    v1["schemaVersion"] = 1;
    for (const e of v1["dachflaechen"][0]["entwaesserung"]) delete e["z"];
    const r = parseProject(JSON.stringify(v1));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const erwartet = {
      ...neu,
      dachflaechen: neu.dachflaechen.map((d) => ({ ...d, entwaesserung: d.entwaesserung.map((e) => ({ ...e, z: 0 })) })),
    };
    expect(r.projekt).toEqual(erwartet);
    expect(r.hinweise).toEqual([`Projekt von Schemaversion 1 auf ${SCHEMA_VERSION} migriert.`]);
  });
  it("Migration v1→v2 wirft nicht bei kaputter Struktur; Validierung meldet Fehler mit Pfad", () => {
    const v1 = roh(beispiel());
    v1["schemaVersion"] = 1;
    v1["dachflaechen"][0]["entwaesserung"][1] = 7;
    v1["dachflaechen"][1] = { entwaesserung: "x" };
    expect(() => parseProject(JSON.stringify(v1))).not.toThrow();
    const r = parseProject(JSON.stringify(v1));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fehler.map((f) => f.pfad)).toEqual(expect.arrayContaining(["/varianten/0/dachflaechen/0/entwaesserung/1", "/varianten/0/dachflaechen/1/entwaesserung"]));
    const leer = { ...roh(beispiel()), schemaVersion: 1, dachflaechen: "kaputt" };
    expect(parseProject(JSON.stringify(leer)).ok).toBe(false);
  });
  it("Beispiel-Migration v3→v4 (angenommen): Kette wird fortgesetzt", () => {
    // Angenommene v3: Gefälle in Prozent unter "gefaelleProzent"; v4 = heutige v3-Form (m/m).
    const kette: MigrationChain = {
      ...MIGRATIONS,
      3: (doc) => {
        const { gefaelleProzent, ...rest } = doc;
        return { ...rest, gefaelleStandard: (gefaelleProzent as number) / 100 };
      },
    };
    const neu = { ...beispiel(), schemaVersion: 4 };
    const { gefaelleStandard, ...alt } = JSON.parse(serializeProject(beispiel())) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const v3 = { ...alt, schemaVersion: 3, gefaelleProzent: gefaelleStandard * 100 };
    const r = parseProject(JSON.stringify(v3), { migrations: kette, zielVersion: 4 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.projekt).toEqual(neu);
    expect(r.hinweise).toEqual(["Projekt von Schemaversion 3 auf 4 migriert."]);
  });
  it("Lücke in der Migrationskette → Fehler", () => {
    const r = parseProject(serializeProject(beispiel()), { migrations: MIGRATIONS, zielVersion: SCHEMA_VERSION + 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fehler[0]!.meldung).toMatch(new RegExp(`Keine Migration von Schemaversion ${SCHEMA_VERSION} auf ${SCHEMA_VERSION + 1}`));
  });
});

// ---------- Eigenschaftstest: zufällige gültige Projekte ----------

const zahl = (min: number, max: number) =>
  fc.double({ min, max, noNaN: true, noDefaultInfinity: true }).map((v) => (v === 0 ? 0 : v)); // −0 → 0 (JSON)
const vec = fc.record({ x: zahl(-1e4, 1e4), y: zahl(-1e4, 1e4) });
const opt = <T>(a: fc.Arbitrary<T>) => fc.option(a, { nil: undefined });
const text = fc.string({ maxLength: 12 });

/** Sternförmige Kontur (sortierte Winkel, Radius > 0) → einfach, Fläche > 0. */
const ring = fc.record({
  c: vec,
  r: fc.array(zahl(0.5, 50), { minLength: 3, maxLength: 7 }),
}).map(({ c, r }) => r.map((ri, i) => {
  const w = (2 * Math.PI * i) / r.length;
  return { x: c.x + ri * Math.cos(w), y: c.y + ri * Math.sin(w) };
}));

const packRef = fc.option(fc.record({ packId: fc.constantFrom("p1", "p-2"), eintragId: fc.string({ minLength: 1, maxLength: 8 }).filter((s) => s.trim() !== "") }), { nil: null });

const dachRoh = fc.record({
  name: text, typ: fc.constantFrom("dach" as const, "terrasse" as const),
  kontur: ring,
  aufbauten: fc.array(fc.record({ name: text, kontur: ring }), { maxLength: 2 }),
  zonen: fc.array(fc.record({
    name: text, kontur: ring, hoehenversatz: zahl(-1, 1),
    gefaelle: opt(fc.oneof(fc.constant(0), zahl(0, 0.1))), begruendung: fc.string({ minLength: 1, maxLength: 12 }).filter((s) => s.trim() !== ""),
  }), { maxLength: 2 }),
  vorgaben: fc.record({ maxHochpunkt: opt(zahl(1, 2)), minTiefpunkt: opt(zahl(-1, 0)) }),
  attika: fc.array(fc.record({ k: fc.nat(), breite: zahl(0.01, 1), oberkante: opt(zahl(-1, 2)) }), { maxLength: 3 }),
  tuerschwellen: fc.array(fc.record({ k: fc.nat(), t: zahl(0, 1), name: text, barrierefrei: fc.boolean(), oberkante: opt(zahl(-1, 1)) }), { maxLength: 2 }),
  entwaesserung: fc.array(fc.record({
    art: fc.constantFrom("gully" as const, "notablauf" as const, "dachreiter" as const, "les" as const),
    name: text, typ: packRef, a: vec, b: vec, k: fc.nat(), t: zahl(0, 1), z: zahl(-1, 1),
  }), { maxLength: 4 }),
  daemmdickeTiefpunkt: opt(zahl(0, 300)),
});

const projektArb: fc.Arbitrary<ProjectModel> = fc.record({
  idPrefix: fc.string({ minLength: 1, maxLength: 4 }).filter((s) => s.trim() !== ""),
  name: text, notiz: opt(fc.string()),
  koordinate: fc.option(fc.record({ lat: zahl(-90, 90), lon: zahl(-180, 180) }), { nil: null }),
  r55: fc.record({ packWert: fc.option(zahl(0, 1000), { nil: null }), manuellWert: opt(zahl(0, 1000)) }),
  r5100: fc.record({ packWert: fc.option(zahl(0, 1000), { nil: null }), manuellWert: opt(zahl(0, 1000)) }),
  gefaelle: zahl(0, 0.1),
  daecher: fc.array(dachRoh, { maxLength: 3 }),
  unterlage: fc.option(fc.record({
    art: fc.constantFrom("pdf" as const, "dxf" as const), seite: opt(fc.integer({ min: 1, max: 50 })),
    massstab: opt(zahl(1, 1000)), eingebettet: opt(fc.base64String().map((base64) => ({ base64 }))),
    wert: fc.stringMatching(/^[0-9a-f]{64}$/),
  }), { nil: null }),
}).map((g) => {
  let n = 0;
  const id = () => `${g.idPrefix}#${n++}`;
  const kontur = (r: { x: number; y: number }[]) => r.map((p) => ({ id: id(), ...p }));
  const laenge = (k: Kontur, i: number) => {
    const a = k[i]!, b = k[(i + 1) % k.length]!;
    return Math.hypot(b.x - a.x, b.y - a.y);
  };
  const dachflaechen: Dachflaeche[] = g.daecher.map((d) => {
    const k = kontur(d.kontur);
    const pos = (ki: number, t: number, belegt = 0) => {
      const i = ki % k.length;
      return { kante: k[i]!.id, abstand: Math.max(0, t * (laenge(k, i) - belegt)) };
    };
    return {
      id: id(), name: d.name, typ: d.typ, kontur: k,
      aufbauten: d.aufbauten.map((a) => ({ id: id(), name: a.name, kontur: kontur(a.kontur) })),
      zonen: d.zonen.map((z) => ({ id: id(), name: z.name, kontur: kontur(z.kontur), hoehenversatz: z.hoehenversatz, gefaelle: z.gefaelle, begruendung: z.begruendung })),
      vorgaben: d.vorgaben,
      attika: d.attika.map((a) => ({ id: id(), kante: k[a.k % k.length]!.id, breite: a.breite, oberkante: a.oberkante })),
      tuerschwellen: d.tuerschwellen.map((t) => {
        const breite = Math.min(1, laenge(k, t.k % k.length) / 2);
        return { id: id(), name: t.name, lage: pos(t.k, t.t, breite), breite, oberkante: t.oberkante, barrierefrei: t.barrierefrei };
      }),
      entwaesserung: d.entwaesserung.map((e): Entwaesserung => {
        const basis = { id: id(), name: e.name, typ: e.typ, z: e.z };
        switch (e.art) {
          case "dachreiter": return { ...basis, art: e.art, lage: pos(e.k, e.t) };
          case "les": return { ...basis, art: e.art, von: e.a, bis: { x: e.a.x + 1 + Math.abs(e.b.x) / 10, y: e.b.y } };
          default: return { ...basis, art: e.art, position: e.a };
        }
      }),
      daemmdickeTiefpunkt: d.daemmdickeTiefpunkt,
    };
  });
  const p: ProjectModel = {
    schemaVersion: SCHEMA_VERSION,
    meta: { name: g.name, notiz: g.notiz, erstelltAm: "2026-01-01T00:00:00Z", geaendertAm: "2026-02-03T04:05:06.789+01:00" },
    packVersionen: { p1: "1.0", "p-2": "2026.1" },
    standort: { koordinate: g.koordinate, regen: { r5_5: g.r55, r5_100: g.r5100 } },
    gefaelleStandard: g.gefaelle,
    dachflaechen,
    unterlage: g.unterlage && {
      dateiname: "plan." + g.unterlage.art, art: g.unterlage.art,
      pruefsumme: { algorithmus: "sha-256", wert: g.unterlage.wert },
      seite: g.unterlage.seite, massstab: g.unterlage.massstab, eingebettet: g.unterlage.eingebettet,
      passpunkte: [{ unterlage: { x: 0, y: 0 }, welt: { x: 0, y: 0 } }, { unterlage: { x: 100, y: 0 }, welt: { x: 1, y: 0 } }],
    },
  };
  // undefined-Felder entfernen, damit der Vergleich das gespeicherte Modell meint.
  return JSON.parse(JSON.stringify(p)) as ProjectModel;
});

describe("Eigenschaftstest Round-Trip", () => {
  it("zufällige Projekte: gültig, parse(serialize(p)) = p, Ausgabe idempotent", () => {
    fc.assert(fc.property(projektArb, (p) => {
      expect(validateProject(p)).toEqual([]);
      const s = serializeProject(p);
      const r = parseProject(s);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.projekt).toEqual(p);
      expect(serializeProject(r.projekt)).toBe(s);
    }), { numRuns: 200 });
  });
});
