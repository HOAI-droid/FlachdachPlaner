/** UI-Steuerung der Bearbeitung (PLAN Schritte 15–17): Werkzeuge, Verlauf, Unterlage, Panels, Zeichnung. */
import {
  abbrechen, abschliessen, ablaeufeHinzufuegen, schlageAblaeufeVor, attikaGesamtFlaeche, attikaGesamtLaenge, attikaLaenge, attikaSegmentFlaeche, attikaStreifen, attikaUmlaufend,
  aufbauFlaeche, ausfuehren, ausPasspunkten, findeAbweichungen, TOLERANZ_STANDARD, uebernehmeVorschlaege, verschiebePunkte, verschiebeEntwaesserung, computeAnschluesse, computeNotwasserstaende, setAttikaOberkante, setTuerschwelleOberkante, setTuerschwelleRinne, setWandanschlussOberkante, setWandanschlussLaenge, setAufbauOberkante, setBelagDicke, setUeberlaufKante, setDachaufbau, mitAbleitung, dachaufbauVon, type LesGriff, createProjekt, projektAusModell, createSnapIndex, modellFuerVariante, mitModell, setzeProjektangaben, legeVarianteAn, benenneVarianteUm, loescheVariante, aufVariante, befehlVarianteAnlegen, befehlVarianteLoeschen, befehlVarianteUmbenennen, istProjektGeaendert, wechsleVariante, vorschlagVariantenName, VARIANTEN_NAME_MAX, variantenListe, serializeProjekt, dachNetto, entfernePunkt, faktor, kannRueckgaengig,
  kannWiederholen, kalibriereStrecke, kantenTreffer, klick, konturFlaeche, konturUmfang, loesche, neuerVerlauf,
  neuerZustand, nennerAusFaktor, nennerSetzen, projektSegmente, rueckgaengig, setAttikaBreite, setTuerschwelleBreite,
  setzeAttikaBreite, setzeSchwellenBreite, setzeAblaufZ, setEntwaesserungTyp, setEntwaesserungZ, setGullyVerbindung, snap, ausrichten, winkelGrad, pointInPolygon, waehleWerkzeug, wiederholen, zonenFlaeche, zuPasspunkten, entwSegment, dachAn, intersection, setzeTrennBreite, trennStreifen,
  type Abweichung, type Ausrichtung, type Auswahl, type Befehl, type InsulationLayout, type SnapSegment, type Dachflaeche, type KlickErgebnis, type ProjectModel, type SnapArt, type SnapIndex, type SnapTreffer,
  type Projekt, type Ansichtseinstellungen, type EbenenZustand, type ProjektangabenTeil, type Verlauf, type Vec2, type WerkzeugId, type WerkzeugZustand,
} from "../core/index";
import type { LayerId, Stage } from "./canvas/stage";
import type { Viewport } from "./canvas/viewport";
import { Ansicht3D } from "./ansicht3d";
import { berechnePlan, zeichneDaemmplan } from "./daemmplan";
import { baueVariantenPdf } from "../io/pdf/plan";
import { dateiname } from "../io/dateiname";
import { baueProjektDxf } from "../io/dxf/export";
import { berechne, farbe, fuelleErgebnis, fuellePruefliste, zeichneEinzugsflaechen, zeichneFaltlinien, zeichneFlaechenLabels, zeichneAnschluesse, zeichneKoten, zeichneNotbereich, zeichnePfeile, type Ergebnis } from "./ergebnis";
import { meter, quadratmeter, zahl } from "./format";
import { aktiveVersionen, daemmStandard, packs, standardTyp, typOptionen } from "./packs";
import { mountStandort } from "./standort";

import { kantenLage, zeichneEntwaesserung } from "./symbole";
import { geteilteBelegung, neuerDurchgang } from "./zeichnen";
import type { Shell } from "./shell";
import { deckkraft, dxfModell, ladeDxf, ladePdf, pdfModell, setzeDeckkraft, sha256, type UnterlageUI } from "./underlay";
import { frageSpeichern, oeffneDialog } from "./dialog";
import { gibDateiAus, leseDatei, waehleUnterlagePfad } from "./datei-ausgabe";
import { entpackeUnterlage, packeUnterlage } from "./einbetten";
import { oeffneAngabenDialog } from "./angaben";
import { waehlePdfSeite } from "./pdf-seiten";
import { istTauri, schuetzeFenster } from "./schliessen";
import { hoereAufMenue, waehleProjektText } from "./datei-ausgabe";
import { autosaveSchreiben, leseProjekt, speichereDatei, waehleDatei } from "./speicher";

const FANG_PX = 10;
const TASTEN: Record<string, WerkzeugId> = { v: "select", k: "contour", a: "attika", u: "aufbau", t: "terrasse", s: "schwelle", w: "wandanschluss", g: "gully", n: "notablauf", r: "dachreiter", l: "les", x: "trennen", m: "measure" };
const FANG_NAME: Record<SnapArt | "ausrichtung", string> = { ausrichtung: "Ausrichtung", endpunkt: "Endpunkt", schnittpunkt: "Schnittpunkt", mittelpunkt: "Mittelpunkt", lot: "Lot", ortho: "Ortho" };
const HINWEIS: Record<WerkzeugId, string> = {
  select: "Objekt anklicken. Entf löscht die Auswahl.",
  contour: "Punkte klicken. Enter, Doppelklick oder Klick auf den Startpunkt schließt. Esc bricht ab, Rücktaste nimmt den letzten Punkt zurück.",
  attika: "Breite eingeben, dann Kanten der Dachkontur anklicken oder „Umlaufend“ wählen.",
  aufbau: "Punkte innerhalb einer Dachfläche klicken. Enter oder Doppelklick schließt.",
  terrasse: "Punkte innerhalb einer Dachfläche klicken. Enter oder Doppelklick schließt.",
  schwelle: "Auf eine Kante der Dachkontur klicken. Die Schwelle wird dort zentriert.",
  wandanschluss: "Länge eingeben, dann auf eine Kante der Dachkontur klicken. Der Wandanschluss wird dort zentriert.",
  gully: "In die Dachfläche klicken. Tiefenlage z des Ablaufs unten eingeben.",
  notablauf: "In die Dachfläche klicken. Notablauf mit Tiefenlage z.",
  dachreiter: "Auf eine Kante der Dachkontur klicken. Der Dachreiter wird dort zentriert.",
  les: "Anfang (tiefer Punkt, z gilt dort) und Ende der Linienentwässerung klicken.",
  trennen: "Breite eingeben, dann Anfang und Ende der Trennlinie klicken. Die Dachfläche wird wie durch eine durchlaufende Attika in zwei Flächen geteilt.",
  measure: "Mit PDF-Unterlage: zwei Punkte klicken, dann bekannte Strecke eingeben.",
};

