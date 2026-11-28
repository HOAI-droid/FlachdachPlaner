/** Menüleiste (Browser) und gemeinsame Menü-Definition; die Desktop-App baut dieselben IDs nativ (src-tauri/src/lib.rs). */

export interface MenuePunkt { readonly id: string; readonly label: string; readonly kurz?: string }
export type MenueEintrag = MenuePunkt | "---";
export interface MenueGruppe { readonly titel: string; readonly eintraege: readonly MenueEintrag[] }

const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
/** Kürzel plattformgerecht anzeigen („Strg+Z“ bzw. „⌘Z“). */
export function kuerzel(k: string): string {
  return MAC ? k.replace(/Strg\+/g, "⌘").replace(/Umschalt\+/g, "⇧") : k;
}

export const MENUE: readonly MenueGruppe[] = [
  { titel: "Datei", eintraege: [
    { id: "neu", label: "Neu", kurz: "Strg+N" }, { id: "oeffnen", label: "Öffnen …", kurz: "Strg+O" }, { id: "speichern", label: "Speichern …", kurz: "Strg+S" },
    "---",
    { id: "unterlage-laden", label: "Unterlage laden …" }, { id: "unterlage-einbetten", label: "Unterlage einbetten …" },
    "---",
    { id: "export-pdf", label: "Plan als PDF …" }, { id: "export-dxf", label: "Plan als DXF …" },
  ] },
  { titel: "Bearbeiten", eintraege: [
    { id: "undo", label: "Rückgängig", kurz: "Strg+Z" }, { id: "redo", label: "Wiederholen", kurz: "Strg+Umschalt+Z" },
    "---",
    { id: "auswahl-loeschen", label: "Auswahl löschen", kurz: "Entf" },
  ] },
  { titel: "Projekt", eintraege: [
    { id: "angaben", label: "Plankopfdaten …" }, { id: "standort", label: "Standort & Regenspende …" }, { id: "varianten", label: "Varianten …" },
  ] },
  { titel: "Ansicht", eintraege: [
    { id: "modus-2d", label: "2D" }, { id: "modus-3d", label: "3D" },
    "---",
    { id: "ansicht-gefaelle", label: "Gefälleplan" }, { id: "ansicht-daemmplan", label: "Gefälledämmplan" },
    "---",
    { id: "thema", label: "Hell / Dunkel umschalten" },
  ] },
  { titel: "Hilfe", eintraege: [{ id: "update", label: "Softwareupdate …" }] },
];

/** HTML-Menüleiste; ruft `aktion(id)` auf. Im Desktop-App-Fenster nicht gemountet (natives Menü). */
export function mountMenuebar(host: HTMLElement, aktion: (id: string) => void): void {
  const bar = document.createElement("nav");
  bar.className = "menubar"; bar.setAttribute("role", "menubar"); bar.setAttribute("aria-label", "Menü");
  let offen: HTMLElement | null = null;
  const schliesse = () => { if (offen) { offen.dataset.open = "false"; offen.querySelector("button")?.setAttribute("aria-expanded", "false"); offen = null; } };
  for (const g of MENUE) {
    const w = document.createElement("div"); w.className = "menu"; w.dataset.open = "false";
    const b = document.createElement("button"); b.type = "button"; b.className = "menu-titel"; b.textContent = g.titel;
    b.setAttribute("role", "menuitem"); b.setAttribute("aria-haspopup", "true"); b.setAttribute("aria-expanded", "false"); b.dataset.menu = g.titel;
    const liste = document.createElement("div"); liste.className = "menu-liste"; liste.setAttribute("role", "menu");
    for (const e of g.eintraege) {
      if (e === "---") { const s = document.createElement("div"); s.className = "menu-trenner"; s.setAttribute("role", "separator"); liste.append(s); continue; }
      const i = document.createElement("button"); i.type = "button"; i.className = "menu-punkt"; i.setAttribute("role", "menuitem"); i.dataset.aktion = e.id;
      const l = document.createElement("span"); l.textContent = e.label; i.append(l);
      if (e.kurz) { const k = document.createElement("span"); k.className = "menu-kurz"; k.textContent = kuerzel(e.kurz); i.append(k); }
      i.addEventListener("click", () => { schliesse(); aktion(e.id); });
      liste.append(i);
    }
    const oeffne = () => { schliesse(); w.dataset.open = "true"; b.setAttribute("aria-expanded", "true"); offen = w; };
    b.addEventListener("click", () => { if (offen === w) schliesse(); else oeffne(); });
    b.addEventListener("mouseenter", () => { if (offen && offen !== w) oeffne(); });
    w.append(b, liste); bar.append(w);
  }
  document.addEventListener("mousedown", (e) => { if (offen && !offen.contains(e.target as Node)) schliesse(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") schliesse(); });
  host.append(bar);
}
