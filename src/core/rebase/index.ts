/** Unterlage austauschen und Abweichungen nachziehen (PLAN Schritt 22a). DOM-frei. */
import type { Befehl } from "../edit/history";
import type { Vec2 } from "../geometry/types";
import type { Dachflaeche, KonturPunkt, ProjectModel } from "../model/types";
import type { SnapSegment } from "../snap/snap";

export const TOLERANZ_STANDARD = 0.02;
/** Ein Punkt gilt als „auf einem Fangpunkt gezeichnet“, wenn er höchstens so weit entfernt liegt (m). */
const ANKER_EPS = 0.001;
/** Suchradius für den neuen Fangpunkt-Vorschlag (m). */
const SUCHRADIUS = 1;

export interface PunktRef {
  readonly dachId: string;
  readonly art: "kontur" | "aufbau" | "zone";
  /** Aufbau-/Zonen-ID; bei `kontur` undefined. */
  readonly objektId?: string;
  readonly punktId: string;
}

export interface Abweichung {
  readonly id: string;
  readonly ref: PunktRef;
  readonly alt: Vec2;
  /** Nächster neuer Fangpunkt innerhalb 1 m; null, wenn keiner existiert. */
  readonly vorschlag: Vec2 | null;
  /** Abstand alt → Vorschlag in m (null ohne Vorschlag). */
  readonly abstand: number | null;
}

const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

function endpunkte(seg: readonly SnapSegment[]): Vec2[] {
  const out: Vec2[] = [];
  for (const s of seg) out.push(s.a, s.b);
  return out;
}
const naechster = (p: Vec2, kand: readonly Vec2[]): { p: Vec2; d: number } | null => {
  let best: { p: Vec2; d: number } | null = null;
  for (const q of kand) { const d = dist(p, q); if (!best || d < best.d) best = { p: q, d }; }
  return best;
};

function punkteAllerKonturen(d: Dachflaeche): { ref: PunktRef; p: KonturPunkt }[] {
  const out: { ref: PunktRef; p: KonturPunkt }[] = [];
  for (const p of d.kontur) out.push({ ref: { dachId: d.id, art: "kontur", punktId: p.id }, p });
  for (const a of d.aufbauten) for (const p of a.kontur) out.push({ ref: { dachId: d.id, art: "aufbau", objektId: a.id, punktId: p.id }, p });
  for (const z of d.zonen) for (const p of z.kontur) out.push({ ref: { dachId: d.id, art: "zone", objektId: z.id, punktId: p.id }, p });
  return out;
}

/**
 * Prüft jeden gezeichneten Konturpunkt, der auf einem alten Fangpunkt lag, gegen die neuen Fangpunkte.
 * Liegt ein neuer Fangpunkt innerhalb `toleranz`, bleibt der Punkt unverändert; sonst wird er mit
 * dem nächsten neuen Fangpunkt als Vorschlag gemeldet (Reihenfolge: Projektreihenfolge, deterministisch).
 */
export function findeAbweichungen(
  m: ProjectModel, altSeg: readonly SnapSegment[], neuSeg: readonly SnapSegment[], toleranz = TOLERANZ_STANDARD,
): Abweichung[] {
  const alt = endpunkte(altSeg), neu = endpunkte(neuSeg);
  const out: Abweichung[] = [];
  for (const d of m.dachflaechen) {
    for (const { ref, p } of punkteAllerKonturen(d)) {
      const ort = { x: p.x, y: p.y };
      const anker = naechster(ort, alt);
      if (!anker || anker.d > ANKER_EPS) continue;
      const n = naechster(ort, neu);
      if (n && n.d <= toleranz) continue;
      const vorschlag = n && n.d <= SUCHRADIUS ? n.p : null;
      out.push({ id: `${ref.dachId}/${ref.art}/${ref.objektId ?? ""}/${ref.punktId}`, ref, alt: ort, vorschlag, abstand: vorschlag ? dist(ort, vorschlag) : null });
    }
  }
  return out;
}

function setzeInKontur(k: readonly KonturPunkt[], punktId: string, pos: Vec2): KonturPunkt[] {
  return k.map((p) => (p.id === punktId ? { ...p, x: pos.x, y: pos.y } : p));
}

/** Setzt mehrere Konturpunkte in einem Schritt (ein Undo-Eintrag). */
export function verschiebePunkte(eintraege: readonly { ref: PunktRef; pos: Vec2 }[], label = "Punkte nachziehen"): Befehl {
  return {
    label,
    anwenden: (m) => ({
      ...m,
      dachflaechen: m.dachflaechen.map((d) => {
        const mine = eintraege.filter((e) => e.ref.dachId === d.id);
        if (!mine.length) return d;
        let r: Dachflaeche = d;
        for (const { ref, pos } of mine) {
          if (ref.art === "kontur") r = { ...r, kontur: setzeInKontur(r.kontur, ref.punktId, pos) };
          else if (ref.art === "aufbau") r = { ...r, aufbauten: r.aufbauten.map((a) => (a.id === ref.objektId ? { ...a, kontur: setzeInKontur(a.kontur, ref.punktId, pos) } : a)) };
          else r = { ...r, zonen: r.zonen.map((z) => (z.id === ref.objektId ? { ...z, kontur: setzeInKontur(z.kontur, ref.punktId, pos) } : z)) };
        }
        return r;
      }),
    }),
  };
}

/** Übernimmt Vorschläge (nur Abweichungen mit Vorschlag). */
export const uebernehmeVorschlaege = (liste: readonly Abweichung[]): Befehl =>
  verschiebePunkte(liste.filter((a) => a.vorschlag).map((a) => ({ ref: a.ref, pos: a.vorschlag! })),
    liste.length === 1 ? "Punkt auf neuen Fangpunkt setzen" : `${liste.length} Punkte auf neue Fangpunkte setzen`);
