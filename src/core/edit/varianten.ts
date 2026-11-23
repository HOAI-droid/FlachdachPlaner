/**
 * Varianten-Befehle (PLAN Schritt 36): anlegen (leer/Kopie), umbenennen, löschen, aktivieren. Rein.
 * Anlegen/Umbenennen/Löschen sind Undo-Schritte (`Befehl<Projekt>`), Aktivieren nicht (`wechsleVariante`).
 */
import { VARIANTEN_NAME_MAX, freieVariantenId, idsDerDachflaechen, mitModell, modellFuerVariante, variantenNameSchluessel } from "../model/varianten";
import type { Dachflaeche, Entwaesserung, Id, KantenPosition, Kontur, Projekt, Variante } from "../model/types";
import type { Befehl, Verlauf } from "./history";

export type VariantenFehlerCode = "name-leer" | "name-zu-lang" | "name-doppelt" | "unbekannte-variante" | "letzte-variante";
export interface VariantenFehler {
  readonly code: VariantenFehlerCode;
  readonly meldung: string;
}
/** `id`: betroffene Variante (bei Löschen: die danach aktive). */
export type VariantenErgebnis =
  | { readonly ok: true; readonly projekt: Projekt; readonly id: Id }
  | { readonly ok: false; readonly fehler: VariantenFehler };

const nicht = (code: VariantenFehlerCode, meldung: string): VariantenErgebnis => ({ ok: false, fehler: { code, meldung } });
const gibt = (p: Projekt, id: Id) => p.varianten.some((v) => v.id === id);

/** Prüft einen Variantennamen (nicht leer, ≤ 200 Zeichen, eindeutig außer gegenüber `ausser`); null = gültig. */
export function pruefeVariantenName(p: Projekt, name: string, ausser?: Id): VariantenFehler | null {
  const n = name.trim();
  if (n === "") return { code: "name-leer", meldung: "Der Variantenname darf nicht leer sein." };
  if (n.length > VARIANTEN_NAME_MAX) return { code: "name-zu-lang", meldung: `Höchstens ${VARIANTEN_NAME_MAX} Zeichen.` };
  const k = variantenNameSchluessel(n);
  if (p.varianten.some((v) => v.id !== ausser && variantenNameSchluessel(v.name) === k)) {
    return { code: "name-doppelt", meldung: `Eine Variante „${n}“ gibt es bereits.` };
  }
  return null;
}

/** Freier Namensvorschlag: „Variante n“ bzw. für eine Kopie „<Name> (Kopie)“, „<Name> (Kopie 2)“ … */
export function vorschlagVariantenName(p: Projekt, kopieVon?: Id): string {
  const frei = (n: string) => pruefeVariantenName(p, n) === null;
  const quelle = kopieVon === undefined ? undefined : p.varianten.find((v) => v.id === kopieVon);
  if (quelle) {
    const basis = `${quelle.name.trim()} (Kopie)`.slice(0, VARIANTEN_NAME_MAX);
    if (frei(basis)) return basis;
    for (let i = 2; ; i++) { const n = `${quelle.name.trim()} (Kopie ${i})`; if (frei(n)) return n; }
  }
  for (let i = p.varianten.length + 1; ; i++) { const n = `Variante ${i}`; if (frei(n)) return n; }
}

/** Alle projektweit belegten IDs (Varianten und Objekte). */
const projektIds = (p: Projekt): Id[] => p.varianten.flatMap((v) => [v.id, ...idsDerDachflaechen(v.dachflaechen)]);

/**
 * Kopie der Dachflächen mit neuen IDs (`${präfix}${n}`, n oberhalb aller belegten Nummern des Präfixes,
 * deterministisch in Listenreihenfolge). Bezüge `kante`, `lage.kante` und `verbundenMit` werden umgeschrieben.
 */
