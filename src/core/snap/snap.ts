/**
 * Punktfang (PLAN.md Schritt 14): End-, Mittel-, Schnittpunkt, Lot, Ortho über einem
 * gleichmäßigen Gitter-Index (CSR-Layout). Rein, ohne DOM. Alle Längen in Weltmetern;
 * die UI rechnet die Pixel-Toleranz über den Maßstab um.
 */
import { EPS } from "../geometry/eps";
import { closestPointOnSegment, dist, distPointSegment, segmentIntersection } from "../geometry/segment";
import type { Vec2 } from "../geometry/types";

/** Fangquelle: Strecke a–b (Unterlage, Kontur …). */
export interface SnapSegment {
  readonly a: Vec2;
  readonly b: Vec2;
}

/** Fangarten in Prioritätsreihenfolge (End > Schnitt > Mitte > Lot > Ortho). */
export const SNAP_ARTEN = ["endpunkt", "schnittpunkt", "mittelpunkt", "lot", "ortho"] as const;
export type SnapArt = (typeof SNAP_ARTEN)[number];

export interface SnapOptionen {
  /** Aktive Fangarten (Standard: alle). Reihenfolge ist egal, es gilt `SNAP_ARTEN`. */
  readonly arten?: readonly SnapArt[];
  /** Bezugspunkt (letzter gesetzter Punkt) für Lot und Ortho; ohne ihn entfallen beide. */
  readonly referenzpunkt?: Vec2;
  /** Drehwinkel der Ortho-Achsen in rad (Standard 0 = x/y-Achse). */
  readonly orthoAchse?: number;
}

export interface SnapTreffer {
  readonly art: SnapArt;
  readonly punkt: Vec2;
  /** Indizes der Quellsegmente (Eingabereihenfolge); leer bei Ortho. */
  readonly segmente: readonly number[];
  /** Abstand Cursor–Fangpunkt in m. */
  readonly abstand: number;
}

export interface SnapIndex {
  readonly segmente: readonly SnapSegment[];
  readonly zellgroesse: number;
  /** @internal */ readonly x0: number;
  /** @internal */ readonly y0: number;
  /** @internal */ readonly nx: number;
  /** @internal */ readonly ny: number;
  /** @internal CSR: Zelle c → items[start[c] .. start[c+1]) */
  readonly start: Uint32Array;
  /** @internal */ readonly items: Uint32Array;
  /** @internal Stempel gegen Mehrfachbesuch je Abfrage. */
  readonly stempel: Uint32Array;
  /** @internal */ abfrage: number;
}

const MAX_ZELLEN_ACHSE = 4096;

const endlich = (s: SnapSegment): boolean =>
  Number.isFinite(s.a.x) && Number.isFinite(s.a.y) && Number.isFinite(s.b.x) && Number.isFinite(s.b.y);

/**
 * Baut den Gitter-Index. `zellgroesse` (m) optional; Standard aus Ausdehnung und Anzahl
 * (≈ 1 Segment je Zelle, mindestens mittlere Segmentlänge / 2). Nicht-endliche Segmente
 * werden ignoriert.
 */
