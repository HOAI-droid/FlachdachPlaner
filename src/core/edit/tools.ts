/**
 * Zeichenwerkzeuge als reine Zustandsmaschine (PLAN Schritt 17), ohne DOM.
 * Die UI übersetzt Mausereignisse in Weltpunkte (bereits gefangen) und ruft `klick`/`abschliessen` auf.
 */
import { EPS } from "../geometry/eps";
import { pointInPolygon, pointInRing } from "../geometry/polygon";
import { closestPointOnSegment, dist, distPointSegment, projectOnSegment } from "../geometry/segment";
import type { Vec2 } from "../geometry/types";
import { dachPolygon, konturKante } from "../model/model";
import type { Dachflaeche, EntwaesserungsArt, Id,  ProjectModel } from "../model/types";
import type { SnapSegment } from "../snap";
import {
  addAufbau, addDachflaeche, addDachreiter, addLes, addPunktablauf, addTerrasse, addTuerschwelle, neueIds, setAttika, setAttikaUmlaufend,
  trenneDachflaeche, type Auswahl, type TypWahl,
} from "./commands";
import type { Befehl } from "./history";
import { pruefePolygon } from "./polygon-check";

export type WerkzeugId = "select" | "contour" | "attika" | "aufbau" | "terrasse" | "schwelle" | "measure" | "gully" | "notablauf" | "dachreiter" | "les" | "trennen";
export const ENTWAESSERUNGS_WERKZEUGE: readonly WerkzeugId[] = ["gully", "notablauf", "dachreiter", "les"];
export const POLYGON_WERKZEUGE: readonly WerkzeugId[] = ["contour", "aufbau", "terrasse"];

export interface WerkzeugZustand {
  readonly tool: WerkzeugId;
  /** Bisher gesetzte Punkte des Polygon-Werkzeugs. */
  readonly entwurf: readonly Vec2[];
  /** Attika-Breite in m (Werkzeugeinstellung, gilt für neue Segmente). */
  readonly attikaBreite: number;
  /** Breite neuer Türschwellen in m (Werkzeugeinstellung). */
  readonly schwellenBreite: number;
  /** Tiefenlage z (m) neuer Abläufe (Werkzeugeinstellung). */
  readonly ablaufZ: number;
  /** Breite des Trennstreifens in m (Werkzeug „Trennen“). */
  readonly trennBreite: number;
  /** Letzte Meldung an den Nutzer (Hinweis, kein Befund). */
  readonly hinweis: string | null;
}

export const STANDARD_ATTIKA_BREITE = 0.3;
export const STANDARD_SCHWELLEN_BREITE = 1;

export const neuerZustand = (tool: WerkzeugId = "select"): WerkzeugZustand =>
  ({ tool, entwurf: [], attikaBreite: STANDARD_ATTIKA_BREITE, schwellenBreite: STANDARD_SCHWELLEN_BREITE, ablaufZ: 0, trennBreite: STANDARD_ATTIKA_BREITE, hinweis: null });

export const waehleWerkzeug = (z: WerkzeugZustand, tool: WerkzeugId): WerkzeugZustand => ({ ...z, tool, entwurf: [], hinweis: null });

export interface KlickErgebnis {
  readonly zustand: WerkzeugZustand;
  readonly befehl?: Befehl;
  /** Auswahl nach dem Befehl bzw. beim Auswählen; undefined = unverändert, null = Auswahl aufheben. */
  readonly auswahl?: Auswahl | null;
}

export interface KantenTreffer {
  readonly dachId: Id;
  readonly kante: Id;
  readonly abstand: number;
  readonly laenge: number;
  /** Fußpunkt auf der Kante. */
  readonly punkt: Vec2;
  /** Abstand Klickpunkt–Kante in m. */
  readonly distanz: number;
}

/** Nächste Dachkontur-Kante innerhalb `tol` (m). */
export function kantenTreffer(m: ProjectModel, p: Vec2, tol: number): KantenTreffer | null {
  let best: KantenTreffer | null = null;
  for (const d of m.dachflaechen) {
    const n = d.kontur.length;
    for (let i = 0; i < n; i++) {
      const a = d.kontur[i]!, b = d.kontur[(i + 1) % n]!;
      const distanz = distPointSegment(p, a, b);
      if (distanz > tol || (best && distanz >= best.distanz)) continue;
      const t = projectOnSegment(p, a, b);
      const laenge = dist(a, b);
      best = { dachId: d.id, kante: a.id, abstand: t * laenge, laenge, punkt: closestPointOnSegment(p, a, b), distanz };
    }
  }
  return best;
}

