/** Modell-Befehle der Zeichenwerkzeuge (PLAN Schritt 17). Rein; IDs deterministisch aus dem Modell. */
import { CLIPPER_SCALE, difference } from "../geometry/clipper";
import { EPS } from "../geometry/eps";
import { pointInRing, ringArea, ringCentroid, signedArea } from "../geometry/polygon";
import { dist, distPointSegment } from "../geometry/segment";
import { konturKante } from "../model/model";
import type {
  AttikaSegment, Dachflaeche, Entwaesserung, EntwaesserungsArt, Gully, Id, Koordinate, Kontur, KonturPunkt, PackRef, ProjectModel, Regenspende,
  Tuerschwelle, Unterlage, Zone,
} from "../model/types";
import type { RainData } from "../rain/rain";
import type { Ring, Vec2 } from "../geometry/types";
import type { Befehl } from "./history";
import { STANDARD_ATTIKA_BREITE } from "./tools";

/** ID-Präfixe: d Dachfläche, p Konturpunkt, au Aufbau, zo Zone, at Attika, ts Türschwelle, en Entwässerung. */
export type IdPraefix = "d" | "p" | "au" | "zo" | "at" | "ts" | "en";

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

const ART_NAME: Record<EntwaesserungsArt, string> = { gully: "Gully", notablauf: "Notablauf", dachreiter: "Dachreiter", les: "LES" };

/** Pack-Verweis samt Pack-Version (landet in `ProjectModel.packVersionen`). */
export interface TypWahl extends PackRef { readonly version?: string }
const reinTyp = (t: TypWahl | null): PackRef | null => (t ? { packId: t.packId, eintragId: t.eintragId } : null);
const mitVersion = (m: ProjectModel, t: TypWahl | null): ProjectModel =>
  t?.version && m.packVersionen[t.packId] !== t.version ? { ...m, packVersionen: { ...m.packVersionen, [t.packId]: t.version } } : m;

function addEntw(dachId: Id, label: string, bau: (id: Id, name: string) => Entwaesserung, typ: TypWahl | null = null): Befehl {
  return {
    label,
    anwenden: (m0) => { const m = mitVersion(m0, typ); return mapDach(m, dachId, (d) => {
      const [id] = neueIds(m, "en");
      const e = bau(id!, "");
      const nr = d.entwaesserung.filter((x) => x.art === e.art).length + 1;
      return { ...d, entwaesserung: [...d.entwaesserung, { ...e, name: `${ART_NAME[e.art]} ${nr}` } as Entwaesserung] };
    }); },
  };
}

/** Gully bzw. Notablauf (Punktablauf) mit Kote `z` (OK Abdichtung am Ablauf). */
export function addPunktablauf(dachId: Id, art: "gully" | "notablauf", position: Vec2, z = 0, typ: TypWahl | null = null): Befehl {
  return addEntw(dachId, `${ART_NAME[art]} setzen`, (id, name) => ({ id, name, art, typ: reinTyp(typ), z, position: { x: position.x, y: position.y } }), typ);
}

/** Dachreiter auf einer Konturkante (Mitte bei `abstand`), Kote `z`. */
export function addDachreiter(dachId: Id, kante: Id, abstand: number, z = 0, typ: TypWahl | null = null): Befehl {
  return {
    label: "Dachreiter setzen",
    anwenden: (m) => {
      const d = m.dachflaechen.find((x) => x.id === dachId);
      const k = d && konturKante(d.kontur, kante);
      if (!k) return m;
      const a = Math.min(Math.max(0, abstand), dist(k[0], k[1]));
      return addEntw(dachId, "", (id, name) => ({ id, name, art: "dachreiter", typ: reinTyp(typ), z, lage: { kante, abstand: a } }), typ).anwenden(m);
    },
  };
}

