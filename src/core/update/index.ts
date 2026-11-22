/** Update-Prüfung für Rule-Packs (PLAN Schritt 22b). DOM-frei, ohne eigenen Netzzugriff: Quelle und Hash werden injiziert. */
import { loadRulePack } from "../rules/loader";
import type { RulePack } from "../rules/types";

/** Globale Laufzeit-Klasse (Browser und Node); core bindet bewusst keine DOM-Typen ein. */
declare const TextEncoder: new () => { encode(s: string): Uint8Array };

export interface ManifestPack {
  readonly id: string;
  readonly version: string;
  /** SHA-256 (hex, klein) der Pack-Datei (rohe Bytes, UTF-8). */
  readonly hash: string;
  /** Relativer Pfad der Pack-Datei zur Update-Quelle (keine absoluten URLs). */
  readonly datei: string;
  readonly quelle?: string;
  readonly gueltigAb?: string;
  readonly notiz?: string;
}
export interface Manifest {
  readonly packs: readonly ManifestPack[];
  readonly programm?: { readonly version: string; readonly notiz?: string };
}

export type ManifestErgebnis = { readonly ok: true; readonly manifest: Manifest } | { readonly ok: false; readonly meldung: string };

const istObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;

/** Relativer, nicht ausbrechender Pfad (kein Schema, kein `..`, kein führender `/`). */
export const istRelativerPfad = (p: string): boolean => !/^[a-z][a-z0-9+.-]*:|^[/\\]|\.\.|\\/i.test(p);

export function parseManifest(roh: unknown): ManifestErgebnis {
  if (!istObj(roh) || !Array.isArray(roh["packs"])) return { ok: false, meldung: "Manifest ungültig: Feld „packs“ fehlt." };
  const packs: ManifestPack[] = [];
  for (const [i, p] of roh["packs"].entries()) {
    if (!istObj(p) || !str(p["id"]) || !str(p["version"]) || !str(p["hash"]) || !str(p["datei"])) return { ok: false, meldung: `Manifest ungültig: Eintrag ${i + 1} unvollständig.` };
    if (!/^[0-9a-f]{64}$/.test(p["hash"])) return { ok: false, meldung: `Manifest ungültig: Hash von „${p["id"]}“ ist kein SHA-256.` };
    if (!istRelativerPfad(p["datei"])) return { ok: false, meldung: `Manifest ungültig: Pfad von „${p["id"]}“ ist nicht relativ.` };
    packs.push({
      id: p["id"], version: p["version"], hash: p["hash"], datei: p["datei"],
      ...(str(p["quelle"]) ? { quelle: p["quelle"] } : {}), ...(str(p["gueltigAb"]) ? { gueltigAb: p["gueltigAb"] } : {}), ...(str(p["notiz"]) ? { notiz: p["notiz"] } : {}),
    });
  }
  const pr = roh["programm"];
  const programm = istObj(pr) && str(pr["version"]) ? { version: pr["version"], ...(str(pr["notiz"]) ? { notiz: pr["notiz"] } : {}) } : undefined;
  return { ok: true, manifest: { packs, ...(programm ? { programm } : {}) } };
}

/** Numerischer Versionsvergleich (1.10.0 > 1.9.0); <0, 0, >0. */
export function vergleicheVersion(a: string, b: string): number {
  const x = a.split(/[.-]/).map((s) => Number.parseInt(s, 10) || 0), y = b.split(/[.-]/).map((s) => Number.parseInt(s, 10) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] ?? 0) - (y[i] ?? 0); if (d !== 0) return d; }
  return 0;
}

export interface PackUpdate { readonly eintrag: ManifestPack; readonly alt: string | null; readonly neu: string }

/** Packs des Manifests, die neuer sind als die höchste installierte Version (alt → neu). */
export function neuerePacks(m: Manifest, installiert: Readonly<Record<string, string>>): PackUpdate[] {
  return m.packs
    .filter((e) => { const v = installiert[e.id]; return v === undefined || vergleicheVersion(e.version, v) > 0; })
    .map((e) => ({ eintrag: e, alt: installiert[e.id] ?? null, neu: e.version }));
}

export type NutzlastErgebnis = { readonly ok: true; readonly pack: RulePack } | { readonly ok: false; readonly grund: string };

/** Prüft Hash (zuerst) und Schema/Bezüge einer geladenen Pack-Datei und passt sie gegen das Manifest ab. */
export async function pruefePackDatei(
  eintrag: ManifestPack, text: string, hashFn: (bytes: Uint8Array) => Promise<string>,
): Promise<NutzlastErgebnis> {
  const h = await hashFn(new TextEncoder().encode(text));
  if (h !== eintrag.hash) return { ok: false, grund: `Prüfsumme von „${eintrag.id}“ stimmt nicht mit dem Manifest überein – abgelehnt.` };
  let roh: unknown;
  try { roh = JSON.parse(text); } catch { return { ok: false, grund: `Pack „${eintrag.id}“ ist kein gültiges JSON.` }; }
  const l = loadRulePack(roh);
  if (!l.ok) return { ok: false, grund: `Pack „${eintrag.id}“ verletzt das Schema: ${l.fehler[0]?.meldung ?? "unbekannt"}` };
  if (l.pack.id !== eintrag.id || l.pack.version !== eintrag.version) return { ok: false, grund: `Pack „${eintrag.id}“: ID/Version stimmen nicht mit dem Manifest überein.` };
  return { ok: true, pack: l.pack };
}