/** Dachfläche, in der der Punkt liegt (Löcher der Aufbauten zählen als außen; Rand zählt als innen). */
export function dachAn(m: ProjectModel, p: Vec2): Dachflaeche | null {
  for (let i = m.dachflaechen.length - 1; i >= 0; i--) {
    const d = m.dachflaechen[i]!;
    if (pointInRing(p, d.kontur) !== "outside") return d;
  }
  return null;
}

/** Lage eines Ablaufs: Punkt (a) oder Strecke (a, b); Dachreiter am Kantenpunkt. */
export function entwSegment(d: Dachflaeche, e: Dachflaeche["entwaesserung"][number]): [Vec2 | null, Vec2 | null] {
  if (e.art === "gully" || e.art === "notablauf") return [e.position, null];
  if (e.art === "les") return [e.von, e.bis];
  const k = konturKante(d.kontur, e.lage.kante);
  if (!k) return [null, null];
  const l = dist(k[0], k[1]);
  if (l <= EPS) return [k[0], null];
  const t = e.lage.abstand / l;
  return [{ x: k[0].x + (k[1].x - k[0].x) * t, y: k[0].y + (k[1].y - k[0].y) * t }, null];
}

/** Objekt unter dem Punkt (Priorität: Ablauf, Schwelle, Attika, Aufbau, Zone, Dachfläche). */
/** Tiefenlage z neuer Abläufe einstellen (jede endliche Zahl, z. B. −0,05). */
export const setzeAblaufZ = (z: WerkzeugZustand, v: number): WerkzeugZustand => (Number.isFinite(v) ? { ...z, ablaufZ: v } : z);

/** Eintrag-Verweis je Ablaufart aus der UI (z. B. einziger Pack-Eintrag); fehlt er, bleibt der Typ unbelegt. */
export interface KlickOptionen { readonly typ?: (art: EntwaesserungsArt) => TypWahl | null }

export function waehle(m: ProjectModel, p: Vec2, tol: number): Auswahl | null {
  for (let i = m.dachflaechen.length - 1; i >= 0; i--) {
    const d = m.dachflaechen[i]!;
    for (const e of d.entwaesserung) {
      const [a, b] = entwSegment(d, e);
      if (a && b ? distPointSegment(p, a, b) <= tol : a ? dist(p, a) <= tol : false) return { art: "entwaesserung", id: e.id, dachId: d.id };
    }
    for (const t of d.tuerschwellen) {
      const k = konturKante(d.kontur, t.lage.kante);
      if (!k) continue;
      const l = dist(k[0], k[1]);
      if (l <= EPS) continue;
      const u = { x: (k[1].x - k[0].x) / l, y: (k[1].y - k[0].y) / l };
      const a = { x: k[0].x + u.x * t.lage.abstand, y: k[0].y + u.y * t.lage.abstand };
      const b = { x: a.x + u.x * t.breite, y: a.y + u.y * t.breite };
      if (distPointSegment(p, a, b) <= tol) return { art: "tuerschwelle", id: t.id, dachId: d.id };
    }
    for (const a of d.attika) {
      const k = konturKante(d.kontur, a.kante);
      if (k && distPointSegment(p, k[0], k[1]) <= tol) return { art: "attika", id: a.id, dachId: d.id };
    }
    for (const a of d.aufbauten) if (pointInRing(p, a.kontur) !== "outside") return { art: "aufbau", id: a.id, dachId: d.id };
    for (const z of d.zonen) if (pointInRing(p, z.kontur) !== "outside") return { art: "zone", id: z.id, dachId: d.id };
    if (pointInPolygon(p, dachPolygon(d)) !== "outside") return { art: "dach", id: d.id, dachId: d.id };
  }
  return null;
}

