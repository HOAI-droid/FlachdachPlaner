/**
 * ASCII-DXF-Parser (PLAN Schritt 15), ohne DOM und ohne Abhängigkeit.
 * Unterstützt LINE, LWPOLYLINE (inkl. Bulge), ARC, CIRCLE, INSERT (Blöcke) und $INSUNITS.
 * Alle Koordinaten bleiben hier in Zeichnungseinheiten; die Umrechnung nach Meter macht `flatten`.
 */

export interface DxfPunkt { readonly x: number; readonly y: number }

export interface DxfLine { readonly typ: "LINE"; readonly layer: string; readonly a: DxfPunkt; readonly b: DxfPunkt }
export interface DxfPolylinie {
  readonly typ: "LWPOLYLINE"; readonly layer: string; readonly geschlossen: boolean;
  readonly punkte: readonly DxfPunkt[]; readonly bulge: readonly number[];
}
/** Winkel in Grad, gegen den Uhrzeigersinn von `start` nach `ende`. */
export interface DxfArc { readonly typ: "ARC"; readonly layer: string; readonly mitte: DxfPunkt; readonly r: number; readonly start: number; readonly ende: number }
export interface DxfCircle { readonly typ: "CIRCLE"; readonly layer: string; readonly mitte: DxfPunkt; readonly r: number }
export interface DxfInsert {
  readonly typ: "INSERT"; readonly layer: string; readonly block: string; readonly pos: DxfPunkt;
  readonly sx: number; readonly sy: number; /** Grad */ readonly drehung: number;
}
export type DxfEntitaet = DxfLine | DxfPolylinie | DxfArc | DxfCircle | DxfInsert;

export interface DxfBlock { readonly name: string; readonly basis: DxfPunkt; readonly entitaeten: readonly DxfEntitaet[] }

export interface DxfDokument {
  /** `$INSUNITS` (0 = nicht angegeben). */
  readonly insunits: number;
  readonly entitaeten: readonly DxfEntitaet[];
  readonly bloecke: ReadonlyMap<string, DxfBlock>;
  /** Layernamen aus den Entitäten (Modell und Blöcke), sortiert. */
  readonly layer: readonly string[];
}

/** Meter je Zeichnungseinheit laut `$INSUNITS`; null = unbekannt (dann gilt 1 m je Einheit als Annahme). */
export const INSUNITS_METER: Readonly<Record<number, number>> = {
  1: 0.0254, 2: 0.3048, 4: 0.001, 5: 0.01, 6: 1, 7: 1000, 10: 0.9144, 14: 0.1, 15: 10, 16: 100,
};
export const einheitFaktor = (insunits: number): number | null => INSUNITS_METER[insunits] ?? null;

type Paar = readonly [number, string];

function paare(text: string): Paar[] {
  const z = text.split(/\r\n|\r|\n/);
  const out: Paar[] = [];
  for (let i = 0; i + 1 < z.length; i += 2) {
    const code = Number.parseInt(z[i]!.trim(), 10);
    if (Number.isNaN(code)) continue;
    out.push([code, z[i + 1]!.trim()]);
  }
  return out;
}
const num = (s: string): number => Number.parseFloat(s);

/** Liest Entitäten ab Index i bis zum nächsten Abschnitts-/Blockende; liefert Entitäten und neuen Index. */
function entitaeten(p: readonly Paar[], start: number): { liste: DxfEntitaet[]; ende: number } {
  const liste: DxfEntitaet[] = [];
  let i = start;
  while (i < p.length) {
    const [c, v] = p[i]!;
    if (c !== 0) { i++; continue; }
    if (v === "ENDSEC" || v === "ENDBLK" || v === "BLOCK" || v === "SECTION") break;
    let j = i + 1;
    while (j < p.length && p[j]![0] !== 0) j++;
    const daten = p.slice(i + 1, j);
    const e = entitaet(v, daten);
    if (e) liste.push(e);
    i = j;
  }
  return { liste, ende: i };
}

const erster = (d: readonly Paar[], code: number, std = 0): number => {
  const f = d.find(([c]) => c === code);
  return f ? num(f[1]) : std;
};

function entitaet(typ: string, d: readonly Paar[]): DxfEntitaet | null {
  const layer = d.find(([c]) => c === 8)?.[1] ?? "0";
  switch (typ) {
    case "LINE":
      return { typ: "LINE", layer, a: { x: erster(d, 10), y: erster(d, 20) }, b: { x: erster(d, 11), y: erster(d, 21) } };
    case "CIRCLE":
      return { typ: "CIRCLE", layer, mitte: { x: erster(d, 10), y: erster(d, 20) }, r: erster(d, 40) };
    case "ARC":
      return { typ: "ARC", layer, mitte: { x: erster(d, 10), y: erster(d, 20) }, r: erster(d, 40), start: erster(d, 50), ende: erster(d, 51) };
    case "INSERT":
      return {
        typ: "INSERT", layer, block: d.find(([c]) => c === 2)?.[1] ?? "", pos: { x: erster(d, 10), y: erster(d, 20) },
        sx: erster(d, 41, 1), sy: erster(d, 42, 1), drehung: erster(d, 50),
      };
    case "LWPOLYLINE": {
      const punkte: DxfPunkt[] = [], bulge: number[] = [];
      for (let k = 0; k < d.length; k++) {
        const [c, v] = d[k]!;
        if (c === 10) {
          const y = d[k + 1]?.[0] === 20 ? num(d[k + 1]![1]) : 0;
          punkte.push({ x: num(v), y }); bulge.push(0);
        } else if (c === 42 && bulge.length > 0) bulge[bulge.length - 1] = num(v);
      }
      return { typ: "LWPOLYLINE", layer, geschlossen: (erster(d, 70) & 1) === 1, punkte, bulge };
    }
    default:
      return null;
  }
}

export function parseDxf(text: string): DxfDokument {
  const p = paare(text);
  let insunits = 0;
  const modell: DxfEntitaet[] = [];
  const bloecke = new Map<string, DxfBlock>();
  for (let i = 0; i < p.length; i++) {
    const [c, v] = p[i]!;
    if (c === 9 && v === "$INSUNITS" && p[i + 1]) insunits = Math.round(num(p[i + 1]![1]));
    if (c === 0 && v === "SECTION" && p[i + 1]?.[0] === 2) {
      const name = p[i + 1]![1];
      if (name === "ENTITIES") {
        const r = entitaeten(p, i + 2);
        modell.push(...r.liste); i = r.ende - 1;
      } else if (name === "BLOCKS") {
        let k = i + 2;
        while (k < p.length && !(p[k]![0] === 0 && p[k]![1] === "ENDSEC")) {
          if (p[k]![0] === 0 && p[k]![1] === "BLOCK") {
            let j = k + 1;
            while (j < p.length && p[j]![0] !== 0) j++;
            const kopf = p.slice(k + 1, j);
            const bname = kopf.find(([cc]) => cc === 2)?.[1] ?? "";
            const r = entitaeten(p, j);
            bloecke.set(bname, { name: bname, basis: { x: erster(kopf, 10), y: erster(kopf, 20) }, entitaeten: r.liste });
            k = r.ende;
          } else k++;
        }
        i = k;
      }
    }
  }
  const layer = new Set<string>();
  for (const e of modell) layer.add(e.layer);
  for (const b of bloecke.values()) for (const e of b.entitaeten) layer.add(e.layer);
  return { insunits, entitaeten: modell, bloecke, layer: [...layer].sort() };
}
