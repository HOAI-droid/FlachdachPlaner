/** Standort- und Regenspende-Panel (PLAN Schritt 20): offline per Koordinate, UTM, PLZ/Ort oder Karte. */
import {
  ermittleRegen, koordinateGueltig, regenAbweichung, setRegenManuell, setStandort, sucheOrte, utmZuWgs84,
  type Befehl, type Koordinate, type ProjectModel, type RainData, type RegenspendenPack,
} from "../core/index";
import { prozent, zahl } from "./format";
import { ladeKostra, ladeOrte } from "./packs";

const num = (s: string): number => Number(s.trim().replace(/\s/g, "").replace(",", "."));
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", t = ""): HTMLElementTagNameMap[K] {
  const x = document.createElement(tag);
  if (cls) x.className = cls;
  if (t) x.textContent = t;
  return x;
}
function feld(label: string, wert: string, key: string, commit: (v: string) => void): HTMLElement {
  const f = el("div", "field");
  const l = el("label", "", label), i = el("input");
  i.id = `f-${key}`; l.htmlFor = i.id; i.value = wert; i.dataset.k = key;
  i.addEventListener("change", () => commit(i.value));
  i.addEventListener("keydown", (e) => { if (e.key === "Enter") i.blur(); });
  f.append(l, i);
  return f;
}
const knopf = (t: string, f: () => void, cls = "btn"): HTMLButtonElement => {
  const b = el("button", cls, t); b.type = "button"; b.addEventListener("click", f); return b;
};

export interface StandortApi {
  modell(): ProjectModel;
  ausfuehre(b: Befehl): void;
}
export interface StandortPanel { render(): void }

