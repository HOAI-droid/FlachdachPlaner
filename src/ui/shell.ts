import { version } from "../core/index";

type Theme = "light" | "dark";
const ICONS: Record<string, string> = {
  select: '<path d="M3 2l9 6-4 1-2 4z"/>',
  contour: '<path d="M3 3h10v10H3z"/>',
  gully: '<circle cx="8" cy="8" r="5"/><path d="M5 5l6 6M11 5l-6 6"/>',
  measure: '<path d="M2 11l9-9 3 3-9 9z"/><path d="M5 8l2 2M7 6l2 2"/>',
};
const GROUPS: { name: string; tools: [string, string, string][] }[] = [
  { name: "Auswahl", tools: [["select", "Auswählen", "V"]] },
  { name: "Zeichnen", tools: [["contour", "Dachkontur", "K"]] },
  { name: "Entwässerung", tools: [["gully", "Gully setzen", "G"]] },
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
  status: { cursor: HTMLElement; scale: HTMLElement; snap: HTMLElement };
  onTool(cb: (id: string) => void): void;
}

export function mountShell(root: HTMLElement): Shell {
  root.replaceChildren();
  setTheme(initialTheme());

  const hint = el("div", "hint-bar", "Mindestbreite 1280 px: bitte Fenster vergrößern.");
  const head = el("header", "head");
  head.append(el("h1", "", "Flachdachplaner"));
  head.append(segment([["2d", "2D"], ["3d", "3D"]], () => {}, "2d"));
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
        toolBtns.forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
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
  check.append(el("div", "panel-title", "Prüfliste"), el("div", "empty", "Noch kein Projekt geöffnet."));

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
  props.append(section("Projekt", proj), section("Dachfläche", el("div", "empty", "Nichts ausgewählt.")));

  const status = el("footer", "status");
  const cursor = el("span", "num", "x –  y –");
  const scale = el("span", "num", "1:100");
  const snap = el("span", "", "Fang: aus");
  status.append(cursor, scale, snap, el("span", "spacer"), el("span", "", `Regelwerk ${version}`));

  root.append(hint, head, tools, stage, check, props, status);
  // hint-bar liegt über dem Grid: nur sichtbar unter 1280 px, ohne Layout zu verschieben
  hint.style.cssText = "position:fixed;inset:0 0 auto 0;z-index:10";

  return { stage, status: { cursor, scale, snap }, onTool: (cb) => { toolCb = cb; } };
}
