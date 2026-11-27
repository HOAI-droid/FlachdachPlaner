/// <reference types="vite/client" />
/**
 * PLAN M9 Schritt 48: Golden-Fixture `terrasse-tuer-attika.fdp.json`.
 * Dach 20 × 10 m, Gully (10|5) z = 0, Gefälle 2 %. Handrechnung: OK fertig max je Linie = 0,02 · max(|dx|,|dy|) (+ Zone, Belag).
 *  Attika (Kante y = 10): max |dx| = 10 → 0,200; OK 0,45 → AH 0,25 (soll 0,15).
 *  Türen (y = 0) in Terrassenzone −0,10, Belag 0,04: 0,02 · 5 − 0,10 + 0,04 = 0,04; OK 0,10 → AH 0,06.
 *  Soll: mit Rinne 0,05 (ok), ohne Rinne 0,15 (zu niedrig).
 *  Notablauf N1: Kante = z 0,04 + Überlaufkante 0,085 = 0,125 (Nutzerwert), ohne Produktdaten kein h_ü und kein Notwasserstand.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computeAnschluesse, computeNotwasserstaende, computeSlope, loadRulePack, parseProject, runChecks, type EmergencyEstimate, type RulePack } from "../src/core/index";

const packTexte = import.meta.glob("../rulepacks/*/pack.json", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;
const r = loadRulePack(JSON.parse(packTexte["../rulepacks/zvdh-2026/pack.json"]!));
if (!r.ok) throw new Error("Pack");
const PACKS: RulePack[] = [r.pack];
const p = parseProject(readFileSync("tests/fixtures/terrasse-tuer-attika.fdp.json", "utf8"));
if (!p.ok) throw new Error(JSON.stringify(p.fehler));
const m = p.projekt;
const slope = computeSlope(m, { packs: PACKS });
const notfall: EmergencyEstimate[] = [{ einzugsflaecheId: "e1", dachflaecheId: "d1", ablaufId: "g1", flaeche: 200, r: null, c: null, q: 4, sicherheitsbeiwert: 2, anstau: null, qAblauf: null, anzahl: null, bereich: [] }];
const an = (id: string) => computeAnschluesse(m, slope, PACKS).find((a) => a.objektId === id)!;

describe("Golden M9: Terrasse, Tür, Attika, Notablauf", () => {
  it("Attika", () => {
    const a = an("at1");
    expect(a.okFertigMax).toBeCloseTo(0.2, 9);
    expect(a.vorhanden).toBeCloseTo(0.25, 9);
    expect(a.soll).toBe(0.15);
  });
  it("Tür mit und ohne Rinne in der Terrassenzone", () => {
    for (const id of ["t1", "t2"]) { expect(an(id).okFertigMax).toBeCloseTo(0.04, 9); expect(an(id).vorhanden).toBeCloseTo(0.06, 9); }
    expect(an("t1").soll).toBe(0.05);
    expect(an("t2").soll).toBe(0.15);
  });
  it("Notablauf: Kante aus Nutzerwert, ohne Produktdaten keine Schätzung", () => {
    const n = computeNotwasserstaende(m, slope, notfall, PACKS);
    expect(n).toHaveLength(1);
    expect(n[0]!.kante).toBeCloseTo(0.125, 9);
    expect(n[0]!.kanteQuelle).toBe("nutzer");
    expect(n[0]!.ueberfallhoehe).toBeNull();
    expect(n[0]!.wasserstand).toBeNull();
  });
  it("Befunde: nur Tür ohne Rinne zu niedrig, jeder Anschlussbefund mit Regel und Quelle", () => {
    const b = runChecks(m, { slope, notfall }, PACKS);
    const ah = b.filter((x) => x.code.startsWith("anschlusshoehe-"));
    expect(ah.map((x) => x.objektId)).toEqual(["t2"]);
    for (const x of b) { expect(x.regelId).toMatch(/\S/); expect(x.quelle).toMatch(/\S/); }
  });
  it("deterministisch", () => {
    expect(JSON.stringify(computeAnschluesse(m, slope, PACKS))).toBe(JSON.stringify(computeAnschluesse(m, slope, PACKS)));
  });
});
