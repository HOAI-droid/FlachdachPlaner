/**
 * Rule-Pack-Loader: JSON-Schema-Validierung (Ajv, Schemas in rulepacks/schema/) plus
 * Bezugsprüfungen, die ein Schema nicht ausdrücken kann. Wirft nie, sondern liefert eine
 * strukturierte Fehlerliste mit JSON-Pointer-Pfaden (wie validateProject).
 */
import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020";
import basisSchema from "../../../rulepacks/schema/basis.schema.json";
import regelnSchema from "../../../rulepacks/schema/regeln.schema.json";
import ablaeufeSchema from "../../../rulepacks/schema/ablaeufe.schema.json";
import lesSchema from "../../../rulepacks/schema/les.schema.json";
import dachreiterSchema from "../../../rulepacks/schema/dachreiter.schema.json";
import abflussbeiwerteSchema from "../../../rulepacks/schema/abflussbeiwerte.schema.json";
import regenspendenSchema from "../../../rulepacks/schema/regenspenden.schema.json";
import daemmplattenSchema from "../../../rulepacks/schema/daemmplatten.schema.json";
import orteSchema from "../../../rulepacks/schema/orte.schema.json";
import { EPS } from "../geometry/eps";
import type { ValidationError } from "../model/validate";
import { PACK_TYPEN, type PackHinweis, type PackTyp, type RulePack } from "./types";

export type PackLoadResult =
  | { readonly ok: true; readonly pack: RulePack; readonly hinweise: readonly PackHinweis[] }
  | { readonly ok: false; readonly fehler: readonly ValidationError[] };

const SCHEMAS: Readonly<Record<PackTyp, object>> = {
  regeln: regelnSchema, ablaeufe: ablaeufeSchema, les: lesSchema, dachreiter: dachreiterSchema,
  abflussbeiwerte: abflussbeiwerteSchema, regenspenden: regenspendenSchema,
  daemmplatten: daemmplattenSchema, orte: orteSchema,
};

interface Validatoren { readonly basis: ValidateFunction; readonly typ: Readonly<Record<PackTyp, ValidateFunction>> }
let cache: Validatoren | undefined;

/** Kompiliert die Schemas einmalig (strict: Schemafehler fallen sofort auf). */
function validatoren(): Validatoren {
  if (cache) return cache;
  const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
  ajv.addSchema(basisSchema);
  const typ = Object.fromEntries(PACK_TYPEN.map((t) => [t, ajv.compile(SCHEMAS[t])])) as Record<PackTyp, ValidateFunction>;
  cache = { basis: ajv.getSchema("basis.schema.json")!, typ };
  return cache;
}