/** LES von (tieferes Ende, Kote `z`) nach bis. */
export function addLes(dachId: Id, von: Vec2, bis: Vec2, z = 0, typ: TypWahl | null = null): Befehl {
  return addEntw(dachId, "LES setzen", (id, name) => ({
    id, name, art: "les", typ: reinTyp(typ), z, von: { x: von.x, y: von.y }, bis: { x: bis.x, y: bis.y },
  }), typ);
}

const mapEntw = (m: ProjectModel, dachId: Id, id: Id, f: (e: Entwaesserung) => Entwaesserung): ProjectModel =>
  mapDach(m, dachId, (d) => {
    const e = d.entwaesserung.find((x) => x.id === id);
    if (!e) return d;
    const n = f(e);
    return n === e ? d : { ...d, entwaesserung: d.entwaesserung.map((x) => (x === e ? n : x)) };
  });

/** Tiefenlage (Kote) eines Ablaufs ändern. */
export function setEntwaesserungZ(dachId: Id, id: Id, z: number): Befehl {
  return {
    label: "Tiefenlage ändern",
    anwenden: (m) => mapEntw(m, dachId, id, (e) => (!Number.isFinite(z) || e.z === z ? e : { ...e, z })),
  };
}

/** Produkttyp (Pack-Verweis) eines Ablaufs setzen. */
export function setEntwaesserungTyp(dachId: Id, id: Id, typ: TypWahl | null): Befehl {
  return {
    label: "Produkt wählen",
    anwenden: (m) => mapEntw(mitVersion(m, typ), dachId, id, (e) => (e.typ?.packId === typ?.packId && e.typ?.eintragId === typ?.eintragId ? e : { ...e, typ: reinTyp(typ) })),
  };
}

/** Gully ohne Feld `verbundenMit` (Feld entfällt ganz, alte Dateien bleiben byte-gleich). */
function ohneVerweis(e: Gully): Gully {
  const r: { -readonly [K in keyof Gully]: Gully[K] } = { ...e };
  delete r.verbundenMit;
  return r;
}

/** Entfernt `verbundenMit`-Verweise auf `ids` (z. B. gelöschte oder neu verbundene Gullys). */
function ohneVerbindungZu(es: readonly Entwaesserung[], ids: readonly Id[]): Entwaesserung[] {
  return es.map((e) => {
    if (e.art !== "gully" || e.verbundenMit === undefined || !ids.includes(e.verbundenMit)) return e;
    return ohneVerweis(e);
  });
}

/**
 * Gully `id` mit Gully `partnerId` derselben Dachfläche verbinden (beidseitig) oder lösen (null).
 * Frühere Verbindungen beider Gullys werden aufgehoben. Ungültige Partner ändern nichts.
 */
export function setGullyVerbindung(dachId: Id, id: Id, partnerId: Id | null): Befehl {
  return {
    label: partnerId ? "Gullys verbinden" : "Verbindung lösen",
    anwenden: (m) => mapDach(m, dachId, (d) => {
      const a = d.entwaesserung.find((x) => x.id === id);
      if (a?.art !== "gully" || partnerId === id) return d;
      const b = partnerId === null ? undefined : d.entwaesserung.find((x) => x.id === partnerId);
      if (partnerId !== null && b?.art !== "gully") return d;
      if ((a.verbundenMit ?? null) === partnerId && (!b || (b.art === "gully" && b.verbundenMit === id))) return d;
      const beteiligt = [id, ...(partnerId ? [partnerId] : [])];
      // Verweise von und auf die Beteiligten lösen, dann neu setzen.
      const geloest = ohneVerbindungZu(d.entwaesserung, beteiligt).map((e) => {
        if (e.art !== "gully" || !beteiligt.includes(e.id)) return e;
        const rest = ohneVerweis(e);
        return partnerId === null ? rest : { ...rest, verbundenMit: e.id === id ? partnerId : id };
      });
      return { ...d, entwaesserung: geloest };
    }),
  };
}

