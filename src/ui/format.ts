// Deutsches Zahlenformat laut DESIGN.md §1/§6: Dezimalkomma, schmales Leerzeichen vor der Einheit.
const NNBSP = " ";

export function zahl(wert: number, stellen = 2): string {
  const s = Math.abs(wert) < 0.5 * 10 ** -stellen ? (0).toFixed(stellen) : wert.toFixed(stellen);
  return s.replace(".", ",").replace("-", "−");
}
export const meter = (w: number, st = 3) => `${zahl(w, st)}${NNBSP}m`;
export const quadratmeter = (w: number, st = 0) => `${zahl(w, st)}${NNBSP}m²`;
export const prozent = (w: number, st = 1) => `${zahl(w, st)}${NNBSP}%`;
export const millimeter = (w: number, st = 0) => `${zahl(w, st)}${NNBSP}mm`;
/** Höhenkote: Vorzeichen immer, 3 Nachkommastellen, z. B. `+12,345`. */
export function kote(w: number): string {
  const z = zahl(w, 3);
  return z.startsWith("\u2212") ? z : `+${z}`;
}