export function createSnapIndex(segmente: readonly SnapSegment[], optionen: { zellgroesse?: number } = {}): SnapIndex {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, sumL = 0, n = 0;
  for (const s of segmente) {
    if (!endlich(s)) continue;
    n++;
    minX = Math.min(minX, s.a.x, s.b.x); maxX = Math.max(maxX, s.a.x, s.b.x);
    minY = Math.min(minY, s.a.y, s.b.y); maxY = Math.max(maxY, s.a.y, s.b.y);
    sumL += dist(s.a, s.b);
  }
  if (n === 0) {
    return {
      segmente, zellgroesse: 1, x0: 0, y0: 0, nx: 0, ny: 0, start: new Uint32Array(1),
      items: new Uint32Array(0), stempel: new Uint32Array(segmente.length), abfrage: 0,
    };
  }
  const w = maxX - minX, h = maxY - minY;
  let cs = optionen.zellgroesse ?? Math.max(Math.sqrt((w * h) / n), sumL / n / 2, Math.max(w, h) / MAX_ZELLEN_ACHSE);
  if (!(cs > EPS)) cs = Math.max(w, h, 1);
  cs = Math.max(cs, w / MAX_ZELLEN_ACHSE, h / MAX_ZELLEN_ACHSE);
  const nx = Math.max(1, Math.floor(w / cs) + 1), ny = Math.max(1, Math.floor(h / cs) + 1);

  // Zwei Durchläufe (zählen, füllen) über die exakt durchlaufenen Zellen je Segment.
  const counts = new Uint32Array(nx * ny + 1);
  const besuche = (s: SnapSegment, f: (c: number) => void): void => {
    const ax = (s.a.x - minX) / cs, ay = (s.a.y - minY) / cs;
    const bx = (s.b.x - minX) / cs, by = (s.b.y - minY) / cs;
    const zy0 = clampI(Math.floor(Math.min(ay, by)), ny), zy1 = clampI(Math.floor(Math.max(ay, by)), ny);
    for (let iy = zy0; iy <= zy1; iy++) {
      // x-Bereich des Segments im Streifen [iy, iy+1] in Zellkoordinaten.
      let xa = ax, xb = bx;
      if (ay !== by) {
        const lo = Math.max(iy, Math.min(ay, by)), hi = Math.min(iy + 1, Math.max(ay, by));
        const xl = ax + ((lo - ay) / (by - ay)) * (bx - ax), xh = ax + ((hi - ay) / (by - ay)) * (bx - ax);
        xa = Math.min(xl, xh); xb = Math.max(xl, xh);
      }
      const zx0 = clampI(Math.floor(Math.min(xa, xb)), nx), zx1 = clampI(Math.floor(Math.max(xa, xb)), nx);
      for (let ix = zx0; ix <= zx1; ix++) f(iy * nx + ix);
    }
  };
  segmente.forEach((s) => { if (endlich(s)) besuche(s, (c) => { counts[c + 1]!++; }); });
  for (let c = 1; c < counts.length; c++) counts[c]! += counts[c - 1]!;
  const items = new Uint32Array(counts[nx * ny]!);
  const fill = counts.slice(0, nx * ny);
  segmente.forEach((s, i) => { if (endlich(s)) besuche(s, (c) => { items[fill[c]!++] = i; }); });
  return {
    segmente, zellgroesse: cs, x0: minX, y0: minY, nx, ny, start: counts, items,
    stempel: new Uint32Array(segmente.length), abfrage: 0,
  };
}

function clampI(v: number, n: number): number {
  return v < 0 ? 0 : v >= n ? n - 1 : v;
}

/** Indizes aller Segmente mit Abstand ≤ r zu p (aufsteigend sortiert). */
export function querySegments(index: SnapIndex, p: Vec2, r: number): number[] {
  const out: number[] = [];
  if (index.nx === 0 || !(r >= 0)) return out;
  const cs = index.zellgroesse;
  const fx0 = Math.floor((p.x - r - index.x0) / cs), fx1 = Math.floor((p.x + r - index.x0) / cs);
  const fy0 = Math.floor((p.y - r - index.y0) / cs), fy1 = Math.floor((p.y + r - index.y0) / cs);
  if (fx1 < 0 || fy1 < 0 || fx0 >= index.nx || fy0 >= index.ny) return out;
  if (++index.abfrage === 0xffffffff) { index.stempel.fill(0); index.abfrage = 1; }
  const stamp = index.abfrage;
  const x0 = clampI(fx0, index.nx), x1 = clampI(fx1, index.nx);
  const y0 = clampI(fy0, index.ny), y1 = clampI(fy1, index.ny);
  for (let iy = y0; iy <= y1; iy++) {
    for (let ix = x0; ix <= x1; ix++) {
      const c = iy * index.nx + ix;
      for (let k = index.start[c]!; k < index.start[c + 1]!; k++) {
        const i = index.items[k]!;
        if (index.stempel[i] === stamp) continue;
        index.stempel[i] = stamp;
        const s = index.segmente[i]!;
        if (distPointSegment(p, s.a, s.b) <= r) out.push(i);
      }
    }
  }
  return out.sort((a, b) => a - b);
}