export type Auswahl =
  | { readonly art: "dach"; readonly id: Id; readonly dachId: Id }
  | { readonly art: "aufbau" | "zone" | "attika" | "tuerschwelle" | "entwaesserung"; readonly id: Id; readonly dachId: Id };

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
          case "entwaesserung": return { ...d, entwaesserung: ohneVerbindungZu(d.entwaesserung.filter((x) => x.id !== a.id), [a.id]) };
        }
      });
    },
  };
}

export function setUnterlage(u: Unterlage | null): Befehl {
  return { label: u ? "Unterlage setzen" : "Unterlage entfernen", anwenden: (m) => (m.unterlage === u ? m : { ...m, unterlage: u }) };
}

// ---------- Standort (Schritt 20) ----------
/** Standort setzen; `rain` (aus ermittleRegen) füllt die Pack-Werte, Nutzerwerte bleiben erhalten. */
export function setStandort(bezeichnung: string | undefined, koordinate: Koordinate | null, rain: RainData | null): Befehl {
  return {
    label: "Standort setzen",
    anwenden: (m) => {
      const regen = (r: Regenspende, w: number | null | undefined): Regenspende =>
        ({ packWert: w ?? null, ...(r.manuellWert !== undefined ? { manuellWert: r.manuellWert } : {}) });
      const pv = rain ? { ...m.packVersionen, [rain.packId]: rain.packVersion } : m.packVersionen;
      const st = m.standort;
      return {
        ...m, packVersionen: pv,
        standort: {
          ...(bezeichnung ? { bezeichnung } : {}), koordinate,
          regen: { r5_5: regen(st.regen.r5_5, rain?.r5_5), r5_100: regen(st.regen.r5_100, rain?.r5_100) },
        },
      };
    },
  };
}

/** Nutzerwert für r(5,5) bzw. r(5,100) setzen; `undefined` entfernt ihn (Pack-Wert gilt wieder). */
export function setRegenManuell(name: "r5_5" | "r5_100", wert: number | undefined): Befehl {
  return {
    label: "Regenspende manuell",
    anwenden: (m) => {
      const alt = m.standort.regen[name];
      if (wert !== undefined && !(Number.isFinite(wert) && wert > 0)) return m;
      const neu: Regenspende = wert === undefined ? { packWert: alt.packWert } : { packWert: alt.packWert, manuellWert: wert };
      return { ...m, standort: { ...m.standort, regen: { ...m.standort.regen, [name]: neu } } };
    },
  };
}

// ---------- Dachfläche trennen (Trennstreifen wie eine über das Dach laufende Attika) ----------
/** Toleranz für Lagevergleiche nach der Clipper-Rasterung (10 Rasterschritte = 1 mm). */
const TRENN_TOL = 10 / CLIPPER_SCALE;

/**
 * Trennstreifen als Rechteck um die Gerade durch a und b, Breite `breite`, beidseitig weit über die Kontur
 * hinaus verlängert. null bei ungültiger Eingabe (a = b, Breite ≤ 0, nicht endlich).
 */
export function trennStreifen(d: Dachflaeche, a: Vec2, b: Vec2, breite: number): Vec2[] | null {
  const l = dist(a, b);
  if (![a.x, a.y, b.x, b.y, breite].every(Number.isFinite) || !(l > EPS) || !(breite > 0)) return null;
  const u = { x: (b.x - a.x) / l, y: (b.y - a.y) / l }, n = { x: -u.y, y: u.x };
  let r = 0;
  for (const p of d.kontur) r = Math.max(r, dist(a, p));
  const L = 2 * r + breite, h = breite / 2;
  const P = (s: number, t: number): Vec2 => ({ x: a.x + u.x * s + n.x * t, y: a.y + u.y * s + n.y * t });
  return [P(-L, -h), P(L, -h), P(L, h), P(-L, h)];
}

