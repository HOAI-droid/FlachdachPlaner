import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, computeSlope, createProject, parseProject, serializeProject, type ProjectModel } from "../src/core/index";

const pt = (id: string, x: number, y: number) => ({ id, x, y });

/** Projekt mit zwei Dächern und Gullys (z gesetzt), in der Dachflächen-Ansicht. */
function basis(): ProjectModel {
  const m = createProject("Migration", "2026-01-01T00:00:00Z");
  const dach = (id: string, x0: number, w: number, gx: number, z: number) => ({
    id, name: id, typ: "dach" as const, aufbauten: [], zonen: [], attika: [], tuerschwellen: [], vorgaben: {},
    kontur: [pt(`${id}1`, x0, 0), pt(`${id}2`, x0 + w, 0), pt(`${id}3`, x0 + w, 8), pt(`${id}4`, x0, 8)],
    entwaesserung: [{ id: `${id}g`, art: "gully" as const, name: "G", typ: null, position: { x: gx, y: 4 }, z }],
  });
  return { ...m, dachflaechen: [dach("a", 0, 10, 5, 0), dach("b", 20, 12, 26, 0)] };
}

const roh = (p: ProjectModel) => JSON.parse(JSON.stringify(p)) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const ergebnis = (m: ProjectModel) => JSON.parse(JSON.stringify(computeSlope(m)));

describe("Migration v1/v2 → aktuell: Berechnungsergebnis bleibt gleich", () => {
  const direkt = basis();

  it("v1 (ohne z) und v2 liefern dieselben Gefälle-Ergebnisse wie das aktuelle Modell", () => {
    const v1 = roh(direkt); v1["schemaVersion"] = 1;
    for (const d of v1["dachflaechen"]) for (const e of d["entwaesserung"]) delete e["z"];
    const v2 = roh(direkt); v2["schemaVersion"] = 2;
    for (const doc of [v1, v2]) {
      const r = parseProject(JSON.stringify(doc));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.hinweise.some((h) => h.includes("migriert"))).toBe(true);
      expect(ergebnis(r.projekt)).toEqual(ergebnis(direkt));
    }
  });

  it("Round-Trip: speichern → laden ändert Ergebnis und Namen nicht, schemaVersion aktuell", () => {
    const text = serializeProject(direkt);
    expect(text.startsWith(`{\n  "schemaVersion": ${SCHEMA_VERSION},`)).toBe(true);
    const r = parseProject(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.projekt.dachflaechen.map((d) => d.name)).toEqual(["a", "b"]);
    expect(ergebnis(r.projekt)).toEqual(ergebnis(direkt));
  });
});