/** Fangquellen aus dem Projekt: Kanten von Dachkonturen, Aufbauten und Zonen. */
export function projektSegmente(m: ProjectModel): SnapSegment[] {
  const out: SnapSegment[] = [];
  const ring = (k: readonly Vec2[]) => { for (let i = 0; i < k.length; i++) out.push({ a: k[i]!, b: k[(i + 1) % k.length]! }); };
  for (const d of m.dachflaechen) {
    ring(d.kontur);
    for (const a of d.aufbauten) ring(a.kontur);
    for (const z of d.zonen) ring(z.kontur);
  }
  return out;
}

const gleich = (a: Vec2, b: Vec2) => dist(a, b) <= EPS;

/** Klick auf die Zeichenfläche mit dem aktiven Werkzeug. `tol` in m (z. B. 8 px / Maßstab). */
export function klick(z: WerkzeugZustand, m: ProjectModel, p: Vec2, tol: number, opt: KlickOptionen = {}): KlickErgebnis {
  const ohne = (hinweis: string | null): KlickErgebnis => ({ zustand: { ...z, hinweis } });
  switch (z.tool) {
    case "select": return { zustand: { ...z, hinweis: null }, auswahl: waehle(m, p, tol) };
    case "contour": case "aufbau": case "terrasse": {
      const e = z.entwurf;
      if (e.length === 0 && z.tool !== "contour" && !dachAn(m, p)) return ohne("Der erste Punkt muss innerhalb einer Dachfläche liegen.");
      if (e.length >= 3 && dist(p, e[0]!) <= Math.max(tol, EPS)) return abschliessen(z, m);
      if (e.length > 0 && gleich(p, e[e.length - 1]!)) return ohne(z.hinweis); // Doppelklick: kein doppelter Punkt
      return { zustand: { ...z, entwurf: [...e, p], hinweis: null } };
    }
    case "attika": {
      const t = kantenTreffer(m, p, tol);
      if (!t) return ohne("Auf eine Dachkontur klicken.");
      const d = m.dachflaechen.find((x) => x.id === t.dachId)!;
      const id = d.attika.find((a) => a.kante === t.kante)?.id ?? neueIds(m, "at")[0]!;
      return {
        zustand: { ...z, hinweis: null }, befehl: setAttika(t.dachId, t.kante, z.attikaBreite),
        auswahl: { art: "attika", id, dachId: t.dachId },
      };
    }
    case "schwelle": {
      const t = kantenTreffer(m, p, tol);
      if (!t) return ohne("Auf eine Dachkontur klicken.");
      if (z.schwellenBreite > t.laenge) return ohne("Die Schwelle ist breiter als die Kante.");
      return {
        zustand: { ...z, hinweis: null },
        befehl: addTuerschwelle(t.dachId, t.kante, t.abstand - z.schwellenBreite / 2, z.schwellenBreite),
        auswahl: { art: "tuerschwelle", id: neueIds(m, "ts")[0]!, dachId: t.dachId },
      };
    }
    case "gully": case "notablauf": {
      const d = dachAn(m, p);
      if (!d) return ohne("Der Ablauf muss innerhalb einer Dachfläche liegen.");
      return {
        zustand: { ...z, hinweis: null }, befehl: addPunktablauf(d.id, z.tool, p, z.ablaufZ, opt.typ?.(z.tool) ?? null),
        auswahl: { art: "entwaesserung", id: neueIds(m, "en")[0]!, dachId: d.id },
      };
    }
    case "dachreiter": {
      const t = kantenTreffer(m, p, tol);
      if (!t) return ohne("Auf eine Dachkontur klicken.");
      return {
        zustand: { ...z, hinweis: null }, befehl: addDachreiter(t.dachId, t.kante, t.abstand, z.ablaufZ, opt.typ?.("dachreiter") ?? null),
        auswahl: { art: "entwaesserung", id: neueIds(m, "en")[0]!, dachId: t.dachId },
      };
    }
    case "les": {
      const d = dachAn(m, p);
      if (!d) return ohne("Die LES muss innerhalb einer Dachfläche liegen.");
      const e = z.entwurf;
      if (e.length === 0) return { zustand: { ...z, entwurf: [p], hinweis: null } };
      if (gleich(p, e[0]!)) return ohne("Das Ende muss vom Anfang abweichen.");
      const d0 = dachAn(m, e[0]!);
      if (!d0 || d0.id !== d.id) return ohne("Beide LES-Enden müssen in derselben Dachfläche liegen.");
      return {
        zustand: { ...z, entwurf: [], hinweis: null }, befehl: addLes(d.id, e[0]!, p, z.ablaufZ, opt.typ?.("les") ?? null),
        auswahl: { art: "entwaesserung", id: neueIds(m, "en")[0]!, dachId: d.id },
      };
    }
    case "trennen": {
      const e = z.entwurf;
      if (e.length === 0) return dachAn(m, p) ? { zustand: { ...z, entwurf: [p], hinweis: null } } : ohne("Den ersten Punkt auf oder in einer Dachfläche setzen.");
      if (dist(p, e[0]!) <= Math.max(tol, EPS)) return ohne("Das Ende muss vom Anfang abweichen.");
      const d = dachAn(m, { x: (e[0]!.x + p.x) / 2, y: (e[0]!.y + p.y) / 2 }) ?? dachAn(m, e[0]!);
      if (!d) return ohne("Die Trennlinie muss über eine Dachfläche verlaufen.");
      const befehl = trenneDachflaeche(d.id, e[0]!, p, z.trennBreite);
      if (befehl.anwenden(m) === m) return ohne("Die Linie trennt die Dachfläche nicht in zwei Teile.");
      const id = neueIds(m, "d")[0]!;
      return { zustand: { ...z, entwurf: [], hinweis: null }, befehl, auswahl: { art: "dach", id, dachId: id } };
    }
    default: return ohne(null);
  }
}

