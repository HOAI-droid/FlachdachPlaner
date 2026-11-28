import { describe, expect, it } from "vitest";
import { createProject, ausfuehren, neuerVerlauf, rueckgaengig, wiederholen, findeAbweichungen, uebernehmeVorschlaege, verschiebePunkte, type ProjectModel, type SnapSegment, type Vec2 } from "../src/core/index";
import { parseDxf, flatten } from "../src/io/dxf";
import { readFileSync } from "node:fs";

const rechteck = (pts: Vec2[]): SnapSegment[] => pts.map((p, i) => ({ a: p, b: pts[(i + 1) % pts.length]! }));
const v1 = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 5 }, { x: 5, y: 8 }, { x: 2, y: 7 }];
// v2: drei Ecken verschoben (um 10 cm, 15 cm, 5 cm)
const v2 = v1.map((p, i) => (i === 1 ? { x: 10.1, y: 0 } : i === 3 ? { x: 0, y: 5.15 } : i === 5 ? { x: 2.05, y: 7 } : p));

function projekt(): ProjectModel {
  const m = createProject("T", "2026-01-01T00:00:00Z");
  return { ...m, dachflaechen: [{ id: "d1", name: "D", typ: "flachdach", kontur: v1.map((p, i) => ({ id: `p${i}`, ...p })), aufbauten: [], zonen: [], vorgaben: {}, attika: [], tuerschwellen: [], entwaesserung: [] } as never] };
}

describe("Abweichungen nach Unterlagenwechsel (22a)", () => {
  const m = projekt();
  const ab = findeAbweichungen(m, rechteck(v1), rechteck(v2));
  it("meldet genau die drei verschobenen Ecken", () => {
    expect(ab.map((a) => a.ref.punktId)).toEqual(["p1", "p3", "p5"]);
    expect(ab[0]!.vorschlag).toEqual({ x: 10.1, y: 0 });
  });
  it("Toleranz: Verschiebung ≤ 2 cm wird nicht gemeldet", () => {
    const klein = v1.map((p, i) => (i === 1 ? { x: 10.015, y: 0 } : p));
    expect(findeAbweichungen(m, rechteck(v1), rechteck(klein))).toHaveLength(0);
    expect(findeAbweichungen(m, rechteck(v1), rechteck(klein), 0.01)).toHaveLength(1);
  });
  it("Übernehmen setzt auf Fangpunkt (±1 mm), unveränderte bleiben; Undo/Redo", () => {
    let v = neuerVerlauf(m);
    v = ausfuehren(v, uebernehmeVorschlaege(ab));
    const k = v.aktuell.dachflaechen[0]!.kontur;
    expect(Math.hypot(k[1]!.x - 10.1, k[1]!.y)).toBeLessThan(0.001);
    expect(k[0]).toMatchObject({ x: 0, y: 0 });
    expect(k[2]).toMatchObject({ x: 10, y: 5 });
    v = rueckgaengig(v); expect(v.aktuell.dachflaechen[0]!.kontur[1]).toMatchObject({ x: 10, y: 0 });
    v = wiederholen(v); expect(v.aktuell.dachflaechen[0]!.kontur[1]).toMatchObject({ x: 10.1, y: 0 });
  });
  it("einzelner Punkt händisch verschieben", () => {
    const n = verschiebePunkte([{ ref: ab[0]!.ref, pos: { x: 10.2, y: 0.1 } }]).anwenden(m);
    expect(n.dachflaechen[0]!.kontur[1]).toMatchObject({ x: 10.2, y: 0.1 });
  });
  it("Punkt ohne neuen Fangpunkt in 1 m: Meldung ohne Vorschlag", () => {
    const leer = findeAbweichungen(m, rechteck(v1), rechteck([{ x: 100, y: 100 }, { x: 101, y: 100 }, { x: 101, y: 101 }]));
    expect(leer.length).toBe(6); expect(leer[0]!.vorschlag).toBeNull();
  });
});

describe("DXF-Fixture v1→v2", () => {
  it("liest beide Fassungen und meldet genau die verschobenen Ecken", () => {
    const seg = (f: string) => flatten(parseDxf(readFileSync(`tests/fixtures/${f}`, "utf8")), {}).segmente;
    const a = seg("l-dach.dxf"), b = seg("l-dach-v2.dxf");
    const ecken = [...new Set(a.flatMap((s) => [s.a, s.b]).map((p) => `${p.x},${p.y}`))].map((s) => { const [x, y] = s.split(",").map(Number); return { x: x!, y: y! }; });
    const mm = { ...projekt(), dachflaechen: [{ ...projekt().dachflaechen[0]!, kontur: ecken.map((p, i) => ({ id: `e${i}`, ...p })) }] };
    expect(findeAbweichungen(mm, a, b)).toHaveLength(3);
  });
});
