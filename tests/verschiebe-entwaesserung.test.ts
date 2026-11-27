import { describe, expect, it } from "vitest";
import {
  addAufbau, addDachflaeche, addDachreiter, addLes, addPunktablauf, ausfuehren, computeSlope, createProject, neuerVerlauf, rueckgaengig,
  validateProject, verschiebeEntwaesserung, wiederholen, type ProjectModel, type Verlauf,
} from "../src/core/index";

const P = (x: number, y: number) => ({ x, y });
/** 20×10 (Kanten p1 unten, p2 rechts, p3 oben, p4 links), Aufbau 2..4 × 2..4, Gully en1, Notablauf en2, Dachreiter en3, LES en4. */
const basis = (): Verlauf => {
  let v = neuerVerlauf(createProject("T", "2026-01-01T00:00:00Z"));
  for (const b of [
    addDachflaeche([P(0, 0), P(20, 0), P(20, 10), P(0, 10)]),
    addAufbau("d1", [P(2, 2), P(4, 2), P(4, 4), P(2, 4)]),
    addPunktablauf("d1", "gully", P(10, 5)),
    addPunktablauf("d1", "notablauf", P(15, 5), 0.05),
    addDachreiter("d1", "p1", 5),
    addLes("d1", P(6, 8), P(14, 8)),
  ]) v = ausfuehren(v, b);
  return v;
};
const entw = (m: ProjectModel, id: string) => m.dachflaechen[0]!.entwaesserung.find((e) => e.id === id)!;

describe("verschiebeEntwaesserung (Schritt 49)", () => {
  it("Gully: Position gesetzt, ein Undo-Schritt, Undo/Redo, Modell gültig, Gefälle neu", () => {
    const v0 = basis();
    const v1 = ausfuehren(v0, verschiebeEntwaesserung("d1", "en1", P(12.5, 4)));
    expect(v1.zurueck).toHaveLength(v0.zurueck.length + 1);
    expect(v1.zurueck.at(-1)!.label).toBe("Ablauf verschieben");
    expect(entw(v1.aktuell, "en1")).toMatchObject({ art: "gully", position: P(12.5, 4), z: 0, name: "Gully 1" });
    expect(validateProject(v1.aktuell)).toEqual([]);
    expect(computeSlope(v1.aktuell)).not.toEqual(computeSlope(v0.aktuell));
    const u = rueckgaengig(v1);
    expect(u.aktuell).toBe(v0.aktuell);
    expect(wiederholen(u).aktuell).toBe(v1.aktuell);
  });

  it("Notablauf verschiebbar, z und Überlaufkante bleiben", () => {
    const v = ausfuehren(basis(), verschiebeEntwaesserung("d1", "en2", P(18, 1)));
    expect(entw(v.aktuell, "en2")).toMatchObject({ art: "notablauf", position: P(18, 1), z: 0.05 });
  });

  it("Rand der Kontur ist gültig", () => {
    const v = ausfuehren(basis(), verschiebeEntwaesserung("d1", "en1", P(20, 5)));
    expect(entw(v.aktuell, "en1")).toMatchObject({ position: P(20, 5) });
  });

  it.each([
    ["außerhalb der Kontur", P(25, 5)],
    ["im Aufbau", P(3, 3)],
    ["nicht endlich", P(Number.NaN, 5)],
  ])("Ablehnung: %s → Modell unverändert, kein Undo-Schritt", (_, p) => {
    const v0 = basis();
    expect(ausfuehren(v0, verschiebeEntwaesserung("d1", "en1", p))).toBe(v0);
  });

  it("gleiche Position, unbekannte ID bzw. Dachfläche → kein Undo-Schritt", () => {
    const v0 = basis();
    expect(ausfuehren(v0, verschiebeEntwaesserung("d1", "en1", P(10, 5)))).toBe(v0);
    expect(ausfuehren(v0, verschiebeEntwaesserung("d1", "en99", P(11, 5)))).toBe(v0);
    expect(ausfuehren(v0, verschiebeEntwaesserung("d9", "en1", P(11, 5)))).toBe(v0);
  });

  it("Dachreiter: auf nächstliegenden Kantenpunkt projiziert, Kante darf wechseln", () => {
    const v0 = basis();
    const a = ausfuehren(v0, verschiebeEntwaesserung("d1", "en3", P(8, 0.7)));
    expect(entw(a.aktuell, "en3")).toMatchObject({ lage: { kante: "p1", abstand: 8 } });
    const b = ausfuehren(v0, verschiebeEntwaesserung("d1", "en3", P(19.5, 6)));
    expect(entw(b.aktuell, "en3")).toMatchObject({ lage: { kante: "p2", abstand: 6 } });
    // von außen: ebenfalls auf die Kante (Ende der Kante begrenzt)
    const c = ausfuehren(v0, verschiebeEntwaesserung("d1", "en3", P(-3, 4)));
    expect(entw(c.aktuell, "en3")).toMatchObject({ lage: { kante: "p4", abstand: 6 } });
    expect(validateProject(c.aktuell)).toEqual([]);
    expect(rueckgaengig(c).aktuell).toBe(v0.aktuell);
    // Projektion auf dieselbe Stelle → kein Undo-Schritt
    expect(ausfuehren(v0, verschiebeEntwaesserung("d1", "en3", P(5, 0.3)))).toBe(v0);
  });

  it("LES: Endpunkt einzeln bzw. ganze Strecke (Mitte), Ablehnung außerhalb und bei Länge 0", () => {
    const v0 = basis();
    const a = ausfuehren(v0, verschiebeEntwaesserung("d1", "en4", P(5, 9), "von"));
    expect(entw(a.aktuell, "en4")).toMatchObject({ von: P(5, 9), bis: P(14, 8) });
    const b = ausfuehren(v0, verschiebeEntwaesserung("d1", "en4", P(15, 7), "bis"));
    expect(entw(b.aktuell, "en4")).toMatchObject({ von: P(6, 8), bis: P(15, 7) });
    const c = ausfuehren(v0, verschiebeEntwaesserung("d1", "en4", P(10, 7)));
    expect(entw(c.aktuell, "en4")).toMatchObject({ von: P(6, 7), bis: P(14, 7) });
    expect(validateProject(c.aktuell)).toEqual([]);
    expect(rueckgaengig(c).aktuell).toBe(v0.aktuell);
    // Mitte so, dass ein Ende über die Kontur hinausragt
    expect(ausfuehren(v0, verschiebeEntwaesserung("d1", "en4", P(17, 7)))).toBe(v0);
    expect(ausfuehren(v0, verschiebeEntwaesserung("d1", "en4", P(14, 8), "von"))).toBe(v0);
    expect(ausfuehren(v0, verschiebeEntwaesserung("d1", "en4", P(22, 8), "bis"))).toBe(v0);
  });
});