export function mountStandort(panel: HTMLElement, api: StandortApi): StandortPanel {
  let kostra: RegenspendenPack | null = null;
  let rain: RainData | null = null;
  let meldung: string | null = null;
  let treffer: { plz: string; ort: string; lat: number; lon: number }[] = [];
  const utm = { zone: "32", ost: "", nord: "" };
  let sucheText = "";

  async function setzeKoordinate(k: Koordinate, bezeichnung?: string) {
    if (!koordinateGueltig(k)) { meldung = "Koordinate ungültig."; render(); return; }
    kostra ??= await ladeKostra();
    if (!kostra) { meldung = "KOSTRA-Pack nicht verfügbar."; render(); return; }
    const r = ermittleRegen(k, kostra);
    meldung = r.befunde[0]?.meldung ?? null;
    rain = r.rain;
    api.ausfuehre(setStandort(bezeichnung ?? api.modell().standort.bezeichnung, k, r.rain));
    render();
  }

  /** Beim Laden: Zelle zur gespeicherten Koordinate neu bestimmen (Anzeige), ohne das Modell zu ändern. */
  async function aktualisiereZelle() {
    const k = api.modell().standort.koordinate;
    if (!k) { rain = null; return; }
    kostra ??= await ladeKostra();
    rain = kostra ? ermittleRegen(k, kostra).rain : null;
    render();
  }

  function wert(name: "r5_5" | "r5_100", titel: string): HTMLElement {
    const s = api.modell().standort.regen[name];
    const box = el("div", "regen");
    box.dataset.k = name;
    const pack = el("div", "row"); pack.append(el("span", "", `${titel} Pack`), el("span", "num", s.packWert === null ? "–" : zahl(s.packWert, 0)));
    pack.querySelector(".num")!.setAttribute("data-k", `${name}-pack`);
    box.append(pack);
    const f = feld(`${titel} manuell (l/(s·ha))`, s.manuellWert === undefined ? "" : zahl(s.manuellWert, 0), `${name}-manuell`, (v) => {
      const t = v.trim();
      if (t === "") api.ausfuehre(setRegenManuell(name, undefined));
      else { const n = num(t); if (Number.isFinite(n) && n > 0) api.ausfuehre(setRegenManuell(name, n)); else meldung = "Manueller Wert muss größer 0 sein."; }
      render();
    });
    box.append(f);
    const ab = regenAbweichung(s);
    if (ab !== null) {
      const h = el("div", "note warn", `Manueller Wert ersetzt den Pack-Wert (${ab >= 0 ? "+" : ""}${prozent(ab * 100, 1)} gegenüber Pack). Rechnung und Prüfung nutzen den manuellen Wert.`);
      h.dataset.k = `${name}-override`; h.setAttribute("role", "status");
      box.append(h);
    }
    return box;
  }

  function render() {
    const m = api.modell(), st = m.standort;
    panel.replaceChildren();
    panel.append(feld("Bezeichnung", st.bezeichnung ?? "", "standort-name", (v) => { if (st.koordinate) void setzeKoordinate(st.koordinate, v.trim() || undefined); else api.ausfuehre(setStandort(v.trim() || undefined, null, null)); }));
    // Koordinate (WGS84)
    const kw = el("div", "pad"); kw.append(el("div", "label", "Koordinate WGS84"));
    let lat = st.koordinate ? zahl(st.koordinate.lat, 5) : "", lon = st.koordinate ? zahl(st.koordinate.lon, 5) : "";
    const zeile = el("div", "field-row");
    zeile.append(feld("Breite", lat, "lat", (v) => { lat = v; }), feld("Länge", lon, "lon", (v) => { lon = v; }));
    kw.append(zeile, knopf("Übernehmen", () => { const la = num(lat), lo = num(lon); void setzeKoordinate({ lat: la, lon: lo }); }));
    panel.append(kw);
    // UTM
    const ud = el("details", "pad");
    ud.append(el("summary", "", "UTM (ETRS89)"));
    ud.append(feld("Zone", utm.zone, "utm-zone", (v) => { utm.zone = v; }), feld("Ost (m)", utm.ost, "utm-ost", (v) => { utm.ost = v; }), feld("Nord (m)", utm.nord, "utm-nord", (v) => { utm.nord = v; }));
    ud.append(knopf("Übernehmen", () => {
      const k = utmZuWgs84(num(utm.zone), num(utm.ost), num(utm.nord));
      if (!k) { meldung = "UTM-Angabe ungültig."; render(); return; }
      void setzeKoordinate(k);
    }));
    panel.append(ud);
    // PLZ / Ort
    const pw = el("div", "pad");
    pw.append(feld("PLZ oder Ort", sucheText, "ort-suche", (v) => { sucheText = v; void suche(); }));
    if (treffer.length) {
      const ul = el("ul", "treffer"); ul.dataset.k = "ort-treffer";
      for (const t of treffer) { const li = el("li"); li.append(knopf(`${t.plz} ${t.ort}`, () => { treffer = []; void setzeKoordinate({ lat: t.lat, lon: t.lon }, `${t.plz} ${t.ort}`); }, "btn link")); ul.append(li); }
      pw.append(ul);
    }
    pw.append(knopf("Auf Karte wählen …", () => { void karte(); }), knopf("Adresse online suchen …", geocoding));
    panel.append(pw);
    // Anzeige
    const info = el("div", "pad");
    const zeilen: [string, string, string][] = [
      ["Rasterzelle", rain ? `${rain.zelle.i} / ${rain.zelle.j}` : "–", "zelle"],
      ["r(5,5)", rain?.r5_5 != null ? `${zahl(rain.r5_5, 0)} l/(s·ha)` : "–", "r55"],
      ["r(5,100)", rain?.r5_100 != null ? `${zahl(rain.r5_100, 0)} l/(s·ha)` : "–", "r5100"],
      ["Quelle", rain ? `${rain.quelle} (${rain.packId} ${rain.packVersion})` : st.koordinate ? "–" : "Kein Standort gesetzt", "quelle"],
    ];
    for (const [a, b, k] of zeilen) { const r = el("div", "row"); const v = el("span", "num", b); v.dataset.k = k; r.append(el("span", "", a), v); info.append(r); }
    panel.append(info, wert("r5_5", "r(5,5)"), wert("r5_100", "r(5,100)"));
    if (meldung) { const n = el("div", "note warn", meldung); n.setAttribute("role", "status"); n.dataset.k = "standort-meldung"; panel.append(n); }
  }

  async function suche() {
    const o = await ladeOrte();
    treffer = sucheOrte(o, sucheText).map((x) => ({ plz: x.plz, ort: x.ort, lat: x.lat, lon: x.lon }));
    meldung = treffer.length ? null : sucheText.trim() ? "Kein Ort gefunden." : null;
    render();
  }

  async function karte() {
    kostra ??= await ladeKostra();
    if (!kostra) { meldung = "KOSTRA-Pack nicht verfügbar."; render(); return; }
    const r = kostra.daten.raster, w = kostra.daten.werte.r5_100;
    const dlg = el("dialog", "dialog karte");
    dlg.setAttribute("aria-label", "Standort auf der Karte wählen");
    const cv = el("canvas"); cv.width = r.spalten; cv.height = r.zeilen; cv.style.width = `${r.spalten * 1.4}px`; cv.style.height = `${r.zeilen * 1.4}px`;
    cv.dataset.k = "karte";
    const g = cv.getContext("2d")!;
    const img = g.createImageData(r.spalten, r.zeilen);
    let lo = Infinity, hi = -Infinity;
    for (const v of w) if (v !== null) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    for (let j = 0; j < r.zeilen; j++) for (let i = 0; i < r.spalten; i++) {
      const v = w[j * r.spalten + i]; const o = ((r.zeilen - 1 - j) * r.spalten + i) * 4;
      if (v === null || v === undefined) continue;
      const t = (v - lo) / (hi - lo || 1);
      img.data[o] = 40 + 160 * t; img.data[o + 1] = 110 - 50 * t; img.data[o + 2] = 190 - 120 * t; img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const info = el("div", "note", "Klick setzt den Standort auf die Mitte der Rasterzelle. Rasterzellen sind ca. 1,5 km groß.");
    cv.addEventListener("click", (e) => {
      const b = cv.getBoundingClientRect();
      const i = Math.floor(((e.clientX - b.left) / b.width) * r.spalten), j = r.zeilen - 1 - Math.floor(((e.clientY - b.top) / b.height) * r.zeilen);
      const k = { lat: r.y0 + (j + 0.5) * r.zellgroesse, lon: r.x0 + (i + 0.5) * r.zellgroesse };
      dlg.close(); dlg.remove();
      void setzeKoordinate(k, "Kartenauswahl");
    });
    const zu = knopf("Abbrechen", () => { dlg.close(); dlg.remove(); });
    dlg.append(info, cv, zu);
    document.body.append(dlg);
    dlg.showModal();
  }

  function geocoding() {
    const dlg = el("dialog", "dialog geo");
    dlg.setAttribute("aria-label", "Online-Adresssuche");
    const adr = el("input"); adr.setAttribute("aria-label", "Adresse"); adr.dataset.k = "geo-adresse";
    const status = el("div", "note");
    dlg.append(
      el("p", "", "Die Adresssuche sendet die eingegebene Adresse an einen Online-Dienst (OpenStreetMap Nominatim). Es werden keine Projektdaten übertragen. Ohne Zustimmung bleibt alles offline."),
      adr, status,
    );
    const ja = knopf("Zustimmen und suchen", async () => {
      const q = adr.value.trim();
      if (!q) { status.textContent = "Bitte Adresse eingeben."; return; }
      status.textContent = "Suche …";
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=de&q=${encodeURIComponent(q)}`, { referrerPolicy: "no-referrer", credentials: "omit" });
        if (!r.ok) { status.textContent = `Online-Suche fehlgeschlagen (HTTP ${r.status}).`; return; }
        const j = (await r.json()) as { lat: string; lon: string; display_name: string }[];
        if (!j[0] || !Number.isFinite(Number(j[0].lat)) || !Number.isFinite(Number(j[0].lon))) { status.textContent = "Nichts gefunden."; return; }
        dlg.close(); dlg.remove();
        void setzeKoordinate({ lat: Number(j[0].lat), lon: Number(j[0].lon) }, j[0].display_name.split(",").slice(0, 2).join(","));
      } catch { status.textContent = "Online-Suche nicht möglich (kein Netz)."; }
    }, "btn primary");
    dlg.append(ja, knopf("Abbrechen", () => { dlg.close(); dlg.remove(); }));
    document.body.append(dlg);
    dlg.showModal();
  }

  void aktualisiereZelle();
  render();
  return { render() { void aktualisiereZelle(); render(); } };
}
