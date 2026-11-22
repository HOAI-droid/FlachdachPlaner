/**
 * Kalibrierung von Unterlagen (PLAN Schritt 16):Ähnlichkeitsabbildung Unterlage → Welt (m)
 * aus zwei Passpunkten (Maßstab + Drehung + Verschiebung, keine Spiegelung/Scherung).
 * Rein, ohne DOM. PDF-Einheit = 1 pt = 1/72 in auf Papier.
 */
import { EPS } from "../geometry/eps";
import type { Vec2 } from "../geometry/types";
import type { Passpunkt } from "../model/types";

/** Meter Papierlänge je PDF-Einheit (1 pt = 0,0254 m / 72). */
export const PAPIER_M_PRO_PT = 0.0254 / 72;

/** x' = a·x − b·y + tx, y' = b·x + a·y + ty (a = s·cosθ, b = s·sinθ). */
export interface Aehnlichkeit {
  readonly a: number; readonly b: number; readonly tx: number; readonly ty: number;
}

export const IDENTITAET: Aehnlichkeit = { a: 1, b: 0, tx: 0, ty: 0 };

export const anwenden = (t: Aehnlichkeit, p: Vec2): Vec2 =>
  ({ x: t.a * p.x - t.b * p.y + t.tx, y: t.b * p.x + t.a * p.y + t.ty });

/** Maßstabsfaktor s (Meter je Unterlagen-Einheit). */
export const faktor = (t: Aehnlichkeit): number => Math.hypot(t.a, t.b);
/** Drehwinkel in rad. */
export const drehung = (t: Aehnlichkeit): number => Math.atan2(t.b, t.a);

export function invertiere(t: Aehnlichkeit): Aehnlichkeit | null {
  const n = t.a * t.a + t.b * t.b;
  if (!(n > 0)) return null;
  const a = t.a / n, b = -t.b / n;
  return { a, b, tx: -(a * t.tx - b * t.ty), ty: -(b * t.tx + a * t.ty) };
}

/** Zwei Passpunkte → Abbildung; null, wenn die Punkte in einer der Ebenen zusammenfallen. */
export function ausPasspunkten(p: readonly [Passpunkt, Passpunkt]): Aehnlichkeit | null {
  const [p0, p1] = p;
  const du = { x: p1.unterlage.x - p0.unterlage.x, y: p1.unterlage.y - p0.unterlage.y };
  const dw = { x: p1.welt.x - p0.welt.x, y: p1.welt.y - p0.welt.y };
  const n = du.x * du.x + du.y * du.y;
  if (!(Math.sqrt(n) > EPS) || !(Math.hypot(dw.x, dw.y) > EPS)) return null;
  // komplexe Division dw / du
  const a = (dw.x * du.x + dw.y * du.y) / n;
  const b = (dw.y * du.x - dw.x * du.y) / n;
  const t0 = { a, b, tx: 0, ty: 0 };
  const m = anwenden(t0, p0.unterlage);
  return { a, b, tx: p0.welt.x - m.x, ty: p0.welt.y - m.y };
}

/** Abbildung → zwei Passpunkte (Einheitsstrecke entlang x in Unterlagenkoordinaten, ab Ursprung). */
export function zuPasspunkten(t: Aehnlichkeit, laenge = 1): [Passpunkt, Passpunkt] {
  const u0 = { x: 0, y: 0 }, u1 = { x: laenge, y: 0 };
  return [{ unterlage: u0, welt: anwenden(t, u0) }, { unterlage: u1, welt: anwenden(t, u1) }];
}

/** Maßstab 1:n für PDF: n Papier-Meter ↔ Welt-Meter; ergibt Meter je PDF-Einheit. */
export const faktorAusNenner = (nenner: number): number => nenner * PAPIER_M_PRO_PT;
/** Maßstabsnenner n aus Meter je PDF-Einheit. */
export const nennerAusFaktor = (f: number): number => f / PAPIER_M_PRO_PT;

/** Unterlage 1:n, Ursprung der Unterlage im Welt-Ursprung, keine Drehung. */
export function ausNenner(nenner: number): Aehnlichkeit | null {
  if (!(nenner > 0) || !Number.isFinite(nenner)) return null;
  return { a: faktorAusNenner(nenner), b: 0, tx: 0, ty: 0 };
}

/** Ändert den Maßstab auf 1:n und hält dabei den Weltpunkt `halt` fest (Drehung bleibt). */
export function nennerSetzen(t: Aehnlichkeit, nenner: number, halt: Vec2): Aehnlichkeit | null {
  const s = faktor(t);
  if (!(s > 0) || !(nenner > 0)) return null;
  return skaliereUm(t, faktorAusNenner(nenner) / s, halt);
}

/** Skaliert die Abbildung um den Weltpunkt `halt` mit Faktor k. */
export function skaliereUm(t: Aehnlichkeit, k: number, halt: Vec2): Aehnlichkeit {
  return { a: t.a * k, b: t.b * k, tx: halt.x + k * (t.tx - halt.x), ty: halt.y + k * (t.ty - halt.y) };
}

/**
 * Zwei-Punkt-Kalibrierung: Der Nutzer wählt zwei Weltpunkte (auf der Unterlage) und gibt die bekannte
 * Strecke in m ein. Punkt A bleibt fest, der Maßstab wird so angepasst, dass |AB| = `strecke` ist.
 */
export function kalibriereStrecke(t: Aehnlichkeit, a: Vec2, b: Vec2, strecke: number): Aehnlichkeit | null {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  if (!(d > EPS) || !(strecke > 0) || !Number.isFinite(strecke)) return null;
  return skaliereUm(t, strecke / d, a);
}

/** Dreht um den Weltpunkt `halt` um `winkel` (rad). */
export function dreheUm(t: Aehnlichkeit, winkel: number, halt: Vec2): Aehnlichkeit {
  const c = Math.cos(winkel), s = Math.sin(winkel);
  const rot = { a: c, b: s, tx: halt.x - (c * halt.x - s * halt.y), ty: halt.y - (s * halt.x + c * halt.y) };
  return {
    a: rot.a * t.a - rot.b * t.b, b: rot.b * t.a + rot.a * t.b,
    tx: rot.a * t.tx - rot.b * t.ty + rot.tx, ty: rot.b * t.tx + rot.a * t.ty + rot.ty,
  };
}
