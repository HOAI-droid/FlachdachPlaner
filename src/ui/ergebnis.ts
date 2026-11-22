/** Berechnung und Darstellung der Ergebnisse (PLAN Schritt 19): Einzugsflächen, Koten, Pfeile, Notbereich, Kennwerte. */
import {
  computeCatchments, computeSlope, estimateEmergency, pointInPolygon, polygonCentroid, runChecks,
  type Befund, type CatchmentResult, type Dachflaeche, type EmergencyEstimate, type Einzugsflaeche, type ProjectModel,
  type Auswahl, type SlopeResult, type Vec2,
} from "../core/index";
import type { Viewport } from "./canvas/viewport";
import { kote, millimeter, prozent, quadratmeter, zahl } from "./format";
import { kantenLage } from "./symbole";
import { daemmStandard, packs } from "./packs";
import { Belegung, badge, bahn, css, dunkel, text, textBreite } from "./zeichnen";

export interface Ergebnis {
  readonly slope: SlopeResult;
  readonly catchments: CatchmentResult;
  readonly notfall: readonly EmergencyEstimate[];
  readonly befunde: readonly Befund[];
  /** Hinweise aus Berechnung (keine Befunde), Klartext. */
  readonly hinweise: readonly string[];
  /** Einzugsflächen-ID → „E3“. */
  readonly eids: ReadonlyMap<string, string>;
}

export function berechne(m: ProjectModel): Ergebnis {
  const std = daemmStandard();
  const slope = computeSlope(m, { packs, ...(std !== undefined ? { daemmdickeTiefpunktStandard: std } : {}) });
  const regeln = packs.find((p) => p.typ === "regeln");
  const catchments = computeCatchments(m, slope, regeln?.typ === "regeln" ? { regeln } : {});
  const em = estimateEmergency(m, slope, catchments.flaechen, null, packs);
  const befunde = [
    ...runChecks(m, { slope, catchments }, packs, std !== undefined ? { daemmdickeTiefpunktStandard: std } : {}),
    ...em.befunde,
  ];
  const eids = new Map(catchments.flaechen.map((f, i) => [f.id, `E${i + 1}`] as const));
  return {
    slope, catchments, notfall: em.schaetzungen, befunde,
    hinweise: [...slope.hinweise, ...catchments.hinweise].map((h) => h.meldung), eids,
  };
}

// 12-Farben-Palette nach Tol (DESIGN §10): Füllung / Rand.
const PALETTE: [string, string][] = [
  ["#77AADD", "#2B5F94"], ["#EE8866", "#A8441F"], ["#EEDD88", "#8C7A1E"], ["#FFAABB", "#B0435A"], ["#99DDFF", "#2E7FA8"], ["#44BB99", "#1E6E57"],
  ["#BBCC33", "#66711A"], ["#AAAA00", "#5C5C00"], ["#AA4499", "#6B2A60"], ["#CC6677", "#7F2E3B"], ["#117733", "#0B4A21"], ["#332288", "#1E1450"],
];
export const farbe = (i: number): [string, string] => PALETTE[((i % 12) + 12) % 12]!;

const dachVon = (m: ProjectModel, id: string): Dachflaeche | undefined => m.dachflaechen.find((d) => d.id === id);

/** Einheitsnormale der Strecke a→b, die ins Dachinnere zeigt. */
function innenNormale(d: Dachflaeche, a: Vec2, b: Vec2): Vec2 {
  const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const n = { x: -(b.y - a.y) / l, y: (b.x - a.x) / l };
  const mid = { x: (a.x + b.x) / 2 + n.x * 0.02, y: (a.y + b.y) / 2 + n.y * 0.02 };
  return pointInPolygon(mid, { outer: d.kontur, holes: [] }) === "outside" ? { x: -n.x, y: -n.y } : n;
}