/** Punkt auf der Kante (Startpunkt-ID `kante`) bei `abstand`; undefined, wenn die Kante fehlt oder entartet ist. */
function kantenPunkt(k: Kontur, kante: Id, abstand: number): Vec2 | undefined {
  const e = konturKante(k, kante);
  if (!e) return undefined;
  const l = dist(e[0], e[1]);
  if (l <= EPS) return undefined;
  const t = abstand / l;
  return { x: e[0].x + (e[1].x - e[0].x) * t, y: e[0].y + (e[1].y - e[0].y) * t };
}

/**
 * Dachfläche `dachId` entlang der Geraden a–b mit einem Trennstreifen der Breite `breite` in Teilflächen
 * zerlegen. Jeder Teil wird eigene Dachfläche; die Schnittkanten erhalten Attika der Breite breite/2
 * (Attika liegt immer außen, beide Hälften füllen zusammen den Streifen). Aufbauten, Zonen und Abläufe
 * gehen an den Teil, in dem sie liegen; was im Streifen liegt, entfällt. Weniger als 2 Teile: keine Änderung.
 */
export function trenneDachflaeche(dachId: Id, a: Vec2, b: Vec2, breite: number = STANDARD_ATTIKA_BREITE): Befehl {
  return {
    label: "Dachfläche trennen",
    anwenden: (m) => {
      const idx = m.dachflaechen.findIndex((x) => x.id === dachId);
      const d = m.dachflaechen[idx];
      if (!d || d.kontur.length < 3) return m;
      const streifen = trennStreifen(d, a, b, breite);
      if (!streifen) return m;
      const roh = difference([{ outer: d.kontur, holes: [] }], [{ outer: streifen, holes: [] }])
        .map((p) => p.outer).filter((r) => r.length >= 3 && ringArea(r) > TRENN_TOL * TRENN_TOL);
      if (roh.length < 2) return m;

      const l = dist(a, b), u = { x: (b.x - a.x) / l, y: (b.y - a.y) / l }, nv = { x: -u.y, y: u.x };
      const s = (p: Vec2) => nv.x * (p.x - a.x) + nv.y * (p.y - a.y);
      const h = breite / 2;
      const n0 = d.kontur.length;
      const origKanten = d.kontur.map((p, i) => [p, d.kontur[(i + 1) % n0]!] as const);
      // Clipper-Rasterung zurücknehmen: Originalecken exakt, Schnittpunkte exakt auf Kante × Streifenrand.
      const exakt = (v: Vec2): Vec2 => {
        for (const p of d.kontur) if (dist(p, v) <= TRENN_TOL) return { x: p.x, y: p.y };
        const t = s(v) >= 0 ? h : -h;
        for (const [p, q] of origKanten) {
          const sp = s(p), sq = s(q);
          if (Math.abs(sq - sp) <= EPS || distPointSegment(v, p, q) > TRENN_TOL) continue;
          const lam = (t - sp) / (sq - sp);
          return { x: p.x + (q.x - p.x) * lam, y: p.y + (q.y - p.y) * lam };
        }
        return v;
      };
      const ccw = signedArea(d.kontur) > 0;
      const ringe = roh.map((r) => (ccw ? r : [...r].reverse()).map(exakt))
        .map((r) => ({ r, c: ringCentroid(r) }))
        .sort((x, y) => s(x.c) - s(y.c) || (u.x * x.c.x + u.y * x.c.y) - (u.x * y.c.x + u.y * y.c.y))
        .map((x) => x.r);

      const dIds = neueIds(m, "d", ringe.length);
      const pIds = neueIds(m, "p", ringe.reduce((n, r) => n + r.length, 0));
      const atIds = neueIds(m, "at", ringe.reduce((n, r) => n + r.length, 0));
      let pi = 0, ai = 0;
      const imTeil = (r: Ring, p: Vec2) => pointInRing(p, r) !== "outside";
      const kollinear = (p: Vec2, q: Vec2, k0: Vec2, k1: Vec2) =>
        distPointSegment(p, k0, k1) <= TRENN_TOL && distPointSegment(q, k0, k1) <= TRENN_TOL;

      const teile = ringe.map((r, ti): Dachflaeche => {
        const kontur: KonturPunkt[] = r.map((p) => ({ id: pIds[pi++]!, x: p.x, y: p.y }));
        const kanten = kontur.map((p, i) => {
          const q = kontur[(i + 1) % kontur.length]!;
          const sp = s(p), sq = s(q);
          const schnitt = Math.abs(Math.abs(sp) - h) <= TRENN_TOL && Math.abs(Math.abs(sq) - h) <= TRENN_TOL && sp * sq > 0;
          return { p, q, schnitt };
        });
        const attika: AttikaSegment[] = [];
        for (const k of kanten) {
          if (k.schnitt) { attika.push({ id: atIds[ai++]!, kante: k.p.id, breite: h }); continue; }
          const alt = d.attika.find((x) => { const e = konturKante(d.kontur, x.kante); return !!e && kollinear(k.p, k.q, e[0], e[1]); });
          if (alt) attika.push({ id: atIds[ai++]!, kante: k.p.id, breite: alt.breite, ...(alt.oberkante !== undefined ? { oberkante: alt.oberkante } : {}) });
        }
        /** Neue Randkante (keine Schnittkante), auf der die Strecke p–q liegt. */
        const randKante = (p: Vec2, q: Vec2) => kanten.find((k) => !k.schnitt && kollinear(p, q, k.p, k.q));

        const tuerschwellen: Tuerschwelle[] = [];
        for (const t of d.tuerschwellen) {
          const w0 = kantenPunkt(d.kontur, t.lage.kante, t.lage.abstand), w1 = kantenPunkt(d.kontur, t.lage.kante, t.lage.abstand + t.breite);
          const k = w0 && w1 ? randKante(w0, w1) : undefined;
          if (!k || !w0 || !w1) continue;
          const laenge = dist(k.p, k.q);
          const abstand = Math.min(Math.max(0, Math.min(dist(k.p, w0), dist(k.p, w1))), laenge - t.breite);
          tuerschwellen.push({ ...t, lage: { kante: k.p.id, abstand } });
        }
        const entw: Entwaesserung[] = [];
        for (const e of d.entwaesserung) {
          if (e.art === "gully" || e.art === "notablauf") { if (imTeil(r, e.position)) entw.push(e); continue; }
          if (e.art === "les") { if (imTeil(r, e.von) && imTeil(r, e.bis)) entw.push(e); continue; }
          const w = kantenPunkt(d.kontur, e.lage.kante, e.lage.abstand);
          const k = w ? randKante(w, w) : undefined;
          if (k && w) entw.push({ ...e, lage: { kante: k.p.id, abstand: dist(k.p, w) } });
        }
        const ids = entw.map((e) => e.id);
        const entwaesserung = entw.map((e) => (e.art === "gully" && e.verbundenMit !== undefined && !ids.includes(e.verbundenMit) ? ohneVerweis(e) : e));
        const inneres = (k: Kontur) => pointInRing(ringCentroid(k), r) === "inside";
        return {
          id: dIds[ti]!, name: `${d.name} ${String.fromCharCode(65 + ti)}`, typ: d.typ, kontur,
          aufbauten: d.aufbauten.filter((x) => inneres(x.kontur)), zonen: d.zonen.filter((x) => inneres(x.kontur)),
          vorgaben: d.vorgaben, attika, tuerschwellen, entwaesserung,
          ...(d.daemmdickeTiefpunkt !== undefined ? { daemmdickeTiefpunkt: d.daemmdickeTiefpunkt } : {}),
        };
      });
      const dachflaechen = [...m.dachflaechen.slice(0, idx), ...teile, ...m.dachflaechen.slice(idx + 1)];
      return { ...m, dachflaechen };
    },
  };
}
