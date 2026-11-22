/** Rule-Packs im Browser: kleine Packs gebündelt, KOSTRA-Raster und Ortsliste erst bei Bedarf (offline, kein Netz). */
import {
  loadRulePack, standardDaemmdickeTiefpunkt,
  type DaemmplattenPack, type EntwaesserungsArt, type OrtEintrag, type RegenspendenPack, type RulePack, type TypWahl,
} from "../core/index";

const roh = import.meta.glob(
  ["../../rulepacks/*/pack.json", "!../../rulepacks/kostra-dwd-2020/pack.json", "!../../rulepacks/orte-plz/pack.json"],
  { eager: true, import: "default" },
) as Record<string, unknown>;
const spaet = import.meta.glob(
  ["../../rulepacks/kostra-dwd-2020/pack.json", "../../rulepacks/orte-plz/pack.json"],
  { import: "default" },
) as Record<string, () => Promise<unknown>>;

export const packFehler: string[] = [];
export const packs: RulePack[] = [];
for (const [pfad, r] of Object.entries(roh)) {
  const l = loadRulePack(r);
  if (l.ok) packs.push(l.pack); else packFehler.push(`${pfad}: ${l.fehler.map((f) => f.meldung).join("; ")}`);
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