function labelPunkt(f: Einzugsflaeche): Vec2 {
  const groesste = [...f.polygone].sort((a, b) => b.outer.length - a.outer.length)[0];
  if (!groesste) return { x: 0, y: 0 };
  const c = polygonCentroid(groesste);
  if (pointInPolygon(c, groesste) === "inside") return c;
  return groesste.outer[0]!;
}

export function zeichneEinzugsflaechen(ctx: CanvasRenderingContext2D, vp: Viewport, m: ProjectModel, e: Ergebnis): void {
  const px = 1 / vp.scale;
  const belegung = new Belegung(vp);
  const dk = dunkel();
  ctx.save(); ctx.setLineDash([]); ctx.lineJoin = "round";
  for (const f of e.catchments.flaechen) {
    const [fill, rand] = farbe(f.farbe);
    for (const p of f.polygone) {
      ctx.beginPath();
      for (const r of [p.outer, ...p.holes]) { r.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.closePath(); }
      ctx.globalAlpha = dk ? 0.3 : 0.35; ctx.fillStyle = fill; ctx.fill("evenodd");
      ctx.globalAlpha = 1; ctx.strokeStyle = rand; ctx.lineWidth = 1.5 * px; ctx.stroke();
    }
    const d = dachVon(m, f.dachflaecheId);
    if (d) for (const a of f.attika) {
      const n = innenNormale(d, a.von, a.bis);
      const q = [a.von, a.bis, { x: a.bis.x + n.x * a.breite, y: a.bis.y + n.y * a.breite }, { x: a.von.x + n.x * a.breite, y: a.von.y + n.y * a.breite }];
      bahn(ctx, q); ctx.globalAlpha = dk ? 0.16 : 0.18; ctx.fillStyle = fill; ctx.fill(); ctx.globalAlpha = 1;
    }
    if (f.bewertung?.stufe === "fehler") {
      ctx.save(); ctx.setLineDash([6 * px, 3 * px]); ctx.strokeStyle = css("--error", "#B3261E"); ctx.lineWidth = 2 * px;
      for (const p of f.polygone) { bahn(ctx, p.outer); ctx.stroke(); }
      ctx.restore();
    }
  }
  // Labels (nach den Flächen, damit nichts überdeckt wird)
  for (const f of e.catchments.flaechen) {
    const [, rand] = farbe(f.farbe);
    const id = e.eids.get(f.id) ?? "E?";
    const s = f.attikaFlaeche > 0.005
      ? `${id} · Dach ${zahl(f.dachFlaeche, 0)} m² + Attika ${zahl(f.attikaFlaeche, 0)} m² = ${zahl(f.gesamtFlaeche, 0)} m²`
      : `${id} · ${zahl(f.gesamtFlaeche, 0)} m²`;
    const st = f.bewertung?.stufe;
    const symbol = st === "fehler" ? "achteck" : st === "hinweis" ? "dreieck" : null;
    const w = textBreite(ctx, s, 12, true) + 12 + (symbol ? 14 : 0), h = 19;
    const p0 = labelPunkt(f);
    let versatz = 0, ok = false;
    for (const dy of [0, 24, -24, 48, -48]) { if (belegung.belege(p0, -w / 2, dy - h / 2, w, h)) { versatz = dy; ok = true; break; } }
    if (!ok) continue;
    const mitte = { x: p0.x, y: p0.y + versatz * px };
    if (versatz) { ctx.strokeStyle = rand; ctx.lineWidth = px; bahn(ctx, [p0, mitte], false); ctx.stroke(); }
    badge(ctx, vp, [s], mitte, {
      grund: st === "fehler" ? css("--error-soft", "#F9DEDC") : st === "hinweis" ? css("--warn-soft", "#FBEFD5") : `${css("--surface", "#fff")}E6`,
      rand: st === "fehler" ? css("--error", "#B3261E") : st === "hinweis" ? css("--warn", "#8A5A00") : rand,
      farbe: css("--text", "#222"), symbol,
    });
  }
  ctx.restore();
}

