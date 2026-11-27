/// <reference types="vite/client" />
/** PLAN M9 Schritt 47: Anschlusshöhen und Notentwässerung in PDF und DXF. */
import { describe, expect, it } from "vitest";
import {
  anschlussLabel, computeAnschluesse, computeCatchments, computeNotwasserstaende, computeSlope, createProject, loadRulePack, notLabel,
  type Dachflaeche, type ProjectModel, type RulePack,
} from "../src/core/index";
import { baueProjektDxf, DXF_LAYER, flatten, parseDxf } from "../src/io/dxf";
import { baueProjektPdf, baueVariantenPdf } from "../src/io/pdf/plan";

const packTexte = import.meta.glob("../rulepacks/*/pack.json", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;
const r = loadRulePack(JSON.parse(packTexte["../rulepacks/zvdh-2026/pack.json"]!));
if (!r.ok) throw new Error("Pack");
const PACKS: RulePack[] = [r.pack];

const pt = (id: string, x: number, y: number) => ({ id, x, y });
const dach: Dachflaeche = {
  id: "d1", name: "Dach", typ: "dach", aufbauten: [], zonen: [], vorgaben: {},
  attika: [{ id: "at1", kante: "k3", breite: 0.3, oberkante: 0.4 }],
  tuerschwellen: [{ id: "t1", name: "Tür", lage: { kante: "k1", abstand: 9 }, breite: 2, barrierefrei: false, oberkante: 0.3 }],
  kontur: [pt("k1", 0, 0), pt("k2", 20, 0), pt("k3", 20, 10), pt("k4", 0, 10)],
  entwaesserung: [
    { id: "g1", art: "gully", name: "G1", typ: null, position: { x: 10, y: 5 }, z: 0 },
    { id: "n1", art: "notablauf", name: "N1", typ: null, position: { x: 4, y: 4 }, z: 0.04, ueberlaufKante: 0.085 },
  ],
};
const m: ProjectModel = { ...createProject("Anschluss-Export", "2026-01-01T00:00:00Z"), gefaelleStandard: 0.02, dachflaechen: [dach] };
const slope = computeSlope(m, { packs: PACKS });
const anschluesse = computeAnschluesse(m, slope, PACKS);
const notstaende = computeNotwasserstaende(m, slope, [], PACKS);
const catchments = computeCatchments(m, slope, {});
const eids = new Map(catchments.flaechen.map((f, i) => [f.id, `E${i + 1}`] as const));
const basis = { modell: m, slope, catchments, eids, plan: null, farbe: () => "#77AADD", datum: "01.01.2026", regelwerk: "Test 1.0" };
const roh = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join("");
const pdfText = (s: string) => s.replace(/[()\\]/g, (c) => `\\${c}`).replace(/ü/g, "\\374").replace(/Ü/g, "\\334").replace(/·/g, "\\267").replace(/–/g, "\\226");

describe("Schritt 47: PDF", () => {
  it("Fixture liefert Anschlüsse und Notelement", () => {
    expect(anschluesse.length).toBeGreaterThanOrEqual(2);
    expect(notstaende.length).toBe(1);
  });
  it("ohne Anschlussdaten bleibt die Seitenzahl wie zuvor", () => {
    const s = roh(baueProjektPdf(basis).bytes);
    expect((s.match(/\/Type \/Page /g) ?? []).length).toBe(1);
    expect(s).not.toContain("Anschlusshöhen");
  });
  it("Zusatzblatt enthält Tabellen und Kernwerte (Textsuche)", () => {
    const out = baueProjektPdf({ ...basis, anschluesse, notstaende });
    const s = roh(out.bytes);
    expect((s.match(/\/Type \/Page /g) ?? []).length).toBe(2);
    expect(s).toContain("(Anschlussh\\366hen)");
    expect(s).toContain("(Notentw\\344sserung)");
    const t = anschluesse.find((a) => a.objektId === "t1")!;
    expect(s).toContain(`(${pdfText(anschlussLabel(t.vorhanden, t.soll))})`);
    expect(s).toContain("(Sch\\344tzung)");
    expect(s).toContain(`(${pdfText(notLabel(notstaende[0]!.kante, notstaende[0]!.wasserstand).replace("−", "-"))})`);
    expect(s).not.toContain("NaN");
  });
  it("Mehrvarianten: je Variante ein Zusatzblatt, Blattnummern stimmen, Maßstab unverändert", () => {
    const e = { ...basis, anschluesse, notstaende };
    const out = baueVariantenPdf([{ eingabe: e }, { eingabe: basis }]);
    const s = roh(out.bytes);
    expect((s.match(/\/Type \/Page /g) ?? []).length).toBe(3);
    expect(s).toContain("(3/3)");
    expect(out.massstaebe[0]).toBe(out.massstaebe[1]);
  });
  it("deterministisch", () => {
    const a = baueProjektPdf({ ...basis, anschluesse, notstaende }).bytes, b = baueProjektPdf({ ...basis, anschluesse, notstaende }).bytes;
    expect(roh(a) === roh(b)).toBe(true);
  });
});

describe("Schritt 47: DXF", () => {
  const text = baueProjektDxf({ modell: m, slope, plan: null, anschluesse, notstaende });
  const doc = parseDxf(text);
  it("Layer ANSCHLUSS und NOTENTWAESSERUNG vorhanden", () => {
    expect(DXF_LAYER.anschluss).toBe("ANSCHLUSS");
    expect(DXF_LAYER.notwasser).toBe("NOTENTWAESSERUNG");
    expect(doc.layer).toContain("ANSCHLUSS");
    expect(doc.layer).toContain("NOTENTWAESSERUNG");
    expect(text).not.toContain("NaN");
  });
  /** TEXT-Entitäten (Layer, Text, x, y) direkt aus den Gruppencodes. */
  const texte = (t: string) => {
    const z = t.split("\n"), out: { layer: string; text: string; x: number; y: number }[] = [];
    let cur: { layer: string; text: string; x: number; y: number } | null = null;
    for (let i = 0; i + 1 < z.length; i += 2) {
      const c = z[i]!.trim(), v = z[i + 1]!;
      if (c === "0") { cur = v === "TEXT" ? { layer: "", text: "", x: NaN, y: NaN } : null; if (cur) out.push(cur); }
      else if (cur && c === "8") cur.layer = v;
      else if (cur && c === "1") cur.text = v;
      else if (cur && c === "10" && Number.isNaN(cur.x)) cur.x = Number(v);
      else if (cur && c === "20" && Number.isNaN(cur.y)) cur.y = Number(v);
    }
    return out;
  };
  it("Re-Import: Linien auf ANSCHLUSS, Texte an Ort ± 1 mm mit Label", () => {
    const seg = flatten(doc, { layerSichtbar: new Set(["ANSCHLUSS"]) }).segmente;
    expect(seg.length).toBeGreaterThanOrEqual(anschluesse.length);
    const tx = texte(text).filter((x) => x.layer === "ANSCHLUSS");
    expect(tx).toHaveLength(anschluesse.length);
    const t = anschluesse.find((a) => a.objektId === "t1")!;
    const lab = tx.filter((x) => x.text === anschlussLabel(t.vorhanden, t.soll) && Math.abs(x.x - t.ort.x) <= 0.001 && Math.abs(x.y - t.ort.y - 0.15) <= 0.001);
    expect(lab).toHaveLength(1);
    const nt = texte(text).filter((x) => x.layer === "NOTENTWAESSERUNG");
    expect(nt).toHaveLength(1);
    expect(nt[0]!.text).toContain("Sch\\U+00E4tzung");
    expect(Math.abs(nt[0]!.x - notstaende[0]!.ort.x)).toBeLessThanOrEqual(0.001);
  });
  it("ohne Anschlussdaten keine Entitäten auf den neuen Layern; deterministisch", () => {
    const leer = baueProjektDxf({ modell: m, slope, plan: null });
    expect(texte(leer).some((x) => x.layer === "ANSCHLUSS" || x.layer === "NOTENTWAESSERUNG")).toBe(false);
    expect(baueProjektDxf({ modell: m, slope, plan: null, anschluesse, notstaende })).toBe(text);
  });
});
