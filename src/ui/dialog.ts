/** Modaler Dialog (DESIGN-Tokens): Fokus auf dem Hauptknopf, Esc = Abbruch, Tab bleibt im Dialog. */
export interface DialogKnopf { readonly id: string; readonly label: string; readonly primaer?: boolean }

export interface DialogOptionen {
  readonly titel: string;
  readonly text?: string;
  /** Zusätzlicher Inhalt (z. B. Miniaturen); wird vor den Knöpfen eingefügt. */
  readonly inhalt?: HTMLElement;
  readonly knoepfe: readonly DialogKnopf[];
  /** Ergebnis bei Esc / Klick auf den Hintergrund. */
  readonly abbruchId: string;
  readonly breit?: boolean;
}

export interface DialogHandle {
  readonly ergebnis: Promise<string>;
  schliesse(id: string): void;
  readonly wurzel: HTMLElement;
}

const mk = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

export function oeffneDialog(o: DialogOptionen): DialogHandle {
  const vorher = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const hintergrund = mk("div", "dialog-bg");
  const box = mk("div", o.breit ? "dialog breit" : "dialog");
  box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true");
  const titel = mk("h2", "dialog-titel", o.titel); titel.id = `dlg-${Math.random().toString(36).slice(2)}`;
  box.setAttribute("aria-labelledby", titel.id);
  box.append(titel);
  if (o.text) box.append(mk("p", "dialog-text", o.text));
  if (o.inhalt) box.append(o.inhalt);
  const zeile = mk("div", "btn-row dialog-knoepfe");
  let fertig: (id: string) => void = () => {};
  const ergebnis = new Promise<string>((ok) => { fertig = ok; });
  let zu = false;
  const schliesse = (id: string) => {
    if (zu) return;
    zu = true;
    document.removeEventListener("keydown", taste, true);
    hintergrund.remove();
    vorher?.focus?.();
    fertig(id);
  };
  const knoepfe: HTMLButtonElement[] = [];
  for (const k of o.knoepfe) {
    const b = mk("button", k.primaer ? "btn primary" : "btn", k.label); b.type = "button"; b.dataset.k = `dialog-${k.id}`;
    b.addEventListener("click", () => schliesse(k.id));
    knoepfe.push(b); zeile.append(b);
  }
  box.append(zeile); hintergrund.append(box);
  function taste(e: KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); schliesse(o.abbruchId); return; }
    if (e.key !== "Tab") return;
    const f = [...box.querySelectorAll<HTMLElement>("button, [tabindex]:not([tabindex='-1'])")].filter((x) => !x.hasAttribute("disabled"));
    if (!f.length) return;
    const i = f.indexOf(document.activeElement as HTMLElement);
    const n = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : (i === f.length - 1 ? 0 : i + 1);
    e.preventDefault(); f[n]!.focus();
  }
  document.addEventListener("keydown", taste, true);
  hintergrund.addEventListener("mousedown", (e) => { if (e.target === hintergrund) schliesse(o.abbruchId); });
  document.body.append(hintergrund);
  (knoepfe.find((_, i) => o.knoepfe[i]!.primaer) ?? knoepfe[0])?.focus();
  return { ergebnis, schliesse, wurzel: box };
}

export type SpeicherAntwort = "speichern" | "verwerfen" | "abbrechen";

/** Rückfrage bei ungespeicherten Änderungen (Fokus auf „Speichern“, Esc = Abbrechen). */
export function frageSpeichern(projektName: string, anlass: string): Promise<SpeicherAntwort> {
  return oeffneDialog({
    titel: "Änderungen speichern?",
    text: `Das Projekt „${projektName}“ hat ungespeicherte Änderungen. Vor ${anlass} speichern?`,
    knoepfe: [{ id: "verwerfen", label: "Verwerfen" }, { id: "abbrechen", label: "Abbrechen" }, { id: "speichern", label: "Speichern", primaer: true }],
    abbruchId: "abbrechen",
  }).ergebnis as Promise<SpeicherAntwort>;
}
