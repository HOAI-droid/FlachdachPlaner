/** UI-Steuerung der Bearbeitung (PLAN Schritte 15–17): Werkzeuge, Verlauf, Unterlage, Panels, Zeichnung. */
import {
  abbrechen, abschliessen, attikaGesamtFlaeche, attikaGesamtLaenge, attikaLaenge, attikaSegmentFlaeche, attikaUmlaufend,
  aufbauFlaeche, ausfuehren, ausPasspunkten, findeAbweichungen, TOLERANZ_STANDARD, uebernehmeVorschlaege, verschiebePunkte, createProject, createSnapIndex, dachNetto, entfernePunkt, faktor, kannRueckgaengig,
  kannWiederholen, kalibriereStrecke, kantenTreffer, klick, konturFlaeche, konturUmfang, loesche, neuerVerlauf,
  neuerZustand, nennerAusFaktor, nennerSetzen, projektSegmente, rueckgaengig, setAttikaBreite, setTuerschwelleBreite,
  setzeAttikaBreite, setzeSchwellenBreite, setzeAblaufZ, setEntwaesserungTyp, setEntwaesserungZ, serializeProject, snap, waehleWerkzeug, wiederholen, zonenFlaeche, zuPasspunkten, entwSegment,
  type Abweichung, type Auswahl, type Befehl, type InsulationLayout, type SnapSegment, type Dachflaeche, type KlickErgebnis, type ProjectModel, type SnapArt, type SnapIndex, type SnapTreffer,
  type Verlauf, type Vec2, type WerkzeugId, type WerkzeugZustand,
} from "../core/index";
import type { Stage } from "./canvas/stage";
import type { Viewport } from "./canvas/viewport";
import { Ansicht3D } from "./ansicht3d";
import { berechnePlan, zeichneDaemmplan } from "./daemmplan";
import { baueProjektPdf } from "../io/pdf/plan";
import { berechne, farbe, fuelleErgebnis, fuellePruefliste, zeichneEinzugsflaechen, zeichneKoten, zeichneNotbereich, zeichnePfeile, type Ergebnis } from "./ergebnis";
import { meter, quadratmeter, zahl } from "./format";
import { packs, standardTyp, typOptionen } from "./packs";
import { mountStandort } from "./standort";

import { kantenLage, zeichneEntwaesserung } from "./symbole";
import { Belegung } from "./zeichnen";
import type { Shell } from "./shell";
import { dxfModell, ladeDxf, ladePdf, pdfModell, type UnterlageUI } from "./underlay";
import { autosaveSchreiben, base64ZuBytes, bytesZuBase64, leseProjekt, speichereDatei, waehleDatei } from "./speicher";

