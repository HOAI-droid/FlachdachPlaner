/** Update-Panel (PLAN Schritt 22b): Pack-Updates und Programmversion. Netzzugriff nur auf manifest.json und bestätigte Pack-Dateien der eingestellten Quelle. */
import { parseManifest, neuerePacks, pruefePackDatei, vergleicheVersion } from "../core/index";
import type { Befehl, PackUpdate } from "../core/index";
import type { Editor } from "./editor";
import { aktiveVersionen, hoechsteVersionen, installierePack, neuerePackVersionen, setzeAktivePackVersion, versionenVon, packs } from "./packs";
import { sha256 } from "./underlay";

const KEY = "flachdachplaner-update";
interface Einstellung { quelle: string; beiStart: boolean }
const HINWEIS_PROGRAMM = "Neue Programmversion: git pull && npm install && npm run build (bis zur Desktop-Version mit Tauri).";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", t = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag); if (cls) e.className = cls; if (t) e.textContent = t; return e;
}
function lies(): Einstellung {
  try { const r = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Einstellung>; return { quelle: r.quelle ?? "", beiStart: r.beiStart ?? true }; } catch { return { quelle: "", beiStart: true }; }
}
const merke = (s: Einstellung) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ohne Speicher weiter */ } };
const hashBytes = (b: Uint8Array) => sha256(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);

