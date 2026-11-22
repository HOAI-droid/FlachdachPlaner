/** Modell-Befehle der Zeichenwerkzeuge (PLAN Schritt 17). Rein; IDs deterministisch aus dem Modell. */
import { dist } from "../geometry/segment";
import { konturKante } from "../model/model";
import type {
  AttikaSegment, Dachflaeche, Id, Kontur, ProjectModel, Tuerschwelle, Unterlage, Zone,
} from "../model/types";
import type { Vec2 } from "../geometry/types";
import type { Befehl } from "./history";

/** ID-Präfixe: d Dachfläche, p Konturpunkt, au Aufbau, zo Zone, at Attika, ts Türschwelle. */
export type IdPraefix = "d" | "p" | "au" | "zo" | "at" | "ts";

function alleIds(m: ProjectModel): string[] {
  const ids: string[] = [];
  for (const d of m.dachflaechen) {
    ids.push(d.id, ...d.kontur.map((p) => p.id));
    for (const a of d.aufbauten) ids.push(a.id, ...a.kontur.map((p) => p.id));
    for (const z of d.zonen) ids.push(z.id, ...z.kontur.map((p) => p.id));
    ids.push(...d.attika.map((a) => a.id), ...d.tuerschwellen.map((t) => t.id), ...d.entwaesserung.map((e) => e.id));
  }
  return ids;
}

/** Nächste freie ID `${praefix}${n}` (n = größte vorhandene Nummer dieses Präfixes + 1); `anzahl` fortlaufende IDs. */
export function neueIds(m: ProjectModel, praefix: IdPraefix, anzahl = 1): string[] {
  let max = 0;
  const re = new RegExp(`^${praefix}(\\d+)$`);
  for (const id of alleIds(m)) { const r = re.exec(id); if (r) max = Math.max(max, Number(r[1])); }
  return Array.from({ length: anzahl }, (_, i) => `${praefix}${max + 1 + i}`);
}

function konturAus(m: ProjectModel, pts: readonly Vec2[]): Kontur {
  const ids = neueIds(m, "p", pts.length);
  return pts.map((p, i) => ({ id: ids[i]!, x: p.x, y: p.y }));
}

const mapDach = (m: ProjectModel, id: Id, f: (d: Dachflaeche) => Dachflaeche): ProjectModel => {
  let geaendert = false;
  const dachflaechen = m.dachflaechen.map((d) => {
    if (d.id !== id) return d;
    const n = f(d);
    if (n !== d) geaendert = true;
    return n;
  });
  return geaendert ? { ...m, dachflaechen } : m;
};

export function addDachflaeche(pts: readonly Vec2[], typ: "dach" | "terrasse" = "dach", name?: string): Befehl {
  return {
    label: typ === "dach" ? "Dachkontur zeichnen" : "Terrassenfläche zeichnen",
    anwenden: (m) => {
      const [id] = neueIds(m, "d");
      const d: Dachflaeche = {
        id: id!, name: name ?? `${typ === "dach" ? "Dach" : "Terrasse"} ${m.dachflaechen.length + 1}`, typ,
        kontur: konturAus(m, pts), aufbauten: [], zonen: [], vorgaben: {}, attika: [], tuerschwellen: [], entwaesserung: [],
      };
      return { ...m, dachflaechen: [...m.dachflaechen, d] };
    },
  };
}

export function addAufbau(dachId: Id, pts: readonly Vec2[], name?: string): Befehl {
  return {
    label: "Aufbau zeichnen",
    anwenden: (m) => mapDach(m, dachId, (d) => {
      const [id] = neueIds(m, "au");
      return { ...d, aufbauten: [...d.aufbauten, { id: id!, name: name ?? `Aufbau ${d.aufbauten.length + 1}`, kontur: konturAus(m, pts) }] };
    }),
  };
}

/** Terrasse = Zone mit Höhenversatz (Standard −0,10 m, Nutzerwert aus PLAN Schritt 8) innerhalb der Dachfläche. */
export function addTerrasse(dachId: Id, pts: readonly Vec2[], hoehenversatz = -0.1, name?: string): Befehl {
  return {
    label: "Terrasse zeichnen",
    anwenden: (m) => mapDach(m, dachId, (d) => {
      const [id] = neueIds(m, "zo");
      const z: Zone = { id: id!, name: name ?? "Terrasse", kontur: konturAus(m, pts), hoehenversatz };
      return { ...d, zonen: [...d.zonen, z] };
    }),
  };
}

/** Attika auf einer Konturkante setzen; vorhandenes Segment derselben Kante bekommt nur die neue Breite. */
export function setAttika(dachId: Id, kante: Id, breite: number): Befehl {
  return {
    label: "Attika setzen",
    anwenden: (m) => mapDach(m, dachId, (d) => {
      if (!(breite > 0) || !konturKante(d.kontur, kante)) return d;
      const vorh = d.attika.find((a) => a.kante === kante);
      if (vorh) {
        if (vorh.breite === breite) return d;
        return { ...d, attika: d.attika.map((a) => (a === vorh ? { ...a, breite } : a)) };
      }
      const [id] = neueIds(m, "at");
      const a: AttikaSegment = { id: id!, kante, breite };
      return { ...d, attika: [...d.attika, a] };
    }),
  };
}

