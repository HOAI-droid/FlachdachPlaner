/** PDF-Seitenwahl mit Miniaturen (PLAN 35). Einseitig → ohne Dialog; Abbruch → null. */
import { oeffneDialog } from "./dialog";

const MINI_PX = 160;

/** Anzahl Seiten und Seitenwahl; `vorgabe` = bereits gespeicherte Seite (vorausgewählt). */
export async function waehlePdfSeite(file: File, vorgabe = 1): Promise<number | null> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  try {
    const n = doc.numPages;
    if (n <= 1) return 1;
    const start = Math.min(Math.max(1, vorgabe), n);
    let gewaehlt = start;
    const raster = document.createElement("div");
    raster.className = "pdf-seiten"; raster.setAttribute("role", "radiogroup"); raster.setAttribute("aria-label", "PDF-Seite");
    const knoepfe: HTMLButtonElement[] = [];
    const canvasse: HTMLCanvasElement[] = [];
    const dlg = oeffneDialog({
      titel: "PDF-Seite wählen",
      text: `Das PDF hat ${n} Seiten. Welche Seite soll als Unterlage dienen?`,
      inhalt: raster, breit: true, abbruchId: "abbrechen",
      knoepfe: [{ id: "abbrechen", label: "Abbrechen" }, { id: "ok", label: "Seite übernehmen", primaer: true }],
    });
    const markiere = () => knoepfe.forEach((b, i) => { b.setAttribute("aria-checked", String(i + 1 === gewaehlt)); b.classList.toggle("gewaehlt", i + 1 === gewaehlt); });
    for (let i = 1; i <= n; i++) {
      const b = document.createElement("button"); b.type = "button"; b.className = "pdf-seite"; b.dataset.seite = String(i);
      b.setAttribute("role", "radio"); b.setAttribute("aria-label", `Seite ${i}`);
      const c = document.createElement("canvas"); c.width = MINI_PX; c.height = Math.round(MINI_PX * 1.41);
      const l = document.createElement("span"); l.textContent = `Seite ${i}`;
      b.append(c, l);
      b.addEventListener("click", () => { gewaehlt = i; markiere(); });
      b.addEventListener("dblclick", () => dlg.schliesse("ok"));
      knoepfe.push(b); canvasse.push(c); raster.append(b);
    }
    markiere();
    knoepfe[start - 1]?.scrollIntoView?.({ block: "nearest" });
    let offen = true;
    // Miniaturen nacheinander (Hauptfaden bleibt bedienbar), danach Seitenspeicher freigeben.
    void (async () => {
      for (let i = 1; i <= n && offen; i++) {
        let page;
        try {
          page = await doc.getPage(i);
          const b = page.getViewport({ scale: 1 });
          const vp = page.getViewport({ scale: Math.min(MINI_PX / b.width, (MINI_PX * 1.41) / b.height) });
          const c = canvasse[i - 1]!; c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
          const ctx = c.getContext("2d");
          if (!ctx) continue;
          ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
          await page.render({ canvas: c, canvasContext: ctx, viewport: vp }).promise;
        } catch { /* Miniatur bleibt leer */ } finally { page?.cleanup(); }
        await new Promise((r) => setTimeout(r, 0));
      }
    })();
    const antwort = await dlg.ergebnis;
    offen = false;
    return antwort === "ok" ? gewaehlt : null;
  } finally { void doc.destroy(); }
}