const css = (n: string, fb: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || fb;
const num = (s: string): number => Number(s.trim().replace(/\s/g, "").replace(",", "."));
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}
function row(label: string, wert: string, key: string): HTMLElement {
  const r = el("div", "row");
  const v = el("span", "num", wert);
  v.dataset.k = key;
  r.append(el("span", "", label), v);
  return r;
}
function feld(label: string, wert: string, key: string, commit: (v: number) => void, einheit = "m"): HTMLElement {
  const f = el("div", "field");
  const l = el("label", "", `${label} (${einheit})`);
  const i = el("input");
  i.id = `f-${key}`; l.htmlFor = i.id; i.value = wert; i.inputMode = "decimal"; i.dataset.k = key;
  i.addEventListener("change", () => { const v = num(i.value); if (Number.isFinite(v)) commit(v); });
  i.addEventListener("keydown", (e) => { if (e.key === "Enter") i.blur(); });
  f.append(l, i);
  return f;
}
/** Optionale Höhe (m): leeres Feld = nicht gesetzt (undefined). */
function feldOpt(label: string, wert: number | undefined, key: string, commit: (v: number | undefined) => void, platzhalter = "", einheit = "m", stellen = 3): HTMLElement {
  const f = feld(label, wert === undefined ? "" : zahl(wert, stellen), key, () => undefined, einheit);
  const i = f.querySelector("input")!;
  i.placeholder = platzhalter;
  const neu = i.cloneNode(true) as HTMLInputElement; // Handler von feld() entfernen
  neu.addEventListener("change", () => { const t = neu.value.trim(); if (t === "") commit(undefined); else { const v = num(t); if (Number.isFinite(v)) commit(v); } });
  neu.addEventListener("keydown", (e) => { if (e.key === "Enter") neu.blur(); });
  i.replaceWith(neu);
  return f;
}
const mm = (v: number | null) => (v === null ? "–" : `${Math.round(v * 1000)} mm`);
function button(text: string, onClick: () => void, cls = "btn"): HTMLButtonElement {
  const b = el("button", cls, text);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

export interface Editor {
  readonly modell: ProjectModel;
  lade(m: ProjectModel): void;
  /** Ganzes Projekt (alle Varianten) laden. */
  ladeProjekt(p: Projekt): void;
  readonly projekt: Projekt;
  /** Auswahl setzen (Tests/E2E). */
  waehle(a: Auswahl | null): void;
  /** Befehl ausführen (Undo-fähig), z. B. aus dem Standort-Panel. */
  ausfuehre(b: Befehl): void;
  /** Menüaktion ausführen (gleiche IDs wie Menüleiste und natives Menü). */
  aktion(id: string): void;
  /** Wird nach jeder Aktualisierung aufgerufen (z. B. Update-Panel). */
  beiAenderung: (() => void) | null;
}


export function mountEditor(shell: Shell, stage: Stage): Editor {
  /**
   * Ein Verlauf über das ganze Projekt (A9): Werkzeugbefehle wirken über `aufVariante` auf die aktive
   * Variante, Variantenaktionen sind eigene Schritte, Umschalten (`wechsleVariante`) ist keiner und leert nichts.
   */
  let verlauf: Verlauf<Projekt> = neuerVerlauf(createProjekt("Neues Projekt", new Date().toISOString()));
  const aktuellesProjekt = (): Projekt => verlauf.aktuell;
  /** Inhaltsschlüssel (ohne aktive Variante) → Umschalten der Variante gilt nicht als Änderung. */
  let schluesselMemo: { p: Projekt; k: string } | null = null;
  const schluessel = (): string => {
    const p = verlauf.aktuell;
    if (schluesselMemo?.p !== p) schluesselMemo = { p, k: JSON.stringify({ ...p, aktiveVariante: "" }) };
    return schluesselMemo.k;
  };
  let gespeichertSchluessel = schluessel();
  /** Gespeicherter Stand als Referenz: schneller Vergleich ohne Serialisieren (null = nur Schlüssel zählt). */
  let gespeichertStand: Projekt | null = verlauf.aktuell;
  /** Einbetten ändert die Projektdatei, nicht das Modell: zählt deshalb extra als Änderung. */
  let gespeichertEinbetten = false;
  const markiereGespeichert = () => { gespeichertSchluessel = schluessel(); gespeichertStand = verlauf.aktuell; gespeichertEinbetten = einbetten; };
  const geaendert = () => einbetten !== gespeichertEinbetten || (gespeichertStand !== null && !istProjektGeaendert(verlauf, gespeichertStand) ? false : schluessel() !== gespeichertSchluessel);
  /** Billige Variante für die Statuszeile (pro Refresh, auch beim Ziehen): Referenzvergleich statt JSON.stringify; genau nur bei Rückfrage/Schließen. */
  const geaendertSchnell = () => einbetten !== gespeichertEinbetten || (gespeichertStand !== null ? istProjektGeaendert(verlauf, gespeichertStand) : schluessel() !== gespeichertSchluessel);
  let z: WerkzeugZustand = neuerZustand();
  let auswahl: Auswahl | null = null;
  let unterlage: UnterlageUI | null = null;
  let cursor: Vec2 | null = null;
  let treffer: SnapTreffer | null = null;
  /** Per Verweilen erfasste Punkte (Objektfang-Spur) und die aktuell wirkende Ausrichtung. */
  let erfasst: Vec2[] = [];
  let ausricht: Ausrichtung | null = null;
  let verweil: { punkt: Vec2; timer: ReturnType<typeof setTimeout> } | null = null;
  let kante: ReturnType<typeof kantenTreffer> = null;
  let kal: { p1?: Vec2; p2?: Vec2 } = {};
  let meldung: string | null = null;
  /** Originalbytes der geladenen Unterlage (nur im Speicher; für optionales Einbetten). */
  let unterlageBytes: ArrayBuffer | null = null;
  /** Ursprungspfad der Unterlage (nur Desktop-App, wo der Öffnen-Dialog Pfade liefert). */
  let unterlagePfad: string | null = null;
  let einbetten = false;
  /** Verweis aus geöffnetem Projekt, dessen Datei noch erneut gewählt werden muss. */
  let offeneUnterlage: ProjectModel["unterlage"] = null;
  let projektMeldung: string | null = null;
  let lebendigerDialog: (() => void) | null = null;
  /** Unterlagenwechsel (22a): alte Fangstrecken, Toleranz, bewusst belassene Punkte. */
  let tausch: { alt: SnapSegment[]; belassen: Set<string>; toleranz: number; pass: number[] } | null = null;
  let abweichungen: Abweichung[] = [];
  let index: SnapIndex | null = null;
  let indexKey: [ProjectModel, readonly unknown[]] | null = null;
  let ergebnis: Ergebnis | null = null;
  let ergebnisFuer: ProjectModel | null = null;
  /** Ergebnis je Rechengrundlage (Dachflächen-Referenz + Standort + Standardgefälle): Variantenwechsel rechnet nicht neu. */
  const rechenCache = new WeakMap<object, { standort: unknown; gefaelle: unknown; regeln: string; erg: Ergebnis }>();
  const berechneGemerkt = (m: ProjectModel): Ergebnis => {
    const c = rechenCache.get(m.dachflaechen);
    const regeln = `${Object.entries(aktiveVersionen()).join("|")}#${daemmStandard() ?? ""}`;
    if (c && c.standort === m.standort && c.gefaelle === m.gefaelleStandard && c.regeln === regeln) return c.erg;
    const erg = berechne(m);
    rechenCache.set(m.dachflaechen, { standort: m.standort, gefaelle: m.gefaelleStandard, regeln, erg });
    return erg;
  };
  let ergebnisFehler: string | null = null;
  let standortFuer: ProjectModel["standort"] | null = null;
  let standortPanel: ReturnType<typeof mountStandort> | null = null;
  const leeresErgebnis = { slope: { dachflaechen: [], hinweise: [] }, catchments: { flaechen: [], nachbarn: [], hinweise: [] }, notfall: [], befunde: [], hinweise: [], eids: new Map() } as unknown as Ergebnis;
  /** Autosave ins lokale Speichern (ohne Netz); Fehler (z. B. privater Modus) werden ignoriert. */
  let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
  const autosaveJetzt = () => { if (autosaveTimer !== null) { clearTimeout(autosaveTimer); autosaveTimer = null; } void autosaveSchreiben(serializeProjekt(mitAnsicht(aktuellesProjekt()))); };
  /** Entprellt (400 ms): beim Ziehen wird nicht bei jedem Schritt das ganze Projekt serialisiert; beim Verlassen der Seite sofort. */
  function speichere() { if (autosaveTimer === null) autosaveTimer = setTimeout(autosaveJetzt, 400); }
  window.addEventListener("pagehide", () => { if (autosaveTimer !== null) autosaveJetzt(); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && autosaveTimer !== null) autosaveJetzt(); });

  /** Ansicht der aktiven Variante, je Projektstand gemerkt (Referenzvergleiche für Ergebnis, Fang, Plan bleiben gültig). */
  let modellMemo: { p: Projekt; m: ProjectModel } | null = null;
  const modell = (): ProjectModel => {
    const p = verlauf.aktuell;
    if (modellMemo?.p !== p) modellMemo = { p, m: modellFuerVariante(p) };
    return modellMemo.m;
  };
  /** Werkzeug-/Panelbefehl auf der aktiven Variante als Projektschritt ausführen. */
  const fuehreAus = (b: Befehl) => { verlauf = ausfuehren(verlauf, aufVariante(b)); };
  const tol = () => FANG_PX / stage.viewport.scale;

  // ---------- Fang ----------
  function fangIndex(): SnapIndex {
    const u = unterlage?.segmente() ?? [];
    if (!index || !indexKey || indexKey[0] !== modell() || indexKey[1] !== u) {
      index = createSnapIndex([...u, ...projektSegmente(modell())]);
      indexKey = [modell(), u];
    }
    return index;
  }
  const zeichnetMitFang = () => z.tool !== "select";
  function refPunkt(): Vec2 | undefined {
    if (z.tool === "measure") return kal.p1;
    return z.entwurf[z.entwurf.length - 1];
  }
  const ERFASS_MS = 450, MAX_ERFASST = 4;
  const spurPunkte = (): Vec2[] => [...erfasst, ...z.entwurf];
  /** Fangtreffer plus Ausrichtung an erfassten Punkten und bisherigen Entwurfspunkten (ersetzt Ortho). */
  function fangAuswerten(w: Vec2): { treffer: SnapTreffer | null; ausricht: Ausrichtung | null; punkt: Vec2 } {
    const ref = refPunkt();
    const t = snap(fangIndex(), w, tol(), ref ? { referenzpunkt: ref } : {});
    if (t && t.art !== "ortho") return { treffer: t, ausricht: null, punkt: t.punkt };
    const a = ausrichten(spurPunkte(), w, tol());
    if (a) return { treffer: null, ausricht: a, punkt: a.punkt };
    return { treffer: t, ausricht: null, punkt: t ? t.punkt : w };
  }
  function gefangen(w: Vec2): Vec2 {
    if (!zeichnetMitFang() || z.tool === "attika" || z.tool === "schwelle" || z.tool === "wandanschluss" || z.tool === "dachreiter") return w;
    return fangAuswerten(w).punkt;
  }
  function verweilen(t: SnapTreffer | null) {
    if (!t || t.art === "ortho" || t.art === "lot") { if (verweil) { clearTimeout(verweil.timer); verweil = null; } return; }
    if (verweil && Math.hypot(verweil.punkt.x - t.punkt.x, verweil.punkt.y - t.punkt.y) < 1e-9) return;
    if (verweil) clearTimeout(verweil.timer);
    const punkt = t.punkt;
    verweil = { punkt, timer: setTimeout(() => {
      verweil = null;
      if (erfasst.some((q) => Math.hypot(q.x - punkt.x, q.y - punkt.y) < 1e-9)) return;
      erfasst = [...erfasst, punkt].slice(-MAX_ERFASST);
      stage.invalidate();
    }, ERFASS_MS) };
  }
  const vergissErfasste = () => { erfasst = []; ausricht = null; if (verweil) { clearTimeout(verweil.timer); verweil = null; } };

  // ---------- Aktionen ----------
  const ableitOpt = () => { const std = daemmStandard(); return { packs, ...(std !== undefined ? { daemmdickeTiefpunktStandard: std } : {}) }; };
  function wende(r: KlickErgebnis) {
    const warEntwurf = z.entwurf.length > 0;
    z = r.zustand;
    if (warEntwurf && z.entwurf.length === 0) vergissErfasste();
    if (r.befehl) {
      const alt = verlauf;
      const dachId = r.auswahl?.art === "entwaesserung" ? r.auswahl.dachId : undefined;
      fuehreAus(dachId ? mitAbleitung(r.befehl, dachId, ableitOpt()) : r.befehl);
      if (verlauf === alt) z = { ...z, hinweis: z.hinweis };
    }
    if (r.auswahl !== undefined) auswahl = r.auswahl && z.tool === "select" && gesperrt(r.auswahl.art === "entwaesserung" ? "symbole" : "kontur") ? null : r.auswahl;
    refresh();
  }
  function setzeWerkzeug(id: WerkzeugId) {
    z = waehleWerkzeug(z, id);
    kal = {}; meldung = null; treffer = null; kante = null; vergissErfasste();
    shell.setTool(id);
    stage.setCursor(id === "select" ? "" : "crosshair");
    refresh();
  }
  function setzeAuswahl(a: Auswahl | null) { auswahl = a; refresh(); }
  /** Undo/Redo stellt auch die damals aktive Variante her (Ansicht springt dorthin, wo der Schritt geschah). */
  const springe = (neu: Verlauf<Projekt>) => {
    const vorher = verlauf.aktuell.aktiveVariante;
    verlauf = neu; unterlageInsModell(); pruefeAuswahl(); // Unterlage ist kein Undo-Schritt: der Editorstand gilt weiter
    if (verlauf.aktuell.aktiveVariante !== vorher) { tausch = null; kal = {}; z = neuerZustand(); vergissErfasste(); projektMeldung = `Variante „${variantenListe(verlauf.aktuell).find((v) => v.aktiv)?.name ?? ""}“ aktiv.`; }
    refresh();
  };
  const undo = () => springe(rueckgaengig(verlauf));
  const redo = () => springe(wiederholen(verlauf));
  function pruefeAuswahl() {
    if (!auswahl) return;
    const d = modell().dachflaechen.find((x) => x.id === auswahl!.dachId);
    const ok = d && (auswahl.art === "dach" ||
      (auswahl.art === "aufbau" && d.aufbauten.some((x) => x.id === auswahl!.id)) ||
      (auswahl.art === "zone" && d.zonen.some((x) => x.id === auswahl!.id)) ||
      (auswahl.art === "attika" && d.attika.some((x) => x.id === auswahl!.id)) ||
      (auswahl.art === "tuerschwelle" && d.tuerschwellen.some((x) => x.id === auswahl!.id)) ||
      (auswahl.art === "wandanschluss" && (d.wandanschluesse ?? []).some((x) => x.id === auswahl!.id)) ||
      (auswahl.art === "entwaesserung" && d.entwaesserung.some((x) => x.id === auswahl!.id)));
    if (!ok) auswahl = null;
  }
  function loescheAuswahl() { if (auswahl) { fuehreAus(loesche(auswahl)); auswahl = null; refresh(); } }
  function aktuellesDach(): Dachflaeche | null {
    const ds = modell().dachflaechen;
    return ds.find((d) => d.id === auswahl?.dachId) ?? (ds.length === 1 ? ds[0]! : null);
  }

  // ---------- Unterlage ----------
  /** Modelleintrag ohne Verlauf (Unterlage ist keine Zeichenaktion). */
  function unterlageInsModell() {
    const u = unterlage;
    let eintrag = null;
    if (u) {
      if (u.kalibrierung) {
        const t = u.kalibrierung.get();
        eintrag = pdfModell(u, zuPasspunkten(t, u.kalibrierung.breite), Math.round(nennerAusFaktor(faktor(t))));
      } else eintrag = dxfModell(u);
    }
    if (JSON.stringify(eintrag) === JSON.stringify(verlauf.aktuell.unterlage ?? null)) return; // unverändert → nicht „geändert“
    if (eintrag && unterlagePfad) eintrag = { ...eintrag, quellpfad: unterlagePfad };
    verlauf = { ...verlauf, aktuell: { ...verlauf.aktuell, unterlage: eintrag } };
  }
  /** DXF laden; PDF mit mehreren Seiten erst nach Seitenwahl (Abbruch → null). `ohneDialog`: gespeicherte Seite verwenden. */
  async function ladeUnterlageDatei(f: File, vorgabe: number | undefined, ohneDialog: boolean): Promise<UnterlageUI | null> {
    if (!/\.pdf$/i.test(f.name)) return ladeDxf(f);
    const seite = ohneDialog ? (vorgabe ?? 1) : await waehlePdfSeite(f, vorgabe ?? 1);
    return seite === null ? null : ladePdf(f, seite);
  }
  async function ladeDatei(f: File, ohneDialog = false) {
    try {
      meldung = null;
      const bytes = await f.arrayBuffer();
      const u = await ladeUnterlageDatei(f, offeneUnterlage?.seite, ohneDialog);
      if (!u) { refresh(); return; }
      unterlage = u; unterlageBytes = bytes;
      const ref = offeneUnterlage; offeneUnterlage = null;
      if (ref && ref.pruefsumme.wert === u.pruefsumme) {
        const t = ausPasspunkten(ref.passpunkte);
        if (t && u.kalibrierung) u.kalibrierung.set(t);
        else if (t && u.ausrichtung) u.ausrichtung.set(t);
      } else if (ref) meldung = `Die Datei „${u.name}“ weicht von der gespeicherten Unterlage ab (Prüfsumme). Bitte Maßstab/Ausrichtung prüfen.`;
      unterlageInsModell();
      stage.setLayer("unterlage", u.draw);
      const b = u.bounds();
      if (b) stage.fit(...b);
      kal = {};
    } catch (e) {
      meldung = `Datei konnte nicht gelesen werden: ${e instanceof Error ? e.message : String(e)}`;
    }
    refresh();
  }
  async function tauscheUnterlage(f: File) {
    try {
      const alt = unterlage?.art === "dxf" ? unterlage.segmente().map((s) => ({ a: s.a, b: s.b })) : null;
      const bytes = await f.arrayBuffer();
      const u = await ladeUnterlageDatei(f, unterlage?.seite ?? offeneUnterlage?.seite, false);
      if (!u) return;
      unterlage = u; unterlageBytes = bytes; offeneUnterlage = null; meldung = null; kal = {};
      unterlageInsModell(); stage.setLayer("unterlage", u.draw);
      tausch = alt && u.art === "dxf" ? { alt, belassen: new Set(), toleranz: TOLERANZ_STANDARD, pass: [0, 0, 0, 0, 0, 0, 0, 0] } : null;
      if (!tausch) meldung = "Unterlage ersetzt. Abweichungsprüfung nur zwischen zwei DXF-Dateien möglich.";
    } catch (e) { meldung = `Datei konnte nicht gelesen werden: ${e instanceof Error ? e.message : String(e)}`; }
    refresh();
  }
  function berechneAbweichungen() {
    abweichungen = tausch && unterlage?.art === "dxf"
      ? findeAbweichungen(modell(), tausch.alt, unterlage.segmente(), tausch.toleranz).filter((a) => !tausch!.belassen.has(a.id)) : [];
  }
  function richteAus() {
    if (!tausch || !unterlage?.ausrichtung) return;
    const q = tausch.pass;
    const t = ausPasspunkten([
      { unterlage: { x: q[0]!, y: q[1]! }, welt: { x: q[2]!, y: q[3]! } },
      { unterlage: { x: q[4]!, y: q[5]! }, welt: { x: q[6]!, y: q[7]! } },
    ]);
    if (!t) { meldung = "Passpunkte ungültig (Punkte fallen zusammen)."; refresh(); return; }
    unterlage.ausrichtung.set(t); unterlageInsModell(); stage.invalidate(); meldung = null; refresh();
  }
  function panelAbweichungen(p: HTMLElement) {
    if (!tausch) return;
    const t = tausch;
    const box = el("div", "pad abweichungen");
    box.append(el("div", "note", "Unterlage ausgetauscht: Abweichungen (Koordinaten in m)"));
    const al = el("details", "ausrichtung"); al.append(el("summary", "", "Ausrichtung (zwei Passpunkte)"));
    const namen = ["Neu 1 x", "Neu 1 y", "Alt 1 x", "Alt 1 y", "Neu 2 x", "Neu 2 y", "Alt 2 x", "Alt 2 y"];
    namen.forEach((n, i) => al.append(feld(n, zahl(t.pass[i]!, 3), `pass${i}`, (v) => { t.pass[i] = v; }, "m")));
    al.append(button("Ausrichten", richteAus));
    box.append(al, feld("Toleranz", zahl(t.toleranz * 100, 1), "toleranz", (v) => { if (v >= 0) { t.toleranz = v / 100; refresh(); } }, "cm"));
    if (!abweichungen.length) box.append(el("div", "ok", "Keine offenen Abweichungen."));
    else {
      const ul = el("ul", "befunde");
      for (const a of abweichungen) {
        const li = el("li", "befund abw-zeile"); li.dataset.abw = a.id;
        const txt = a.vorschlag ? `${zahl(a.alt.x, 3)} | ${zahl(a.alt.y, 3)} → ${zahl(a.vorschlag.x, 3)} | ${zahl(a.vorschlag.y, 3)} (${zahl((a.abstand ?? 0) * 100, 1)} cm)` : `${zahl(a.alt.x, 3)} | ${zahl(a.alt.y, 3)} → kein neuer Fangpunkt`;
        li.append(el("div", "stufe", "Abweichung"), el("div", "num", txt));
        const z = el("div", "btn-row");
        if (a.vorschlag) z.append(button("Übernehmen", () => ausfuehreBefehl(uebernehmeVorschlaege([a]))));
        const pos = { x: (a.vorschlag ?? a.alt).x, y: (a.vorschlag ?? a.alt).y };
        const fx = el("input", "num-klein"), fy = el("input", "num-klein");
        fx.value = zahl(pos.x, 3); fy.value = zahl(pos.y, 3); fx.setAttribute("aria-label", "x neu"); fy.setAttribute("aria-label", "y neu");
        fx.inputMode = fy.inputMode = "decimal";
        z.append(fx, fy, button("Setzen", () => {
          const x = num(fx.value), y = num(fy.value);
          if (!Number.isFinite(x) || !Number.isFinite(y)) return;
          t.belassen.add(a.id); ausfuehreBefehl(verschiebePunkte([{ ref: a.ref, pos: { x, y } }], "Punkt händisch verschieben"));
        }));
        z.append(button("Belassen", () => { t.belassen.add(a.id); refresh(); }));
        li.append(z); ul.append(li);
      }
      box.append(ul);
      const alle = el("div", "btn-row");
      alle.append(button("Alle übernehmen", () => ausfuehreBefehl(uebernehmeVorschlaege(abweichungen))), button("Alle belassen", () => { abweichungen.forEach((a) => t.belassen.add(a.id)); refresh(); }));
      box.append(alle);
    }
    box.append(button("Schließen", () => { tausch = null; refresh(); }));
    p.append(box);
  }
  function entferneUnterlage() { unterlage = null; unterlageBytes = null; unterlagePfad = null; offeneUnterlage = null; unterlageInsModell(); stage.setLayer("unterlage", null); kal = {}; refresh(); }
  function setzeMassstab(n: number) {
    const k = unterlage?.kalibrierung;
    if (!k || !(n > 0)) return;
    const b = unterlage!.bounds()!;
    const t = nennerSetzen(k.get(), n, { x: (b[0] + b[2]) / 2, y: (b[1] + b[3]) / 2 });
    if (t) { k.set(t); unterlageInsModell(); stage.invalidate(); refresh(); }
  }
  function kalibrieren(strecke: number) {
    const k = unterlage?.kalibrierung;
    if (!k || !kal.p1 || !kal.p2) return;
    const t = kalibriereStrecke(k.get(), kal.p1, kal.p2, strecke);
    if (!t) { meldung = "Strecke ungültig."; refresh(); return; }
    k.set(t); kal = {}; meldung = null; unterlageInsModell(); stage.invalidate(); refresh();
  }

  // ---------- Projektdatei (PLAN Schritt 22) ----------
  /** Mit Einbetten: DXF bzw. nur die gewählte PDF-Seite, gzip-komprimiert. Die Prüfsumme gilt dann für die eingebetteten Bytes. */
  async function modellFuerDatei(): Promise<ProjectModel> {
    const m = modell();
    if (!(einbetten && m.unterlage && unterlageBytes)) return m;
    const pdf = m.unterlage.art === "pdf";
    const { eingebettet, roh } = await packeUnterlage(unterlageBytes, pdf ? "pdf" : "dxf", m.unterlage.seite);
    const u = pdf ? { ...m.unterlage, seite: 1, pruefsumme: { algorithmus: "sha-256" as const, wert: await sha256(roh.buffer) } } : m.unterlage;
    return { ...m, unterlage: { ...u, eingebettet } };
  }
  async function speichereProjekt(): Promise<boolean> {
    const stand = schluessel(), standP = verlauf.aktuell, standE = einbetten;
    let ok = false;
    try { ok = await speichereDatei(serializeProjekt(mitAnsicht(mitModell(verlauf.aktuell, await modellFuerDatei()))), dateiname(modell().meta.name)); }
    catch (e) { projektMeldung = `Speichern fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`; refresh(); return false; }
    projektMeldung = ok ? "Projekt gespeichert." : null;
    if (ok) { gespeichertSchluessel = stand; gespeichertStand = standP; gespeichertEinbetten = standE; }
    refresh();
    return ok;
  }
  async function oeffneText(text: string) {
    const r = leseProjekt(text);
    if (!r.ok) { projektMeldung = r.meldung; refresh(); return; }
    const u = r.projekt.unterlage;
    einbetten = false; uebernehmeAnsicht(r.projekt.ansicht);
    let m = r.projekt;
    if (u?.eingebettet) { const k: { eingebettet?: unknown } = { ...u }; delete k.eingebettet; m = { ...m, unterlage: k as NonNullable<ProjectModel["unterlage"]> }; }
    verlauf = neuerVerlauf(m); markiereGespeichert(); auswahl = null; tausch = null; kal = {}; z = neuerZustand(); unterlage = null; unterlageBytes = null; unterlagePfad = null; offeneUnterlage = null; stage.setLayer("unterlage", null);
    projektMeldung = r.hinweise.length ? r.hinweise.join(" ") : "Projekt geöffnet.";
    if (u?.eingebettet) {
      const bytes = await entpackeUnterlage(u.eingebettet);
      offeneUnterlage = u; unterlagePfad = u.quellpfad ?? null;
      unterlageBytes = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer; // Rückfall: Daten bleiben erhalten, falls das Laden scheitert
      await ladeDatei(new File([bytes], u.dateiname), true);
      einbetten = true;
      markiereGespeichert();
    } else if (u) {
      offeneUnterlage = u;
      const bytes = u.quellpfad && istTauri() ? await leseDatei(u.quellpfad).catch(() => null) : null;
      if (bytes) {
        unterlagePfad = u.quellpfad ?? null;
        await ladeDatei(new File([bytes], u.dateiname), true);
        projektMeldung += ` Unterlage „${u.dateiname}“ vom Ursprungspfad geladen.`;
      } else projektMeldung += u.quellpfad
        ? ` Unterlage „${u.dateiname}“ nicht gefunden unter ${u.quellpfad}: bitte Datei erneut wählen.`
        : ` Unterlage „${u.dateiname}“ ist nur verknüpft: bitte Datei erneut wählen.`;
    }
    refresh();
  }
  async function oeffneProjekt() {
    if (!(await darfVerwerfen("dem Öffnen"))) return;
    if (istTauri()) { const t = await waehleProjektText().catch(() => null); if (t !== null) await oeffneText(t); return; }
    const f = await waehleDatei();
    if (f) await oeffneText(await f.text());
  }
  /** Rückfrage bei ungespeicherten Änderungen; true = weitermachen (nichts offen, gespeichert oder verworfen). */
  async function darfVerwerfen(anlass: string): Promise<boolean> {
    if (!geaendert()) return true;
    const a = await frageSpeichern(modell().meta.name, anlass);
    if (a === "abbrechen") return false;
    if (a === "speichern") return await speichereProjekt();
    return true;
  }
  async function neuesProjekt() {
    if (!(await darfVerwerfen("dem Anlegen eines neuen Projekts"))) return;
    verlauf = neuerVerlauf(createProjekt("Neues Projekt", new Date().toISOString())); markiereGespeichert(); auswahl = null; unterlage = null; unterlageBytes = null; unterlagePfad = null; offeneUnterlage = null;
    uebernehmeAnsicht(undefined); einbetten = false; gespeichertEinbetten = false; tausch = null; kal = {}; meldung = null; z = neuerZustand(); stage.setLayer("unterlage", null);
    projektMeldung = "Neues Projekt angelegt.";
    refresh();
  }
  let anschlussCache: { schluessel: object; m: ProjectModel; daten: ReturnType<typeof anschlussDaten> } | null = null;
  /** Je Berechnungsergebnis nur einmal rechnen (Neuzeichnen bei Pan/Zoom, Panel). */
  function anschlussDatenCached(m: ProjectModel, erg: NonNullable<typeof ergebnis>) {
    if (!anschlussCache || anschlussCache.schluessel !== erg || anschlussCache.m !== m) anschlussCache = { schluessel: erg, m, daten: anschlussDaten(m, erg.slope, erg.notfall) };
    return anschlussCache.daten;
  }
  function anschlussDaten(m: ProjectModel, slope: Parameters<typeof computeAnschluesse>[1], notfall: Parameters<typeof computeNotwasserstaende>[2]) {
    try { return { anschluesse: computeAnschluesse(m, slope, packs), notstaende: computeNotwasserstaende(m, slope, notfall, packs) }; } catch { return { anschluesse: [], notstaende: [] }; }
  }
  function baueExportEingabe(m: ProjectModel, name: string, datum: string, regelwerk: string, mitName: boolean) {
    const erg = m.dachflaechen.length ? berechne(m) : null;
    if (!erg) return null;
    let pl = null;
    try { pl = berechnePlan(m, erg.slope); } catch { /* ohne Dämmplan */ }
    const { anschluesse, notstaende } = anschlussDaten(m, erg.slope, erg.notfall);
    return { eingabe: { modell: m, slope: erg.slope, catchments: erg.catchments, eids: erg.eids, plan: pl, anschluesse, notstaende, farbe: (i: number) => farbe(i)[0], datum, regelwerk, ...(mitName ? { variante: name } : {}) } };
  }
  /** Fragt bei mehreren Varianten, welche exportiert werden (Standard: die aktive); null = abgebrochen. */
  async function waehleExportVarianten(): Promise<string[] | null> {
    const pr = aktuellesProjekt();
    const liste = variantenListe(pr);
    if (liste.length < 2) return [pr.aktiveVariante];
    const gewaehlt = new Set<string>([pr.aktiveVariante]);
    const box = el("div", "pad");
    const hinweis = el("div", "note warn", "Wählen Sie mindestens eine Variante.");
    hinweis.hidden = true;
    const felder: HTMLInputElement[] = [];
    for (const v of liste) {
      const lab = el("label", "check-row");
      const cb = el("input"); cb.type = "checkbox"; cb.checked = gewaehlt.has(v.id); cb.dataset.k = `export-${v.id}`;
      cb.addEventListener("change", () => { if (cb.checked) gewaehlt.add(v.id); else gewaehlt.delete(v.id); aktualisiere(); });
      felder.push(cb);
      lab.append(cb, el("span", "", v.name + (v.aktiv ? " (aktiv)" : "")));
      box.append(lab);
    }
    box.append(hinweis);
    const d = oeffneDialog({
      titel: "Plan als PDF exportieren", text: "Welche Varianten sollen ins PDF? Jede Variante erhält ihre eigenen Blätter.", inhalt: box,
      knoepfe: [{ id: "abbrechen", label: "Abbrechen" }, { id: "export", label: "Exportieren", primaer: true }], abbruchId: "abbrechen",
    });
    const ok = d.wurzel.querySelector<HTMLButtonElement>("[data-k='dialog-export']")!;
    function aktualisiere() { ok.disabled = gewaehlt.size === 0; hinweis.hidden = gewaehlt.size > 0; }
    const antwort = await d.ergebnis;
    if (antwort !== "export") return null;
    return liste.filter((v) => gewaehlt.has(v.id)).map((v) => v.id);
  }
  let pdfLaeuft = false;
  /** Sperre gegen Doppelstart: während des Exports (inkl. Dialog und Speichern) startet kein zweiter. */
  async function exportierePdf() {
    if (pdfLaeuft) return;
    pdfLaeuft = true;
    try { await exportierePdfJetzt(); } finally { pdfLaeuft = false; }
  }
  async function exportierePdfJetzt() {
    const pr = aktuellesProjekt();
    const ids = await waehleExportVarianten();
    if (!ids) return;
    try {
      const regeln = packs.find((x) => x.typ === "regeln");
      const heute = new Date();
      const datum = `${String(heute.getDate()).padStart(2, "0")}.${String(heute.getMonth() + 1).padStart(2, "0")}.${heute.getFullYear()}`;
      const regelwerk = regeln ? `${regeln.titel ?? regeln.id} · ${regeln.version}` : "–";
      const mehrere = variantenListe(pr).length > 1;
      const teile = [];
      const leer: string[] = [];
      for (const [i, id] of ids.entries()) {
        const name = variantenListe(pr).find((v) => v.id === id)?.name ?? id;
        if (ids.length > 1) { projektMeldung = `PDF wird erstellt: Variante ${i + 1}/${ids.length} …`; refresh(); await new Promise<void>((res) => requestAnimationFrame(() => setTimeout(res, 0))); }
        const t = baueExportEingabe(modellFuerVariante(pr, id), name, datum, regelwerk, mehrere);
        if (t) teile.push(t); else leer.push(name);
      }
      if (teile.length === 0) { projektMeldung = "PDF-Export: erst eine Dachfläche zeichnen."; refresh(); return; }
      const r = baueVariantenPdf(teile);
      const einzel = ids.length === 1 && mehrere ? `-${dateiname(variantenListe(pr).find((v) => v.id === ids[0])?.name ?? "")}` : "";
      const gespeichert = await gibDateiAus(r.bytes, { name: `${dateiname(pr.meta.name)}${einzel}-Plan.pdf`, mime: "application/pdf", endung: "pdf", beschreibung: "PDF" });
      if (!gespeichert) { projektMeldung = "PDF-Export abgebrochen."; refresh(); return; }
      projektMeldung = `PDF erstellt (A3, ${teile.length} ${teile.length === 1 ? "Variante" : "Varianten"}, Maßstab 1 : ${[...new Set(r.massstaebe)].join(" / 1 : ")}).` + (leer.length ? ` Ohne Dachfläche übersprungen: ${leer.join(", ")}.` : "");
    } catch (e) { projektMeldung = `PDF-Export fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`; }
    refresh();
  }

  function exportiereDxf() {
    if (!ergebnis) { projektMeldung = "DXF-Export: erst eine Dachfläche zeichnen."; refresh(); return; }
    try {
      let p = null;
      try { p = berechnePlan(modell(), ergebnis.slope); } catch { /* ohne Dämmplan */ }
      const text = baueProjektDxf({ modell: modell(), slope: ergebnis.slope, plan: p, ...anschlussDaten(modell(), ergebnis.slope, ergebnis.notfall) });
      void gibDateiAus(text, { name: `${dateiname(modell().meta.name)}-Plan.dxf`, mime: "application/dxf", endung: "dxf", beschreibung: "DXF" }).then((ok) => { projektMeldung = ok ? "DXF erstellt (Meter, Layer FDP_*)." : "DXF-Export abgebrochen."; refresh(); }, (e) => { projektMeldung = `DXF-Export fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`; refresh(); });
      projektMeldung = "DXF wird erstellt …";
    } catch (e) { projektMeldung = `DXF-Export fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`; }
    refresh();
  }

  // ---------- Varianten und Projektangaben ----------
  /** Neuer Projektstand nach einer Variantenaktion (Verlauf bleibt): Ansicht und Auswahl neu aufbauen, Unterlage bleibt. */
  function uebernimmProjekt(neu: Verlauf<Projekt>, meldungText: string) {
    verlauf = neu;
    auswahl = null; tausch = null; kal = {}; z = neuerZustand(); vergissErfasste();
    projektMeldung = meldungText; refresh();
  }
  function wechsleZuVariante(id: string) {
    const neu = wechsleVariante(verlauf, id);
    if (neu !== verlauf) uebernimmProjekt(neu, `Variante „${variantenListe(neu.aktuell).find((v) => v.aktiv)?.name}“ aktiv.`);
  }
  function neueVariante(kopieVon?: string) {
    const pr = aktuellesProjekt();
    const name = vorschlagVariantenName(pr, kopieVon);
    const r = legeVarianteAn(pr, name, kopieVon);
    if (r.ok) uebernimmProjekt(ausfuehren(verlauf, befehlVarianteAnlegen(name, kopieVon)), kopieVon ? "Variante dupliziert." : "Leere Variante angelegt.");
    else { projektMeldung = r.fehler.meldung; refresh(); }
  }
  async function loescheVarianteFrage(id: string) {
    const pr = aktuellesProjekt();
    const name = variantenListe(pr).find((v) => v.id === id)?.name ?? id;
    const d = oeffneDialog({
      titel: "Variante löschen?", text: `Die Variante „${name}“ mit allen Dachflächen wird gelöscht. Rückgängig mit Strg+Z.`,
      knoepfe: [{ id: "abbrechen", label: "Abbrechen", primaer: true }, { id: "loeschen", label: "Löschen" }], abbruchId: "abbrechen",
    });
    if ((await d.ergebnis) !== "loeschen") return;
    const r = loescheVariante(aktuellesProjekt(), id);
    if (r.ok) uebernimmProjekt(ausfuehren(verlauf, befehlVarianteLoeschen(id)), `Variante „${name}“ gelöscht.`); else { projektMeldung = r.fehler.meldung; refresh(); }
  }
  function benenneAktive(name: string): string | null {
    const pr = aktuellesProjekt();
    const r = benenneVarianteUm(pr, pr.aktiveVariante, name);
    if (!r.ok) return r.fehler.meldung;
    if (r.projekt !== pr) { verlauf = ausfuehren(verlauf, befehlVarianteUmbenennen(pr.aktiveVariante, name)); refresh(); }
    return null;
  }
  function setzeAngaben(teil: ProjektangabenTeil): string | null {
    const r = setzeProjektangaben(modell(), teil);
    if (!r.ok) return r.fehler.map((f) => f.meldung).join(" ");
    if (r.modell !== modell()) { fuehreAus({ label: "Projektangaben", anwenden: (m) => { const x = setzeProjektangaben(m, teil); return x.ok ? x.modell : m; } }); refresh(); }
    return null;
  }
  function blockVarianten(): HTMLElement {
    const pr = aktuellesProjekt();
    const box = el("div", "varianten");
    box.append(el("div", "label", "Varianten"));
    const liste = el("div", "varianten-liste");
    liste.setAttribute("role", "list");
    for (const v of variantenListe(pr)) {
      const b = button(v.name, () => wechsleZuVariante(v.id), v.aktiv ? "btn variante aktiv" : "btn variante");
      b.dataset.k = `variante-${v.id}`; b.setAttribute("role", "listitem");
      if (v.aktiv) b.setAttribute("aria-current", "true");
      liste.append(b);
    }
    box.append(liste);
    const f = el("div", "field");
    const l = el("label", "", "Name"); const i = el("input"); i.id = "f-variante-name"; l.htmlFor = i.id; i.dataset.k = "variante-name";
    i.value = variantenListe(pr).find((v) => v.aktiv)?.name ?? "";
    const fehler = el("div", "note error"); fehler.hidden = true; fehler.setAttribute("role", "alert");
    i.maxLength = VARIANTEN_NAME_MAX;
    i.addEventListener("change", () => { const m = benenneAktive(i.value); if (m) { fehler.textContent = m; fehler.hidden = false; } });
    i.addEventListener("keydown", (e) => { if (e.key === "Enter") i.blur(); });
    f.append(l, i);
    const zeile = el("div", "btn-row");
    const b1 = button("Neue Variante", () => neueVariante()); b1.dataset.k = "variante-neu";
    const b2 = button("Duplizieren", () => neueVariante(pr.aktiveVariante)); b2.dataset.k = "variante-duplizieren";
    const b3 = button("Löschen …", () => void loescheVarianteFrage(pr.aktiveVariante), "btn gefahr"); b3.dataset.k = "variante-loeschen"; b3.disabled = variantenListe(pr).length < 2;
    zeile.append(b1, b2, b3);
    box.append(f, fehler, zeile);
    return box;
  }

  function blockEinbetten(): HTMLElement {
    const box = el("div", "einbetten");
    if (!unterlage) { box.append(el("div", "empty", "Keine Unterlage geladen.")); return box; }
    const lab = el("label", "check-row");
    const cb = el("input"); cb.type = "checkbox"; cb.checked = einbetten; cb.dataset.k = "einbetten";
    cb.addEventListener("change", () => { einbetten = cb.checked; refresh(); });
    lab.append(cb, el("span", "", unterlage.art === "pdf" ? `PDF (nur Seite ${unterlage.seite ?? 1}) in die Projektdatei einbetten` : "DXF in die Projektdatei einbetten"));
    box.append(lab, el("div", "note", einbetten
      ? "Die Unterlage steckt komprimiert in der Projektdatei und lässt sich auf jedem Rechner öffnen."
      : "Die Unterlage wird nicht eingebettet: das Projekt verweist nur auf die Originaldatei und sucht sie beim Öffnen am gleichen Ort."));
    return box;
  }
  /** Desktop: Öffnen-Dialog liefert den Ursprungspfad (wird in der Projektdatei als Verweis gespeichert). */
  async function waehleUnterlageDialog() {
    const w = await waehleUnterlagePfad().catch(() => null);
    if (!w) return;
    const vorher = unterlage, altPfad = unterlagePfad;
    unterlagePfad = w.pfad;
    const f = new File([w.bytes], w.pfad.split(/[\\/]/).pop() ?? "unterlage");
    await (vorher ? tauscheUnterlage(f) : ladeDatei(f));
    if (unterlage === vorher) unterlagePfad = altPfad; // Seitenwahl abgebrochen o. Ä.
    else { unterlageInsModell(); refresh(); }
  }
  function waehleUnterlageDatei() {
    if (istTauri()) { void waehleUnterlageDialog(); return; }
    unterlagePfad = null;
    const i = el("input"); i.type = "file"; i.accept = ".dxf,.pdf,application/pdf";
    i.addEventListener("change", () => { const f = i.files?.[0]; if (f) void (unterlage ? tauscheUnterlage(f) : ladeDatei(f)); });
    i.click();
  }

  // ---------- Panels ----------
  function panelUnterlage() {
    const p = shell.panels.unterlage;
    p.replaceChildren();
    const wahl = el("input");
    wahl.type = "file"; wahl.accept = ".dxf,.pdf,application/pdf"; wahl.id = "f-unterlage"; wahl.setAttribute("aria-label", "Unterlage laden (DXF oder PDF)");
    wahl.addEventListener("click", (e) => { if (istTauri()) { e.preventDefault(); void waehleUnterlageDialog(); } });
    wahl.addEventListener("change", () => { const f = wahl.files?.[0]; if (f) { unterlagePfad = null; void ladeDatei(f); } });
    wahl.className = "visually-hidden"; wahl.tabIndex = -1;
    const btn = el("button", "btn", "Unterlage laden …"); btn.type = "button";
    btn.addEventListener("click", () => wahl.click());
    const w = el("div", "pad"); w.append(btn, wahl);
    p.append(w);
    if (!unterlage) { p.append(el("div", "empty", offeneUnterlage ? `Unterlage „${offeneUnterlage.dateiname}“ ist nur verknüpft: bitte Datei erneut wählen.` : "Keine Unterlage geladen.")); } else {
      const u = unterlage;
      p.append(row("Datei", u.name, "u-name"));
      if (u.einheitUnbekannt) p.append(el("div", "note", "Einheit in der DXF-Datei unbekannt: 1 Einheit = 1 m angenommen."));
      if (u.art === "dxf") {
        const l = el("div", "pad layer-liste");
        for (const n of u.layer) {
          const lab = el("label", "check-row");
          const cb = el("input"); cb.type = "checkbox"; cb.checked = u.sichtbar.has(n); cb.dataset.layer = n;
          cb.addEventListener("change", () => { u.setLayer(n, cb.checked); stage.invalidate(); });
          lab.append(cb, el("span", "", n));
          l.append(lab);
        }
        p.append(l);
      } else if (u.kalibrierung) {
        p.append(feld("Maßstab 1 :", String(Math.round(nennerAusFaktor(faktor(u.kalibrierung.get())))), "massstab", setzeMassstab, "n"));
      }
      const tw = el("input"); tw.type = "file"; tw.accept = ".dxf,.pdf,application/pdf"; tw.id = "f-tausch"; tw.className = "visually-hidden"; tw.tabIndex = -1;
      tw.addEventListener("change", () => { const f = tw.files?.[0]; tw.value = ""; if (f) void tauscheUnterlage(f); });
      const b = el("div", "pad btn-row"); b.append(button("Unterlage austauschen …", () => tw.click()), button("Unterlage entfernen", entferneUnterlage), tw); p.append(b);
      panelAbweichungen(p);
    }
    if (meldung) { const m = el("div", "note error", meldung); m.setAttribute("role", "alert"); p.append(m); }
    const s = shell.status.unterlage;
    if (!unterlage) s.textContent = "";
    else if (unterlage.kalibrierung) s.textContent = `Unterlage 1:${Math.round(nennerAusFaktor(faktor(unterlage.kalibrierung.get())))}`;
    else s.textContent = "Unterlage DXF";
  }

  // ---------- Ebenen (oberste Zeile = oberste Zeichenebene, Unterlage ganz unten) ----------
  const EBENEN: readonly { id: LayerId; name: string }[] = [
    { id: "koten", name: "Koten & Anschlüsse" }, { id: "symbole", name: "Abläufe" }, { id: "pfeile", name: "Gefälle & Beschriftung" },
    { id: "kontur", name: "Konturen" }, { id: "daemmplan", name: "Dämmplan" }, { id: "einzugsflaechen", name: "Einzugsflächen" }, { id: "unterlage", name: "Unterlage" },
  ];
  let ebenenZ: Record<string, EbenenZustand> = {};
  const ebZ = (id: LayerId): EbenenZustand => ebenenZ[id] ?? { sichtbar: true, deckkraft: id === "unterlage" ? deckkraft() : 1, gesperrt: false };
  const gesperrt = (id: LayerId) => ebZ(id).gesperrt;
  function setzeEbene(id: LayerId, teil: Partial<EbenenZustand>) {
    ebenenZ = { ...ebenenZ, [id]: { ...ebZ(id), ...teil } };
    wendeEbenen();
  }
  function wendeEbenen() {
    for (const { id } of EBENEN) {
      const e = ebZ(id);
      stage.setEbene(id, { sichtbar: e.sichtbar, deckkraft: id === "unterlage" ? 1 : e.deckkraft });
      if (id === "unterlage") setzeDeckkraft(e.deckkraft);
    }
    stage.invalidate();
  }
  const ebenenAnsicht = (): Ansichtseinstellungen => ({ ebenen: Object.fromEntries(EBENEN.map(({ id }) => [id, ebZ(id)])) });
  const mitAnsicht = (p: Projekt): Projekt => ({ ...p, ansicht: ebenenAnsicht() });
  function uebernehmeAnsicht(a: Ansichtseinstellungen | undefined) { ebenenZ = a ? { ...a.ebenen } : {}; wendeEbenen(); }
  const AUGE = '<path d="M1 8s3-5 7-5 7 5 7 5-3 5-7 5-7-5-7-5z"/><circle cx="8" cy="8" r="2"/>';
  const AUGE_ZU = '<path d="M1 8s3-5 7-5 7 5 7 5-3 5-7 5-7-5-7-5z" opacity=".4"/><path d="M2 14L14 2"/>';
  const SCHLOSS = '<rect x="3" y="7" width="10" height="7"/><path d="M5 7V5a3 3 0 016 0v2"/>';
  const SCHLOSS_OFFEN = '<rect x="3" y="7" width="10" height="7"/><path d="M5 7V5a3 3 0 015.6-1.5"/>';
  function panelEbenen() {
    const p = shell.panels.ebenen;
    const liste = el("div", "ebenen-liste"); liste.setAttribute("role", "list");
    for (const { id, name } of EBENEN) {
      const e = ebZ(id);
      const zeile = el("div", id === "unterlage" ? "ebene ebene-unterlage" : "ebene"); zeile.dataset.ebene = id; zeile.setAttribute("role", "listitem");
      const icon = (pfad: string) => `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">${pfad}</svg>`;
      const auge = el("button", "ico"); auge.type = "button"; auge.dataset.k = `ebene-sichtbar-${id}`;
      auge.setAttribute("aria-pressed", String(e.sichtbar)); auge.setAttribute("aria-label", `${name} ${e.sichtbar ? "ausblenden" : "einblenden"}`); auge.title = e.sichtbar ? "Ausblenden" : "Einblenden";
      auge.innerHTML = icon(e.sichtbar ? AUGE : AUGE_ZU);
      auge.addEventListener("click", () => { setzeEbene(id, { sichtbar: !e.sichtbar }); panelEbenen(); speichere(); });
      zeile.append(auge);
      if (id === "unterlage") zeile.append(el("span"));
      else {
        const lk = el("button", "ico"); lk.type = "button"; lk.dataset.k = `ebene-sperre-${id}`;
        lk.setAttribute("aria-pressed", String(e.gesperrt)); lk.setAttribute("aria-label", `${name} ${e.gesperrt ? "entsperren" : "sperren"}`); lk.title = e.gesperrt ? "Gesperrt: nicht auswählbar" : "Sperren";
        lk.innerHTML = icon(e.gesperrt ? SCHLOSS : SCHLOSS_OFFEN);
        lk.addEventListener("click", () => { setzeEbene(id, { gesperrt: !e.gesperrt }); panelEbenen(); speichere(); });
        zeile.append(lk);
      }
      zeile.append(el("span", "name", name));
      const rg = el("input"); rg.type = "range"; rg.min = "5"; rg.max = "100"; rg.step = "5"; rg.value = String(Math.round(e.deckkraft * 100));
      rg.dataset.k = `ebene-deckkraft-${id}`; if (id === "unterlage") rg.id = "u-deckkraft";
      rg.setAttribute("aria-label", `Deckkraft ${name}`); rg.title = `Deckkraft ${rg.value} %`;
      rg.addEventListener("input", () => { setzeEbene(id, { deckkraft: Number(rg.value) / 100 }); rg.title = `Deckkraft ${rg.value} %`; });
      rg.addEventListener("change", () => speichere());
      zeile.append(rg);
      liste.append(zeile);
    }
    p.replaceChildren(liste);
  }

  function panelWerkzeug() {
    const p = shell.panels.werkzeug;
    p.replaceChildren();
    p.append(el("div", "note", HINWEIS[z.tool]));
    if (z.tool === "attika") {
      p.append(feld("Breite", zahl(z.attikaBreite, 2), "attika-breite", (v) => { if (v > 0) { z = setzeAttikaBreite(z, v); refresh(); } }));
      const b = el("div", "pad");
      b.append(button("Umlaufend", () => {
        const d = aktuellesDach();
        if (!d) { z = { ...z, hinweis: "Zuerst eine Dachfläche auswählen." }; refresh(); return; }
        wende(attikaUmlaufend(z, d.id));
      }));
      p.append(b);
    }
    if (z.tool === "schwelle") {
      p.append(feld("Breite", zahl(z.schwellenBreite, 2), "schwelle-breite", (v) => { if (v > 0) { z = setzeSchwellenBreite(z, v); refresh(); } }));
    }
    if (z.tool === "wandanschluss") {
      p.append(feld("Länge", zahl(z.schwellenBreite, 2), "wand-laenge", (v) => { if (v > 0) { z = setzeSchwellenBreite(z, v); refresh(); } }));
    }
    if (z.tool === "trennen") {
      p.append(feld("Breite", zahl(z.trennBreite, 2), "trenn-breite", (v) => { if (v > 0) { z = setzeTrennBreite(z, v); refresh(); } }));
    }
    if (z.tool === "gully" || z.tool === "notablauf" || z.tool === "dachreiter" || z.tool === "les") {
      p.append(feld("Tiefenlage z", zahl(z.ablaufZ, 3), "ablauf-z", (v) => { z = setzeAblaufZ(z, v); refresh(); }));
      const t = standardTyp(z.tool);
      p.append(el("div", "note", t ? `Produkt: ${typOptionen(z.tool).find((o) => o.wahl.eintragId === t.eintragId)?.titel ?? t.eintragId}` : "Kein Produkt im Pack: Typ bleibt unbelegt."));
    }
    if (z.tool === "measure" && unterlage?.kalibrierung) {
      if (kal.p1 && kal.p2) {
        const d = Math.hypot(kal.p2.x - kal.p1.x, kal.p2.y - kal.p1.y);
        p.append(row("Gemessen", meter(d, 3), "kal-gemessen"));
        p.append(feld("Tatsächlich", "", "kal-strecke", kalibrieren));
      } else p.append(el("div", "note", kal.p1 ? "Zweiten Punkt klicken." : "Ersten Punkt klicken."));
    }
    if (z.entwurf.length > 0) p.append(row("Punkte", String(z.entwurf.length), "entwurf"));
    if (z.hinweis) { const h = el("div", "note warn", z.hinweis); h.setAttribute("role", "status"); p.append(h); }
  }

  /** Schritt 31: Vorschlag als Gullys übernehmen (ein Undo-Schritt), Ergebnis als Hinweis im Werkzeug-Panel. */
  function schlageVor(dachId: string) {
    const r = schlageAblaeufeVor(modell(), packs, { dachflaecheId: dachId });
    z = { ...z, hinweis: r.befunde.map((b) => b.meldung).join(" ") || null };
    ausfuehreBefehl(ablaeufeHinzufuegen(r.ablaeufe, standardTyp("gully")));
  }

  /** Live: vorhanden / soll / erforderliche OK je Anschluss (Schritt 45), aus computeAnschluesse. */
  function anschlussZeilen(p: HTMLElement, objektId: string) {
    if (!ergebnis) return;
    const liste = anschlussDatenCached(modell(), ergebnis).anschluesse;
    const x = liste.find((q) => q.objektId === objektId);
    if (!x) return;
    p.append(row("OK fertig max", `${zahl(x.okFertigMax, 3)} m`, "ok-fertig"),
      row("Anschlusshöhe vorhanden", mm(x.vorhanden), "ah-vorhanden"),
      row("Anschlusshöhe soll", mm(x.soll), "ah-soll"),
      row("Erforderliche OK", x.erforderlicheOberkante === null ? "–" : `${zahl(x.erforderlicheOberkante, 3)} m`, "ah-erforderlich"));
    if (x.soll === null) p.append(el("div", "note warn", "Regel „anschlusshoehe“ fehlt im Pack."));
    else if (x.vorhanden !== null && x.vorhanden < x.soll - 1e-9) p.append(el("div", "note warn", `Zu niedrig: ${mm(x.vorhanden)} statt ${mm(x.soll)}.`));
  }
  function notZeilen(p: HTMLElement, objektId: string) {
    if (!ergebnis) return;
    const liste = anschlussDatenCached(modell(), ergebnis).notstaende;
    const x = liste.find((q) => q.objektId === objektId);
    if (!x) return;
    p.append(row("Kante (Pack)", x.kantePack === null ? "–" : `${zahl(x.kantePack, 3)} m`, "not-kante-pack"),
      row("Kante wirksam", x.kante === null ? "–" : `${zahl(x.kante, 3)} m${x.kanteQuelle === "nutzer" ? " (Nutzer)" : ""}`, "not-kante"),
      row("Überfallhöhe (Schätzung)", mm(x.ueberfallhoehe), "not-ueberfall"),
      row("Notwasserstand (Schätzung)", x.wasserstand === null ? "–" : `${zahl(x.wasserstand, 3)} m`, "not-wasser"));
  }
  /** Dachaufbau: drei Eingaben (Dämmstärke im Mittel, min. Tiefpunkt, max. Hochpunkt) + abgeleitete Höhen live. */
  function panelDachaufbau(p: HTMLElement, d: Dachflaeche) {
    const w = dachaufbauVon(d);
    const setze = (n: Partial<Record<keyof typeof w, number | undefined>>) => {
      const neu = { ...w, ...n };
      fuehreAus(setDachaufbau(d.id, { ...(neu.daemmMittel !== undefined ? { daemmMittel: neu.daemmMittel } : {}), ...(neu.minTiefpunkt !== undefined ? { minTiefpunkt: neu.minTiefpunkt } : {}), ...(neu.maxHochpunkt !== undefined ? { maxHochpunkt: neu.maxHochpunkt } : {}) }, ableitOpt()));
      refresh();
    };
    p.append(el("div", "panel-title", "Dachaufbau"),
      feldOpt("Dämmstärke im Mittel", w.daemmMittel, "daemm-mittel", (v) => setze({ daemmMittel: v === undefined || v < 0 ? undefined : v }), "aus", "mm", 0),
      feldOpt("Min. Tiefpunkt z", w.minTiefpunkt, "min-tiefpunkt", (v) => setze({ minTiefpunkt: v }), "aus"),
      feldOpt("Max. Hochpunkt z", w.maxHochpunkt, "max-hochpunkt", (v) => setze({ maxHochpunkt: v }), "keine Warnung"));
    const g = ergebnis?.slope.dachflaechen.find((x) => x.dachflaecheId === d.id);
    if (g?.tiefpunkt || g?.hochpunkt) {
      p.append(row("Tiefpunkt z", g.tiefpunkt ? `${zahl(g.tiefpunkt.kote, 3)} m` : "–", "hoehe-tief"), row("Hochpunkt z", g.hochpunkt ? `${zahl(g.hochpunkt.kote, 3)} m` : "–", "hoehe-hoch"));
      if (g.daemmung) p.append(row("Dämmung Tiefpunkt / Mittel / max.", `${zahl(g.daemmung.min, 0)} / ${zahl(g.daemmung.mittel, 0)} / ${zahl(g.daemmung.max, 0)} mm`, "daemm-werte"));
    }
  }
  function panelAuswahl() {
    const p = shell.panels.auswahl;
    p.replaceChildren();
    const a = auswahl;
    const d = a ? modell().dachflaechen.find((x) => x.id === a.dachId) : undefined;
    if (!a || !d) { p.append(el("div", "empty", "Nichts ausgewählt.")); return; }
    switch (a.art) {
      case "dach":
        p.append(row("Art", `Dachfläche ${d.name}`, "art"),
          row("Fläche", quadratmeter(konturFlaeche(d.kontur), 2), "flaeche"),
          row("Fläche netto", quadratmeter(dachNetto(d), 2), "netto"),
          row("Umfang", meter(konturUmfang(d.kontur), 2), "umfang"),
          row("Attika Länge", meter(attikaGesamtLaenge(d), 2), "attika-laenge"),
          row("Attika Fläche", quadratmeter(attikaGesamtFlaeche(d), 2), "attika-flaeche"));
        p.append(feldOpt("Belagdicke", d.belagDicke, "belag-dicke", (v) => { fuehreAus(setBelagDicke(d.id, null, v)); refresh(); }, "0"));
        panelDachaufbau(p, d);
        { const b = el("div", "pad"); b.append(button("Abläufe vorschlagen", () => schlageVor(d.id))); p.append(b); }
        break;
      case "aufbau": {
        const x = d.aufbauten.find((q) => q.id === a.id)!;
        p.append(row("Art", "Aufbau", "art"), row("Fläche", quadratmeter(aufbauFlaeche(x), 2), "flaeche"),
          feldOpt("OK Aufsetzkranz", x.oberkante, "oberkante", (v) => { fuehreAus(setAufbauOberkante(d.id, x.id, v)); refresh(); }, "nicht gesetzt"));
        anschlussZeilen(p, x.id);
        break;
      }
      case "zone": {
        const x = d.zonen.find((q) => q.id === a.id)!;
        p.append(row("Art", x.name, "art"), row("Fläche", quadratmeter(zonenFlaeche(x), 2), "flaeche"),
          feldOpt("Belagdicke", x.belagDicke, "belag-dicke", (v) => { fuehreAus(setBelagDicke(d.id, x.id, v)); refresh(); }, d.belagDicke === undefined ? "0" : zahl(d.belagDicke, 3)));
        break;
      }
      case "attika": {
        const x = d.attika.find((q) => q.id === a.id)!;
        p.append(row("Art", "Attika", "art"), row("Länge", meter(attikaLaenge(d, x), 2), "laenge"),
          feld("Breite", zahl(x.breite, 2), "breite", (v) => { if (v > 0) { fuehreAus(setAttikaBreite(d.id, x.id, v)); refresh(); } }),
          row("Fläche", quadratmeter(attikaSegmentFlaeche(d, x), 2), "flaeche"),
          feldOpt("OK Attika", x.oberkante, "oberkante", (v) => { fuehreAus(setAttikaOberkante(d.id, x.id, v)); refresh(); }, "nicht gesetzt"));
        anschlussZeilen(p, x.id);
        break;
      }
      case "tuerschwelle": {
        const x = d.tuerschwellen.find((q) => q.id === a.id)!;
        p.append(row("Art", "Türschwelle", "art"),
          feld("Breite", zahl(x.breite, 2), "breite", (v) => { if (v > 0) { fuehreAus(setTuerschwelleBreite(d.id, x.id, v)); refresh(); } }),
          row("Abstand", meter(x.lage.abstand, 2), "abstand"),
          feldOpt("OK Schwelle", x.oberkante, "oberkante", (v) => { fuehreAus(setTuerschwelleOberkante(d.id, x.id, v)); refresh(); }, "nicht gesetzt"));
        { const f = el("label", "check-row"), c = el("input"); c.type = "checkbox"; c.checked = !!x.rinne; c.dataset.k = "rinne"; c.id = "f-rinne";
          c.addEventListener("change", () => { fuehreAus(setTuerschwelleRinne(d.id, x.id, c.checked)); refresh(); });
          f.append(c, document.createTextNode(" Rinne vor Tür")); p.append(f); }
        anschlussZeilen(p, x.id);
        break;
      }
      case "wandanschluss": {
        const x = (d.wandanschluesse ?? []).find((q) => q.id === a.id)!;
        p.append(row("Art", x.name, "art"),
          feld("Länge", zahl(x.laenge, 2), "laenge", (v) => { if (v > 0) { fuehreAus(setWandanschlussLaenge(d.id, x.id, v)); refresh(); } }),
          row("Abstand", meter(x.lage.abstand, 2), "abstand"),
          feldOpt("OK Anschluss", x.oberkante, "oberkante", (v) => { fuehreAus(setWandanschlussOberkante(d.id, x.id, v)); refresh(); }, "nicht gesetzt"));
        anschlussZeilen(p, x.id);
        break;
      }
      case "entwaesserung": {
        const x = d.entwaesserung.find((q) => q.id === a.id)!;
        const art = { gully: "Gully", notablauf: "Notablauf", dachreiter: "Dachreiter", les: "Linienentwässerung" }[x.art];
        const eid = ergebnis?.eids.get(`${d.id}/${x.id}`);
        p.append(row("Art", eid ? `${art} (${eid})` : art, "art"),
          feld("Tiefenlage z", zahl(x.z, 3), "z", (v) => { fuehreAus(setEntwaesserungZ(d.id, x.id, v)); refresh(); }));
        if (x.art === "notablauf" || x.art === "dachreiter") {
          p.append(feldOpt("Überlaufkante über z [m]", x.ueberlaufKante, "ueberlauf-kante", (v) => { fuehreAus(setUeberlaufKante(d.id, x.id, v)); refresh(); }, "Pack-Wert"));
          notZeilen(p, x.id);
        }
        const opt = typOptionen(x.art);
        if (opt.length) {
          const f = el("div", "field"), l = el("label", "", "Produkt"), sel = el("select");
          sel.id = "f-typ"; l.htmlFor = sel.id;
          const leer = el("option", "", "– nicht gewählt –"); leer.value = ""; sel.append(leer);
          for (const o of opt) { const op = el("option", "", o.titel); op.value = o.wahl.eintragId; sel.append(op); }
          sel.value = x.typ?.eintragId ?? "";
          sel.addEventListener("change", () => { fuehreAus(setEntwaesserungTyp(d.id, x.id, opt.find((o) => o.wahl.eintragId === sel.value)?.wahl ?? null)); refresh(); });
          f.append(l, sel); p.append(f);
        } else p.append(el("div", "note", "Kein Produkt im Pack verfügbar."));
        if (x.art === "gully") {
          const f = el("div", "field"), l = el("label", "", "Verbunden mit"), sel = el("select");
          sel.id = "f-verbunden"; l.htmlFor = sel.id;
          const keine = el("option", "", "keine"); keine.value = ""; sel.append(keine);
          for (const o of d.entwaesserung) {
            if (o.art !== "gully" || o.id === x.id) continue;
            const op = el("option", "", o.name || o.id); op.value = o.id; sel.append(op);
          }
          sel.value = x.verbundenMit ?? "";
          sel.addEventListener("change", () => { fuehreAus(setGullyVerbindung(d.id, x.id, sel.value || null)); refresh(); });
          f.append(l, sel); p.append(f);
        }
        break;
      }
    }
    const b = el("div", "pad"); b.append(button("Löschen", loescheAuswahl)); p.append(b);
  }

  let ansicht: "gefaelle" | "daemmplan" = "gefaelle";
  let zeigeAnschluesse = true;
  let plan: InsulationLayout | null = null, planFuer: Ergebnis | null = null;
  const ansicht3d = new Ansicht3D(shell.stage);
  new MutationObserver(() => stage.invalidate()).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  shell.onAnsicht((a) => { ansicht = a; ansicht3d.setzeModus(a === "daemmplan" ? "daemmplan" : "flaeche"); stage.invalidate(); });
  let ist3d = false;
  function aktualisiere3d() {
    if (!ist3d) return;
    if (ergebnis && planFuer !== ergebnis) { planFuer = ergebnis; try { plan = berechnePlan(modell(), ergebnis.slope); } catch { plan = null; } }
    ansicht3d.daten(ergebnis?.slope ?? null, ergebnis ? plan : null);
  }
  shell.onModus((m) => { ist3d = m === "3d"; ansicht3d.zeigen(ist3d); aktualisiere3d(); });
  const api: Editor = { beiAenderung: null } as unknown as Editor;
  /** Schalter der Ebene „Anschlüsse“ am Ende des Ergebnis-Panels. */
  function ebenenSchalter() {
    const lab = el("label", "check-row"), cb = el("input");
    cb.type = "checkbox"; cb.checked = zeigeAnschluesse; cb.id = "ebene-anschluesse"; cb.dataset.k = "ebene-anschluesse";
    cb.addEventListener("change", () => { zeigeAnschluesse = cb.checked; stage.invalidate(); });
    lab.append(cb, el("span", "", "Ebene „Anschlüsse“"));
    shell.panels.ergebnis.append(lab);
  }
  function refresh() {
    queueMicrotask(() => api.beiAenderung?.());
    shell.undo.disabled = !kannRueckgaengig(verlauf);
    shell.redo.disabled = !kannWiederholen(verlauf);
    if (ergebnisFuer !== modell()) {
      ergebnisFuer = modell();
      try { ergebnis = modell().dachflaechen.length ? berechneGemerkt(modell()) : null; ergebnisFehler = null; }
      catch (e) { ergebnis = null; ergebnisFehler = e instanceof Error ? e.message : String(e); }
      speichere();
    }
    shell.status.projekt.textContent = [variantenListe(aktuellesProjekt()).length > 1 ? `Variante: ${variantenListe(aktuellesProjekt()).find((x) => x.aktiv)?.name ?? ""}` : "", geaendertSchnell() ? "ungespeichert" : "", projektMeldung ?? ""].filter(Boolean).join(" · ");
    berechneAbweichungen();
    panelEbenen(); panelUnterlage(); panelWerkzeug(); panelAuswahl();
    lebendigerDialog?.();
    if (standortFuer !== modell().standort) { standortFuer = modell().standort; standortPanel?.render(); }
    if (ergebnisFehler) { shell.panels.pruefliste.replaceChildren(el("div", "note error", `Berechnung fehlgeschlagen: ${ergebnisFehler}`)); shell.panels.ergebnis.replaceChildren(); }
    else { fuellePruefliste(shell.panels.pruefliste, modell(), ergebnis, (z) => { if (z.auswahl) { auswahl = z.auswahl; } if (z.mitte) stage.centerOn(z.mitte.x, z.mitte.y); refresh(); }); fuelleErgebnis(shell.panels.ergebnis, modell(), ergebnis ?? leeresErgebnis); ebenenSchalter(); }
    shell.status.snap.textContent = treffer ? `Fang: ${FANG_NAME[treffer.art]}` : zeichnetMitFang() ? "Fang: bereit" : "Fang: aus";
    stage.invalidate();
    aktualisiere3d();
  }

  // ---------- Zeichnung ----------
  const text = (ctx: CanvasRenderingContext2D, vp: Viewport, s: string, x: number, y: number, px = 11, color = "--text-muted") => {
    ctx.save();
    ctx.translate(x, y); ctx.scale(1 / vp.scale, -1 / vp.scale);
    ctx.font = `${px}px ${css("--font-ui", "sans-serif")}`; ctx.fillStyle = css(color, "#555");
    ctx.fillText(s, 0, 0);
    ctx.restore();
  };
  const bahn = (ctx: CanvasRenderingContext2D, pts: readonly Vec2[], zu = true) => {
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    if (zu) ctx.closePath();
  };

  function zeichneKontur(ctx: CanvasRenderingContext2D, vp: Viewport) {
    const px = 1 / vp.scale;
    ctx.lineJoin = "miter";
    for (const d of modell().dachflaechen) {
      for (const zn of d.zonen) {
        bahn(ctx, zn.kontur);
        ctx.globalAlpha = .12; ctx.fillStyle = css("--line-strong", "#999"); ctx.fill();
        ctx.globalAlpha = 1; ctx.strokeStyle = css("--line-strong", "#999"); ctx.lineWidth = px; ctx.stroke();
        const c = zn.kontur.reduce((s, q) => ({ x: s.x + q.x / zn.kontur.length, y: s.y + q.y / zn.kontur.length }), { x: 0, y: 0 });
        text(ctx, vp, zn.name, c.x, c.y);
      }
      {
        // Streifen immer außen an der Kante (attikaStreifen); ein gemeinsamer Pfad, damit sich die Füllung an Gehrungsnähten nicht überlagert.
        const qs = d.attika.map((s) => attikaStreifen(d, s)).filter((q) => q.length >= 4);
        if (qs.length) {
          ctx.beginPath();
          for (const q of qs) { ctx.moveTo(q[0]!.x, q[0]!.y); for (const pt of q.slice(1)) ctx.lineTo(pt.x, pt.y); ctx.closePath(); }
          ctx.globalAlpha = .25; ctx.fillStyle = css("--text", "#222"); ctx.fill("nonzero");
          ctx.globalAlpha = 1; ctx.strokeStyle = css("--text", "#222"); ctx.lineWidth = px;
          for (const q of qs) { bahn(ctx, [q[3]!, q[2]!], false); ctx.stroke(); }
        }
      }
      for (const au of d.aufbauten) {
        bahn(ctx, au.kontur);
        ctx.globalAlpha = 1; ctx.strokeStyle = css("--text", "#222"); ctx.lineWidth = px; ctx.stroke();
        const k = au.kontur;
        ctx.beginPath();
        for (const [i, j] of [[0, 2], [1, 3]] as const) if (k[j] && k[i]) { ctx.moveTo(k[i]!.x, k[i]!.y); ctx.lineTo(k[j]!.x, k[j]!.y); }
        ctx.stroke();
      }
      bahn(ctx, d.kontur);
      ctx.globalAlpha = 1; ctx.strokeStyle = css("--text", "#222"); ctx.lineWidth = 1.5 * px; ctx.stroke();
    }
  }

  function zeichneSymbole(ctx: CanvasRenderingContext2D, vp: Viewport) {
    const px = 1 / vp.scale;
    const belegung = geteilteBelegung(vp);
    for (const d of modell().dachflaechen) {
      for (const e of d.entwaesserung) zeichneEntwaesserung(ctx, vp, d, e, belegung, ergebnis?.eids.get(`${d.id}/${e.id}`), ansicht === "gefaelle");
      for (const t of [...d.tuerschwellen.map((x) => ({ lage: x.lage, breite: x.breite })), ...(d.wandanschluesse ?? []).map((x) => ({ lage: x.lage, breite: x.laenge }))]) {
        const i = d.kontur.findIndex((q) => q.id === t.lage.kante);
        if (i < 0) continue;
        const a = d.kontur[i]!, b = d.kontur[(i + 1) % d.kontur.length]!;
        const l = Math.hypot(b.x - a.x, b.y - a.y);
        if (l <= 0) continue;
        const ux = (b.x - a.x) / l, uy = (b.y - a.y) / l;
        const p0 = { x: a.x + ux * t.lage.abstand, y: a.y + uy * t.lage.abstand };
        const p1 = { x: p0.x + ux * t.breite, y: p0.y + uy * t.breite };
        ctx.strokeStyle = css("--accent", "#1F4FA3"); ctx.lineWidth = 3 * px; ctx.lineCap = "butt";
        bahn(ctx, [p0, p1], false); ctx.stroke();
      }
    }
  }

  function zeichneAuswahl(ctx: CanvasRenderingContext2D, vp: Viewport) {
    const a = auswahl;
    const d = a ? modell().dachflaechen.find((x) => x.id === a.dachId) : undefined;
    if (!a || !d) return;
    const px = 1 / vp.scale;
    ctx.strokeStyle = css("--accent", "#1F4FA3"); ctx.lineWidth = 2 * px; ctx.setLineDash([]);
    if (a.art === "dach") bahn(ctx, d.kontur);
    else if (a.art === "aufbau") bahn(ctx, d.aufbauten.find((x) => x.id === a.id)?.kontur ?? []);
    else if (a.art === "zone") bahn(ctx, d.zonen.find((x) => x.id === a.id)?.kontur ?? []);
    else if (a.art === "attika") {
      const s = d.attika.find((x) => x.id === a.id);
      const i = d.kontur.findIndex((q) => q.id === s?.kante);
      if (i < 0) return;
      bahn(ctx, [d.kontur[i]!, d.kontur[(i + 1) % d.kontur.length]!], false);
    } else if (a.art === "entwaesserung") {
      const e = d.entwaesserung.find((x) => x.id === a.id);
      if (!e) return;
      const [p0, p1] = entwSegment(d, e);
      const pt = p0 ?? (e.art === "dachreiter" ? kantenLage(d, e.lage.kante, e.lage.abstand)?.p : undefined);
      if (!pt) return;
      ctx.beginPath();
      if (p1) { ctx.moveTo(pt.x, pt.y); ctx.lineTo(p1.x, p1.y); ctx.lineWidth = 4 * px; } else ctx.arc(pt.x, pt.y, 11 * px, 0, Math.PI * 2);
    } else {
      const ts = d.tuerschwellen.find((x) => x.id === a.id), wa = (d.wandanschluesse ?? []).find((x) => x.id === a.id);
      const t = ts ? { lage: ts.lage, breite: ts.breite } : wa ? { lage: wa.lage, breite: wa.laenge } : undefined;
      const i = d.kontur.findIndex((q) => q.id === t?.lage.kante);
      if (!t || i < 0) return;
      const p = d.kontur[i]!, q = d.kontur[(i + 1) % d.kontur.length]!;
      const l = Math.hypot(q.x - p.x, q.y - p.y);
      const ux = (q.x - p.x) / l, uy = (q.y - p.y) / l;
      bahn(ctx, [{ x: p.x + ux * t.lage.abstand, y: p.y + uy * t.lage.abstand },
        { x: p.x + ux * (t.lage.abstand + t.breite), y: p.y + uy * (t.lage.abstand + t.breite) }], false);
      ctx.lineWidth = 4 * px;
    }
    ctx.stroke();
  }

  function marker(ctx: CanvasRenderingContext2D, vp: Viewport, t: SnapTreffer, ref?: Vec2) {
    const px = 1 / vp.scale, h = 4.5 * px, { x, y } = t.punkt;
    const farbe = css("--snap", "#D4007A");
    ctx.strokeStyle = farbe; ctx.lineWidth = 1.5 * px; ctx.setLineDash([]);
    if ((t.art === "lot" || t.art === "ortho") && ref) {
      ctx.save(); ctx.globalAlpha = .6; ctx.setLineDash([4 * px, 4 * px]);
      bahn(ctx, [ref, t.punkt], false); ctx.stroke(); ctx.restore();
    }
    ctx.beginPath();
    switch (t.art) {
      case "endpunkt": ctx.rect(x - h, y - h, 2 * h, 2 * h); break;
      case "mittelpunkt": ctx.moveTo(x - h, y - h); ctx.lineTo(x + h, y - h); ctx.lineTo(x, y + h); ctx.closePath(); break;
      case "schnittpunkt": ctx.moveTo(x - h, y - h); ctx.lineTo(x + h, y + h); ctx.moveTo(x - h, y + h); ctx.lineTo(x + h, y - h); break;
      case "lot": ctx.moveTo(x - h, y - h); ctx.lineTo(x - h, y + h * 0.2); ctx.lineTo(x + h * 0.2, y + h * 0.2); ctx.moveTo(x - h, y - h); ctx.lineTo(x + h, y - h); break;
      case "ortho": ctx.moveTo(x - h, y); ctx.lineTo(x + h, y); ctx.moveTo(x, y - h); ctx.lineTo(x, y + h); break;
    }
    ctx.stroke();
    ctx.save(); text(ctx, vp, FANG_NAME[t.art], x + 8 * px, y + 8 * px, 11, "--snap"); ctx.restore();
  }

  function zeichneFang(ctx: CanvasRenderingContext2D, vp: Viewport) {
    const px = 1 / vp.scale;
    const farbe = css("--snap", "#D4007A");
    if (z.entwurf.length > 0) {
      ctx.strokeStyle = css("--text", "#222"); ctx.lineWidth = 1.5 * px;
      const pts = cursor && zeichnetMitFang() ? [...z.entwurf, treffer?.punkt ?? ausricht?.punkt ?? cursor] : z.entwurf;
      bahn(ctx, pts, false); ctx.stroke();
      if (z.entwurf.length >= 2) { ctx.save(); ctx.setLineDash([4 * px, 4 * px]); ctx.globalAlpha = .6; bahn(ctx, [pts[pts.length - 1]!, pts[0]!], false); ctx.stroke(); ctx.restore(); }
      for (const p of z.entwurf) { ctx.fillStyle = css("--text", "#222"); ctx.fillRect(p.x - 2.5 * px, p.y - 2.5 * px, 5 * px, 5 * px); }
    }
    if (z.tool === "trennen" && z.entwurf.length === 1 && cursor) zeichneTrennVorschau(ctx, px, z.entwurf[0]!, treffer?.punkt ?? ausricht?.punkt ?? cursor);
    if (z.tool === "measure" && kal.p1) {
      const q = kal.p2 ?? treffer?.punkt ?? cursor;
      if (q) { ctx.strokeStyle = farbe; ctx.lineWidth = 1.5 * px; bahn(ctx, [kal.p1, q], false); ctx.stroke(); }
    }
    if (kante && (z.tool === "attika" || z.tool === "schwelle" || z.tool === "wandanschluss" || z.tool === "dachreiter")) {
      const d = modell().dachflaechen.find((x) => x.id === kante!.dachId)!;
      const i = d.kontur.findIndex((q) => q.id === kante!.kante);
      ctx.strokeStyle = farbe; ctx.lineWidth = 3 * px; ctx.globalAlpha = .7;
      bahn(ctx, [d.kontur[i]!, d.kontur[(i + 1) % d.kontur.length]!], false); ctx.stroke(); ctx.globalAlpha = 1;
      marker(ctx, vp, { art: "mittelpunkt", punkt: kante.punkt, segmente: [], abstand: kante.distanz });
    }
    if (treffer) marker(ctx, vp, treffer, refPunkt());
    zeichneSpuren(ctx, vp);
    zeichneWinkel(ctx, vp);
  }

  /** Vorschau des Trennstreifens (auf die Dachfläche begrenzt). */
  function zeichneTrennVorschau(ctx: CanvasRenderingContext2D, px: number, a: Vec2, b: Vec2) {
    const m = modell();
    const d = dachAn(m, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }) ?? dachAn(m, a);
    const s = d && trennStreifen(d, a, b, z.trennBreite);
    if (!d || !s) return;
    ctx.save();
    ctx.fillStyle = css("--accent", "#0B6E99"); ctx.strokeStyle = css("--accent", "#0B6E99"); ctx.lineWidth = 1.5 * px;
    for (const q of intersection([{ outer: d.kontur, holes: [] }], [{ outer: s, holes: [] }])) {
      ctx.globalAlpha = .3; bahn(ctx, q.outer); ctx.fill();
      ctx.globalAlpha = .9; bahn(ctx, q.outer); ctx.stroke();
    }
    ctx.restore();
  }

  /** Erfasste Punkte (Kreuz) und Hilfslinien der wirkenden Ausrichtung. */
  function zeichneSpuren(ctx: CanvasRenderingContext2D, vp: Viewport) {
    if (!zeichnetMitFang()) return;
    const px = 1 / vp.scale, farbe = css("--snap", "#D4007A"), h = 5 * px;
    ctx.save(); ctx.strokeStyle = farbe; ctx.lineWidth = 1.5 * px; ctx.setLineDash([]);
    for (const p of erfasst) { ctx.beginPath(); ctx.moveTo(p.x - h, p.y); ctx.lineTo(p.x + h, p.y); ctx.moveTo(p.x, p.y - h); ctx.lineTo(p.x, p.y + h); ctx.stroke(); }
    if (ausricht) {
      ctx.globalAlpha = .7; ctx.setLineDash([5 * px, 4 * px]); ctx.lineWidth = 1 * px;
      const q = ausricht.punkt, ueber = 24 * px;
      for (const sp of ausricht.spuren) {
        const dx = sp.richtung === "y" ? Math.sign(q.x - sp.von.x) || 1 : 0, dy = sp.richtung === "x" ? Math.sign(q.y - sp.von.y) || 1 : 0;
        bahn(ctx, [sp.von, { x: q.x + dx * ueber, y: q.y + dy * ueber }], false); ctx.stroke();
      }
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.arc(q.x, q.y, 4 * px, 0, Math.PI * 2); ctx.stroke();
      text(ctx, vp, FANG_NAME.ausrichtung, q.x + 8 * px, q.y + 8 * px, 11, "--snap");
    }
    ctx.restore();
  }

  /** Winkel ≠ 90° anzeigen: beim Zeichnen am letzten Punkt, sonst an den Ecken der gewählten Dachfläche. */
  function zeichneWinkel(ctx: CanvasRenderingContext2D, vp: Viewport) {
    const px = 1 / vp.scale, abw = (w: number) => Number.isFinite(w) && Math.abs(w - 90) > 0.05;
    const beschrifte = (w: number, s: Vec2, richtung: Vec2) => {
      const l = Math.hypot(richtung.x, richtung.y) || 1;
      text(ctx, vp, `${zahl(w, 1)}°`, s.x + (richtung.x / l) * 26 * px - 10 * px, s.y + (richtung.y / l) * 26 * px - 4 * px, 11, "--accent");
    };
    const n = z.entwurf.length;
    if (n >= 1 && cursor && zeichnetMitFang()) {
      const q = treffer?.punkt ?? ausricht?.punkt ?? cursor, s = z.entwurf[n - 1]!;
      if (n >= 2) {
        const a = z.entwurf[n - 2]!, w = winkelGrad(a, s, q);
        if (abw(w)) beschrifte(w, s, { x: (a.x - s.x) / (Math.hypot(a.x - s.x, a.y - s.y) || 1) + (q.x - s.x) / (Math.hypot(q.x - s.x, q.y - s.y) || 1), y: (a.y - s.y) / (Math.hypot(a.x - s.x, a.y - s.y) || 1) + (q.y - s.y) / (Math.hypot(q.x - s.x, q.y - s.y) || 1) });
      }
      return;
    }
    const d = auswahl ? modell().dachflaechen.find((x) => x.id === auswahl!.dachId) : undefined;
    if (!d || z.tool !== "select") return;
    const k = d.kontur, m = k.length;
    for (let i = 0; i < m; i++) {
      const a = k[(i + m - 1) % m]!, s = k[i]!, b = k[(i + 1) % m]!;
      let w = winkelGrad(a, s, b);
      if (!Number.isFinite(w)) continue;
      const ua = Math.hypot(a.x - s.x, a.y - s.y), ub = Math.hypot(b.x - s.x, b.y - s.y);
      let r = { x: (a.x - s.x) / ua + (b.x - s.x) / ub, y: (a.y - s.y) / ua + (b.y - s.y) / ub };
      const probe = { x: s.x + r.x * 1e-4, y: s.y + r.y * 1e-4 };
      if (pointInPolygon(probe, { outer: k, holes: [] }) === "outside") { w = 360 - w; r = { x: -r.x, y: -r.y }; }
      if (abw(w) && Math.abs(w - 270) > 0.05) beschrifte(w, s, r);
    }
  }

  stage.onFrame(neuerDurchgang); // vor allen Ebenen: "daemmplan" liegt in LAYER_ORDER vor "kontur"
  stage.setLayer("kontur", zeichneKontur);
  stage.setLayer("einzugsflaechen", (ctx, vp) => { if (ergebnis && ansicht === "gefaelle") zeichneEinzugsflaechen(ctx, vp, modell(), ergebnis); });
  stage.setLayer("daemmplan", (ctx, vp) => {
    if (!ergebnis || ansicht !== "daemmplan") return;
    if (planFuer !== ergebnis) { planFuer = ergebnis; try { plan = berechnePlan(modell(), ergebnis.slope); } catch { plan = null; } }
    zeichneDaemmplan(ctx, vp, modell(), ergebnis.slope, plan);
  });
  stage.setLayer("pfeile", (ctx, vp) => { if (ergebnis && ansicht === "gefaelle") { zeichneFaltlinien(ctx, vp, ergebnis); zeichneFlaechenLabels(ctx, vp, modell(), ergebnis); zeichneNotbereich(ctx, vp, modell(), ergebnis); zeichnePfeile(ctx, vp, ergebnis); } });
  stage.setLayer("koten", (ctx, vp) => {
    if (!ergebnis || ansicht !== "gefaelle") return;
    zeichneKoten(ctx, vp, ergebnis);
    if (!zeigeAnschluesse) return;
    const ad = anschlussDatenCached(modell(), ergebnis);
    try { zeichneAnschluesse(ctx, vp, ad.anschluesse, ad.notstaende); } catch { /* Zeichnen fehlgeschlagen: Ebene entfällt */ }
  });
  stage.setLayer("symbole", zeichneSymbole);
  stage.setLayer("auswahl", zeichneAuswahl);
  stage.setLayer("fang", zeichneFang);

  // ---------- Ablauf ziehen (Schritt 49) ----------
  /** Aktiver Ziehvorgang: `basis` ist der Verlauf davor, jede Bewegung ersetzt den einen Undo-Schritt. */
  let ziehen: { basis: typeof verlauf; dachId: string; id: string; griff: LesGriff; versatz: Vec2; start: Vec2 } | null = null;
  function ziehTreffer(w: Vec2): { griff: LesGriff; versatz: Vec2 } | null {
    const a = auswahl;
    if (!a || a.art !== "entwaesserung" || z.tool !== "select") return null;
    const d = modell().dachflaechen.find((x) => x.id === a.dachId);
    const e = d?.entwaesserung.find((x) => x.id === a.id);
    if (!d || !e) return null;
    const [p0, p1] = entwSegment(d, e);
    const nah = (p: Vec2 | null) => !!p && Math.hypot(p.x - w.x, p.y - w.y) <= Math.max(tol(), 12 / stage.viewport.scale);
    if (e.art === "les" && p0 && p1) {
      for (const [g, p] of [["von", p0], ["bis", p1]] as const) if (nah(p)) return { griff: g, versatz: { x: p.x - w.x, y: p.y - w.y } };
      const m = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
      if (nah(m)) return { griff: "mitte", versatz: { x: m.x - w.x, y: m.y - w.y } };
      return null;
    }
    if (nah(p0)) return { griff: "mitte", versatz: { x: p0!.x - w.x, y: p0!.y - w.y } };
    return null;
  }
  function ziehAnwenden(w: Vec2) {
    const zi = ziehen;
    if (!zi) return;
    const roh = { x: w.x + zi.versatz.x, y: w.y + zi.versatz.y };
    const p = fangAuswerten(roh);
    treffer = p.treffer; ausricht = p.ausricht;
    const neu = ausfuehren(zi.basis, aufVariante(verschiebeEntwaesserung(zi.dachId, zi.id, p.punkt, zi.griff)));
    // Unverändert = Ausgangslage (zurückgezogen) oder ungültige Lage (letzte gültige bleibt stehen)
    if (neu !== zi.basis) { verlauf = neu; z = { ...z, hinweis: null }; }
    else if (Math.hypot(p.punkt.x - zi.start.x, p.punkt.y - zi.start.y) < 0.02) verlauf = neu;
    refresh();
  }
  function ziehAbbrechen() {
    if (!ziehen) return false;
    verlauf = ziehen.basis; ziehen = null; treffer = null; ausricht = null; refresh();
    return true;
  }

  // ---------- Eingaben ----------
  stage.onPointer({
    ziehStart(w) {
      const p = { x: w[0], y: w[1] }, t = ziehTreffer(p);
      if (!t || !auswahl) return false;
      ziehen = { basis: verlauf, dachId: auswahl.dachId, id: auswahl.id, griff: t.griff, versatz: t.versatz, start: { x: p.x + t.versatz.x, y: p.y + t.versatz.y } };
      stage.setCursor("grabbing");
      return true;
    },
    ziehBewegt(w) { ziehAnwenden({ x: w[0], y: w[1] }); },
    ziehEnde(w) { if (ziehen) { ziehAnwenden({ x: w[0], y: w[1] }); ziehen = null; treffer = null; ausricht = null; stage.setCursor(""); refresh(); } },
    move(w) {
      cursor = { x: w[0], y: w[1] };
      stage.setCursor(ziehTreffer(cursor) ? "grab" : "");
      treffer = null; kante = null; ausricht = null;
      if (zeichnetMitFang()) {
        if (z.tool === "attika" || z.tool === "schwelle" || z.tool === "wandanschluss" || z.tool === "dachreiter") kante = kantenTreffer(modell(), cursor, tol());
        else {
          const f = fangAuswerten(cursor);
          treffer = f.treffer; ausricht = f.ausricht;
          verweilen(f.treffer);
        }
      }
      if (!zeichnetMitFang() || kante) ausricht = null;
      shell.status.snap.textContent = treffer ? `Fang: ${FANG_NAME[treffer.art]}` : ausricht ? "Fang: Ausrichtung" : zeichnetMitFang() ? "Fang: bereit" : "Fang: aus";
      stage.invalidate();
    },
    click(w) {
      const p = gefangen({ x: w[0], y: w[1] });
      if (z.tool === "measure") {
        if (!unterlage?.kalibrierung) { meldung = null; z = { ...z, hinweis: "Zum Kalibrieren zuerst ein PDF laden." }; refresh(); return; }
        if (!kal.p1 || kal.p2) kal = { p1: p }; else if (Math.hypot(p.x - kal.p1.x, p.y - kal.p1.y) > 1e-6) kal = { ...kal, p2: p };
        refresh();
        return;
      }
      wende(klick(z, modell(), p, tol(), { typ: standardTyp }));
    },
    dblclick() { if (z.entwurf.length >= 3) wende(abschliessen(z, modell())); },
    leave() { cursor = null; treffer = null; kante = null; ausricht = null; if (verweil) { clearTimeout(verweil.timer); verweil = null; } stage.invalidate(); },
  });

  shell.onTool((id) => setzeWerkzeug(id as WerkzeugId));
  /** Schreibfelder behalten ihr eigenes Rückgängig; Regler, Haken und Knöpfe reichen Strg/⌘+Z an den Plan durch. */
  function istTextEingabe(t: EventTarget | null): boolean {
    if (!(t instanceof HTMLElement)) return false;
    if (t.isContentEditable || t.tagName === "TEXTAREA" || t.tagName === "SELECT") return true;
    if (t.tagName !== "INPUT") return false;
    return !/^(checkbox|radio|range|button|file|color)$/.test((t as HTMLInputElement).type);
  }
  shell.undo.addEventListener("click", undo);
  shell.redo.addEventListener("click", redo);
  window.addEventListener("keydown", (e) => {
    if (istTextEingabe(e.target)) return;
    const k = e.key.toLowerCase();
    if (e.ctrlKey || e.metaKey) {
      if (k === "n" && !e.shiftKey) { e.preventDefault(); void neuesProjekt(); return; }
      if (k === "s" && !e.shiftKey) { e.preventDefault(); void speichereProjekt(); return; }
      if (k === "o" && !e.shiftKey) { e.preventDefault(); void oeffneProjekt(); return; }
      if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(); } else if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); redo(); }
      return;
    }
    if (e.altKey) return;
    if (k === "enter") { if (z.entwurf.length) { e.preventDefault(); wende(abschliessen(z, modell())); } }
    else if (k === "escape") { if (ziehAbbrechen()) return; if (z.entwurf.length || kal.p1 || erfasst.length) { z = abbrechen(z); kal = {}; vergissErfasste(); refresh(); } else if (z.tool !== "select") setzeWerkzeug("select"); else setzeAuswahl(null); }
    else if (k === "backspace") { if (z.entwurf.length) { e.preventDefault(); z = entfernePunkt(z); refresh(); } }
    else if (k === "delete") loescheAuswahl();
    else if (TASTEN[k]) setzeWerkzeug(TASTEN[k]!);
  });

  /** Dialog mit einem bestehenden Panel-Element (bleibt lebendig, solange der Dialog offen ist). */
  function zeigePanel(titel: string, host: HTMLElement) {
    const inhalt = el("div", "pad dialog-panel"); inhalt.append(host);
    oeffneDialog({ titel, inhalt, knoepfe: [{ id: "ok", label: "Schließen", primaer: true }], abbruchId: "ok", breit: true });
  }
  /** Dialog, dessen Inhalt bei jeder Aktualisierung neu gebaut wird (Varianten, Einbetten). */
  function zeigeLebendig(titel: string, baue: () => HTMLElement) {
    const inhalt = el("div", "pad dialog-panel");
    const neu = () => inhalt.replaceChildren(baue());
    neu(); lebendigerDialog = neu;
    void oeffneDialog({ titel, inhalt, knoepfe: [{ id: "ok", label: "Schließen", primaer: true }], abbruchId: "ok", breit: true }).ergebnis.then(() => { if (lebendigerDialog === neu) lebendigerDialog = null; });
  }
  function aktion(id: string) {
    switch (id) {
      case "neu": return void neuesProjekt();
      case "oeffnen": return void oeffneProjekt();
      case "speichern": return void speichereProjekt();
      case "export-pdf": return void exportierePdf();
      case "export-dxf": return exportiereDxf();
      // Natives Menü fängt Cmd/Strg+Z ab: im Schreibfeld das Text-Undo des Feldes, sonst Plan-Undo.
      case "undo": return istTextEingabe(document.activeElement) ? void document.execCommand("undo") : undo();
      case "redo": return istTextEingabe(document.activeElement) ? void document.execCommand("redo") : redo();
      case "auswahl-loeschen": return loescheAuswahl();
      case "angaben": return void oeffneAngabenDialog(modell().meta, setzeAngaben);
      case "standort": return zeigePanel("Standort & Regenspende", shell.panels.standort);
      case "varianten": return zeigeLebendig("Varianten", blockVarianten);
      case "update": return zeigePanel("Softwareupdate", shell.panels.update);
      case "unterlage-laden": return void waehleUnterlageDatei();
      case "unterlage-einbetten": return zeigeLebendig("Unterlage einbetten", blockEinbetten);
      case "modus-2d": return shell.setModus("2d");
      case "modus-3d": return shell.setModus("3d");
      case "ansicht-gefaelle": return shell.setAnsicht("gefaelle");
      case "ansicht-daemmplan": return shell.setAnsicht("daemmplan");
      case "thema": return shell.toggleTheme();
    }
  }
  const ausfuehreBefehl = (b: Befehl) => { fuehreAus(b); refresh(); };
  standortPanel = mountStandort(shell.panels.standort, { modell, ausfuehre: ausfuehreBefehl });
  setzeWerkzeug("select");
  refresh();
  shell.onMenue(aktion);
  if (istTauri()) void hoereAufMenue(aktion);
  void schuetzeFenster(geaendert, () => darfVerwerfen("dem Schließen"));
  Object.defineProperties(api, {
    ausfuehre: { value: ausfuehreBefehl },
    aktion: { value: aktion },
    modell: { get: () => modell() },
    lade: { value: (m: ProjectModel) => { einbetten = false; verlauf = neuerVerlauf(projektAusModell(m)); markiereGespeichert(); auswahl = null; if (m.unterlage) offeneUnterlage = m.unterlage; refresh(); } },
    ladeProjekt: { value: (pr: Projekt) => { einbetten = false; verlauf = neuerVerlauf(pr); const wieder = modellFuerVariante(pr).dachflaechen.length > 0; gespeichertSchluessel = wieder ? "\u0000" : schluessel(); gespeichertStand = wieder ? null : pr; gespeichertEinbetten = einbetten; auswahl = null; const u = pr.unterlage; if (u) offeneUnterlage = u; uebernehmeAnsicht(pr.ansicht); refresh(); } },
    projekt: { get: () => aktuellesProjekt() },
    waehle: { value: setzeAuswahl },
  });
  return api;
}