const esc = (k: string | number) => String(k).replace(/~/g, "~0").replace(/\//g, "~1");
const sub = (p: string, k: string | number) => `${p}/${esc(k)}`;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const TYPNAME: Readonly<Record<string, string>> = {
  string: "Text", number: "Endliche Zahl", integer: "Ganze Zahl", boolean: "Wahrheitswert",
  object: "Objekt", array: "Liste", null: "null",
};

/** Übersetzt einen Ajv-Fehler in {pfad, meldung}; Pfade zeigen auf das betroffene Feld. */
function uebersetze(e: ErrorObject): ValidationError {
  const p = e.instancePath;
  const par = e.params as Record<string, unknown>;
  switch (e.keyword) {
    case "required": return { pfad: sub(p, String(par["missingProperty"])), meldung: "Pflichtfeld fehlt" };
    case "additionalProperties": return { pfad: sub(p, String(par["additionalProperty"])), meldung: "Unbekanntes Feld" };
    case "unevaluatedProperties": return { pfad: sub(p, String(par["unevaluatedProperty"])), meldung: "Unbekanntes Feld" };
    case "type": {
      const t = String(par["type"]).split(",").map((x) => TYPNAME[x] ?? x).join(" oder ");
      return { pfad: p, meldung: `${t} erwartet` };
    }
    case "enum": return { pfad: p, meldung: `Erwartet: ${(par["allowedValues"] as unknown[]).join(" | ")}` };
    case "const": return { pfad: p, meldung: `Erwartet: ${String(par["allowedValue"])}` };
    case "minimum": return { pfad: p, meldung: `Wert muss ≥ ${String(par["limit"])} sein` };
    case "maximum": return { pfad: p, meldung: `Wert muss ≤ ${String(par["limit"])} sein` };
    case "exclusiveMinimum": return { pfad: p, meldung: `Wert muss > ${String(par["limit"])} sein` };
    case "exclusiveMaximum": return { pfad: p, meldung: `Wert muss < ${String(par["limit"])} sein` };
    case "minLength": return { pfad: p, meldung: "Darf nicht leer sein" };
    case "pattern":
      return { pfad: p, meldung: par["pattern"] === "\\S" ? "Darf nicht leer sein" : "Ungültiges Format" };
    case "minItems": return { pfad: p, meldung: `Mindestens ${String(par["limit"])} Einträge erwartet` };
    case "minProperties": return { pfad: p, meldung: `Mindestens ${String(par["limit"])} Felder erwartet` };
    case "propertyNames": return { pfad: sub(p, String(par["propertyName"])), meldung: "Ungültiger Feldname" };
    default: return { pfad: p, meldung: e.message ?? e.keyword };
  }
}

function schemaFehler(v: ValidateFunction, raw: unknown): ValidationError[] {
  if (v(raw)) return [];
  const seen = new Set<string>();
  const out: ValidationError[] = [];
  for (const e of v.errors ?? []) {
    // propertyNames erzeugt zusätzlich einen pattern-Fehler am Objekt; der Feldname-Fehler genügt.
    if (e.keyword === "pattern" && e.propertyName !== undefined) continue;
    const f = uebersetze(e);
    const k = `${f.pfad}\u0000${f.meldung}`;
    if (!seen.has(k)) { seen.add(k); out.push(f); }
  }
  return out;
}

/** IDs in einer Liste eindeutig. */
function eindeutig(fehler: ValidationError[], pfad: string, liste: readonly Record<string, unknown>[] | undefined, feld = "id"): void {
  const gesehen = new Map<unknown, number>();
  liste?.forEach((e, i) => {
    const id = e[feld];
    const vorher = gesehen.get(id);
    if (vorher !== undefined) fehler.push({ pfad: sub(sub(pfad, i), feld), meldung: `Doppelte ID "${String(id)}" (wie Eintrag ${vorher})` });
    else gesehen.set(id, i);
  });
}

/** Bezugs- und Konsistenzprüfungen nach bestandenem Schema. */
function bezugsFehler(pack: RulePack): ValidationError[] {
  const f: ValidationError[] = [];
  switch (pack.typ) {
    case "regeln": {
      eindeutig(f, "/daten/regeln", pack.daten.regeln as unknown as Record<string, unknown>[]);
      pack.daten.regeln.forEach((r, i) => {
        const h = r.parameter["hinweisAb"], e = r.parameter["fehlerUeber"];
        if (h && e && h.einheit === e.einheit && h.wert > e.wert) {
          f.push({ pfad: `/daten/regeln/${i}/parameter/hinweisAb`, meldung: "hinweisAb muss ≤ fehlerUeber sein" });
        }
      });
      break;
    }
    case "les":
      eindeutig(f, "/daten/eintraege", pack.daten.eintraege as unknown as Record<string, unknown>[]);
      pack.daten.eintraege.forEach((e, i) => {
        if (e.keil.dickeMax < e.keil.dickeMin) f.push({ pfad: `/daten/eintraege/${i}/keil/dickeMax`, meldung: "dickeMax muss ≥ dickeMin sein" });
      });
      break;
    case "ablaeufe": case "dachreiter": case "abflussbeiwerte":
      eindeutig(f, "/daten/eintraege", pack.daten.eintraege as unknown as Record<string, unknown>[]);
      break;
    case "regenspenden": {
      const n = pack.daten.raster.spalten * pack.daten.raster.zeilen;
      for (const k of ["r5_5", "r5_100"] as const) {
        const len = pack.daten.werte[k].length;
        if (len !== n) f.push({ pfad: `/daten/werte/${k}`, meldung: `Erwartet ${n} Werte (spalten × zeilen), gefunden ${len}` });
      }
      break;
    }
    case "daemmplatten": {
      const d = pack.daten;
      eindeutig(f, "/daten/typen", d.typen as unknown as Record<string, unknown>[], "typ");
      eindeutig(f, "/daten/sonderplatten", d.sonderplatten as unknown as Record<string, unknown>[] | undefined);
      eindeutig(f, "/daten/kehlkeile", d.kehlkeile as unknown as Record<string, unknown>[] | undefined);
      d.typen.forEach((t, i) => {
        if (!(t.dickeEnde > t.dickeAnfang)) f.push({ pfad: `/daten/typen/${i}/dickeEnde`, meldung: "dickeEnde muss > dickeAnfang sein" });
        const n = d.typen[i + 1];
        if (n && Math.abs(n.dickeAnfang - t.dickeEnde) > EPS) {
          f.push({
            pfad: `/daten/typen/${i + 1}/dickeAnfang`,
            meldung: `Lücke: Enddicke Typ ${t.typ} (${t.dickeEnde} m) ≠ Anfangsdicke Typ ${n.typ} (${n.dickeAnfang} m)`,
          });
        }
      });
      const typen = new Set(d.typen.map((t) => t.typ));
      d.kehlkeile?.forEach((k, i) => {
        if (!typen.has(k.typ)) f.push({ pfad: `/daten/kehlkeile/${i}/typ`, meldung: `Plattentyp "${k.typ}" nicht in typen` });
      });
      break;
    }
    case "orte": break;
  }
  return f;
}

/** Hinweise eines gültigen Packs (z. B. "Regelwerk ungeprüft"). */
export function packHinweise(pack: RulePack): PackHinweis[] {
  if (pack.geprueft) return [];
  return [{ code: "pack-ungeprueft", packId: pack.id, meldung: `Regelwerk ungeprüft: ${pack.titel ?? pack.id} (Version ${pack.version})` }];
}

/** Validiert ein bereits geparstes Pack; leere Liste = gültig. */
export function validateRulePack(raw: unknown): ValidationError[] {
  const v = validatoren();
  if (!isObj(raw)) return [{ pfad: "", meldung: "Pack muss ein JSON-Objekt sein" }];
  const typ = raw["typ"];
  if (typeof typ !== "string" || !(PACK_TYPEN as readonly string[]).includes(typ)) {
    // Ohne bekannten Typ nur den Kopf prüfen (meldet u. a. fehlende Pflichtfelder und /typ).
    return schemaFehler(v.basis, raw);
  }
  const f = schemaFehler(v.typ[typ as PackTyp], raw);
  return f.length > 0 ? f : bezugsFehler(raw as unknown as RulePack);
}

/** Lädt ein geparstes Pack: gültig → Pack + Hinweise, sonst Fehlerliste. */
export function loadRulePack(raw: unknown): PackLoadResult {
  const fehler = validateRulePack(raw);
  if (fehler.length > 0) return { ok: false, fehler };
  const pack = raw as RulePack;
  return { ok: true, pack, hinweise: packHinweise(pack) };
}

/** Liest Pack-JSON-Text (wirft nie). */
export function parseRulePack(text: string): PackLoadResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, fehler: [{ pfad: "", meldung: `Kein gültiges JSON: ${e instanceof Error ? e.message : String(e)}` }] };
  }
  return loadRulePack(raw);
}
