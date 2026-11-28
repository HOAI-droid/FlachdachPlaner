// Beschriftung der Anschlusshöhen und Notentwässerung im 2D-Plan (PLAN M9 Schritt 46). Rein, ohne DOM.
// Eigene Formatierer (core importiert nichts aus ui); Ausgabe identisch zu ui/format.
const zahl = (wert: number, stellen = 2): string => {
  const s = Math.abs(wert) < 0.5 * 10 ** -stellen ? (0).toFixed(stellen) : wert.toFixed(stellen);
  return s.replace(".", ",").replace("-", "\u2212");
};
const kote = (w: number): string => { const z = zahl(w, 3); return z.startsWith("\u2212") ? z : `+${z}`; };

export type AnschlussStatus = "ok" | "niedrig" | "unbekannt";

const mmText = (m: number) => zahl(m * 1000, 0);

/** Status: unbekannt ohne Oberkante oder Sollwert; zu niedrig, wenn vorhanden < soll. */
export function anschlussStatus(vorhanden: number | null, soll: number | null): AnschlussStatus {
  if (vorhanden === null || soll === null) return "unbekannt";
  return vorhanden < soll - 1e-9 ? "niedrig" : "ok";
}

/** `AH 130 mm (soll 150)`; fehlende Werte als „–“. */
export function anschlussLabel(vorhanden: number | null, soll: number | null): string {
  return `AH ${vorhanden === null ? "–" : `${mmText(vorhanden)} mm`} (soll ${soll === null ? "–" : mmText(soll)})`;
}

/** `ÜK +0,085 · NW +0,146` (Koten in m); ohne Wert „–“. */
export function notLabel(kante: number | null, wasserstand: number | null): string {
  return `ÜK ${kante === null ? "–" : kote(kante)} · NW ${wasserstand === null ? "–" : kote(wasserstand)}`;
}
