/** PDF-Export-Vorschau: Varianten, Unterlage (ein/aus, Deckkraft) einstellen und das fertige Blatt vor dem Speichern prüfen. */
import { oeffneDialog } from "./dialog";

export interface VorschauWahl { readonly ids: string[]; readonly unterlage: boolean; readonly deckkraft: number }

export interface VorschauQuelle {
  readonly liste: readonly { id: string; name: string; aktiv: boolean }[];
  /** Name der geladenen Unterlage; null = keine (Optionen entfallen). */
  readonly unterlageName: string | null;
  readonly start: VorschauWahl;
  /** PDF-Bytes zur Wahl; null, wenn nichts zu zeichnen ist (keine Dachfläche). */
  baue(w: VorschauWahl): Promise<Uint8Array | null>;
}

const mk = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

/** Zeigt Einstellungen und Seitenvorschau (pdf.js, Blatt 1…n); Ergebnis: gewählte Einstellungen oder null bei Abbruch. */
export async function zeigePdfVorschau(q: VorschauQuelle): Promise<VorschauWahl | null> {
  const wahl: { ids: Set<string>; unterlage: boolean; deckkraft: number } = { ids: new Set(q.start.ids), unterlage: q.start.unterlage && q.unterlageName !== null, deckkraft: q.start.deckkraft };
  const wurzel = mk("div", "vorschau");
  const opt = mk("div", "vorschau-opt");
  const bild = mk("div", "vorschau-bild");
  const canvas = mk("canvas");
  const status = mk("div", "note", "Vorschau wird erstellt …");
  bild.append(canvas, status);
  wurzel.append(opt, bild);

  const warn = mk("div", "note warn", "Mindestens eine Variante wählen.");
  warn.hidden = true;
  const pruefe = () => {
    const b = d.wurzel.querySelector<HTMLButtonElement>("[data-k='dialog-export']");
    if (b) b.disabled = wahl.ids.size === 0;
    warn.hidden = wahl.ids.size > 0;
  };

  if (q.liste.length > 1) {
    opt.append(mk("div", "panel-title", "Varianten"), warn);
    for (const v of q.liste) {
      const lab = mk("label", "check-row"), cb = mk("input");
      cb.type = "checkbox"; cb.checked = wahl.ids.has(v.id); cb.dataset.k = `export-${v.id}`;
      cb.addEventListener("change", () => { if (cb.checked) wahl.ids.add(v.id); else wahl.ids.delete(v.id); pruefe(); neu(); });
      lab.append(cb, mk("span", "", v.name + (v.aktiv ? " (aktiv)" : "")));
      opt.append(lab);
    }
  }
  if (q.unterlageName !== null) {
    opt.append(mk("div", "panel-title", "Unterlage"));
    const lab = mk("label", "check-row"), cb = mk("input");
    cb.type = "checkbox"; cb.checked = wahl.unterlage; cb.dataset.k = "export-unterlage";
    lab.append(cb, mk("span", "", `„${q.unterlageName}“ unter dem Plan zeigen`));
    const zeile = mk("label", "field");
    const wert = mk("span", "num", `${Math.round(wahl.deckkraft * 100)} %`);
    const rg = mk("input");
    rg.type = "range"; rg.min = "5"; rg.max = "100"; rg.step = "5"; rg.value = String(Math.round(wahl.deckkraft * 100)); rg.dataset.k = "export-deckkraft"; rg.disabled = !wahl.unterlage;
    rg.addEventListener("input", () => { wahl.deckkraft = Number(rg.value) / 100; wert.textContent = `${rg.value} %`; neu(); });
    cb.addEventListener("change", () => { wahl.unterlage = cb.checked; rg.disabled = !cb.checked; neu(); });
    const l = mk("span", "", "Deckkraft");
    zeile.append(l, rg, wert);
    zeile.classList.add("vorschau-regler");
    opt.append(lab, zeile);
  }
  const blattWahl = mk("select"); blattWahl.dataset.k = "export-blatt"; blattWahl.hidden = true;
  blattWahl.addEventListener("change", () => { void zeigeBlatt(Number(blattWahl.value)); });
  const blattLabel = mk("label", "field"); blattLabel.append(mk("span", "", "Blatt"), blattWahl);
  opt.append(mk("div", "panel-title", "Vorschau"), blattLabel);

  const d = oeffneDialog({
    titel: "PDF-Export: Vorschau", inhalt: wurzel, breit: true,
    knoepfe: [{ id: "abbrechen", label: "Abbrechen" }, { id: "export", label: "Als PDF speichern", primaer: true }], abbruchId: "abbrechen",
  });
  d.wurzel.classList.add("vorschau-dialog");
  pruefe();

  // Rendern: veraltete Läufe werden verworfen (Zähler); pdf.js läuft lokal gebündelt wie bei der Unterlage.
  type Dok = { numPages: number; getPage(n: number): Promise<{ getViewport(o: { scale: number }): { width: number; height: number }; render(o: unknown): { promise: Promise<void> } }>; destroy(): Promise<void> };
  let lauf = 0, doc = null as Dok | null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function zeigeBlatt(n: number) {
    if (!doc) return;
    const mein = lauf;
    const seite = await doc.getPage(n);
    if (mein !== lauf) return;
    const roh = seite.getViewport({ scale: 1 });
    const breite = Math.max(320, bild.clientWidth || 640), dpr = window.devicePixelRatio || 1;
    const sk = breite / roh.width, vp = seite.getViewport({ scale: sk * dpr });
    canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
    canvas.style.width = `${Math.ceil(vp.width / dpr)}px`; canvas.style.height = `${Math.ceil(vp.height / dpr)}px`;
    const cx = canvas.getContext("2d");
    if (!cx) return;
    cx.fillStyle = "#ffffff"; cx.fillRect(0, 0, canvas.width, canvas.height);
    await seite.render({ canvas, canvasContext: cx, viewport: vp }).promise;
    if (mein === lauf) status.hidden = true;
  }
  async function aktualisiere() {
    const mein = ++lauf;
    status.hidden = false; status.textContent = "Vorschau wird erstellt …";
    if (wahl.ids.size === 0) { status.textContent = "Wählen Sie mindestens eine Variante."; return; }
    try {
      const bytes = await q.baue({ ids: [...wahl.ids], unterlage: wahl.unterlage, deckkraft: wahl.deckkraft });
      if (mein !== lauf) return;
      if (!bytes) { status.textContent = "Nichts zu zeichnen: erst eine Dachfläche anlegen."; return; }
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
      const neuDoc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
      if (mein !== lauf) { void neuDoc.destroy(); return; }
      void doc?.destroy();
      doc = neuDoc as typeof doc;
      const vorher = Number(blattWahl.value) || 1;
      blattWahl.replaceChildren(...Array.from({ length: neuDoc.numPages }, (_, i) => { const o = mk("option", "", `${i + 1} von ${neuDoc.numPages}`); o.value = String(i + 1); return o; }));
      blattWahl.value = String(Math.min(vorher, neuDoc.numPages)); blattWahl.hidden = neuDoc.numPages < 2; blattLabel.hidden = neuDoc.numPages < 2;
      await zeigeBlatt(Number(blattWahl.value));
    } catch (e) { if (mein === lauf) status.textContent = `Vorschau nicht möglich: ${e instanceof Error ? e.message : String(e)}`; }
  }
  function neu() { clearTimeout(timer); timer = setTimeout(() => { void aktualisiere(); }, 250); }
  void aktualisiere();

  const antwort = await d.ergebnis;
  clearTimeout(timer); lauf++;
  void doc?.destroy();
  if (antwort !== "export" || wahl.ids.size === 0) return null;
  return { ids: q.liste.filter((v) => wahl.ids.has(v.id)).map((v) => v.id), unterlage: wahl.unterlage, deckkraft: wahl.deckkraft };
}