/**
 * Bester Fangpunkt zu `punkt` innerhalb `toleranz` (m) oder `null`.
 * Priorität End > Schnitt > Mitte > Lot > Ortho; innerhalb einer Art gewinnt der kleinste
 * Abstand, bei Gleichstand der kleinste Segmentindex (deterministisch).
 */
export function snap(index: SnapIndex, punkt: Vec2, toleranz: number, optionen: SnapOptionen = {}): SnapTreffer | null {
  if (!(toleranz >= 0) || !Number.isFinite(punkt.x) || !Number.isFinite(punkt.y)) return null;
  const aktiv = new Set<SnapArt>(optionen.arten ?? SNAP_ARTEN);
  const ref = optionen.referenzpunkt;
  const brauchtSegmente = SNAP_ARTEN.some((a) => a !== "ortho" && aktiv.has(a));
  const kand = brauchtSegmente ? querySegments(index, punkt, toleranz) : [];
  const segs = index.segmente;

  for (const art of SNAP_ARTEN) {
    if (!aktiv.has(art)) continue;
    let best: SnapTreffer | null = null;
    const pruefe = (q: Vec2, quellen: number[]): void => {
      const d = dist(punkt, q);
      if (d <= toleranz && (best === null || d < best.abstand - EPS)) best = { art, punkt: q, segmente: quellen, abstand: d };
    };
    switch (art) {
      case "endpunkt":
        for (const i of kand) { pruefe(segs[i]!.a, [i]); pruefe(segs[i]!.b, [i]); }
        break;
      case "mittelpunkt":
        for (const i of kand) {
          const s = segs[i]!;
          pruefe({ x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 }, [i]);
        }
        break;
      case "schnittpunkt":
        // Ein Schnittpunkt im Toleranzkreis liegt auf beiden Segmenten → beide sind Kandidaten.
        for (let m = 0; m < kand.length; m++) {
          const s = segs[kand[m]!]!;
          for (let k = m + 1; k < kand.length; k++) {
            const t = segs[kand[k]!]!;
            const x = segmentIntersection(s.a, s.b, t.a, t.b);
            if (x.kind === "point") pruefe(x.point, [kand[m]!, kand[k]!]);
          }
        }
        break;
      case "lot":
        if (!ref) break;
        for (const i of kand) {
          const s = segs[i]!;
          if (dist(s.a, s.b) <= EPS) continue;
          const f = lotfuss(ref, s.a, s.b);
          if (f) pruefe(f, [i]);
        }
        break;
      case "ortho":
        if (!ref) break;
        best = ortho(punkt, ref, optionen.orthoAchse ?? 0, toleranz);
        break;
    }
    if (best) return best;
  }
  return null;
}

/** Lotfußpunkt von r auf die Gerade a–b, nur wenn er auf dem Segment liegt. */
function lotfuss(r: Vec2, a: Vec2, b: Vec2): Vec2 | null {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = ((r.x - a.x) * dx + (r.y - a.y) * dy) / l2;
  const e = EPS / Math.sqrt(l2);
  if (t < -e || t > 1 + e) return null;
  return closestPointOnSegment(r, a, b);
}

/** Projektion des Cursors auf die nähere der beiden Ortho-Achsen durch `ref`. */
function ortho(p: Vec2, ref: Vec2, winkel: number, tol: number): SnapTreffer | null {
  const ux = Math.cos(winkel), uy = Math.sin(winkel);
  const vx = p.x - ref.x, vy = p.y - ref.y;
  const s = vx * ux + vy * uy, n = -vx * uy + vy * ux; // Koordinaten im gedrehten System
  const aufU = Math.abs(n) <= Math.abs(s);
  const q = aufU ? { x: ref.x + s * ux, y: ref.y + s * uy } : { x: ref.x - n * uy, y: ref.y + n * ux };
  const d = Math.min(Math.abs(n), Math.abs(s));
  return d <= tol ? { art: "ortho", punkt: q, segmente: [], abstand: d } : null;
}
