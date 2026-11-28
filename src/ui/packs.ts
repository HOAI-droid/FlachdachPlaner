/** Rule-Packs im Browser: kleine Packs gebündelt, KOSTRA-Raster und Ortsliste erst bei Bedarf (offline, kein Netz). */
import {
  loadRulePack, standardDaemmdickeTiefpunkt, vergleicheVersion,
  type DaemmplattenPack, type EntwaesserungsArt, type OrtEintrag, type RegenspendenPack, type RulePack, type TypWahl,
} from "../core/index";
import { packSchreiben, packsLesen } from "./speicher";

const roh = import.meta.glob(
  ["../../rulepacks/*/pack.json", "!../../rulepacks/kostra-dwd-2020/pack.json", "!../../rulepacks/orte-plz/pack.json"],
  { eager: true, import: "default" },
) as Record<string, unknown>;
const spaet = import.meta.glob(
  ["../../rulepacks/kostra-dwd-2020/pack.json", "../../rulepacks/orte-plz/pack.json"],
  { import: "default" },
) as Record<string, () => Promise<unknown>>;

export const packFehler: string[] = [];
/** Aktive Packs (je ID eine Version); Berechnung und Auswahl nutzen diese Liste. */
export const packs: RulePack[] = [];
/** Alle bekannten Versionen je Pack-ID (gebündelt + nachgeladen). */
const alle = new Map<string, RulePack[]>();
const AKTIV_KEY = "flachdachplaner-pack-aktiv";
const hoeher = (a: string, b: string) => vergleicheVersion(a, b) > 0;
for (const [pfad, r] of Object.entries(roh)) {
  const l = loadRulePack(r);
  if (l.ok) { packs.push(l.pack); alle.set(l.pack.id, [l.pack]); } else packFehler.push(`${pfad}: ${l.fehler.map((f) => f.meldung).join("; ")}`);
}

async function ladeSpaet<T extends RulePack>(teil: string): Promise<T | null> {
  const k = Object.keys(spaet).find((p) => p.includes(teil));
  if (!k) return null;
  const l = loadRulePack(await spaet[k]!());
  if (!l.ok) { packFehler.push(`${teil}: ${l.fehler.map((f) => f.meldung).join("; ")}`); return null; }
  return l.pack as T;
}
let kostra: Promise<RegenspendenPack | null> | null = null;
let orte: Promise<readonly OrtEintrag[]> | null = null;
export const ladeKostra = (): Promise<RegenspendenPack | null> => (kostra ??= ladeSpaet<RegenspendenPack>("kostra-dwd-2020"));
export const ladeOrte = (): Promise<readonly OrtEintrag[]> =>
  (orte ??= ladeSpaet<RulePack>("orte-plz").then((p) => (p && p.typ === "orte" ? (p.daten as { eintraege: readonly OrtEintrag[] }).eintraege : [])));

export const daemmStandard = (): number | undefined => {
  const p = packs.find((x): x is DaemmplattenPack => x.typ === "daemmplatten");
  return (p && standardDaemmdickeTiefpunkt(p)) ?? undefined;
};

/** Pack-Einträge je Ablaufart (für die Produktwahl); LES immer aus dem les-Pack. */
export function typOptionen(art: EntwaesserungsArt): { wahl: TypWahl; titel: string }[] {
  const aus: { wahl: TypWahl; titel: string }[] = [];
  for (const p of packs) {
    if (art === "les" && p.typ === "les") for (const e of p.daten.eintraege) aus.push({ wahl: { packId: p.id, eintragId: e.id, version: p.version }, titel: `${e.hersteller} ${e.produkt}` });
    if ((art === "gully" || art === "notablauf") && p.typ === "ablaeufe") for (const e of p.daten.eintraege) if (e.art === art) aus.push({ wahl: { packId: p.id, eintragId: e.id, version: p.version }, titel: `${e.hersteller} ${e.produkt}` });
    if (art === "dachreiter" && p.typ === "dachreiter") for (const e of p.daten.eintraege) aus.push({ wahl: { packId: p.id, eintragId: e.id, version: p.version }, titel: `${e.hersteller} ${e.produkt}` });
  }
  return aus;
}
/** Standardtyp: der erste Pack-Eintrag der Art, sonst unbelegt. */
export const standardTyp = (art: EntwaesserungsArt): TypWahl | null => typOptionen(art)[0]?.wahl ?? null;

// ---------- Versionen, Updates, Rollback (PLAN Schritt 22b) ----------
function aktivMerker(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(AKTIV_KEY) ?? "{}") as Record<string, string>; } catch { return {}; }
}
function waehleAktiv(id: string, version: string | null): void {
  const liste = alle.get(id) ?? [];
  const neuest = [...liste].sort((a, b) => vergleicheVersion(b.version, a.version))[0];
  const p = (version ? liste.find((x) => x.version === version) : undefined) ?? neuest;
  if (!p) return;
  const i = packs.findIndex((x) => x.id === id);
  if (i >= 0) packs[i] = p; else packs.push(p);
}
export const versionenVon = (id: string): string[] => (alle.get(id) ?? []).map((p) => p.version).sort((a, b) => vergleicheVersion(b, a));
export const aktiveVersionen = (): Record<string, string> => Object.fromEntries(packs.map((p) => [p.id, p.version]));
/** Höchste bekannte Version je Pack-ID (Grundlage für den Update-Vergleich). */
export const hoechsteVersionen = (): Record<string, string> =>
  Object.fromEntries([...alle].map(([id, l]) => [id, [...l].sort((a, b) => vergleicheVersion(b.version, a.version))[0]!.version]));

/** Aktive Version setzen (Rollback auf ältere oder Wechsel auf neuere) und merken. */
export function setzeAktivePackVersion(id: string, version: string): void {
  waehleAktiv(id, version);
  try { localStorage.setItem(AKTIV_KEY, JSON.stringify({ ...aktivMerker(), [id]: version })); } catch { /* ohne Speicher weiter */ }
}

/** Geprüftes Pack lokal speichern und aktivieren. */
export async function installierePack(p: RulePack, text: string): Promise<void> {
  const liste = (alle.get(p.id) ?? []).filter((x) => x.version !== p.version);
  alle.set(p.id, [...liste, p]);
  await packSchreiben(`${p.id}@${p.version}`, text);
  setzeAktivePackVersion(p.id, p.version);
}

/** Beim Start: lokal gespeicherte Packs (erneut validiert) hinzufügen, gemerkte Auswahl anwenden. */
export async function ladeInstallierte(): Promise<void> {
  for (const text of await packsLesen()) {
    try {
      const l = loadRulePack(JSON.parse(text));
      if (!l.ok) { packFehler.push(`nachgeladenes Pack ungültig: ${l.fehler[0]?.meldung ?? ""}`); continue; }
      const liste = (alle.get(l.pack.id) ?? []).filter((x) => x.version !== l.pack.version);
      alle.set(l.pack.id, [...liste, l.pack]);
    } catch { /* beschädigter Eintrag wird ignoriert */ }
  }
  const merker = aktivMerker();
  for (const id of alle.keys()) waehleAktiv(id, merker[id] ?? null);
}

/** Packs, deren aktive Version neuer ist als die im Projekt gemerkte (Hinweis „Neu berechnen?“). */
export function neuerePackVersionen(gemerkt: Readonly<Record<string, string>>): { id: string; alt: string; neu: string }[] {
  const akt = aktiveVersionen();
  return Object.entries(gemerkt).filter(([id, v]) => akt[id] !== undefined && hoeher(akt[id]!, v)).map(([id, v]) => ({ id, alt: v, neu: akt[id]! }));
}
