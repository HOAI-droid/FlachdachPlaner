/**
 * Entwässerungselemente → Quellen des Höhenfelds (PLAN A2/A2a, Schritt 6).
 * - Gully/Notablauf: Punktquelle, Abstandsmaß in Dachachse.
 * - LES: Strecke von (tieferes Ende, Kote z) → bis; die Gefälledämmung bildet eine waagerechte
 *   Kehle entlang der LES, Seitenflächen fallen senkrecht zu ihr. Der LES-Keil liegt AUF der
 *   Gefälledämmung (additiv) und liefert das Längsgefälle; Maße/Gefälle nur aus dem Pack.
 * - Dachreiter: Randquelle auf der Konturkante; Breite der Einlauföffnung aus dem Pack.
 *   Fehlen die Maße, wirkt er als Randpunkt (Hinweis), es werden keine Werte angenommen.
 * Ungeprüfte Packs erzeugen den Hinweis "pack-ungeprueft".
 */
import { CLIPPER_SCALE, intersection } from "../geometry/clipper";
import { EPS } from "../geometry/eps";
import { pointInPolygon, polygonArea } from "../geometry/polygon";
import type { Polygon, Vec2 } from "../geometry/types";
import { konturKante } from "../model/model";
import type { Dachflaeche, Dachreiter, Linienentwaesserung, PackRef } from "../model/types";
import type { DachreiterEintrag, LesEintrag, PackKopf, RulePack } from "../rules/types";
import type { DachreiterLage, Ebene, Hoehenquelle, LesKeil, LesKeilSeite, SlopeHinweis } from "./types";

const umfang = (p: Polygon) => [p.outer, ...p.holes].reduce((s, r) =>
  s + r.reduce((u, a, i) => { const b = r[(i + 1) % r.length]!; return u + Math.hypot(b.x - a.x, b.y - a.y); }, 0), 0);

/** Rundungssplitter der Clipper-Operationen: mittlere Breite (Fläche/Umfang) unter einem Rasterschritt. */
export const istSplitter = (p: Polygon) => polygonArea(p) <= umfang(p) / CLIPPER_SCALE;

const plus = (p: Vec2, v: Vec2, f: number): Vec2 => ({ x: p.x + f * v.x, y: p.y + f * v.y });
const links = (v: Vec2): Vec2 => ({ x: -v.y, y: v.x });

export interface Quellen {
  readonly quellen: Hoehenquelle[];
  readonly les: LesKeil[];
  readonly dachreiter: DachreiterLage[];
}

type Hinweis = (h: Omit<SlopeHinweis, "dachflaecheId">) => void;

/** Eintrag `ref` im Pack vom Typ `typ`; null, wenn Pack oder Eintrag fehlt. */
function finde<E extends { readonly id: string }>(
  packs: readonly RulePack[], ref: PackRef, typ: "les" | "dachreiter",
): { pack: PackKopf; eintrag: E } | null {
  const pack = packs.find((p) => p.id === ref.packId && p.typ === typ);
  if (!pack || (pack.typ !== "les" && pack.typ !== "dachreiter")) return null;
  const eintrag = (pack.daten.eintraege as readonly { readonly id: string }[]).find((e) => e.id === ref.eintragId);
  return eintrag ? { pack, eintrag: eintrag as E } : null;
}

function ungeprueft(pack: PackKopf, objektId: string, hinweis: Hinweis): void {
  if (!pack.geprueft) {
    hinweis({ code: "pack-ungeprueft", objektId, meldung: `Regelwerk ungeprüft: ${pack.titel ?? pack.id} (Version ${pack.version})` });
  }
}