/** Grate (durchgezogen) und Kehlen (gestrichelt, betont) der Gefälleplanung inkl. Zonen. */
export function zeichneFaltlinien(ctx: CanvasRenderingContext2D, vp: Viewport, e: Ergebnis): void {
  const px = 1 / vp.scale;
  ctx.save(); ctx.lineCap = "round";
  for (const d of e.slope.dachflaechen) for (const l of [...d.linien, ...d.zonen.flatMap((z) => z.linien)]) {
    const kehle = l.art === "kehle";
    ctx.strokeStyle = css(kehle ? "--accent" : "--text", "#222"); ctx.globalAlpha = kehle ? 0.95 : 0.7;
    ctx.lineWidth = (kehle ? 2 : 1.4) * px; ctx.setLineDash(kehle ? [7 * px, 4 * px] : []);
    ctx.beginPath(); ctx.moveTo(l.von.x, l.von.y); ctx.lineTo(l.bis.x, l.bis.y); ctx.stroke();
  }
  ctx.restore();
}

export function zeichnePfeile(ctx: CanvasRenderingContext2D, vp: Viewport, e: Ergebnis): void {
  const px = 1 / vp.scale, belegung = new Belegung(vp);
  ctx.save(); ctx.setLineDash([]); ctx.strokeStyle = css("--text-muted", "#555"); ctx.lineWidth = px; ctx.lineCap = "round";
  for (const d of e.slope.dachflaechen) for (const a of d.pfeile) {
    if (d.koten.some((k) => k.art === "ablauf" && Math.hypot(k.position.x - a.start.x, k.position.y - a.start.y) * vp.scale < 120)) continue;
    const len = 44 * px, { x, y } = a.start, rx = a.richtung.x, ry = a.richtung.y;
    const ex = x + rx * len, ey = y + ry * len, k = 8 * px;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey);
    ctx.moveTo(ex - (rx * Math.cos(0.45) - ry * Math.sin(0.45)) * k, ey - (ry * Math.cos(0.45) + rx * Math.sin(0.45)) * k); ctx.lineTo(ex, ey);
    ctx.lineTo(ex - (rx * Math.cos(-0.45) - ry * Math.sin(-0.45)) * k, ey - (ry * Math.cos(-0.45) + rx * Math.sin(-0.45)) * k);
    ctx.stroke();
    const s = prozent(a.gefaelle * 100, 1);
    const mx = x + rx * len / 2 - ry * 7 * px, my = y + ry * len / 2 + rx * 7 * px;
    if (belegung.belege({ x: mx, y: my }, -16, -6, 32, 12)) text(ctx, vp, s, mx, my, { px: 11, mono: true, ankerMitte: true, winkel: Math.atan2(-ry, rx) });
  }
  ctx.restore();
}

export function zeichneKoten(ctx: CanvasRenderingContext2D, vp: Viewport, e: Ergebnis): void {
  const px = 1 / vp.scale, belegung = new Belegung(vp), tx = css("--text", "#222");
  ctx.save(); ctx.setLineDash([]);
  const marke = (p: Vec2, s: string, fett: boolean) => {
    const w = s.length * 7.4;
    let dy = 0, ok = false;
    for (const v of [6, 24, 42]) if (belegung.belege(p, 8, v, w, 14)) { dy = v; ok = true; break; }
    if (!ok) return;
    ctx.fillStyle = tx; ctx.beginPath();
    ctx.moveTo(p.x - 4 * px, p.y + 8 * px); ctx.lineTo(p.x + 4 * px, p.y + 8 * px); ctx.lineTo(p.x, p.y); ctx.closePath(); ctx.fill();
    if (dy > 6) { ctx.strokeStyle = tx; ctx.lineWidth = px; bahn(ctx, [p, { x: p.x + 8 * px, y: p.y + dy * px }], false); ctx.stroke(); }
    text(ctx, vp, s, p.x + 10 * px, p.y + dy * px, { px: 12, mono: true, farbe: fett ? css("--accent", "#1F4FA3") : tx });
  };
  for (const d of e.slope.dachflaechen) {
    const amAblauf = (o: Vec2) => d.koten.some((k) => k.art === "ablauf" && Math.hypot(k.position.x - o.x, k.position.y - o.y) < 0.05);
    if (d.hochpunkt) for (const o of d.hochpunkt.orte.filter((q) => !amAblauf(q)).slice(0, 2)) marke(o, `HP ${kote(d.hochpunkt.kote)}`, true);
    if (d.tiefpunkt) for (const o of d.tiefpunkt.orte.filter((q) => !amAblauf(q)).slice(0, 2)) marke(o, `TP ${kote(d.tiefpunkt.kote)}`, true);
    for (const k of d.koten) if (k.art !== "ablauf") marke(k.position, kote(k.kote), false);
  }
  ctx.restore();
}

