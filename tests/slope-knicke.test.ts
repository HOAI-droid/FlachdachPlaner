/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { computeSlope, loadRulePack, parseProject, meshDach, type RulePack } from "../src/core/index";

const t = import.meta.glob("../rulepacks/*/pack.json", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;
const r = loadRulePack(JSON.parse(t["../rulepacks/zvdh-2026/pack.json"]!));
if (!r.ok) throw new Error("Pack");
type Pt = { x: number; y: number };
const PACKS: RulePack[] = [r.pack];

describe("Knicke: jede Kante zwischen verschieden geneigten Facetten ist eine Faltlinie", () => {
  it("L-Dach mit zwei Gullys: keine 3D-Kante ohne Faltlinie (kein loses Liniensegment)", () => {
    const P = (id: string, x: number, y: number) => ({ id, x, y });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pr: any = parseProject(readFileSync("tests/fixtures/terrasse-tuer-attika.fdp.json", "utf8"));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dach: any = { id: "d1", name: "Dach", typ: "dach", aufbauten: [], zonen: [], vorgaben: {}, attika: [], tuerschwellen: [],
      kontur: [P("a", 0, 0), P("b", 11.72, 0), P("c", 11.72, 12.23), P("d", 15.58, 12.23), P("e", 15.58, 19.45), P("f", 0, 19.45)],
      entwaesserung: [{ id: "g1", art: "gully", name: "E1", position: { x: 0.7, y: 18.2 }, z: 0 }, { id: "g2", art: "gully", name: "E2", position: { x: 11.2, y: 0.6 }, z: 0 }] };
    const s = computeSlope({ ...pr.projekt, dachflaechen: [dach] }, { packs: PACKS });
    const d = s.dachflaechen[0]!;
    const segs = [...d.linien.map((l) => [l.von, l.bis] as const), ...dach.kontur.map((q: Pt, i: number) => [q, dach.kontur[(i + 1) % dach.kontur.length]] as const)];
    const auf = (q: { x: number; y: number }, [u, v]: readonly [Pt, Pt]) => {
      const L2 = (v.x - u.x) ** 2 + (v.y - u.y) ** 2, k = ((q.x - u.x) * (v.x - u.x) + (q.y - u.y) * (v.y - u.y)) / L2;
      return k >= -1e-6 && k <= 1 + 1e-6 && Math.hypot(q.x - (u.x + k * (v.x - u.x)), q.y - (u.y + k * (v.y - u.y))) < 1e-4;
    };
    const lose: string[] = [];
    for (const f of meshDach(s, 1)) f.outer.forEach((a, i) => {
      const b = f.outer[(i + 1) % f.outer.length]!;
      if (f.stumm![i]) return;
      if (!segs.some((sg) => auf({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, sg))) lose.push(`${a.x},${a.y}->${b.x},${b.y}`);
    });
    expect(lose).toEqual([]);
  });
});