export function kopiereDachflaechen(ds: readonly Dachflaeche[], belegt: Iterable<Id>): Dachflaeche[] {
  const max = new Map<string, number>();
  for (const id of belegt) {
    const r = /^([a-z]+)(\d+)$/.exec(id);
    if (r) max.set(r[1]!, Math.max(max.get(r[1]!) ?? 0, Number(r[2])));
  }
  const alt2neu = new Map<Id, Id>();
  const neu = (praefix: string, alt: Id): Id => {
    const n = (max.get(praefix) ?? 0) + 1;
    max.set(praefix, n);
    const id = `${praefix}${n}`;
    alt2neu.set(alt, id);
    return id;
  };
  // 1. Durchgang: IDs vergeben (Reihenfolge wie idsDerDachflaechen).
  const gerueste = ds.map((d) => {
    const dId = neu("d", d.id);
    const kontur = (k: Kontur): Kontur => k.map((p) => ({ ...p, id: neu("p", p.id) }));
    return {
      ...d, id: dId, kontur: kontur(d.kontur),
      aufbauten: d.aufbauten.map((a) => { const id = neu("au", a.id); return { ...a, id, kontur: kontur(a.kontur) }; }),
      zonen: d.zonen.map((z) => { const id = neu("zo", z.id); return { ...z, id, kontur: kontur(z.kontur) }; }),
      attika: d.attika.map((a) => ({ ...a, id: neu("at", a.id) })),
      tuerschwellen: d.tuerschwellen.map((t) => ({ ...t, id: neu("ts", t.id) })),
      entwaesserung: d.entwaesserung.map((e) => ({ ...e, id: neu("en", e.id) })),
    };
  });
  // 2. Durchgang: Bezüge umschreiben (unbekannte Bezüge bleiben, wie im Original).
  const ref = (id: Id) => alt2neu.get(id) ?? id;
  const lage = (l: KantenPosition): KantenPosition => ({ ...l, kante: ref(l.kante) });
  return gerueste.map((d) => ({
    ...d,
    attika: d.attika.map((a) => ({ ...a, kante: ref(a.kante) })),
    tuerschwellen: d.tuerschwellen.map((t) => ({ ...t, lage: lage(t.lage) })),
    entwaesserung: d.entwaesserung.map((e): Entwaesserung => {
      if (e.art === "dachreiter") return { ...e, lage: lage(e.lage) };
      if (e.art === "gully" && e.verbundenMit !== undefined) return { ...e, verbundenMit: ref(e.verbundenMit) };
      return e;
    }),
  }));
}

/**
 * Legt eine Variante am Listenende an und aktiviert sie: leer oder als volle Kopie von `kopieVon`
 * (alle IDs neu, Gefälle-Standard der Quelle übernommen).
 */
export function legeVarianteAn(p: Projekt, name: string, kopieVon?: Id): VariantenErgebnis {
  const f = pruefeVariantenName(p, name);
  if (f) return { ok: false, fehler: f };
  const quelle = kopieVon === undefined ? undefined : p.varianten.find((v) => v.id === kopieVon);
  if (kopieVon !== undefined && !quelle) return nicht("unbekannte-variante", `Variante "${kopieVon}" gibt es nicht.`);
  const belegt = projektIds(p);
  const id = freieVariantenId(belegt);
  const v: Variante = {
    id, name: name.trim(),
    dachflaechen: quelle ? kopiereDachflaechen(quelle.dachflaechen, [...belegt, id]) : [],
    ...(quelle?.gefaelleStandard !== undefined ? { gefaelleStandard: quelle.gefaelleStandard } : {}),
  };
  return { ok: true, id, projekt: { ...p, varianten: [...p.varianten, v], aktiveVariante: id } };
}

/** Benennt die Variante `id` um (gleicher Name → dasselbe Projekt). */
export function benenneVarianteUm(p: Projekt, id: Id, name: string): VariantenErgebnis {
  if (!gibt(p, id)) return nicht("unbekannte-variante", `Variante "${id}" gibt es nicht.`);
  const f = pruefeVariantenName(p, name, id);
  if (f) return { ok: false, fehler: f };
  const n = name.trim();
  if (p.varianten.find((v) => v.id === id)!.name === n) return { ok: true, id, projekt: p };
  return { ok: true, id, projekt: { ...p, varianten: p.varianten.map((v) => (v.id === id ? { ...v, name: n } : v)) } };
}