/** Notentwässerungsbereich: Streifen entlang der Kante (DESIGN §6), gestrichelt in --warn, Füllung 10 %. */
export function zeichneNotbereich(ctx: CanvasRenderingContext2D, vp: Viewport, m: ProjectModel, e: Ergebnis): void {
  const px = 1 / vp.scale, warn = css("--warn", "#8A5A00");
  ctx.save();
  for (const s of e.notfall) {
    const d = dachVon(m, s.dachflaecheId);
    if (!d) continue;
    for (const b of s.bereich) {
      const n = innenNormale(d, b.von, b.bis), t = 22 * px;
      const q = [b.von, b.bis, { x: b.bis.x + n.x * t, y: b.bis.y + n.y * t }, { x: b.von.x + n.x * t, y: b.von.y + n.y * t }];
      bahn(ctx, q); ctx.globalAlpha = 0.1; ctx.fillStyle = warn; ctx.fill();
      ctx.globalAlpha = 1; ctx.setLineDash([6 * px, 3 * px]); ctx.strokeStyle = warn; ctx.lineWidth = 1.5 * px; ctx.stroke();
      const mx = (b.von.x + b.bis.x) / 2 + n.x * t * 0.5, my = (b.von.y + b.bis.y) / 2 + n.y * t * 0.5;
      if (Math.hypot(b.bis.x - b.von.x, b.bis.y - b.von.y) * vp.scale > 320) text(ctx, vp, "Bereich Notentwässerung", mx, my - 4 * px, { px: 11, farbe: warn, ankerMitte: true, winkel: Math.atan2(-(b.bis.y - b.von.y), b.bis.x - b.von.x) });
    }
  }
  ctx.restore();
}

// ---------- Ergebnis-Panel ----------
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", t = ""): HTMLElementTagNameMap[K] {
  const x = document.createElement(tag);
  if (cls) x.className = cls;
  if (t) x.textContent = t;
  return x;
}

