import { describe, expect, it } from "vitest";
import { createViewport, fitBounds } from "../src/ui/canvas/viewport";
import { LAYER_ORDER } from "../src/ui/canvas/stage";
import { Belegung, geteilteBelegung, neuerDurchgang, passtText, platziere } from "../src/ui/zeichnen";

const basis = createViewport(1076, 636);
const vpA = fitBounds(basis, 2, 1, 18, 9);    // nur Dach A sichtbar
const vpB = fitBounds(basis, 28, -1, 44, 11); // nur Dach B sichtbar

describe("Belegung (Label-Kollision in Bildschirm-px)", () => {
  it("sperre/belege rechnen mit dem Viewport des Durchgangs", () => {
    const b = new Belegung(vpB);
    expect(b.belege({ x: 36, y: 5 }, 0, 0, 30, 14)).toBe(true);
    expect(b.belege({ x: 36, y: 5 }, 10, 0, 30, 14)).toBe(false); // Überlappung
    b.sperre({ x: 33, y: 5 }, -10, -10, 20, 20);
    expect(b.belege({ x: 33, y: 5 }, 0, 0, 5, 5)).toBe(false);
    expect(new Belegung(vpA).belege({ x: 36, y: 5 }, 0, 0, 30, 14)).toBe(false); // außerhalb von vpA
  });

  it("Regression: Viewport-Wechsel ohne Reset liefert keine veraltete Belegung (Dach B ohne Zahlen)", () => {
    // Durchgang 1 (Ansicht A): eine Ebene belegt etwas, Reset fand vorher statt
    neuerDurchgang();
    expect(geteilteBelegung(vpA).belege({ x: 5, y: 4 }, 0, 0, 40, 14)).toBe(true);
    // Durchgang 2 (Ansicht B): die Dämmplan-Ebene läuft vor der Kontur-Ebene – ohne Reset
    const b = geteilteBelegung(vpB);
    expect(b.belege({ x: 36, y: 5 }, 0, 0, 30, 14)).toBe(true);
  });

  it("neuerDurchgang verwirft alle Rechtecke (gleicher Viewport, neues Bild)", () => {
    neuerDurchgang();
    expect(geteilteBelegung(vpB).belege({ x: 36, y: 5 }, 0, 0, 30, 14)).toBe(true);
    neuerDurchgang();
    expect(geteilteBelegung(vpB).belege({ x: 36, y: 5 }, 0, 0, 30, 14)).toBe(true);
  });

  it("Dämmplan-Ebene liegt in der Zeichenreihenfolge vor der Kontur (Reset darf nicht an einer Ebene hängen)", () => {
    expect(LAYER_ORDER.indexOf("daemmplan")).toBeLessThan(LAYER_ORDER.indexOf("kontur"));
  });

  it("platziere: erste freie Stufe, sonst null (kein Ausweichen ins Endlose)", () => {
    const b = new Belegung(vpB);
    const p = { x: 30, y: 5 };
    b.sperre(p, -2, 46, 400, 18); // erste Stufe über der Kante belegt
    expect(platziere(b, p, -2, [46, 64, 82], 200, 18)).toBe(64);
    const voll = new Belegung(vpB);
    voll.sperre(p, -1000, -1000, 3000, 3000);
    expect(platziere(voll, p, -2, [46, 64, 82], 200, 18)).toBeNull();
    // außerhalb der Zeichenfläche zählt nicht als frei
    expect(platziere(new Belegung(vpB), p, -2, [10_000], 50, 18)).toBeNull();
  });

  it("passtText: Maßtext nur, wenn Strecke ≥ Textbreite + Rand", () => {
    expect(passtText(60, 52)).toBe(true);
    expect(passtText(59.9, 52)).toBe(false);
    expect(passtText(10, 40)).toBe(false);
  });
});