/** Löscht die Variante `id` (nie die letzte). War sie aktiv, wird die folgende (sonst vorherige) aktiv. */
export function loescheVariante(p: Projekt, id: Id): VariantenErgebnis {
  const i = p.varianten.findIndex((v) => v.id === id);
  if (i < 0) return nicht("unbekannte-variante", `Variante "${id}" gibt es nicht.`);
  if (p.varianten.length === 1) return nicht("letzte-variante", "Die letzte Variante kann nicht gelöscht werden.");
  const varianten = p.varianten.filter((v) => v.id !== id);
  const aktive = p.aktiveVariante === id ? varianten[Math.min(i, varianten.length - 1)]!.id : p.aktiveVariante;
  return { ok: true, id: aktive, projekt: { ...p, varianten, aktiveVariante: aktive } };
}

/** Aktiviert die Variante `id` (kein Undo-Schritt; bereits aktiv → dasselbe Projekt). */
export function aktiviereVariante(p: Projekt, id: Id): VariantenErgebnis {
  if (!gibt(p, id)) return nicht("unbekannte-variante", `Variante "${id}" gibt es nicht.`);
  return { ok: true, id, projekt: p.aktiveVariante === id ? p : { ...p, aktiveVariante: id } };
}

const alsBefehl = (label: string, f: (p: Projekt) => VariantenErgebnis): Befehl<Projekt> =>
  ({ label, anwenden: (p) => { const r = f(p); return r.ok ? r.projekt : p; } });

/** Undo-Befehle; bei ungültiger Eingabe ändern sie nichts (vorher `pruefeVariantenName` für die Meldung). */
export const befehlVarianteAnlegen = (name: string, kopieVon?: Id): Befehl<Projekt> =>
  alsBefehl(kopieVon === undefined ? "Variante anlegen" : "Variante duplizieren", (p) => legeVarianteAn(p, name, kopieVon));
export const befehlVarianteUmbenennen = (id: Id, name: string): Befehl<Projekt> =>
  alsBefehl("Variante umbenennen", (p) => benenneVarianteUm(p, id, name));
export const befehlVarianteLoeschen = (id: Id): Befehl<Projekt> =>
  alsBefehl("Variante löschen", (p) => loescheVariante(p, id));

/**
 * Hebt einen Befehl der Varianten-Ansicht auf das Projekt: wirkt auf Variante `id` (Standard: die
 * zum Ausführungszeitpunkt aktive). Ändert der Befehl nichts, bleibt das Projekt dasselbe Objekt.
 */
export function aufVariante(b: Befehl, id?: Id): Befehl<Projekt> {
  return {
    label: b.label,
    anwenden: (p) => {
      const vid = id ?? p.aktiveVariante;
      if (!gibt(p, vid)) return p;
      const m = modellFuerVariante(p, vid);
      const n = b.anwenden(m);
      return n === m ? p : mitModell(p, n, vid);
    },
  };
}

/** Variante im Verlauf umschalten, ohne Undo-Schritt (unbekannte ID → unverändert). */
export function wechsleVariante(v: Verlauf<Projekt>, id: Id): Verlauf<Projekt> {
  const r = aktiviereVariante(v.aktuell, id);
  return r.ok && r.projekt !== v.aktuell ? { ...v, aktuell: r.projekt } : v;
}

/**
 * Geändert gegenüber dem gespeicherten Stand? Wie `istGeaendert`, aber das Umschalten der aktiven
 * Variante zählt nicht (Vergleich der übrigen Felder per Referenz, billig).
 */
export function istProjektGeaendert(v: Verlauf<Projekt>, gespeichert: Projekt): boolean {
  const a = v.aktuell;
  if (a === gespeichert) return false;
  return a.varianten !== gespeichert.varianten || a.meta !== gespeichert.meta || a.standort !== gespeichert.standort
    || a.unterlage !== gespeichert.unterlage || a.packVersionen !== gespeichert.packVersionen
    || a.gefaelleStandard !== gespeichert.gefaelleStandard || a.schemaVersion !== gespeichert.schemaVersion;
}
