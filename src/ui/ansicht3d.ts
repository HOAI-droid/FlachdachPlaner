/** 3D-Ansicht (PLAN Schritt 27, DESIGN §7, §11): Canvas-2D-Projektion ohne Zusatzbibliothek (Painter-Algorithmus). */
import { meshDach, meshDaemmung, type Flaeche3, type InsulationLayout, type SlopeResult, type Vec3 } from "../core/index";
import { farbe } from "./ergebnis";
import { zahl } from "./format";
import { css, dunkel } from "./zeichnen";

export type Modus3 = "flaeche" | "daemmplan";

const mischen = (hex: string, mit: number, anteil: number): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16), c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return c.map((v) => v + (mit - v) * anteil) as [number, number, number];
};
const rgb = (c: [number, number, number], licht: number) => `rgb(${c.map((v) => Math.max(0, Math.min(255, Math.round(v * licht)))).join(",")})`;
const LICHT = (() => { const v = [-1, -1, 1.3], l = Math.hypot(...(v as [number, number, number])); return v.map((x) => x / l); })() as [number, number, number];

export class Ansicht3D {
  readonly wurzel: HTMLElement;
  private canvas = document.createElement("canvas");
  private yaw = 0.6; private pitch = 0.9; private zoom = 1; private ue = 5; private modus: Modus3 = "flaeche";
  private slope: SlopeResult | null = null; private plan: InsulationLayout | null = null;
  private netz: Flaeche3[] = [];
  private bereit = false;

