/** Lokales Speichern (PLAN Schritt 22): .fdp-Datei, IndexedDB-Autosave. Kein Netz, keine Telemetrie. */
import { parseProjekt, type Projekt } from "../core/index";

const DB = "flachdachplaner", STORE = "projekt", PACKS = "packs", KEY = "autosave";
const LS_KEY = "flachdachplaner-projekt";

function oeffneDb(): Promise<IDBDatabase> {
  return new Promise((ok, fail) => {
    if (typeof indexedDB === "undefined") return fail(new Error("kein IndexedDB"));
    const r = indexedDB.open(DB, 2);
    r.onupgradeneeded = () => { for (const n of [STORE, PACKS]) if (!r.result.objectStoreNames.contains(n)) r.result.createObjectStore(n); };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error ?? new Error("IndexedDB-Fehler"));
  });
}

/** Autosave schreiben (IndexedDB, sonst localStorage); Fehler werden verschluckt. */
export async function autosaveSchreiben(text: string): Promise<void> {
  try {
    const db = await oeffneDb();
    await new Promise<void>((ok, fail) => {
      const t = db.transaction(STORE, "readwrite");
      t.objectStore(STORE).put(text, KEY);
      t.oncomplete = () => ok(); t.onerror = () => fail(t.error ?? new Error("Schreibfehler"));
    });
    db.close();
  } catch {
    try { localStorage.setItem(LS_KEY, text); } catch { /* ohne Speicher weiter */ }
  }
}

export async function autosaveLesen(): Promise<string | null> {
  try {
    const db = await oeffneDb();
    const v = await new Promise<unknown>((ok, fail) => {
      const r = db.transaction(STORE).objectStore(STORE).get(KEY);
      r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error ?? new Error("Lesefehler"));
    });
    db.close();
    if (typeof v === "string") return v;
  } catch { /* Fallback */ }
  try { return localStorage.getItem(LS_KEY); } catch { return null; }
}

export const DATEIENDUNG = ".fdp";

type FsWindow = Window & {
  showSaveFilePicker?: (o: unknown) => Promise<{ createWritable(): Promise<{ write(d: string): Promise<void>; close(): Promise<void> }> }>;
  showOpenFilePicker?: (o: unknown) => Promise<{ getFile(): Promise<File> }[]>;
};
const FDP_TYPEN = [{ description: "Flachdachplaner-Projekt", accept: { "application/json": [DATEIENDUNG] } }];

/** Speichert als .fdp (File System Access API, sonst Download). Liefert false bei Abbruch. */
export async function speichereDatei(text: string, name: string): Promise<boolean> {
  const dateiname = name.endsWith(DATEIENDUNG) ? name : name + DATEIENDUNG;
  const w = window as FsWindow;
  if (w.showSaveFilePicker) {
    try {
      const h = await w.showSaveFilePicker({ suggestedName: dateiname, types: FDP_TYPEN });
      const s = await h.createWritable(); await s.write(text); await s.close();
      return true;
    } catch (e) { if (e instanceof DOMException && e.name === "AbortError") return false; /* sonst Download */ }
  }
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a"); a.href = url; a.download = dateiname; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

/** Öffnet per Dateidialog (FS-API, sonst übergebene Datei aus <input type=file>). */
export async function waehleDatei(): Promise<File | null> {
  const w = window as FsWindow;
  if (!w.showOpenFilePicker) return null;
  try { const [h] = await w.showOpenFilePicker({ types: FDP_TYPEN }); return h ? await h.getFile() : null; }
  catch { return null; }
}

export type OeffneErgebnis =
  | { readonly ok: true; readonly projekt: Projekt; readonly hinweise: readonly string[] }
  | { readonly ok: false; readonly meldung: string };

/** Projekttext prüfen: fremde (neuere) Version → verständlicher Hinweis, nichts wird verändert. */
export function leseProjekt(text: string): OeffneErgebnis {
  const r = parseProjekt(text);
  if (r.ok) return { ok: true, projekt: r.projekt, hinweise: r.hinweise };
  const erste = r.fehler[0]?.meldung ?? "unbekannter Fehler";
  return { ok: false, meldung: r.neuereVersion
    ? `Diese Projektdatei stammt aus einer neueren Programmversion (${erste}). Bitte das Programm aktualisieren.`
    : `Projektdatei ungültig: ${erste}` };
}

export function bytesZuBase64(b: ArrayBuffer): string {
  let s = ""; const u = new Uint8Array(b);
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}
export function base64ZuBytes(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s); const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

/** Nachgeladene Rule-Packs (Schritt 22b) lokal ablegen/lesen: Schlüssel „id@version“, Wert = Pack-Text. */
export async function packSchreiben(schluessel: string, text: string): Promise<void> {
  const db = await oeffneDb();
  await new Promise<void>((ok, fail) => {
    const t = db.transaction(PACKS, "readwrite"); t.objectStore(PACKS).put(text, schluessel);
    t.oncomplete = () => ok(); t.onerror = () => fail(t.error ?? new Error("Schreibfehler"));
  });
  db.close();
}
export async function packsLesen(): Promise<string[]> {
  try {
    const db = await oeffneDb();
    const v = await new Promise<unknown[]>((ok, fail) => {
      const r = db.transaction(PACKS).objectStore(PACKS).getAll(); r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error ?? new Error("Lesefehler"));
    });
    db.close();
    return v.filter((x): x is string => typeof x === "string");
  } catch { return []; }
}