export function quellenAus(
  d: Dachflaeche, dach: Polygon, dachAchse: Vec2, packs: readonly RulePack[], hinweis: Hinweis,
): Quellen {
  const out: Quellen = { quellen: [], les: [], dachreiter: [] };
  const ausserhalb = (id: string, name: string, ...p: Vec2[]) => {
    if (p.some((x) => pointInPolygon(x, dach) === "outside")) {
      hinweis({ code: "ablauf-ausserhalb", objektId: id, meldung: `${name || id} liegt außerhalb der Dachfläche.` });
    }
  };
  for (const e of d.entwaesserung) {
    switch (e.art) {
      case "gully":
      case "notablauf":
        ausserhalb(e.id, e.name, e.position);
        out.quellen.push({ ablaufId: e.id, position: { ...e.position }, bis: { ...e.position }, achse: dachAchse, z: e.z });
        break;
      case "les":
        lesQuelle(e, dach, dachAchse, packs, hinweis, out, ausserhalb);
        break;
      case "dachreiter":
        dachreiterQuelle(e, d, packs, hinweis, out);
        break;
    }
  }
  return out;
}

// ---------- LES ----------

function lesQuelle(
  e: Linienentwaesserung, dach: Polygon, dachAchse: Vec2, packs: readonly RulePack[], hinweis: Hinweis, out: Quellen,
  ausserhalb: (id: string, name: string, ...p: Vec2[]) => void,
): void {
  const von = { x: e.von.x, y: e.von.y }, bis = { x: e.bis.x, y: e.bis.y };
  const laenge = Math.hypot(bis.x - von.x, bis.y - von.y);
  ausserhalb(e.id, e.name, von, bis);
  if (laenge <= EPS) {
    hinweis({ code: "les-laenge-null", objektId: e.id, meldung: `${e.name || e.id}: LES ohne Länge, wirkt als Punktablauf ohne Keil.` });
    out.quellen.push({ ablaufId: e.id, position: von, bis: von, achse: dachAchse, z: e.z });
    return;
  }
  const richtung = { x: (bis.x - von.x) / laenge, y: (bis.y - von.y) / laenge };
  out.quellen.push({ ablaufId: e.id, position: von, bis, achse: richtung, z: e.z });

  const t = e.typ ? finde<LesEintrag>(packs, e.typ, "les") : null;
  if (!e.typ || !t) {
    hinweis({ code: "les-typ-fehlt", objektId: e.id, meldung: `${e.name || e.id}: LES-Produkt nicht gewählt oder nicht im Pack; Keil nicht berechnet.` });
    return;
  }
  ungeprueft(t.pack, e.id, hinweis);
  const { gefaelle: g, keil: k } = t.eintrag;
  if (!(g.quer > 0) || !(g.laengs > 0)) {
    hinweis({ code: "les-gefaelle-ungueltig", objektId: e.id, meldung: `${t.eintrag.produkt}: Längs-/Quergefälle im Pack muss > 0 sein; Linienentwässerung wird nicht gerechnet.` });
    return;
  }
  // Pack in sich stimmig? Breite = Länge · längs/quer, Dickenzuwachs = längs · Länge.
  if (Math.abs(k.breiteJeSeite - (k.laenge * g.laengs) / g.quer) > EPS || Math.abs(k.dickeMax - k.dickeMin - g.laengs * k.laenge) > EPS) {
    hinweis({ code: "les-pack-inkonsistent", objektId: e.id, meldung: `${t.eintrag.produkt}: Keilmaße passen nicht zu Längs-/Quergefälle; gerechnet wird mit den Gefällen.` });
  }
  if (Math.abs(laenge - k.laenge) > EPS) {
    hinweis({ code: "les-laenge-abweichend", objektId: e.id, meldung: `${e.name || e.id}: Länge weicht vom Keil im Pack ab; Keilmaße aus den Gefällen hochgerechnet.` });
  }
  if (t.eintrag.maxLaenge !== undefined && laenge > t.eintrag.maxLaenge + EPS) {
    hinweis({ code: "les-zu-lang", objektId: e.id, meldung: `${e.name || e.id}: länger als die Systemlänge laut Pack.` });
  }
  out.les.push(lesKeil(e, t.eintrag, von, bis, richtung, laenge, dach));
}

