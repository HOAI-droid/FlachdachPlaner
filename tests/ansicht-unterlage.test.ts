import { describe, expect, it } from "vitest";
import { createProject, parseProjekt, projektAusModell, serializeProjekt, validateProjekt } from "../src/core/index";

const basis = () => projektAusModell(createProject("A", "2026-01-01T00:00:00Z"));
const roh = (x: unknown) => JSON.parse(JSON.stringify(x)) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe("Ansichtseinstellungen (Ebenen) in der Projektdatei", () => {
  it("bleiben beim Speichern und Laden erhalten", () => {
    const p = { ...basis(), ansicht: { ebenen: { symbole: { sichtbar: false, deckkraft: 0.5, gesperrt: true }, unterlage: { sichtbar: true, deckkraft: 0.3, gesperrt: false } } } };
    const r = parseProjekt(serializeProjekt(p));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.projekt.ansicht).toEqual(p.ansicht);
  });
  it("fehlend ist gültig, Unsinn wird abgelehnt", () => {
    expect(validateProjekt(roh(basis()))).toEqual([]);
    const f = (ebenen: unknown) => validateProjekt({ ...roh(basis()), ansicht: { ebenen } });
    expect(f({ gibtsnicht: { sichtbar: true, deckkraft: 1, gesperrt: false } })).toEqual([]); // spätere Version: ignoriert
    expect(f({ symbole: { sichtbar: "ja", deckkraft: 1, gesperrt: false } }).length).toBeGreaterThan(0);
    expect(f({ symbole: { sichtbar: true, deckkraft: 2, gesperrt: false } }).length).toBeGreaterThan(0);
  });
});

describe("Unterlage: Quellpfad und komprimierte Einbettung", () => {
  const unterlage = { dateiname: "plan.pdf", art: "pdf", pruefsumme: { algorithmus: "sha-256", wert: "a".repeat(64) }, seite: 2, passpunkte: [{ unterlage: { x: 0, y: 0 }, welt: { x: 0, y: 0 } }, { unterlage: { x: 1, y: 0 }, welt: { x: 1, y: 0 } }] };
  const mit = (u: Record<string, unknown>) => ({ ...roh(basis()), unterlage: { ...unterlage, ...u } });
  it("akzeptiert quellpfad und komprimiert: gzip", () => {
    expect(validateProjekt(mit({ quellpfad: "/Users/x/plan.pdf", eingebettet: { base64: "AAAA", komprimiert: "gzip" } }))).toEqual([]);
  });
  it("lehnt unbekannte Kompression ab", () => {
    expect(validateProjekt(mit({ eingebettet: { base64: "AAAA", komprimiert: "zip" } })).length).toBeGreaterThan(0);
  });
});
