/**
 * Validierung eines Projektdokuments. Wirft nie, sondern liefert eine Fehlerliste.
 * Pfade als JSON Pointer (RFC 6901), z. B. "/dachflaechen/0/kontur/2/x" (wie Ajv `instancePath`).
 * Geprüft werden Struktur, Typen, Wertebereiche und Bezüge (IDs, Kanten, Pack-Referenzen),
 * keine Planungsregeln (die liegen in den Rule-Packs).
 */
import { EPS } from "../geometry/eps";
import { signedArea } from "../geometry/polygon";
import { dist } from "../geometry/segment";
import { SCHEMA_VERSION } from "./migrate";
import { EBENEN_IDS } from "./types";
import { PROJEKTANGABEN_FELDER, pruefeAngabe } from "./projektangaben";
import { VARIANTEN_NAME_MAX, variantenNameSchluessel } from "./varianten";

export interface ValidationError {
  readonly pfad: string;
  readonly meldung: string;
}

type Obj = Record<string, unknown>;
interface NumOpts { min?: number; max?: number; gt?: number; ganz?: boolean }

const PACK_ID = /^[a-z0-9][a-z0-9._-]*$/;
const SHA256 = /^[0-9a-f]{64}$/;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const ISO_ZEIT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

const esc = (k: string | number) => String(k).replace(/~/g, "~0").replace(/\//g, "~1");
const sub = (p: string, k: string | number) => `${p}/${esc(k)}`;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

class Pruefer {
  readonly fehler: ValidationError[] = [];
  private readonly ids = new Map<string, string>();
  /** `v4`: Felder ab Schemaversion 4 (Anschlusshöhen) sind erlaubt; davor gelten sie als unbekannt. */
  constructor(private readonly packIds: ReadonlySet<string>, readonly v4: boolean) {}

  /** Optionale Felder, die erst ab Schemaversion 4 gelten. */
  ab4(felder: readonly string[]): readonly string[] { return this.v4 ? felder : []; }

  err(pfad: string, meldung: string): void { this.fehler.push({ pfad, meldung }); }

  /** Objekt mit Pflicht- und optionalen Schlüsseln; unbekannte Schlüssel sind Fehler. */
  obj(p: string, v: unknown, pflicht: readonly string[], optional: readonly string[] = []): Obj | undefined {
    if (v === undefined) return undefined; // fehlendes Pflichtfeld: bereits gemeldet
    if (!isObj(v)) { this.err(p, "Objekt erwartet"); return undefined; }
    for (const k of pflicht) if (!Object.hasOwn(v, k) || v[k] === undefined) this.err(sub(p, k), "Pflichtfeld fehlt");
    for (const k of Object.keys(v)) {
      if (!pflicht.includes(k) && !optional.includes(k)) this.err(sub(p, k), "Unbekanntes Feld");
    }
    return v;
  }

  num(p: string, v: unknown, o: NumOpts = {}): v is number {
    if (v === undefined) return false;
    if (typeof v !== "number" || !Number.isFinite(v)) { this.err(p, "Endliche Zahl erwartet"); return false; }
    if (o.ganz && !Number.isInteger(v)) this.err(p, "Ganze Zahl erwartet");
    if (o.min !== undefined && v < o.min) this.err(p, `Wert muss ≥ ${o.min} sein`);
    if (o.max !== undefined && v > o.max) this.err(p, `Wert muss ≤ ${o.max} sein`);
    if (o.gt !== undefined && !(v > o.gt)) this.err(p, `Wert muss > ${o.gt} sein`);
    return true;
  }

  str(p: string, v: unknown, o: { nichtLeer?: boolean; muster?: RegExp; text?: string } = {}): v is string {
    if (v === undefined) return false;
    if (typeof v !== "string") { this.err(p, "Text erwartet"); return false; }
    if (o.nichtLeer && v.trim() === "") this.err(p, "Darf nicht leer sein");
    if (o.muster && !o.muster.test(v)) this.err(p, o.text ?? "Ungültiges Format");
    return true;
  }

  optStr(p: string, o: Obj, k: string): void { if (o[k] !== undefined) this.str(sub(p, k), o[k]); }
  optNum(p: string, o: Obj, k: string, n: NumOpts = {}): void { if (o[k] !== undefined) this.num(sub(p, k), o[k], n); }

  bool(p: string, v: unknown): void { if (v !== undefined && typeof v !== "boolean") this.err(p, "Wahrheitswert erwartet"); }

  oneOf<T extends string>(p: string, v: unknown, werte: readonly T[]): v is T {
    if (v === undefined) return false;
    if (typeof v !== "string" || !(werte as readonly string[]).includes(v)) {
      this.err(p, `Erwartet: ${werte.join(" | ")}`); return false;
    }
    return true;
  }

  arr(p: string, v: unknown, minLen = 0): readonly unknown[] | undefined {
    if (v === undefined) return undefined;
    if (!Array.isArray(v)) { this.err(p, "Liste erwartet"); return undefined; }
    if (v.length < minLen) this.err(p, `Mindestens ${minLen} Einträge erwartet`);
    return v;
  }

  id(p: string, v: unknown): void {
    if (!this.str(p, v, { nichtLeer: true })) return;
    const frueher = this.ids.get(v);
    if (frueher !== undefined) this.err(p, `ID "${v}" ist bereits vergeben (${frueher})`);
    else this.ids.set(v, p);
  }

  vec(p: string, v: unknown): { x: number; y: number } | undefined {
    const o = this.obj(p, v, ["x", "y"]);
    if (!o) return undefined;
    const okX = this.num(sub(p, "x"), o["x"]);
    const okY = this.num(sub(p, "y"), o["y"]);
    return okX && okY ? { x: o["x"] as number, y: o["y"] as number } : undefined;
  }

  /** Kontur; liefert Punkte je ID (für Kantenbezüge), falls vollständig gültig. */
  kontur(p: string, v: unknown): Map<string, number> | undefined {
    const a = this.arr(p, v, 3);
    if (!a) return undefined;
    const pts: { x: number; y: number }[] = [];
    const len = new Map<string, number>();
    a.forEach((e, i) => {
      const q = sub(p, i);
      const o = this.obj(q, e, ["id", "x", "y"]);
      if (!o) return;
      this.id(sub(q, "id"), o["id"]);
      const okX = this.num(sub(q, "x"), o["x"]);
      const okY = this.num(sub(q, "y"), o["y"]);
      if (okX && okY) pts.push({ x: o["x"] as number, y: o["y"] as number });
    });
    if (pts.length !== a.length || a.length < 3) return undefined;
    if (Math.abs(signedArea(pts)) <= EPS) { this.err(p, "Kontur ist entartet (Fläche 0)"); return undefined; }
    a.forEach((e, i) => {
      const next = pts[(i + 1) % pts.length]!;
      len.set((e as Obj)["id"] as string, dist(pts[i]!, next));
    });
    return len;
  }

  packRef(p: string, v: unknown): void {
    if (v === null || v === undefined) return;
    const o = this.obj(p, v, ["packId", "eintragId"]);
    if (!o) return;
    if (this.str(sub(p, "packId"), o["packId"], { nichtLeer: true }) && !this.packIds.has(o["packId"])) {
      this.err(sub(p, "packId"), `Pack "${o["packId"]}" ist nicht in packVersionen eingetragen`);
    }
    this.str(sub(p, "eintragId"), o["eintragId"], { nichtLeer: true });
  }

  /** Kantenposition; `laenge` = belegte Länge ab `abstand` (0 für Punkt). */
  kantenPos(p: string, v: unknown, kanten: Map<string, number> | undefined, laenge = 0): void {
    const o = this.obj(p, v, ["kante", "abstand"]);
    if (!o) return;
    const okA = this.num(sub(p, "abstand"), o["abstand"], { min: 0 });
    if (!this.str(sub(p, "kante"), o["kante"], { nichtLeer: true }) || !kanten) return;
    const l = kanten.get(o["kante"]);
    if (l === undefined) { this.err(sub(p, "kante"), `Kante "${o["kante"]}" gibt es in der Kontur nicht`); return; }
    if (okA && (o["abstand"] as number) + laenge > l + EPS) this.err(sub(p, "abstand"), `Liegt außerhalb der Kante (Länge ${l} m)`);
  }

  vorgaben(p: string, v: unknown): void {
    const o = this.obj(p, v, [], ["maxHochpunkt", "minTiefpunkt", "okRohdecke"]);
    if (!o) return;
    this.optNum(p, o, "okRohdecke");
    this.optNum(p, o, "maxHochpunkt");
    this.optNum(p, o, "minTiefpunkt");
    const hp = o["maxHochpunkt"], tp = o["minTiefpunkt"];
    if (typeof hp === "number" && typeof tp === "number" && hp < tp) {
      this.err(sub(p, "maxHochpunkt"), "max. Hochpunkt liegt unter min. Tiefpunkt");
    }
  }
}

function pruefeRegen(c: Pruefer, p: string, v: unknown): void {
  const o = c.obj(p, v, ["packWert"], ["manuellWert"]);
  if (!o) return;
  if (o["packWert"] !== null) c.num(sub(p, "packWert"), o["packWert"], { min: 0 });
  c.optNum(p, o, "manuellWert", { min: 0 });
}

function pruefeStandort(c: Pruefer, p: string, v: unknown): void {
  const o = c.obj(p, v, ["koordinate", "regen"], ["bezeichnung"]);
  if (!o) return;
  c.optStr(p, o, "bezeichnung");
  if (o["koordinate"] !== null) {
    const q = sub(p, "koordinate");
    const k = c.obj(q, o["koordinate"], ["lat", "lon"]);
    if (k) {
      c.num(sub(q, "lat"), k["lat"], { min: -90, max: 90 });
      c.num(sub(q, "lon"), k["lon"], { min: -180, max: 180 });
    }
  }
  const q = sub(p, "regen");
  const r = c.obj(q, o["regen"], ["r5_5", "r5_100"]);
  if (r) { pruefeRegen(c, sub(q, "r5_5"), r["r5_5"]); pruefeRegen(c, sub(q, "r5_100"), r["r5_100"]); }
}

function pruefeEntwaesserung(c: Pruefer, p: string, v: unknown, kanten: Map<string, number> | undefined): void {
  if (!isObj(v)) { c.err(p, "Objekt erwartet"); return; }
  const basis = ["id", "name", "typ", "art", "z"];
  if (!c.oneOf(sub(p, "art"), v["art"], ["gully", "notablauf", "dachreiter", "les"] as const)) return;
  const art = v["art"];
  const extra = art === "dachreiter" ? ["lage"] : art === "les" ? ["von", "bis"] : ["position"];
  const optional = art === "gully" ? ["verbundenMit"] : art === "notablauf" || art === "dachreiter" ? c.ab4(["ueberlaufKante"]) : [];
  const o = c.obj(p, v, [...basis, ...extra], optional);
  if (!o) return;
  c.optNum(p, o, "ueberlaufKante", { min: 0 });
  c.id(sub(p, "id"), o["id"]);
  // Nur Form; ein fehlender/fremder Partner ist ein Hinweis der Gefälleplanung, kein Ladefehler.
  if (art === "gully") c.optStr(p, o, "verbundenMit");
  c.str(sub(p, "name"), o["name"]);
  c.packRef(sub(p, "typ"), o["typ"]);
  c.num(sub(p, "z"), o["z"]);
  if (art === "dachreiter") c.kantenPos(sub(p, "lage"), o["lage"], kanten);
  else if (art === "les") {
    const a = c.vec(sub(p, "von"), o["von"]);
    const b = c.vec(sub(p, "bis"), o["bis"]);
    if (a && b && dist(a, b) <= EPS) c.err(sub(p, "bis"), "LES hat die Länge 0");
  } else c.vec(sub(p, "position"), o["position"]);
}

function pruefeDach(c: Pruefer, p: string, v: unknown): void {
  const o = c.obj(p, v, ["id", "name", "typ", "kontur", "aufbauten", "zonen", "vorgaben", "attika", "tuerschwellen", "entwaesserung"],
    ["daemmdickeTiefpunkt", "daemmMittel", ...c.ab4(["belagDicke", "wandanschluesse"])]);
  if (!o) return;
  c.optNum(p, o, "daemmdickeTiefpunkt", { min: 0 });
  c.optNum(p, o, "daemmMittel", { min: 0, max: 1000 });
  c.optNum(p, o, "belagDicke", { min: 0 });
  c.id(sub(p, "id"), o["id"]);
  c.str(sub(p, "name"), o["name"]);
  c.oneOf(sub(p, "typ"), o["typ"], ["dach", "terrasse"] as const);
  const kanten = c.kontur(sub(p, "kontur"), o["kontur"]);
  c.vorgaben(sub(p, "vorgaben"), o["vorgaben"]);

  c.arr(sub(p, "aufbauten"), o["aufbauten"])?.forEach((e, i) => {
    const q = sub(sub(p, "aufbauten"), i);
    const a = c.obj(q, e, ["id", "name", "kontur"], c.ab4(["oberkante"]));
    if (!a) return;
    c.id(sub(q, "id"), a["id"]);
    c.str(sub(q, "name"), a["name"]);
    c.kontur(sub(q, "kontur"), a["kontur"]);
    c.optNum(q, a, "oberkante");
  });

  c.arr(sub(p, "zonen"), o["zonen"])?.forEach((e, i) => {
    const q = sub(sub(p, "zonen"), i);
    const z = c.obj(q, e, ["id", "name", "kontur", "hoehenversatz"], ["gefaelle", "begruendung", "vorgaben", ...c.ab4(["belagDicke"])]);
    if (!z) return;
    c.optNum(q, z, "belagDicke", { min: 0 });
    c.id(sub(q, "id"), z["id"]);
    c.str(sub(q, "name"), z["name"]);
    c.kontur(sub(q, "kontur"), z["kontur"]);
    c.num(sub(q, "hoehenversatz"), z["hoehenversatz"]);
    c.optNum(q, z, "gefaelle", { min: 0 });
    c.optStr(q, z, "begruendung");
    if (z["vorgaben"] !== undefined) c.vorgaben(sub(q, "vorgaben"), z["vorgaben"]);
    const b = z["begruendung"];
    if (z["gefaelle"] === 0 && (typeof b !== "string" || b.trim() === "")) {
      c.err(sub(q, "begruendung"), "0-%-Zone braucht eine Begründung");
    }
  });

  c.arr(sub(p, "attika"), o["attika"])?.forEach((e, i) => {
    const q = sub(sub(p, "attika"), i);
    const a = c.obj(q, e, ["id", "kante", "breite"], ["oberkante", "seite"]);
    if (!a) return;
    // „seite“ (Altdaten, innen/außen-Umschaltung entfallen): toleriert und ignoriert; Attika liegt immer außen.
    c.id(sub(q, "id"), a["id"]);
    c.num(sub(q, "breite"), a["breite"], { gt: 0 });
    c.optNum(q, a, "oberkante");
    if (c.str(sub(q, "kante"), a["kante"], { nichtLeer: true }) && kanten && !kanten.has(a["kante"])) {
      c.err(sub(q, "kante"), `Kante "${a["kante"]}" gibt es in der Kontur nicht`);
    }
  });

  c.arr(sub(p, "tuerschwellen"), o["tuerschwellen"])?.forEach((e, i) => {
    const q = sub(sub(p, "tuerschwellen"), i);
    const t = c.obj(q, e, ["id", "name", "lage", "breite", "barrierefrei"], ["oberkante", ...c.ab4(["rinne"])]);
    if (!t) return;
    c.id(sub(q, "id"), t["id"]);
    c.str(sub(q, "name"), t["name"]);
    const okB = c.num(sub(q, "breite"), t["breite"], { gt: 0 });
    c.kantenPos(sub(q, "lage"), t["lage"], kanten, okB ? (t["breite"] as number) : 0);
    c.optNum(q, t, "oberkante");
    c.bool(sub(q, "barrierefrei"), t["barrierefrei"]);
    c.bool(sub(q, "rinne"), t["rinne"]);
  });

  c.arr(sub(p, "wandanschluesse"), o["wandanschluesse"])?.forEach((e, i) => {
    const q = sub(sub(p, "wandanschluesse"), i);
    const w = c.obj(q, e, ["id", "name", "lage", "laenge"], ["oberkante"]);
    if (!w) return;
    c.id(sub(q, "id"), w["id"]);
    c.str(sub(q, "name"), w["name"]);
    const okL = c.num(sub(q, "laenge"), w["laenge"], { gt: 0 });
    const l = w["laenge"] as number;
    c.kantenPos(sub(q, "lage"), w["lage"], kanten, okL && l > 0 ? l : 0);
    c.optNum(q, w, "oberkante");
  });

  c.arr(sub(p, "entwaesserung"), o["entwaesserung"])?.forEach((e, i) =>
    pruefeEntwaesserung(c, sub(sub(p, "entwaesserung"), i), e, kanten));
}

function pruefeUnterlage(c: Pruefer, p: string, v: unknown): void {
  const o = c.obj(p, v, ["dateiname", "art", "pruefsumme", "passpunkte"], ["seite", "massstab", "eingebettet", "quellpfad"]);
  if (!o) return;
  c.str(sub(p, "dateiname"), o["dateiname"], { nichtLeer: true });
  c.oneOf(sub(p, "art"), o["art"], ["pdf", "dxf"] as const);
  const q = sub(p, "pruefsumme");
  const s = c.obj(q, o["pruefsumme"], ["algorithmus", "wert"]);
  if (s) {
    c.oneOf(sub(q, "algorithmus"), s["algorithmus"], ["sha-256"] as const);
    c.str(sub(q, "wert"), s["wert"], { muster: SHA256, text: "SHA-256 als 64 Hex-Zeichen (klein) erwartet" });
  }
  c.optNum(p, o, "seite", { min: 1, ganz: true });
  c.optStr(p, o, "quellpfad");
  if (typeof o["quellpfad"] === "string" && o["quellpfad"].length > 1024) c.err(sub(p, "quellpfad"), "Pfad zu lang");
  c.optNum(p, o, "massstab", { gt: 0 });
  const pp = sub(p, "passpunkte");
  const a = c.arr(pp, o["passpunkte"], 2);
  if (a && a.length !== 2) c.err(pp, "Genau 2 Passpunkte erwartet");
  const pts = a?.map((e, i) => {
    const r = sub(pp, i);
    const x = c.obj(r, e, ["unterlage", "welt"]);
    return x ? { u: c.vec(sub(r, "unterlage"), x["unterlage"]), w: c.vec(sub(r, "welt"), x["welt"]) } : undefined;
  });
  const [p0, p1] = pts ?? [];
  if (p0?.u && p1?.u && dist(p0.u, p1.u) <= EPS) c.err(sub(sub(pp, 1), "unterlage"), "Passpunkte fallen zusammen");
  if (p0?.w && p1?.w && dist(p0.w, p1.w) <= EPS) c.err(sub(sub(pp, 1), "welt"), "Passpunkte fallen zusammen");
  if (o["eingebettet"] !== undefined) {
    const eq = sub(p, "eingebettet");
    const e = c.obj(eq, o["eingebettet"], ["base64"], ["komprimiert"]);
    if (e) {
      c.str(sub(eq, "base64"), e["base64"], { muster: BASE64, text: "Base64 erwartet" });
      if (e["komprimiert"] !== undefined) c.oneOf(sub(eq, "komprimiert"), e["komprimiert"], ["gzip"] as const);
    }
  }
}

function pruefeAnsicht(c: Pruefer, v: unknown): void {
  const a = c.obj("/ansicht", v, ["ebenen"]);
  if (!a) return;
  const eb = a["ebenen"];
  if (!isObj(eb)) return c.err("/ansicht/ebenen", "Objekt erwartet");
  for (const [k, w] of Object.entries(eb)) {
    const q = sub("/ansicht/ebenen", k);
    if (!(EBENEN_IDS as readonly string[]).includes(k)) continue; // Ebenen späterer Versionen: ignorieren, Datei bleibt lesbar
    const x = c.obj(q, w, ["sichtbar", "deckkraft", "gesperrt"]);
    if (!x) continue;
    for (const b of ["sichtbar", "gesperrt"]) if (typeof x[b] !== "boolean") c.err(sub(q, b), "Wahrheitswert erwartet");
    c.num(sub(q, "deckkraft"), x["deckkraft"], { min: 0, max: 1 });
  }
}

function pruefeMeta(c: Pruefer, v: unknown): void {
  const m = c.obj("/meta", v, ["name", "erstelltAm", "geaendertAm"], ["projektnummer", "notiz", ...PROJEKTANGABEN_FELDER]);
  if (!m) return;
  c.str("/meta/name", m["name"]);
  for (const k of ["erstelltAm", "geaendertAm"]) {
    c.str(sub("/meta", k), m[k], { muster: ISO_ZEIT, text: "ISO-8601-Zeitstempel erwartet" });
  }
  c.optStr("/meta", m, "projektnummer");
  for (const k of [...PROJEKTANGABEN_FELDER, "notiz"] as const) {
    if (m[k] === undefined || !c.str(sub("/meta", k), m[k])) continue;
    const f = pruefeAngabe(k, m[k]);
    if (f) c.err(sub("/meta", k), f);
  }
}

/** Projektweite Teile (gleich in Dachflächen- und Varianten-Form). */
function pruefeGemeinsam(c: Pruefer, o: Obj): void {
  pruefeMeta(c, o["meta"]);
  const packVersionen = o["packVersionen"];
  if (!isObj(packVersionen)) c.err("/packVersionen", "Objekt erwartet");
  else for (const [k, ver] of Object.entries(packVersionen)) {
    if (!PACK_ID.test(k)) c.err(sub("/packVersionen", k), "Ungültige Pack-ID (erlaubt: a-z, 0-9, . _ -)");
    c.str(sub("/packVersionen", k), ver, { nichtLeer: true });
  }
  pruefeStandort(c, "/standort", o["standort"]);
  c.num("/gefaelleStandard", o["gefaelleStandard"], { min: 0 });
  if (o["unterlage"] !== null) pruefeUnterlage(c, "/unterlage", o["unterlage"]);
}

const packIdsVon = (raw: Obj) => new Set(isObj(raw["packVersionen"]) ? Object.keys(raw["packVersionen"]) : []);

/**
 * Prüft ein Modell in Dachflächen-Form (Projektdatei bis Schemaversion 2 bzw. Varianten-Ansicht
 * `ProjectModel`) gegen `schemaVersion`. Leere Liste = gültig.
 */
export function validateProject(raw: unknown, schemaVersion: number = SCHEMA_VERSION): ValidationError[] {
  if (!isObj(raw)) return [{ pfad: "", meldung: "Projekt muss ein JSON-Objekt sein" }];
  const c = new Pruefer(packIdsVon(raw), schemaVersion >= 4);
  const o = c.obj("", raw, ["schemaVersion", "meta", "packVersionen", "standort", "gefaelleStandard", "dachflaechen", "unterlage"]);
  if (!o) return c.fehler;
  if (o["schemaVersion"] !== schemaVersion) c.err("/schemaVersion", `Schemaversion ${schemaVersion} erwartet`);
  pruefeGemeinsam(c, o);
  c.arr("/dachflaechen", o["dachflaechen"])?.forEach((d, i) => pruefeDach(c, sub("/dachflaechen", i), d));
  return c.fehler;
}

/**
 * Prüft eine Projektdatei in Varianten-Form (ab Schemaversion 3). IDs (Varianten und Objekte) sind
 * projektweit eindeutig; Variantennamen nicht leer und eindeutig; `aktiveVariante` muss existieren.
 */
export function validateProjekt(raw: unknown, schemaVersion: number = SCHEMA_VERSION): ValidationError[] {
  if (!isObj(raw)) return [{ pfad: "", meldung: "Projekt muss ein JSON-Objekt sein" }];
  const c = new Pruefer(packIdsVon(raw), schemaVersion >= 4);
  const o = c.obj("", raw, ["schemaVersion", "meta", "packVersionen", "standort", "gefaelleStandard", "varianten", "aktiveVariante", "unterlage"], ["ansicht"]);
  if (!o) return c.fehler;
  if (o["ansicht"] !== undefined) pruefeAnsicht(c, o["ansicht"]);
  if (o["schemaVersion"] !== schemaVersion) c.err("/schemaVersion", `Schemaversion ${schemaVersion} erwartet`);
  pruefeGemeinsam(c, o);
  const ids = new Set<string>();
  const namen = new Map<string, string>();
  c.arr("/varianten", o["varianten"], 1)?.forEach((v, i) => {
    const q = sub("/varianten", i);
    const x = c.obj(q, v, ["id", "name", "dachflaechen"], ["gefaelleStandard"]);
    if (!x) return;
    c.id(sub(q, "id"), x["id"]);
    if (typeof x["id"] === "string") ids.add(x["id"]);
    const name = x["name"];
    if (c.str(sub(q, "name"), name, { nichtLeer: true }) && name.trim() !== "") {
      if (name.trim().length > VARIANTEN_NAME_MAX) c.err(sub(q, "name"), `Höchstens ${VARIANTEN_NAME_MAX} Zeichen`);
      const frueher = namen.get(variantenNameSchluessel(name));
      if (frueher !== undefined) c.err(sub(q, "name"), `Variantenname „${name.trim()}“ ist bereits vergeben (${frueher})`);
      else namen.set(variantenNameSchluessel(name), sub(q, "name"));
    }
    c.optNum(q, x, "gefaelleStandard", { min: 0 });
    c.arr(sub(q, "dachflaechen"), x["dachflaechen"])?.forEach((d, j) => pruefeDach(c, sub(sub(q, "dachflaechen"), j), d));
  });
  const a = o["aktiveVariante"];
  if (c.str("/aktiveVariante", a, { nichtLeer: true }) && Array.isArray(o["varianten"]) && !ids.has(a)) {
    c.err("/aktiveVariante", `Variante "${a}" gibt es nicht`);
  }
  return c.fehler;
}
