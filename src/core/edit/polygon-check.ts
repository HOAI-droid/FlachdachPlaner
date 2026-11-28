import { EPS } from "../geometry/eps";
import { signedArea } from "../geometry/polygon";
import { segmentIntersection } from "../geometry/segment";
import type { Vec2 } from "../geometry/types";

/** Prüft ein gezeichnetes Polygon; liefert eine deutsche Meldung oder null, wenn es gültig ist. */
export function pruefePolygon(pts: readonly Vec2[]): string | null {
  if (pts.length < 3) return "Mindestens 3 Punkte nötig.";
  if (Math.abs(signedArea(pts)) <= EPS) return "Fläche ist null.";
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i]!, b = pts[(i + 1) % n]!;
    if (Math.hypot(b.x - a.x, b.y - a.y) <= EPS) return "Zwei aufeinanderfolgende Punkte fallen zusammen.";
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue; // benachbarte Kanten
      if (segmentIntersection(a, b, pts[j]!, pts[(j + 1) % n]!).kind !== "none") return "Die Kontur schneidet sich selbst.";
    }
  }
  return null;
}
