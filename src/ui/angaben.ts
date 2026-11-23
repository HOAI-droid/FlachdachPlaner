/** Maske „Projektangaben“ (Plankopf): Büro, Bauherr, Datum, Revision … Jede Eingabe wird sofort geprüft und übernommen. */
import type { Projektmetadaten, ProjektangabenTeil } from "../core/index";
import { ANGABE_MAX_LAENGE, NOTIZ_MAX_LAENGE } from "../core/index";
import { oeffneDialog } from "./dialog";

type Art = "text" | "datum" | "lang";
interface FeldDef { readonly k: keyof ProjektangabenTeil & string; readonly label: string; readonly art?: Art; readonly pflicht?: boolean }

const GRUPPEN: readonly { readonly titel: string; readonly felder: readonly FeldDef[] }[] = [
  { titel: "Projekt", felder: [
    { k: "name", label: "Projektname", pflicht: true },
    { k: "projektnummer", label: "Projektnummer" },
    { k: "bauvorhaben", label: "Bauvorhaben" },
    { k: "bauherr", label: "Bauherr" },
    { k: "planinhalt", label: "Planinhalt" },
  ] },
  { titel: "Büro", felder: [
    { k: "bueroName", label: "Büroname" },
    { k: "bueroAnschrift", label: "Anschrift" },
    { k: "bueroKontakt", label: "Kontakt (Telefon, E-Mail)" },
    { k: "bearbeiter", label: "Bearbeiter" },
    { k: "geprueftVon", label: "Geprüft von" },
  ] },
  { titel: "Plan", felder: [
    { k: "planNummer", label: "Plan-Nr." },
    { k: "planDatum", label: "Plandatum", art: "datum" },
    { k: "revision", label: "Revision" },
    { k: "revisionDatum", label: "Revisionsdatum", art: "datum" },
  ] },
  { titel: "Notiz", felder: [{ k: "notiz", label: "Interne Notiz (nicht im Plankopf)", art: "lang" }] },
];

const mk = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

/** Heutiges Datum lokal als JJJJ-MM-TT. */
export const heuteIso = (d: Date = new Date()): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Baut das Formular; `setze` liefert eine Fehlermeldung oder null (übernommen). */
export function baueAngabenFormular(meta: Projektmetadaten, setze: (teil: ProjektangabenTeil) => string | null): HTMLElement {
  const wurzel = mk("div", "angaben");
  const werte = meta as unknown as Record<string, string | undefined>;
  for (const g of GRUPPEN) {
    const sec = mk("fieldset", "angaben-gruppe");
    sec.append(mk("legend", "", g.titel));
    for (const f of g.felder) {
      const zeile = mk("div", "field");
      const id = `angabe-${f.k}`;
      const l = mk("label", "", f.label + (f.pflicht ? " *" : "")); l.htmlFor = id;
      const i = f.art === "lang" ? mk("textarea") : mk("input");
      i.id = id; i.dataset.k = id;
      if (i instanceof HTMLInputElement) i.type = f.art === "datum" ? "date" : "text";
      if (i instanceof HTMLTextAreaElement) i.rows = 3;
      i.value = werte[f.k] ?? "";
      if (f.art !== "datum") i.maxLength = f.k === "notiz" ? NOTIZ_MAX_LAENGE : ANGABE_MAX_LAENGE;
      const fehler = mk("div", "note error"); fehler.hidden = true; fehler.setAttribute("role", "alert");
      fehler.id = `${id}-fehler`;
      i.setAttribute("aria-describedby", fehler.id);
      i.addEventListener("change", () => {
        const m = setze({ [f.k]: i.value });
        fehler.hidden = m === null; fehler.textContent = m ?? "";
        i.setAttribute("aria-invalid", m === null ? "false" : "true");
      });
      if (f.art === "datum") {
        i.lang = "de";
        const heute = mk("button", "btn", "Heute"); heute.type = "button"; heute.dataset.k = `${id}-heute`;
        heute.addEventListener("click", () => { i.value = heuteIso(); i.dispatchEvent(new Event("change")); });
        const z = mk("div", "feld-zeile"); z.append(i, heute);
        zeile.append(l, z);
      } else zeile.append(l, i);
      sec.append(zeile, fehler);
    }
    wurzel.append(sec);
  }
  return wurzel;
}

/** Öffnet die Maske als Dialog; Änderungen gelten sofort, „Fertig“ schließt. */
export function oeffneAngabenDialog(meta: Projektmetadaten, setze: (teil: ProjektangabenTeil) => string | null): Promise<void> {
  const d = oeffneDialog({
    titel: "Projektangaben (Plankopf)",
    text: "Diese Angaben erscheinen im Schriftfeld des PDF-Plans. Leere Felder zeigen „–“; ohne Plandatum gilt das Exportdatum.",
    inhalt: baueAngabenFormular(meta, setze),
    knoepfe: [{ id: "fertig", label: "Fertig", primaer: true }],
    abbruchId: "fertig",
    breit: true,
  });
  d.wurzel.querySelector<HTMLElement>("input")?.focus();
  return d.ergebnis.then(() => undefined);
}
