/** Macht einen Projektnamen zu einem sicheren Dateinamen (keine Pfadzeichen, max. 100 Zeichen). */
export function dateiname(name: string, ersatz = "Projekt"): string {
  const s = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim().replace(/^\.+|\.+$/g, "").slice(0, 100).trim();
  return s || ersatz;
}