/** Enter bzw. Doppelklick: Polygon schließen und als Objekt anlegen. */
export function abschliessen(z: WerkzeugZustand, m: ProjectModel): KlickErgebnis {
  if (!POLYGON_WERKZEUGE.includes(z.tool)) return { zustand: z };
  const e = z.entwurf;
  const fehler = pruefePolygon(e);
  if (fehler) return { zustand: { ...z, hinweis: fehler } };
  const frei = { ...z, entwurf: [], hinweis: null };
  if (z.tool === "contour") {
    return { zustand: frei, befehl: addDachflaeche(e), auswahl: { art: "dach", id: neueIds(m, "d")[0]!, dachId: neueIds(m, "d")[0]! } };
  }
  const d = dachAn(m, e[0]!);
  if (!d || !e.every((q) => pointInRing(q, d.kontur) !== "outside")) {
    return { zustand: { ...z, hinweis: "Die Fläche muss vollständig innerhalb einer Dachfläche liegen." } };
  }
  if (z.tool === "aufbau") {
    return { zustand: frei, befehl: addAufbau(d.id, e), auswahl: { art: "aufbau", id: neueIds(m, "au")[0]!, dachId: d.id } };
  }
  return { zustand: frei, befehl: addTerrasse(d.id, e), auswahl: { art: "zone", id: neueIds(m, "zo")[0]!, dachId: d.id } };
}

/** Rücktaste: letzten Entwurfspunkt entfernen. */
export const entfernePunkt = (z: WerkzeugZustand): WerkzeugZustand => ({ ...z, entwurf: z.entwurf.slice(0, -1), hinweis: null });
/** Esc: Entwurf verwerfen. */
export const abbrechen = (z: WerkzeugZustand): WerkzeugZustand => ({ ...z, entwurf: [], hinweis: null });
export const setzeAttikaBreite = (z: WerkzeugZustand, b: number): WerkzeugZustand => (b > 0 ? { ...z, attikaBreite: b } : z);
export const setzeTrennBreite = (z: WerkzeugZustand, b: number): WerkzeugZustand => (b > 0 && Number.isFinite(b) ? { ...z, trennBreite: b } : z);
export const setzeSchwellenBreite = (z: WerkzeugZustand, b: number): WerkzeugZustand => (b > 0 ? { ...z, schwellenBreite: b } : z);

/** Knopf „Umlaufend“ des Attika-Werkzeugs für die Dachfläche `dachId`. */
export const attikaUmlaufend = (z: WerkzeugZustand, dachId: Id): KlickErgebnis => ({
  zustand: { ...z, hinweis: null }, befehl: setAttikaUmlaufend(dachId, z.attikaBreite),
});