type Quelle = { holeText(pfad: string): Promise<string> };
function urlQuelle(basis: string): Quelle {
  const b = new URL(basis.endsWith("/") ? basis : basis + "/", location.href);
  return { async holeText(pfad) {
    const r = await fetch(new URL(pfad, b), { cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
  } };
}
function ordnerQuelle(dateien: FileList): Quelle {
  const karte = new Map<string, File>();
  for (const f of Array.from(dateien)) karte.set(f.webkitRelativePath.split("/").slice(1).join("/"), f);
  return { async holeText(pfad) { const f = karte.get(pfad); if (!f) throw new Error("Datei fehlt"); return f.text(); } };
}

export function mountUpdate(host: HTMLElement, editor: Editor): void {
  const box = el("section", "update"); box.dataset.k = "update";
  box.append(el("h3", "", "Updates"));
  let s = lies();
  let ordner: Quelle | null = null;
  let angebote: PackUpdate[] = [];
  let status = s.quelle ? "" : "Update-Quelle nicht eingestellt (Standard: aus).";
  let programmHinweis = "";
  let hinweisNeu = true;

  const quelle = (): Quelle | null => ordner ?? (s.quelle.trim() ? urlQuelle(s.quelle.trim()) : null);
  const aktualisiere = () => draw();

  async function pruefe(): Promise<void> {
    const q = quelle();
    if (!q) { status = "Update-Quelle nicht eingestellt."; return draw(); }
    try {
      const m = parseManifest(JSON.parse(await q.holeText("manifest.json")));
      if (!m.ok) { status = m.meldung; angebote = []; return draw(); }
            angebote = neuerePacks(m.manifest, hoechsteVersionen());
      const pv = m.manifest.programm;
      programmHinweis = pv && vergleicheVersion(pv.version, __APP_VERSION__) > 0 ? `${HINWEIS_PROGRAMM} (neu: ${pv.version}${pv.notiz ? " – " + pv.notiz : ""})` : "";
      status = angebote.length || programmHinweis ? "" : "Alles aktuell.";
    } catch {
      angebote = []; status = "Quelle nicht erreichbar (offline?) – nichts geändert.";
    }
    draw();
  }

  async function lade(u: PackUpdate): Promise<void> {
    const q = quelle(); if (!q) return;
    try {
      const text = await q.holeText(u.eintrag.datei);
      const r = await pruefePackDatei(u.eintrag, text, hashBytes);
      if (!r.ok) { status = r.grund; return draw(); }
      await installierePack(r.pack, text);
      angebote = angebote.filter((a) => a !== u);
      status = `„${u.eintrag.id}“ ${u.neu} geladen und aktiv.`;
      editor.ausfuehre({ label: "Pack-Version geprüft", anwenden: (m) => m }); // löst Neuberechnung/Hinweis aus
    } catch { status = `„${u.eintrag.id}“ konnte nicht geladen werden – nichts geändert.`; }
    draw();
  }

  function neuBerechnen(): Befehl {
    const akt = aktiveVersionen();
    return { label: "Mit neuen Rule-Packs neu berechnen", anwenden: (m) => ({ ...m, packVersionen: { ...m.packVersionen, ...Object.fromEntries(Object.keys(m.packVersionen).filter((id) => akt[id]).map((id) => [id, akt[id]!])) } }) };
  }

  function draw(): void {
    box.replaceChildren(el("h3", "", "Updates"));
    const ver = el("p", "hilfe", `Programm: Version ${__APP_VERSION__} · Build ${__APP_BUILD__}`); ver.dataset.k = "programm-version";
    box.append(ver);
    const f = el("div", "feld"), l = el("label", "", "Update-Quelle (URL oder Ordner)"); l.htmlFor = "f-update-quelle";
    const i = el("input"); i.id = "f-update-quelle"; i.type = "text"; i.placeholder = "leer = aus"; i.value = s.quelle; i.dataset.k = "update-quelle";
    i.addEventListener("change", () => { s = { ...s, quelle: i.value }; ordner = null; merke(s); status = s.quelle ? "" : "Update-Quelle nicht eingestellt (Standard: aus)."; draw(); });
    f.append(l, i); box.append(f);
    const ord = el("input"); ord.type = "file"; ord.hidden = true; ord.setAttribute("webkitdirectory", ""); ord.dataset.k = "update-ordner";
    ord.addEventListener("change", () => { if (ord.files?.length) { ordner = ordnerQuelle(ord.files); status = "Lokaler Ordner gewählt."; draw(); } });
    const zeile = el("div", "btn-row");
    const b1 = el("button", "btn", "Ordner wählen …"); b1.type = "button"; b1.addEventListener("click", () => ord.click());
    const b2 = el("button", "btn", "Nach Updates suchen"); b2.type = "button"; b2.dataset.k = "update-suchen"; b2.addEventListener("click", () => void pruefe());
    zeile.append(b1, b2, ord); box.append(zeile);
    const cb = el("label", "check"), c = el("input"); c.type = "checkbox"; c.checked = s.beiStart; c.dataset.k = "update-start";
    c.addEventListener("change", () => { s = { ...s, beiStart: c.checked }; merke(s); });
    cb.append(c, document.createTextNode(" Beim Start prüfen")); box.append(cb);
    if (status) { const p = el("p", "hilfe", status); p.dataset.k = "update-status"; p.setAttribute("role", "status"); box.append(p); }
    if (programmHinweis) { const p = el("p", "hilfe", programmHinweis); p.dataset.k = "programm-hinweis"; box.append(p); }
    if (angebote.length) {
      const ul = el("ul", "update-liste"); ul.dataset.k = "update-angebote";
      for (const a of angebote) {
        const li = el("li"); li.dataset.pack = a.eintrag.id;
        li.append(el("span", "", `${a.eintrag.id}: ${a.alt ?? "neu"} → ${a.neu}${a.eintrag.gueltigAb ? ` (gültig ab ${a.eintrag.gueltigAb})` : ""}${a.eintrag.notiz ? " – " + a.eintrag.notiz : ""}`));
        const b = el("button", "btn", "Laden"); b.type = "button"; b.addEventListener("click", () => void lade(a)); li.append(b);
        ul.append(li);
      }
      box.append(ul);
    }
    // Rollback: Auswahl der aktiven Version je Pack
    const mehr = packs.filter((p) => versionenVon(p.id).length > 1);
    if (mehr.length) {
      const d = el("details"); d.append(el("summary", "", "Pack-Versionen (Rollback)"));
      for (const p of mehr) {
        const fz = el("div", "feld"), lb = el("label", "", p.id); lb.htmlFor = `f-pv-${p.id}`;
        const sel = el("select"); sel.id = lb.htmlFor; sel.dataset.k = `pv-${p.id}`;
        for (const v of versionenVon(p.id)) { const o = el("option", "", v); o.value = v; o.selected = v === p.version; sel.append(o); }
        sel.addEventListener("change", () => { setzeAktivePackVersion(p.id, sel.value); status = `„${p.id}“ auf ${sel.value} gesetzt.`; editor.ausfuehre({ label: "Pack-Version gewählt", anwenden: (m) => m }); draw(); });
        fz.append(lb, sel); d.append(fz);
      }
      box.append(d);
    }
    // Hinweis „Neu berechnen?“
    const neuer = neuerePackVersionen(editor.modell.packVersionen);
    if (neuer.length && hinweisNeu) {
      const h = el("div", "hinweis"); h.dataset.k = "neu-berechnen";
      h.append(el("p", "", `Neuere Rule-Packs verfügbar: ${neuer.map((n) => `${n.id} ${n.alt} → ${n.neu}`).join(", ")}. Neu berechnen?`));
      const ja = el("button", "btn", "Neu berechnen"); ja.type = "button"; ja.addEventListener("click", () => { editor.ausfuehre(neuBerechnen()); });
      const nein = el("button", "btn", "Später"); nein.type = "button"; nein.addEventListener("click", () => { hinweisNeu = false; draw(); });
      h.append(ja, nein); box.append(h);
    }
  }

  editor.beiAenderung = () => { if (!box.contains(document.activeElement)) aktualisiere(); };
  host.append(box);
  draw();
  if (s.beiStart && s.quelle.trim()) void pruefe();
}