  constructor(host: HTMLElement) {
    this.wurzel = document.createElement("div");
    this.wurzel.className = "ansicht3d";
    this.wurzel.style.cssText = "position:absolute;inset:0;display:none;background:var(--bg)";
    this.canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;cursor:grab";
    this.wurzel.append(this.canvas, this.leiste());
    host.append(this.wurzel);
    let drag: { x: number; y: number } | null = null;
    this.canvas.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY }; this.canvas.setPointerCapture(e.pointerId); this.canvas.style.cursor = "grabbing"; });
    this.canvas.addEventListener("pointermove", (e) => {
      if (!drag) return;
      this.yaw += (e.clientX - drag.x) * 0.008; this.pitch = Math.max(0.05, Math.min(Math.PI / 2, this.pitch + (e.clientY - drag.y) * 0.008));
      drag = { x: e.clientX, y: e.clientY }; this.zeichne();
    });
    const ende = (e: PointerEvent) => { drag = null; this.canvas.releasePointerCapture(e.pointerId); this.canvas.style.cursor = "grab"; };
    this.canvas.addEventListener("pointerup", ende); this.canvas.addEventListener("pointercancel", ende);
    this.canvas.addEventListener("wheel", (e) => { e.preventDefault(); this.zoom = Math.max(0.2, Math.min(20, this.zoom * Math.exp(-e.deltaY * 0.0015))); this.zeichne(); }, { passive: false });
    new ResizeObserver(() => this.zeichne()).observe(this.wurzel);
    new MutationObserver(() => this.zeichne()).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  }

  private leiste(): HTMLElement {
    const l = document.createElement("div");
    l.style.cssText = "position:absolute;top:12px;right:12px;display:flex;gap:8px;align-items:center";
    const gruppe = <T extends string>(name: string, felder: [T, string][], start: T, bei: (v: T) => void) => {
      const w = document.createElement("div"); w.className = "segment"; w.setAttribute("role", "group"); w.setAttribute("aria-label", name);
      for (const [v, t] of felder) {
        const b = document.createElement("button"); b.type = "button"; b.textContent = t; b.setAttribute("aria-pressed", String(v === start));
        b.addEventListener("click", () => { w.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", "false")); b.setAttribute("aria-pressed", "true"); bei(v); });
        w.append(b);
      }
      return w;
    };
    l.append(
      gruppe<Modus3>("3D-Modus", [["flaeche", "Fläche"], ["daemmplan", "Dämmplan"]], "flaeche", (v) => { this.modus = v; this.baue(); this.zeichne(); }),
      gruppe<string>("Überhöhung", [["1", "1×"], ["5", "5×"], ["10", "10×"]], "5", (v) => { this.ue = Number(v); this.baue(); this.zeichne(); }),
    );
    return l;
  }

  zeigen(an: boolean): void { this.wurzel.style.display = an ? "block" : "none"; this.bereit = an; if (an) this.zeichne(); }
  daten(slope: SlopeResult | null, plan: InsulationLayout | null): void { this.slope = slope; this.plan = plan; this.baue(); if (this.bereit) this.zeichne(); }

  private baue(): void {
    if (!this.slope) { this.netz = []; return; }
    this.netz = this.modus === "daemmplan" && this.plan ? meshDaemmung(this.slope, this.plan, this.ue) : meshDach(this.slope, this.ue);
  }

  /** Weltpunkt → Bild (rechts, oben) und Tiefe (größer = weiter weg). */
  private proj(p: Vec3, c: Vec3): { x: number; y: number; t: number } {
    const x = p.x - c.x, y = p.y - c.y, z = p.z - c.z, cy = Math.cos(this.yaw), sy = Math.sin(this.yaw), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const rx = x * cy - y * sy, ry = x * sy + y * cy;
    return { x: rx, y: z * cp + ry * sp, t: ry * cp - z * sp };
  }

  zeichne(): void {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = css("--bg", "#F4F2EC"); ctx.fillRect(0, 0, w, h);
    const alle = this.netz.flatMap((f) => f.outer);
    if (alle.length === 0) return;
    const mn = { x: Math.min(...alle.map((v) => v.x)), y: Math.min(...alle.map((v) => v.y)), z: Math.min(...alle.map((v) => v.z)) };
    const mx = { x: Math.max(...alle.map((v) => v.x)), y: Math.max(...alle.map((v) => v.y)), z: Math.max(...alle.map((v) => v.z)) };
    const c: Vec3 = { x: (mn.x + mx.x) / 2, y: (mn.y + mx.y) / 2, z: (mn.z + mx.z) / 2 };
    const R = Math.max(0.5, Math.hypot(mx.x - mn.x, mx.y - mn.y, mx.z - mn.z) / 2);
    const s = (Math.min(w, h) * 0.45 / R) * this.zoom, ox = w / 2, oy = h / 2;
    const bild = (p: Vec3) => { const q = this.proj(p, c); return { x: ox + q.x * s, y: oy - q.y * s, t: q.t }; };
    const dk = dunkel(), linie = css("--text", "#222");

    const faces = this.netz.map((f) => {
      const pts = f.outer.map(bild);
      return { f, pts, tiefe: pts.reduce((a, q) => a + q.t, 0) / pts.length };
    }).sort((a, b) => b.tiefe - a.tiefe);
    for (const { f, pts } of faces) {
      const n = normale(f.outer);
      const licht = 0.72 + 0.28 * Math.max(0, n.x * LICHT[0] + n.y * LICHT[1] + n.z * LICHT[2]);
      let basis: [number, number, number];
      if (f.art === "dach") basis = mischen(farbe(f.gruppe)[dk ? 1 : 0], dk ? 0 : 255, dk ? 0 : 0.15);
      else if (f.art === "platte") basis = f.zusatzlagen ? (dk ? [214, 176, 40] : [244, 208, 63]) : (dk ? [110, 112, 118] : [232, 228, 218]);
      else basis = mischen(dk ? "#6E7076" : "#C9C4B8", 0, 0);
      ctx.beginPath();
      for (const ring of [pts, ...f.holes.map((r) => r.map(bild))]) { ring.forEach((q, i) => (i === 0 ? ctx.moveTo(q.x, q.y) : ctx.lineTo(q.x, q.y))); ctx.closePath(); }
      ctx.fillStyle = rgb(basis, f.art === "seite" ? licht * 0.85 : licht); ctx.fill("evenodd");
      ctx.strokeStyle = f.art === "platte" ? css("--text-muted", "#777") : linie; ctx.globalAlpha = f.art === "dach" ? 0.6 : f.art === "platte" ? 0.9 : 0.25; ctx.lineWidth = f.art === "platte" ? 0.8 : 1;
      if (f.stumm) {
        ctx.beginPath();
        pts.forEach((q, i) => { const r = pts[(i + 1) % pts.length]!; if (!f.stumm![i]) { ctx.moveTo(q.x, q.y); ctx.lineTo(r.x, r.y); } });
        ctx.stroke();
      } else ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // Gefällepfeile wie in 2D (nur Flächenmodus): 0,8 m lang, Spitze bergab, auf der Facettenebene
    if (this.modus === "flaeche" && this.slope) {
      ctx.strokeStyle = dk ? "#E8E6E0" : css("--text", "#222"); ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = 1.4; ctx.lineCap = "round";
      for (const g of this.slope.dachflaechen) {
        const z0 = g.tiefpunkt?.kote ?? 0;
        for (const a of g.pfeile) {
          const f = g.facetten.find((x) => x.id === a.facetteId);
          if (!f) continue;
          const e = f.ebene, pt = (x: number, y: number) => bild({ x, y, z: z0 + (e.a * x + e.b * y + e.c - z0) * this.ue });
          const L = 0.52, k = 0.2, r = a.richtung, s0 = a.start;
          const v = pt(s0.x - r.x * L, s0.y - r.y * L), b = pt(s0.x + r.x * L, s0.y + r.y * L);
          const h1 = pt(s0.x + r.x * (L - k) - r.y * k * 0.6, s0.y + r.y * (L - k) + r.x * k * 0.6), h2 = pt(s0.x + r.x * (L - k) + r.y * k * 0.6, s0.y + r.y * (L - k) - r.x * k * 0.6);
          ctx.beginPath(); ctx.moveTo(v.x, v.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(h1.x, h1.y); ctx.lineTo(h2.x, h2.y); ctx.closePath(); ctx.fill();
        }
      }
    }
    // Typ-Labels auf den Oberseiten (nur wenn Platz)
    if (this.modus === "daemmplan") {
      ctx.font = "11px 'IBM Plex Sans Condensed', sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = linie;
      const belegt: { x: number; y: number; w: number }[] = [];
      for (const { f, pts } of faces.slice().reverse()) {
        if (f.art !== "platte" || !f.bezeichnung) continue;
        const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y), bw = Math.max(...xs) - Math.min(...xs), bh = Math.max(...ys) - Math.min(...ys);
        if (bw < ctx.measureText(f.bezeichnung).width + 6 || bh < 12) continue;
        const tx = (Math.min(...xs) + Math.max(...xs)) / 2, ty = (Math.min(...ys) + Math.max(...ys)) / 2, tw = ctx.measureText(f.bezeichnung).width + 4;
        if (belegt.some((r) => Math.abs(r.x - tx) < (r.w + tw) / 2 && Math.abs(r.y - ty) < 12)) continue;
        belegt.push({ x: tx, y: ty, w: tw });
        ctx.fillText(f.bezeichnung, tx, ty);
      }
    }
    // Überhöhung + Kompass/Achsenkreuz (unten links, 48 px)
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.font = "12px 'IBM Plex Mono', monospace"; ctx.fillStyle = linie;
    ctx.fillText(`Überhöhung ${zahl(this.ue, 0)}×`, 12, h - 12 - 60);
    const k = { x: 12 + 24, y: h - 12 - 24 };
    ctx.strokeStyle = linie; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(k.x, k.y, 24, 0, Math.PI * 2); ctx.globalAlpha = 0.4; ctx.stroke(); ctx.globalAlpha = 1;
    const achse = (v: Vec3, t: string, stark: boolean) => {
      const q = this.proj(v, { x: 0, y: 0, z: 0 });
      const ex = k.x + q.x * 17, ey = k.y - q.y * 17;
      ctx.strokeStyle = linie; ctx.lineWidth = stark ? 2 : 1; ctx.beginPath(); ctx.moveTo(k.x, k.y); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = `${stark ? 600 : 400} 10px 'IBM Plex Sans Condensed', sans-serif`;
      ctx.fillText(t, k.x + q.x * 21, k.y - q.y * 21);
    };
    achse({ x: 1, y: 0, z: 0 }, "x", false); achse({ x: 0, y: 0, z: 1 }, "z", false); achse({ x: 0, y: 1, z: 0 }, "N", true);
  }
}

function normale(p: readonly Vec3[]): Vec3 {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i]!, b = p[(i + 1) % p.length]!;
    nx += (a.y - b.y) * (a.z + b.z); ny += (a.z - b.z) * (a.x + b.x); nz += (a.x - b.x) * (a.y + b.y);
  }
  const l = Math.hypot(nx, ny, nz) || 1;
  return nz < 0 ? { x: -nx / l, y: -ny / l, z: -nz / l } : { x: nx / l, y: ny / l, z: nz / l };
}