/** Attika umlaufend: alle Konturkanten, vorhandene bekommen die neue Breite. */
export function setAttikaUmlaufend(dachId: Id, breite: number): Befehl {
  return {
    label: "Attika umlaufend",
    anwenden: (m) => mapDach(m, dachId, (d) => {
      if (!(breite > 0)) return d;
      const ids = neueIds(m, "at", d.kontur.length);
      let n = 0;
      const attika: AttikaSegment[] = d.kontur.map((p) => {
        const vorh = d.attika.find((a) => a.kante === p.id);
        return vorh ? { ...vorh, breite } : { id: ids[n++]!, kante: p.id, breite };
      });
      const gleich = attika.length === d.attika.length && attika.every((a, i) => a.id === d.attika[i]?.id && a.breite === d.attika[i]?.breite);
      return gleich ? d : { ...d, attika };
    }),
  };
}

export function setAttikaBreite(dachId: Id, attikaId: Id, breite: number): Befehl {
  return {
    label: "Attikabreite ändern",
    anwenden: (m) => mapDach(m, dachId, (d) => {
      const a = d.attika.find((x) => x.id === attikaId);
      if (!a || !(breite > 0) || a.breite === breite) return d;
      return { ...d, attika: d.attika.map((x) => (x === a ? { ...x, breite } : x)) };
    }),
  };
}

/** Türschwelle auf einer Konturkante; `abstand` wird so begrenzt, dass die Schwelle auf die Kante passt. */
export function addTuerschwelle(dachId: Id, kante: Id, abstand: number, breite: number, barrierefrei = false): Befehl {
  return {
    label: "Türschwelle setzen",
    anwenden: (m) => mapDach(m, dachId, (d) => {
      const k = konturKante(d.kontur, kante);
      if (!k || !(breite > 0)) return d;
      const laenge = dist(k[0], k[1]);
      if (breite > laenge) return d;
      const [id] = neueIds(m, "ts");
      const t: Tuerschwelle = {
        id: id!, name: `Türschwelle ${d.tuerschwellen.length + 1}`,
        lage: { kante, abstand: Math.min(Math.max(0, abstand), laenge - breite) }, breite, barrierefrei,
      };
      return { ...d, tuerschwellen: [...d.tuerschwellen, t] };
    }),
  };
}

export function setTuerschwelleBreite(dachId: Id, id: Id, breite: number): Befehl {
  return {
    label: "Schwellenbreite ändern",
    anwenden: (m) => mapDach(m, dachId, (d) => {
      const t = d.tuerschwellen.find((x) => x.id === id);
      if (!t || !(breite > 0) || t.breite === breite) return d;
      const k = konturKante(d.kontur, t.lage.kante);
      const laenge = k ? dist(k[0], k[1]) : 0;
      if (breite > laenge) return d;
      const abstand = Math.min(t.lage.abstand, laenge - breite);
      return { ...d, tuerschwellen: d.tuerschwellen.map((x) => (x === t ? { ...x, breite, lage: { ...x.lage, abstand } } : x)) };
    }),
  };
}

export type Auswahl =
  | { readonly art: "dach"; readonly id: Id; readonly dachId: Id }
  | { readonly art: "aufbau" | "zone" | "attika" | "tuerschwelle"; readonly id: Id; readonly dachId: Id };

/** Löscht das gewählte Objekt (Dachfläche samt Inhalt). */
export function loesche(a: Auswahl): Befehl {
  return {
    label: "Löschen",
    anwenden: (m) => {
      if (a.art === "dach") {
        return m.dachflaechen.some((d) => d.id === a.id) ? { ...m, dachflaechen: m.dachflaechen.filter((d) => d.id !== a.id) } : m;
      }
      return mapDach(m, a.dachId, (d) => {
        switch (a.art) {
          case "aufbau": return { ...d, aufbauten: d.aufbauten.filter((x) => x.id !== a.id) };
          case "zone": return { ...d, zonen: d.zonen.filter((x) => x.id !== a.id) };
          case "attika": return { ...d, attika: d.attika.filter((x) => x.id !== a.id) };
          case "tuerschwelle": return { ...d, tuerschwellen: d.tuerschwellen.filter((x) => x.id !== a.id) };
        }
      });
    },
  };
}

export function setUnterlage(u: Unterlage | null): Befehl {
  return { label: u ? "Unterlage setzen" : "Unterlage entfernen", anwenden: (m) => (m.unterlage === u ? m : { ...m, unterlage: u }) };
}
