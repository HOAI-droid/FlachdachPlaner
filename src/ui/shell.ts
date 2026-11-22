import { version } from "../core/index";

type Theme = "light" | "dark";
const ICONS: Record<string, string> = {
  select: '<path d="M3 2l9 6-4 1-2 4z"/>',
  contour: '<path d="M3 3h10v10H3z"/>',
  gully: '<circle cx="8" cy="8" r="5"/><path d="M5 5l6 6M11 5l-6 6"/>',
  notablauf: '<circle cx="8" cy="8" r="4"/><circle cx="8" cy="8" r="6.5" stroke-dasharray="2 1.5"/><path d="M6.5 10V6l3 4V6"/>',
  dachreiter: '<path d="M3 5h10v4H3z"/><path d="M8 10l-3 4h6z"/>',
  les: '<path d="M2 6h12M2 10h12M5 6v4M8 6v4M11 6v4"/>',
  measure: '<path d="M2 11l9-9 3 3-9 9z"/><path d="M5 8l2 2M7 6l2 2"/>',
  attika: '<path d="M2 2h12v12H2z"/><path d="M5 5h6v6H5z"/>',
  aufbau: '<path d="M3 3h10v10H3z"/><path d="M3 3l10 10M13 3L3 13"/>',
  terrasse: '<path d="M2 4h12v8H2z"/><path d="M5 8h6"/>',
  schwelle: '<path d="M2 13h12"/><path d="M5 13V7h6v6"/>',
  undo: '<path d="M6 3L2 7l4 4"/><path d="M2 7h7a4 4 0 010 8H6"/>',
  redo: '<path d="M10 3l4 4-4 4"/><path d="M14 7H7a4 4 0 000 8h3"/>',
};
const GROUPS: { name: string; tools: [string, string, string][] }[] = [
  { name: "Auswahl", tools: [["select", "Auswählen", "V"]] },
  { name: "Zeichnen", tools: [
    ["contour", "Dachkontur", "K"], ["attika", "Attika", "A"], ["aufbau", "Aufbau", "U"],
    ["terrasse", "Terrasse", "T"], ["schwelle", "Türschwelle", "S"],
  ] },
  { name: "Entwässerung", tools: [["gully", "Gully setzen", "G"], ["notablauf", "Notablauf setzen", "N"], ["dachreiter", "Dachreiter setzen", "R"], ["les", "Linienentwässerung (LES)", "L"]] },
  { name: "Messen", tools: [["measure", "Messen / Kalibrieren", "M"]] },
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

export function setTheme(t: Theme): void {
  if (t === "dark") document.documentElement.dataset.theme = "dark";
  else delete document.documentElement.dataset.theme;
  try { localStorage.setItem("theme", t); } catch { /* ohne Speicher weiter */ }
}
function initialTheme(): Theme {
  try { const s = localStorage.getItem("theme"); if (s === "dark" || s === "light") return s; } catch { /* egal */ }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function segment(labels: [string, string][], onPick: (v: string) => void, active: string): HTMLElement {
  const wrap = el("div", "segment");
  wrap.setAttribute("role", "group");
  for (const [v, l] of labels) {
    const b = el("button", "", l);
    b.type = "button";
    b.setAttribute("aria-pressed", String(v === active));
    b.addEventListener("click", () => {
      wrap.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", "false"));
      b.setAttribute("aria-pressed", "true");
      onPick(v);
    });
    wrap.append(b);
  }
  return wrap;
}

function section(title: string, body: HTMLElement): HTMLElement {
  const s = el("div", "section");
  s.dataset.open = "true";
  const h = el("button", "section-head");
  h.type = "button";
  h.setAttribute("aria-expanded", "true");
  h.append(el("span", "", title), el("span", "chev", "▾"));
  h.addEventListener("click", () => {
    const open = s.dataset.open !== "true";
    s.dataset.open = String(open);
    h.setAttribute("aria-expanded", String(open));
  });
  body.classList.add("section-body");
  s.append(h, body);
  return s;
}

export interface Shell {
  stage: HTMLElement;
  status: { cursor: HTMLElement; scale: HTMLElement; snap: HTMLElement; unterlage: HTMLElement };
  onTool(cb: (id: string) => void): void;
  /** Planansicht: "gefaelle" (Gefälleplan) oder "daemmplan" (Gefälledämmplan). */
  onAnsicht(cb: (a: "gefaelle" | "daemmplan") => void): void;
  /** Umschalter 2D | 3D. */
  onModus(cb: (m: "2d" | "3d") => void): void;
  /** Markiert das aktive Werkzeug (z. B. nach Esc oder Tastenkürzel). */
  setTool(id: string): void;
  /** Panel-Abschnitte (Inhalt wird von der UI-Steuerung befüllt). */
  panels: { unterlage: HTMLElement; werkzeug: HTMLElement; auswahl: HTMLElement; pruefliste: HTMLElement; standort: HTMLElement; ergebnis: HTMLElement; projekt: HTMLElement; update: HTMLElement };
  undo: HTMLButtonElement;
  redo: HTMLButtonElement;
}

export function mountShell(root: HTMLElement): Shell {
  root.replaceChildren();
  setTheme(initialTheme());

  const hint = el("div", "hint-bar", "Mindestbreite 1280 px: bitte Fenster vergrößern.");
  const head = el("header", "head");
  head.append(el("h1", "", "Flachdachplaner"));
  let modusCb: (m: "2d" | "3d") => void = () => {};
  head.append(segment([["2d", "2D"], ["3d", "3D"]], (v) => modusCb(v as "2d" | "3d"), "2d"));
  let ansichtCb: (a: "gefaelle" | "daemmplan") => void = () => {};
  const ansicht = segment([["gefaelle", "Gefälle"], ["daemmplan", "Dämmplan"]], (v) => ansichtCb(v as "gefaelle" | "daemmplan"), "gefaelle");
  ansicht.setAttribute("aria-label", "Planansicht");
  head.append(ansicht);
  const undo = el("button", "btn icon");
  const redo = el("button", "btn icon");
  for (const [b, id, name] of [[undo, "undo", "Rückgängig  Strg+Z"], [redo, "redo", "Wiederholen  Strg+Y"]] as const) {
    b.type = "button"; b.title = name; b.setAttribute("aria-label", name.split("  ")[0]!);
    b.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true">${ICONS[id]}</svg>`;
    b.disabled = true;
  }
  head.append(undo, redo);
  head.append(el("span", "spacer"));
  const themeBtn = el("button", "btn", "Dunkel");
  themeBtn.type = "button";
  themeBtn.addEventListener("click", () => {
    const dark = document.documentElement.dataset.theme === "dark";
    setTheme(dark ? "light" : "dark");
    themeBtn.textContent = dark ? "Dunkel" : "Hell";
  });
  if (document.documentElement.dataset.theme === "dark") themeBtn.textContent = "Hell";
  head.append(themeBtn);

  const tools = el("nav", "tools");
  tools.setAttribute("aria-label", "Werkzeuge");
  const toolBtns: HTMLButtonElement[] = [];
  const markTool = (id: string) => toolBtns.forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.tool === id)));
  let toolCb: (id: string) => void = () => {};
  for (const g of GROUPS) {
    const grp = el("div", "group");
    for (const [id, name, key] of g.tools) {
      const b = el("button", "tool");
      b.type = "button";
      b.dataset.tool = id;
      b.title = `${name}  ${key}`;
      b.setAttribute("aria-label", name);
      b.setAttribute("aria-pressed", String(id === "select"));
      b.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true">${ICONS[id]}</svg>`;
      b.addEventListener("click", () => {
        markTool(id);
        toolCb(id);
      });
      toolBtns.push(b);
      grp.append(b);
    }
    tools.append(grp);
  }

  const stage = el("main", "stage");
  stage.setAttribute("aria-label", "Zeichenfläche");

  const check = el("section", "check");
  check.setAttribute("aria-label", "Prüfliste");
  const pruefliste = el("div", "empty", "Noch keine Dachfläche gezeichnet.");
  check.append(el("div", "panel-title", "Prüfliste"), pruefliste);

  const props = el("aside", "props");
  props.setAttribute("aria-label", "Eigenschaften");
  props.append(el("div", "panel-title", "Eigenschaften"));
  const proj = el("div");
  const f = el("div", "field");
  const lbl = el("label", "", "Standard-Gefälle");
  const inp = el("input");
  inp.id = "f-gefaelle"; lbl.htmlFor = inp.id; inp.value = "2,0 %"; inp.inputMode = "decimal";
  f.append(lbl, inp);
  proj.append(f);
  const update = el("div"), unterlage = el("div"), werkzeug = el("div"), auswahl = el("div"), standort = el("div"), ergebnis = el("div");
  unterlage.append(el("div", "empty", "Keine Unterlage geladen."));
  auswahl.append(el("div", "empty", "Nichts ausgewählt."));
  props.append(section("Unterlage", unterlage), section("Werkzeug", werkzeug), section("Auswahl", auswahl), section("Standort & Regenspende", standort), section("Ergebnis", ergebnis), section("Projekt", proj), section("Updates", update));

  const status = el("footer", "status");
  const cursor = el("span", "num", "x –  y –");
  const scale = el("span", "num", "1:100");
  const snap = el("span", "", "Fang: aus");
  const unterlageStatus = el("span", "num", "");
  status.append(cursor, scale, unterlageStatus, snap, el("span", "spacer"), el("span", "", `Regelwerk ${version}`));

  root.append(hint, head, tools, stage, check, props, status);
  // hint-bar liegt über dem Grid: nur sichtbar unter 1280 px, ohne Layout zu verschieben
  hint.style.cssText = "position:fixed;inset:0 0 auto 0;z-index:10";

  return {
    stage, status: { cursor, scale, snap, unterlage: unterlageStatus }, onTool: (cb) => { toolCb = cb; }, onAnsicht: (cb) => { ansichtCb = cb; }, onModus: (cb) => { modusCb = cb; },
    setTool: markTool, panels: { unterlage, werkzeug, auswahl, pruefliste, standort, ergebnis, projekt: proj, update }, undo, redo,
  };
}