export function fuelleErgebnis(p: HTMLElement, m: ProjectModel, e: Ergebnis): void {
  p.replaceChildren();
  if (m.dachflaechen.length === 0) { p.append(el("div", "empty", "Noch keine Dachfläche gezeichnet.")); return; }
  const mitD = e.slope.dachflaechen.filter((d) => d.daemmung);
  if (mitD.length === 0) p.append(el("div", "empty", "Keine Gefälledämmung berechenbar (Ablauf setzen)."));
  else {
    const t = el("table", "ergebnis");
    t.dataset.k = "daemmung";
    const kopf = el("tr");
    for (const h of ["Dachfläche", "Ø", "min", "max"]) kopf.append(el("th", h === "Dachfläche" ? "" : "num", h));
    t.append(kopf);
    for (const d of mitD) {
      const g = d.daemmung!, r = el("tr");
      r.append(el("td", "", m.dachflaechen.find((x) => x.id === d.dachflaecheId)?.name ?? d.dachflaecheId),
        el("td", "num", millimeter(g.mittel, 0)), el("td", "num", millimeter(g.min, 0)), el("td", "num", millimeter(g.max, 0)));
      t.append(r);
    }
    p.append(el("div", "label", "Ø Gefälledämmung"), t);
    const g0 = mitD[0]!.daemmung!;
    const b = el("div", "badge", `Ø ${zahl(g0.mittel, 0)} mm (min ${zahl(g0.min, 0)} · max ${zahl(g0.max, 0)} mm)`);
    b.dataset.k = "daemmung-badge";
    p.append(b);
  }
  if (e.catchments.flaechen.length) {
    const t = el("table", "ergebnis"); t.dataset.k = "einzug";
    const kopf = el("tr");
    for (const h of ["Fläche", "Dach", "Attika", "Gesamt"]) kopf.append(el("th", h === "Fläche" ? "" : "num", h));
    t.append(kopf);
    for (const f of e.catchments.flaechen) {
      const r = el("tr", f.bewertung?.stufe === "fehler" ? "fehler" : f.bewertung?.stufe === "hinweis" ? "warn" : "");
      r.append(el("td", "", e.eids.get(f.id) ?? "E?"), el("td", "num", quadratmeter(f.dachFlaeche, 1)),
        el("td", "num", quadratmeter(f.attikaFlaeche, 1)), el("td", "num", quadratmeter(f.gesamtFlaeche, 1)));
      t.append(r);
    }
    p.append(el("div", "label", "Einzugsflächen"), t);
  }
  const sch = e.notfall.filter((s) => s.q !== null);
  if (sch.length) {
    const t = el("table", "ergebnis"); t.dataset.k = "notfall";
    const kopf = el("tr");
    for (const h of ["Fläche", "Q", "Anzahl"]) kopf.append(el("th", h === "Fläche" ? "" : "num", h));
    t.append(kopf);
    for (const s of sch) {
      const r = el("tr");
      r.append(el("td", "", e.eids.get(s.einzugsflaecheId) ?? "E?"), el("td", "num", `${zahl(s.q!, 1)} l/s`), el("td", "num", s.anzahl === null ? "–" : String(s.anzahl)));
      t.append(r);
    }
    p.append(el("div", "label", "Notentwässerung"), t);
  }
}

const STUFE: Record<string, string> = { fehler: "Fehler", warnung: "Warnung", hinweis: "Hinweis" };
function entPunkt(d: Dachflaeche, e: Dachflaeche["entwaesserung"][number]): Vec2 | null {
  if (e.art === "gully" || e.art === "notablauf") return e.position;
  if (e.art === "les") return { x: (e.von.x + e.bis.x) / 2, y: (e.von.y + e.bis.y) / 2 };
  return kantenLage(d, e.lage.kante, e.lage.abstand)?.p ?? null;
}

export interface BefundZiel { readonly auswahl: Auswahl | null; readonly mitte: Vec2 | null }

