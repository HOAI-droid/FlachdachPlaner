import { describe, expect, it } from "vitest";
import {
  addDachflaeche, ausfuehren, computeSlope, createProject, klick, loesche, neuerVerlauf, neuerZustand, rueckgaengig,
  setEntwaesserungTyp, setEntwaesserungZ, setzeAblaufZ, validateProject, waehle, waehleWerkzeug,
  type ProjectModel, type WerkzeugId,
} from "../src/core/index";

const P = (x: number, y: number) => ({ x, y });
const basis = (): ProjectModel => {
  const v = ausfuehren(neuerVerlauf(createProject("T", "2026-01-01T00:00:00Z")), addDachflaeche([P(0, 0), P(20, 0), P(20, 10), P(0, 10)]));
  return v.aktuell;
};
const setze = (m: ProjectModel, tool: WerkzeugId, pts: { x: number; y: number }[], z = 0, typ = null as null | { packId: string; eintragId: string; version?: string }) => {
  let st = setzeAblaufZ(waehleWerkzeug(neuerZustand(), tool), z);
  let v = neuerVerlauf(m);
  for (const p of pts) {
    const r = klick(st, v.aktuell, p, 0.1, { typ: () => typ });
    st = r.zustand;
    if (r.befehl) v = ausfuehren(v, r.befehl);
  }
  return v;
};

describe("Entwässerungswerkzeuge (Schritt 18)", () => {
  it("Gully setzen: Typ, Kote z, gültiges Modell, Undo", () => {
    const v = setze(basis(), "gully", [P(10, 5)], -0.05);
    const e = v.aktuell.dachflaechen[0]!.entwaesserung;
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ art: "gully", id: "en1", name: "Gully 1", z: -0.05, position: P(10, 5) });
    expect(validateProject(v.aktuell)).toEqual([]);
    expect(rueckgaengig(v).aktuell.dachflaechen[0]!.entwaesserung).toHaveLength(0);
  });

  it("Klick außerhalb setzt nichts, gibt Hinweis", () => {
    const r = klick(waehleWerkzeug(neuerZustand(), "gully"), basis(), P(30, 5), 0.1);
    expect(r.befehl).toBeUndefined();
    expect(r.zustand.hinweis).toMatch(/innerhalb/);
  });

  it("Notablauf, Dachreiter (Kante) und LES (zwei Klicks) werden fortlaufend nummeriert", () => {
    let m = setze(basis(), "notablauf", [P(5, 5)]).aktuell;
    m = setze(m, "dachreiter", [P(20, 4)], 0.01).aktuell;
    m = setze(m, "les", [P(2, 8), P(12, 8)], 0.02, { packId: "bauder-les", eintragId: "pir-t-les", version: "0.1.0" }).aktuell;
    const e = m.dachflaechen[0]!.entwaesserung;
    expect(e.map((x) => [x.id, x.art])).toEqual([["en1", "notablauf"], ["en2", "dachreiter"], ["en3", "les"]]);
    expect(e[1]).toMatchObject({ lage: { abstand: 4 }, z: 0.01 });
    expect(e[2]).toMatchObject({ von: P(2, 8), bis: P(12, 8), z: 0.02, typ: { eintragId: "pir-t-les" } });
    expect(validateProject(m)).toEqual([]);
  });

  it("Änderung von z führt zu neuer Berechnung (Koten wandern)", () => {
    const v = setze(basis(), "gully", [P(10, 5)], 0);
    const hoch = (m: ProjectModel) => computeSlope(m).dachflaechen[0]!.hochpunkt!.kote;
    const h0 = hoch(v.aktuell);
    const v2 = ausfuehren(v, setEntwaesserungZ("d1", "en1", -0.1));
    expect(v2.aktuell.dachflaechen[0]!.entwaesserung[0]!.z).toBe(-0.1);
    expect(hoch(v2.aktuell)).toBeCloseTo(h0 - 0.1, 9);
    expect(rueckgaengig(v2).aktuell.dachflaechen[0]!.entwaesserung[0]!.z).toBe(0);
  });

  it("Typ setzen, Auswählen, Löschen", () => {
    let v = setze(basis(), "les", [P(2, 8), P(12, 8)]);
    v = ausfuehren(v, setEntwaesserungTyp("d1", "en1", { packId: "bauder-les", eintragId: "pir-t-les", version: "0.1.0" }));
    expect(validateProject(v.aktuell)).toEqual([]);
    expect(v.aktuell.dachflaechen[0]!.entwaesserung[0]!.typ?.eintragId).toBe("pir-t-les");
    expect(waehle(v.aktuell, P(7, 8.02), 0.1)).toEqual({ art: "entwaesserung", id: "en1", dachId: "d1" });
    v = ausfuehren(v, loesche({ art: "entwaesserung", id: "en1", dachId: "d1" }));
    expect(v.aktuell.dachflaechen[0]!.entwaesserung).toHaveLength(0);
  });

  it("LES: zweiter Punkt = erster ergibt Hinweis, Esc-Zustand bleibt sauber", () => {
    let st = waehleWerkzeug(neuerZustand(), "les");
    st = klick(st, basis(), P(2, 8), 0.1).zustand;
    const r = klick(st, basis(), P(2, 8), 0.1);
    expect(r.befehl).toBeUndefined();
    expect(r.zustand.hinweis).toBeTruthy();
  });
});