function lesKeil(e: Linienentwaesserung, le: LesEintrag, von: Vec2, bis: Vec2, richtung: Vec2, laenge: number, dach: Polygon): LesKeil {
  const { laengs, quer } = le.gefaelle;
  const breite = (laenge * laengs) / quer;
  const dickeTief = le.keil.dickeMin;
  const n = links(richtung);
  const seite = (vz: 1 | -1): LesKeilSeite => {
    // Dicke = dickeTief + längs · t − quer · |v|, t längs ab `von`, v quer (vz · v ≥ 0 auf dieser Seite).
    const a = laengs * richtung.x - vz * quer * n.x, b = laengs * richtung.y - vz * quer * n.y;
    const dicke: Ebene = { a, b, c: dickeTief - a * von.x - b * von.y };
    const dreieck = vz === 1 ? [von, bis, plus(bis, n, breite)] : [von, plus(bis, n, -breite), bis];
    const flaechen = intersection([dach], [{ outer: dreieck, holes: [] }]).filter((p) => !istSplitter(p));
    return { seite: vz, flaechen, dicke };
  };
  const dickeHoch = dickeTief + laengs * laenge;
  return {
    ablaufId: e.id, eintrag: { ...e.typ! }, von, bis, richtung, laenge, breiteJeSeite: breite,
    gefaelleLaengs: laengs, gefaelleQuer: quer, dickeTief, dickeHoch,
    koteTief: e.z + dickeTief, koteHoch: e.z + dickeHoch,
    seiten: [seite(1), seite(-1)],
  };
}

/** Keildicke (m) im Punkt p; 0 außerhalb des Keils (geometrisch, ohne Zuschnitt an der Dachfläche). */
export function keilDickeAm(k: LesKeil, p: Vec2): number {
  const dx = p.x - k.von.x, dy = p.y - k.von.y;
  const t = dx * k.richtung.x + dy * k.richtung.y;
  const v = Math.abs(-dx * k.richtung.y + dy * k.richtung.x);
  if (t < -EPS || t > k.laenge + EPS || v > (Math.max(t, 0) * k.breiteJeSeite) / k.laenge + EPS) return 0;
  return k.dickeTief + k.gefaelleLaengs * t - k.gefaelleQuer * v;
}

// ---------- Dachreiter ----------

function dachreiterQuelle(e: Dachreiter, d: Dachflaeche, packs: readonly RulePack[], hinweis: Hinweis, out: Quellen): void {
  const kante = konturKante(d.kontur, e.lage.kante);
  const laenge = kante ? Math.hypot(kante[1].x - kante[0].x, kante[1].y - kante[0].y) : 0;
  if (!kante || laenge <= EPS || e.lage.abstand < -EPS || e.lage.abstand > laenge + EPS) {
    hinweis({ code: "dachreiter-lage-ungueltig", objektId: e.id, meldung: `${e.name || e.id}: Lage nicht auf einer Konturkante; nicht berücksichtigt.` });
    return;
  }
  const [p] = kante;
  const achse = { x: (kante[1].x - p.x) / laenge, y: (kante[1].y - p.y) / laenge };
  const mitte = plus(p, achse, e.lage.abstand);

  const t = e.typ ? finde<DachreiterEintrag>(packs, e.typ, "dachreiter") : null;
  if (t) ungeprueft(t.pack, e.id, hinweis);
  else {
    hinweis({
      code: "dachreiter-masse-fehlen", objektId: e.id,
      meldung: `${e.name || e.id}: Dachreiter-Maße fehlen im Pack; als Randpunkt ohne Öffnungsbreite gerechnet.`,
    });
  }
  const halb = (t?.eintrag.breite ?? 0) / 2;
  const a = Math.max(0, e.lage.abstand - halb), b = Math.min(laenge, e.lage.abstand + halb);
  if (e.lage.abstand - halb < -EPS || e.lage.abstand + halb > laenge + EPS) {
    hinweis({ code: "dachreiter-lage-ungueltig", objektId: e.id, meldung: `${e.name || e.id}: Einlauföffnung ragt über die Kante; auf die Kante begrenzt.` });
  }
  const von = plus(p, achse, a), bis = plus(p, achse, b);
  out.quellen.push({ ablaufId: e.id, position: von, bis, achse, z: e.z });
  out.dachreiter.push({ ablaufId: e.id, eintrag: e.typ ? { ...e.typ } : null, mitte, von, bis, breite: b - a, masse: t?.eintrag ?? null });
}
