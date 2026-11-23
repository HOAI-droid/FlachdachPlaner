/** Schließen-Schutz (PLAN 34): Browser `beforeunload`, Tauri `onCloseRequested`. Logik ohne DOM, damit testbar. */

export interface SchliessEreignis { preventDefault(): void }
/** Der benötigte Ausschnitt der Tauri-Fenster-API. */
export interface FensterApi {
  onCloseRequested(handler: (e: SchliessEreignis) => void | Promise<void>): Promise<unknown>;
  destroy(): Promise<void>;
}

/**
 * Hängt den Schließ-Schutz ein: Das Schließen wird immer angehalten, dann wird `darfVerwerfen()` befragt
 * (liefert true, wenn nichts zu retten ist oder gespeichert/verworfen wurde); nur dann `destroy()`.
 */
export async function schuetzeTauriFenster(fenster: FensterApi, darfSchliessen: () => Promise<boolean>): Promise<void> {
  await fenster.onCloseRequested(async (e) => {
    e.preventDefault();
    let ok = false;
    try { ok = await darfSchliessen(); } catch { ok = false; }
    if (ok) await fenster.destroy();
  });
}

export const istTauri = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Browser: nur die native Rückfrage, solange ungespeicherte Änderungen existieren. */
export function schuetzeBrowserFenster(istGeaendert: () => boolean): void {
  window.addEventListener("beforeunload", (e) => {
    if (!istGeaendert()) return;
    e.preventDefault();
    e.returnValue = "";
  });
}

/** Tauri: Fensterschutz anbinden (dynamischer Import, damit der Browser-Build ohne Tauri auskommt). */
export async function schuetzeFenster(istGeaendert: () => boolean, darfSchliessen: () => Promise<boolean>): Promise<void> {
  if (istTauri()) {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await schuetzeTauriFenster(getCurrentWindow() as unknown as FensterApi, darfSchliessen);
      return;
    } catch { /* Fallback unten */ }
  }
  schuetzeBrowserFenster(istGeaendert);
}