const FANG_PX = 10;
const TASTEN: Record<string, WerkzeugId> = { v: "select", k: "contour", a: "attika", u: "aufbau", t: "terrasse", s: "schwelle", g: "gully", n: "notablauf", r: "dachreiter", l: "les", m: "measure" };
const FANG_NAME: Record<SnapArt, string> = { endpunkt: "Endpunkt", schnittpunkt: "Schnittpunkt", mittelpunkt: "Mittelpunkt", lot: "Lot", ortho: "Ortho" };
const HINWEIS: Record<WerkzeugId, string> = {
  select: "Objekt anklicken. Entf löscht die Auswahl.",
  contour: "Punkte klicken. Enter, Doppelklick oder Klick auf den Startpunkt schließt. Esc bricht ab, Rücktaste nimmt den letzten Punkt zurück.",
  attika: "Breite eingeben, dann Kanten der Dachkontur anklicken oder „Umlaufend“ wählen.",
  aufbau: "Punkte innerhalb einer Dachfläche klicken. Enter oder Doppelklick schließt.",
  terrasse: "Punkte innerhalb einer Dachfläche klicken. Enter oder Doppelklick schließt.",
  schwelle: "Auf eine Kante der Dachkontur klicken. Die Schwelle wird dort zentriert.",
  gully: "In die Dachfläche klicken. Tiefenlage z des Ablaufs unten eingeben.",
  notablauf: "In die Dachfläche klicken. Notablauf mit Tiefenlage z.",
  dachreiter: "Auf eine Kante der Dachkontur klicken. Der Dachreiter wird dort zentriert.",
  les: "Anfang (tiefer Punkt, z gilt dort) und Ende der Linienentwässerung klicken.",
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
function button(text: string, onClick: () => void, cls = "btn"): HTMLButtonElement {
  const b = el("button", cls, text);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

export interface Editor {
  readonly modell: ProjectModel;
  lade(m: ProjectModel): void;
  /** Befehl ausführen (Undo-fähig), z. B. aus dem Standort-Panel. */
  ausfuehre(b: Befehl): void;
  /** Wird nach jeder Aktualisierung aufgerufen (z. B. Update-Panel). */
  beiAenderung: (() => void) | null;
}


export function mountEditor(shell: Shell, stage: Stage): Editor {
  let verlauf: Verlauf = neuerVerlauf(createProject("Neues Projekt", new Date().toISOString()));
  let z: WerkzeugZustand = neuerZustand();
  let auswahl: Auswahl | null = null;
  let unterlage: UnterlageUI | null = null;
  let cursor: Vec2 | null = null;
  let treffer: SnapTreffer | null = null;
  let kante: ReturnType<typeof kantenTreffer> = null;
  let kal: { p1?: Vec2; p2?: Vec2 } = {};
  let meldung: string | null = null;
  /** Originalbytes der geladenen Unterlage (nur im Speicher; für optionales Einbetten). */
  let unterlageBytes: ArrayBuffer | null = null;
  let einbetten = false;
  /** Verweis aus geöffnetem Projekt, dessen Datei noch erneut gewählt werden muss. */
  let offeneUnterlage: ProjectModel["unterlage"] = null;
  let projektMeldung: string | null = null;
  /** Unterlagenwechsel (22a): alte Fangstrecken, Toleranz, bewusst belassene Punkte. */
  let tausch: { alt: SnapSegment[]; belassen: Set<string>; toleranz: number; pass: number[] } | null = null;
  let abweichungen: Abweichung[] = [];
  let index: SnapIndex | null = null;
  let indexKey: [ProjectModel, readonly unknown[]] | null = null;
  let ergebnis: Ergebnis | null = null;
  let ergebnisFuer: ProjectModel | null = null;
  let ergebnisFehler: string | null = null;
  let standortFuer: ProjectModel["standort"] | null = null;
  let standortPanel: ReturnType<typeof mountStandort> | null = null;
  const leeresErgebnis = { slope: { dachflaechen: [], hinweise: [] }, catchments: { flaechen: [], nachbarn: [], hinweise: [] }, notfall: [], befunde: [], hinweise: [], eids: new Map() } as unknown as Ergebnis;
  /** Autosave ins lokale Speichern (ohne Netz); Fehler (z. B. privater Modus) werden ignoriert. */
  function speichere() { void autosaveSchreiben(serializeProject(modell())); }

  const modell = () => verlauf.aktuell;
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
  function gefangen(w: Vec2): Vec2 {
    if (!zeichnetMitFang() || z.tool === "attika" || z.tool === "schwelle" || z.tool === "dachreiter") return w;
    const ref = refPunkt();
    const t = snap(fangIndex(), w, tol(), ref ? { referenzpunkt: ref } : {});
    return t ? t.punkt : w;
  }

  // ---------- Aktionen ----------
  function wende(r: KlickErgebnis) {
    z = r.zustand;
    if (r.befehl) {
      const alt = verlauf;
      verlauf = ausfuehren(verlauf, r.befehl);
      if (verlauf === alt) z = { ...z, hinweis: z.hinweis };
    }
    if (r.auswahl !== undefined) auswahl = r.auswahl;
    refresh();
  }
  function setzeWerkzeug(id: WerkzeugId) {
    z = waehleWerkzeug(z, id);
    kal = {}; meldung = null; treffer = null; kante = null;
    shell.setTool(id);
    stage.setCursor(id === "select" ? "" : "crosshair");
    refresh();
  }
  function setzeAuswahl(a: Auswahl | null) { auswahl = a; refresh(); }
  const undo = () => { verlauf = rueckgaengig(verlauf); pruefeAuswahl(); refresh(); };
  const redo = () => { verlauf = wiederholen(verlauf); pruefeAuswahl(); refresh(); };
  function pruefeAuswahl() {
    if (!auswahl) return;
    const d = modell().dachflaechen.find((x) => x.id === auswahl!.dachId);
    const ok = d && (auswahl.art === "dach" ||
      (auswahl.art === "aufbau" && d.aufbauten.some((x) => x.id === auswahl!.id)) ||
      (auswahl.art === "zone" && d.zonen.some((x) => x.id === auswahl!.id)) ||
      (auswahl.art === "attika" && d.attika.some((x) => x.id === auswahl!.id)) ||
      (auswahl.art === "tuerschwelle" && d.tuerschwellen.some((x) => x.id === auswahl!.id)) ||
      (auswahl.art === "entwaesserung" && d.entwaesserung.some((x) => x.id === auswahl!.id)));
    if (!ok) auswahl = null;
  }
  function loescheAuswahl() { if (auswahl) { verlauf = ausfuehren(verlauf, loesche(auswahl)); auswahl = null; refresh(); } }
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
    verlauf = { ...verlauf, aktuell: { ...verlauf.aktuell, unterlage: eintrag } };
  }
  async function ladeDatei(f: File) {
    try {
      meldung = null;
      const bytes = await f.arrayBuffer();
      const u = /\.pdf$/i.test(f.name) ? await ladePdf(f) : await ladeDxf(f);
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
      const u = /\.pdf$/i.test(f.name) ? await ladePdf(f) : await ladeDxf(f);
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
  function entferneUnterlage() { unterlage = null; unterlageBytes = null; offeneUnterlage = null; unterlageInsModell(); stage.setLayer("unterlage", null); kal = {}; refresh(); }
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
  function modellFuerDatei(): ProjectModel {
    const m = modell();
    if (einbetten && m.unterlage && unterlageBytes) return { ...m, unterlage: { ...m.unterlage, eingebettet: { base64: bytesZuBase64(unterlageBytes) } } };
    return m;
  }
  async function speichereProjekt() {
    const ok = await speichereDatei(serializeProject(modellFuerDatei()), modell().meta.name || "Projekt");
    projektMeldung = ok ? "Projekt gespeichert." : null;
    refresh();
  }
  async function oeffneText(text: string) {
    const r = leseProjekt(text);
    if (!r.ok) { projektMeldung = r.meldung; refresh(); return; }
    const u = r.projekt.unterlage;
    let m = r.projekt;
    if (u?.eingebettet) { const k: { eingebettet?: unknown } = { ...u }; delete k.eingebettet; m = { ...m, unterlage: k as NonNullable<ProjectModel["unterlage"]> }; }
    verlauf = neuerVerlauf(m); auswahl = null; unterlage = null; unterlageBytes = null; offeneUnterlage = null; stage.setLayer("unterlage", null);
    projektMeldung = r.hinweise.length ? r.hinweise.join(" ") : "Projekt geöffnet.";
    if (u?.eingebettet) {
      const bytes = base64ZuBytes(u.eingebettet.base64);
      offeneUnterlage = u;
      await ladeDatei(new File([bytes], u.dateiname));
      einbetten = true;
    } else if (u) { offeneUnterlage = u; projektMeldung += ` Unterlage „${u.dateiname}“ ist nur verknüpft: bitte Datei erneut wählen.`; }
    refresh();
  }
  async function oeffneProjekt() {
    const f = await waehleDatei();
    if (f) await oeffneText(await f.text());
  }
  function exportierePdf() {
    if (!ergebnis) { projektMeldung = "PDF-Export: erst eine Dachfläche zeichnen."; refresh(); return; }
    try {
      let p = null;
      try { p = berechnePlan(modell(), ergebnis.slope); } catch { /* ohne Dämmplan */ }
      const regeln = packs.find((x) => x.typ === "regeln");
      const heute = new Date();
      const r = baueProjektPdf({
        modell: modell(), slope: ergebnis.slope, catchments: ergebnis.catchments, eids: ergebnis.eids, plan: p, farbe: (i) => farbe(i)[0],
        datum: `${String(heute.getDate()).padStart(2, "0")}.${String(heute.getMonth() + 1).padStart(2, "0")}.${heute.getFullYear()}`,
        regelwerk: regeln ? `${regeln.titel ?? regeln.id} · ${regeln.version}` : "–",
      });
      const url = URL.createObjectURL(new Blob([r.bytes as BlobPart], { type: "application/pdf" }));
      const a = document.createElement("a"); a.href = url; a.download = `${modell().meta.name || "Projekt"}-Plan.pdf`; document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      projektMeldung = `PDF erstellt (A3, Maßstab 1 : ${r.massstab}).`;
    } catch (e) { projektMeldung = `PDF-Export fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`; }
    refresh();
  }

  function panelProjekt() {
    const p = shell.panels.projekt;
    p.querySelector(".projekt-datei")?.remove();
    const box = el("div", "pad projekt-datei");
    const wahl = el("input");
    wahl.type = "file"; wahl.accept = ".fdp,application/json"; wahl.id = "f-projekt"; wahl.setAttribute("aria-label", "Projektdatei öffnen");
    wahl.className = "visually-hidden"; wahl.tabIndex = -1;
    wahl.addEventListener("change", () => { const f = wahl.files?.[0]; wahl.value = ""; if (f) void f.text().then(oeffneText); });
    const zeile = el("div", "btn-row");
    zeile.append(button("Projekt speichern", () => void speichereProjekt()), button("Plan als PDF", exportierePdf), button("Projekt öffnen …", () => { if ((window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker) void oeffneProjekt(); else wahl.click(); }));
    const lab = el("label", "check-row");
    const cb = el("input"); cb.type = "checkbox"; cb.checked = einbetten; cb.dataset.k = "einbetten"; cb.disabled = !unterlage;
    cb.addEventListener("change", () => { einbetten = cb.checked; });
    lab.append(cb, el("span", "", "Unterlage in Projektdatei einbetten"));
    box.append(zeile, lab, wahl);
    if (projektMeldung) { const n = el("div", "note", projektMeldung); n.dataset.k = "projekt-meldung"; n.setAttribute("role", "status"); box.append(n); }
    p.append(box);
  }

  // ---------- Panels ----------
  function panelUnterlage() {
    const p = shell.panels.unterlage;
    p.replaceChildren();
    const wahl = el("input");
    wahl.type = "file"; wahl.accept = ".dxf,.pdf,application/pdf"; wahl.id = "f-unterlage"; wahl.setAttribute("aria-label", "Unterlage laden (DXF oder PDF)");
    wahl.addEventListener("change", () => { const f = wahl.files?.[0]; if (f) void ladeDatei(f); });
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
        break;
      case "aufbau": {
        const x = d.aufbauten.find((q) => q.id === a.id)!;
        p.append(row("Art", "Aufbau", "art"), row("Fläche", quadratmeter(aufbauFlaeche(x), 2), "flaeche"));
        break;
      }
      case "zone": {
        const x = d.zonen.find((q) => q.id === a.id)!;
        p.append(row("Art", x.name, "art"), row("Fläche", quadratmeter(zonenFlaeche(x), 2), "flaeche"));
        break;
      }
      case "attika": {
        const x = d.attika.find((q) => q.id === a.id)!;
        p.append(row("Art", "Attika", "art"), row("Länge", meter(attikaLaenge(d, x), 2), "laenge"),
          feld("Breite", zahl(x.breite, 2), "breite", (v) => { if (v > 0) { verlauf = ausfuehren(verlauf, setAttikaBreite(d.id, x.id, v)); refresh(); } }),
          row("Fläche", quadratmeter(attikaSegmentFlaeche(d, x), 2), "flaeche"));
        break;
      }
      case "tuerschwelle": {
        const x = d.tuerschwellen.find((q) => q.id === a.id)!;
        p.append(row("Art", "Türschwelle", "art"),
          feld("Breite", zahl(x.breite, 2), "breite", (v) => { if (v > 0) { verlauf = ausfuehren(verlauf, setTuerschwelleBreite(d.id, x.id, v)); refresh(); } }),
          row("Abstand", meter(x.lage.abstand, 2), "abstand"));
        break;
      }
      case "entwaesserung": {
        const x = d.entwaesserung.find((q) => q.id === a.id)!;
        const art = { gully: "Gully", notablauf: "Notablauf", dachreiter: "Dachreiter", les: "Linienentwässerung" }[x.art];
        const eid = ergebnis?.eids.get(`${d.id}/${x.id}`);
        p.append(row("Art", eid ? `${art} (${eid})` : art, "art"),
          feld("Tiefenlage z", zahl(x.z, 3), "z", (v) => { verlauf = ausfuehren(verlauf, setEntwaesserungZ(d.id, x.id, v)); refresh(); }));
        const opt = typOptionen(x.art);
        if (opt.length) {
          const f = el("div", "field"), l = el("label", "", "Produkt"), sel = el("select");
          sel.id = "f-typ"; l.htmlFor = sel.id;
          const leer = el("option", "", "– nicht gewählt –"); leer.value = ""; sel.append(leer);
          for (const o of opt) { const op = el("option", "", o.titel); op.value = o.wahl.eintragId; sel.append(op); }
          sel.value = x.typ?.eintragId ?? "";
          sel.addEventListener("change", () => { verlauf = ausfuehren(verlauf, setEntwaesserungTyp(d.id, x.id, opt.find((o) => o.wahl.eintragId === sel.value)?.wahl ?? null)); refresh(); });
          f.append(l, sel); p.append(f);
        } else p.append(el("div", "note", "Kein Produkt im Pack verfügbar."));
        break;
      }
    }
    const b = el("div", "pad"); b.append(button("Löschen", loescheAuswahl)); p.append(b);
  }

  let ansicht: "gefaelle" | "daemmplan" = "gefaelle";
  let plan: InsulationLayout | null = null, planFuer: Ergebnis | null = null;
  shell.onAnsicht((a) => { ansicht = a; stage.invalidate(); });
  const ansicht3d = new Ansicht3D(shell.stage);
  let ist3d = false;
  function aktualisiere3d() {
    if (!ist3d) return;
    if (ergebnis && planFuer !== ergebnis) { planFuer = ergebnis; try { plan = berechnePlan(modell(), ergebnis.slope); } catch { plan = null; } }
    ansicht3d.daten(ergebnis?.slope ?? null, ergebnis ? plan : null);
  }
  shell.onModus((m) => { ist3d = m === "3d"; ansicht3d.zeigen(ist3d); aktualisiere3d(); });
  const api: Editor = { beiAenderung: null } as unknown as Editor;
  function refresh() {
    queueMicrotask(() => api.beiAenderung?.());
    shell.undo.disabled = !kannRueckgaengig(verlauf);
    shell.redo.disabled = !kannWiederholen(verlauf);
    if (ergebnisFuer !== modell()) {
      ergebnisFuer = modell();
      try { ergebnis = modell().dachflaechen.length ? berechne(modell()) : null; ergebnisFehler = null; }
      catch (e) { ergebnis = null; ergebnisFehler = e instanceof Error ? e.message : String(e); }
      speichere();
    }
    berechneAbweichungen();
    panelUnterlage(); panelWerkzeug(); panelAuswahl(); panelProjekt();
    if (standortFuer !== modell().standort) { standortFuer = modell().standort; standortPanel?.render(); }
    if (ergebnisFehler) { shell.panels.pruefliste.replaceChildren(el("div", "note error", `Berechnung fehlgeschlagen: ${ergebnisFehler}`)); shell.panels.ergebnis.replaceChildren(); }
    else { fuellePruefliste(shell.panels.pruefliste, modell(), ergebnis, (z) => { if (z.auswahl) { auswahl = z.auswahl; } if (z.mitte) stage.centerOn(z.mitte.x, z.mitte.y); refresh(); }); fuelleErgebnis(shell.panels.ergebnis, modell(), ergebnis ?? leeresErgebnis); }
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
  const ccw = (k: readonly Vec2[]) => k.reduce((s, p, i) => s + (k[(i + 1) % k.length]!.x - p.x) * (k[(i + 1) % k.length]!.y + p.y), 0) < 0;

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
      const n = d.kontur.length;
      const links = ccw(d.kontur);
      for (const s of d.attika) {
        const i = d.kontur.findIndex((q) => q.id === s.kante);
        if (i < 0) continue;
        const a = d.kontur[i]!, b = d.kontur[(i + 1) % n]!;
        const l = Math.hypot(b.x - a.x, b.y - a.y);
        if (l <= 0) continue;
        const ux = (b.x - a.x) / l, uy = (b.y - a.y) / l;
        const nx = (links ? -uy : uy) * s.breite, ny = (links ? ux : -ux) * s.breite;
        const q = [a, b, { x: b.x + nx, y: b.y + ny }, { x: a.x + nx, y: a.y + ny }];
        bahn(ctx, q);
        ctx.globalAlpha = .25; ctx.fillStyle = css("--text", "#222"); ctx.fill();
        ctx.globalAlpha = 1; ctx.strokeStyle = css("--text", "#222"); ctx.lineWidth = px;
        bahn(ctx, [q[3]!, q[2]!], false); ctx.stroke();
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
    const belegung = new Belegung(vp);
    for (const d of modell().dachflaechen) {
      for (const e of d.entwaesserung) zeichneEntwaesserung(ctx, vp, d, e, belegung, ergebnis?.eids.get(`${d.id}/${e.id}`), ansicht === "gefaelle");
      for (const t of d.tuerschwellen) {
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
      const t = d.tuerschwellen.find((x) => x.id === a.id);
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
      const pts = cursor && zeichnetMitFang() ? [...z.entwurf, treffer?.punkt ?? cursor] : z.entwurf;
      bahn(ctx, pts, false); ctx.stroke();
      if (z.entwurf.length >= 2) { ctx.save(); ctx.setLineDash([4 * px, 4 * px]); ctx.globalAlpha = .6; bahn(ctx, [pts[pts.length - 1]!, pts[0]!], false); ctx.stroke(); ctx.restore(); }
      for (const p of z.entwurf) { ctx.fillStyle = css("--text", "#222"); ctx.fillRect(p.x - 2.5 * px, p.y - 2.5 * px, 5 * px, 5 * px); }
    }
    if (z.tool === "measure" && kal.p1) {
      const q = kal.p2 ?? treffer?.punkt ?? cursor;
      if (q) { ctx.strokeStyle = farbe; ctx.lineWidth = 1.5 * px; bahn(ctx, [kal.p1, q], false); ctx.stroke(); }
    }
    if (kante && (z.tool === "attika" || z.tool === "schwelle" || z.tool === "dachreiter")) {
      const d = modell().dachflaechen.find((x) => x.id === kante!.dachId)!;
      const i = d.kontur.findIndex((q) => q.id === kante!.kante);
      ctx.strokeStyle = farbe; ctx.lineWidth = 3 * px; ctx.globalAlpha = .7;
      bahn(ctx, [d.kontur[i]!, d.kontur[(i + 1) % d.kontur.length]!], false); ctx.stroke(); ctx.globalAlpha = 1;
      marker(ctx, vp, { art: "mittelpunkt", punkt: kante.punkt, segmente: [], abstand: kante.distanz });
    }
    if (treffer) marker(ctx, vp, treffer, refPunkt());
  }

  stage.setLayer("kontur", zeichneKontur);
  stage.setLayer("einzugsflaechen", (ctx, vp) => { if (ergebnis && ansicht === "gefaelle") zeichneEinzugsflaechen(ctx, vp, modell(), ergebnis); });
  stage.setLayer("daemmplan", (ctx, vp) => {
    if (!ergebnis || ansicht !== "daemmplan") return;
    if (planFuer !== ergebnis) { planFuer = ergebnis; try { plan = berechnePlan(modell(), ergebnis.slope); } catch { plan = null; } }
    zeichneDaemmplan(ctx, vp, modell(), ergebnis.slope, plan);
  });
  stage.setLayer("pfeile", (ctx, vp) => { if (ergebnis && ansicht === "gefaelle") { zeichnePfeile(ctx, vp, ergebnis); zeichneNotbereich(ctx, vp, modell(), ergebnis); } });
  stage.setLayer("koten", (ctx, vp) => { if (ergebnis && ansicht === "gefaelle") zeichneKoten(ctx, vp, ergebnis); });
  stage.setLayer("symbole", zeichneSymbole);
  stage.setLayer("auswahl", zeichneAuswahl);
  stage.setLayer("fang", zeichneFang);

  // ---------- Eingaben ----------
  stage.onPointer({
    move(w) {
      cursor = { x: w[0], y: w[1] };
      treffer = null; kante = null;
      if (zeichnetMitFang()) {
        if (z.tool === "attika" || z.tool === "schwelle" || z.tool === "dachreiter") kante = kantenTreffer(modell(), cursor, tol());
        else {
          const ref = refPunkt();
          treffer = snap(fangIndex(), cursor, tol(), ref ? { referenzpunkt: ref } : {});
        }
      }
      shell.status.snap.textContent = treffer ? `Fang: ${FANG_NAME[treffer.art]}` : zeichnetMitFang() ? "Fang: bereit" : "Fang: aus";
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
    leave() { cursor = null; treffer = null; kante = null; stage.invalidate(); },
  });

  shell.onTool((id) => setzeWerkzeug(id as WerkzeugId));
  shell.undo.addEventListener("click", undo);
  shell.redo.addEventListener("click", redo);
  window.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLElement && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) && e.target.getAttribute("type") !== "checkbox") return;
    const k = e.key.toLowerCase();
    if (e.ctrlKey || e.metaKey) {
      if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(); } else if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); redo(); }
      return;
    }
    if (e.altKey) return;
    if (k === "enter") { if (z.entwurf.length) { e.preventDefault(); wende(abschliessen(z, modell())); } }
    else if (k === "escape") { if (z.entwurf.length || kal.p1) { z = abbrechen(z); kal = {}; refresh(); } else if (z.tool !== "select") setzeWerkzeug("select"); else setzeAuswahl(null); }
    else if (k === "backspace") { if (z.entwurf.length) { e.preventDefault(); z = entfernePunkt(z); refresh(); } }
    else if (k === "delete") loescheAuswahl();
    else if (TASTEN[k]) setzeWerkzeug(TASTEN[k]!);
  });

  const ausfuehreBefehl = (b: Befehl) => { verlauf = ausfuehren(verlauf, b); refresh(); };
  standortPanel = mountStandort(shell.panels.standort, { modell, ausfuehre: ausfuehreBefehl });
  setzeWerkzeug("select");
  refresh();
  Object.defineProperties(api, {
    ausfuehre: { value: ausfuehreBefehl },
    modell: { get: () => modell() },
    lade: { value: (m: ProjectModel) => { verlauf = neuerVerlauf(m); auswahl = null; if (m.unterlage) offeneUnterlage = m.unterlage; refresh(); } },
  });
  return api;
}
