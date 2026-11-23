/** Datei an den Nutzer ausgeben: Desktop-App per Speichern-Dialog (Tauri), sonst Browser-Download. */
import { istTauri } from "./schliessen";

export interface AusgabeOpt { readonly name: string; readonly mime: string; readonly endung: string; readonly beschreibung: string }

/** Liefert false bei Abbruch im Dialog. Wirft bei Schreibfehlern. */
export async function gibDateiAus(daten: string | Uint8Array, o: AusgabeOpt): Promise<boolean> {
  if (istTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    const ziel = await save({ defaultPath: o.name, filters: [{ name: o.beschreibung, extensions: [o.endung] }] });
    if (!ziel) return false;
    await writeFile(ziel, typeof daten === "string" ? new TextEncoder().encode(daten) : daten);
    return true;
  }
  const url = URL.createObjectURL(new Blob([daten as BlobPart], { type: o.mime }));
  const a = document.createElement("a"); a.href = url; a.download = o.name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