/** Findet zu einem Befund das betroffene Objekt (Auswahl) und einen Punkt zum Zentrieren. */
export function befundZiel(m: ProjectModel, b: Befund): BefundZiel {
  const dachIds = b.dachflaecheId ? [b.dachflaecheId] : m.dachflaechen.map((d) => d.id);
  const mittel = (k: readonly Vec2[]): Vec2 | null => (k.length ? polygonCentroid({ outer: [...k], holes: [] }) : null);
  for (const did of dachIds) {
    const d = dachVon(m, did);
    if (!d) continue;
    if (b.objektId === null || b.objektId === d.id) {
      if (b.objektId === d.id) return { auswahl: { art: "dach", id: d.id, dachId: d.id }, mitte: b.ort ?? mittel(d.kontur) };
      continue;
    }
    const id = b.objektId;
    const ent = d.entwaesserung.find((x) => x.id === id);
    if (ent) { const p0 = entPunkt(d, ent); return { auswahl: { art: "entwaesserung", id, dachId: d.id }, mitte: b.ort ?? p0 ?? mittel(d.kontur) }; }
    const au = d.aufbauten.find((x) => x.id === id);
    if (au) return { auswahl: { art: "aufbau", id, dachId: d.id }, mitte: b.ort ?? mittel(au.kontur) };
    const zo = d.zonen.find((x) => x.id === id);
    if (zo) return { auswahl: { art: "zone", id, dachId: d.id }, mitte: b.ort ?? mittel(zo.kontur) };
    const at = d.attika.find((x) => x.id === id);
    if (at) {
      const i = d.kontur.findIndex((q) => q.id === at.kante), a = d.kontur[i], c = d.kontur[(i + 1) % d.kontur.length];
      return { auswahl: { art: "attika", id, dachId: d.id }, mitte: b.ort ?? (a && c ? { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 } : mittel(d.kontur)) };
    }
    const ts = d.tuerschwellen.find((x) => x.id === id);
    if (ts) return { auswahl: { art: "tuerschwelle", id, dachId: d.id }, mitte: b.ort ?? kantenLage(d, ts.lage.kante, ts.lage.abstand)?.p ?? mittel(d.kontur) };
  }
  // Einzugsfläche/Ablauf-ID aus Flächenbefunden: Ablauf suchen
  return { auswahl: null, mitte: b.ort ?? null };
}

const ZAEHLER: Record<string, [string, string]> = { fehler: ["Fehler", "Fehler"], warnung: ["Warnung", "Warnungen"], hinweis: ["Hinweis", "Hinweise"] };

export function fuellePruefliste(p: HTMLElement, m: ProjectModel, e: Ergebnis | null, bei?: (ziel: BefundZiel) => void): void {
  p.replaceChildren();
  if (m.dachflaechen.length === 0 || !e) { p.append(el("div", "empty", "Noch keine Dachfläche gezeichnet.")); return; }
  const rang = { fehler: 0, warnung: 1, hinweis: 2 } as const;
  const sortiert = [...e.befunde].sort((x, y) => rang[x.stufe] - rang[y.stufe] || x.code.localeCompare(y.code) || x.meldung.localeCompare(y.meldung));
  const anzahl = { fehler: 0, warnung: 0, hinweis: e.hinweise.length };
  for (const b of sortiert) anzahl[b.stufe]++;
  const kopf = el("div", "pruef-zaehler");
  kopf.dataset.k = "zaehler";
  kopf.textContent = (["fehler", "warnung", "hinweis"] as const).map((k) => `${anzahl[k]} ${ZAEHLER[k]![anzahl[k] === 1 ? 0 : 1]}`).join(" · ");
  p.append(kopf);
  const liste = el("ul", "befunde");
  for (const b of sortiert) {
    const li = el("li", `befund ${b.stufe}`);
    li.dataset.code = b.code;
    if (b.objektId) li.dataset.objekt = b.objektId;
    li.append(el("span", "stufe", STUFE[b.stufe]!), el("span", "", b.meldung));
    li.title = b.quelle;
    const ziel = bei ? befundZiel(m, b) : null;
    if (ziel && (ziel.auswahl || ziel.mitte)) {
      li.tabIndex = 0; li.setAttribute("role", "button"); li.classList.add("klick");
      const los = () => bei!(ziel);
      li.addEventListener("click", los);
      li.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); los(); } });
    }
    liste.append(li);
  }
  for (const h of e.hinweise) { const li = el("li", "befund hinweis"); li.dataset.code = "berechnung"; li.append(el("span", "stufe", "Hinweis"), el("span", "", h)); liste.append(li); }
  if (!liste.childElementCount) p.append(el("div", "ok", "Keine Befunde."));
  else p.append(liste);
}
