/**
 * E2E: Varianten (anlegen, duplizieren, umbenennen, löschen) mit Undo/Redo.
 * Voraussetzung: Dev-Server läuft (npx vite --port 5199), Playwright global installiert.
 * Start:  NODE_PATH=$(npm root -g) node scripts/e2e-varianten.cjs [URL]
 * Prüft: Variantenliste, Statusleiste "ungespeichert", Strg+Z/Strg+Y je Aktion,
 *        Umschalten behält Undo-Verlauf, Löschen-Dialog nennt "Rückgängig mit Strg+Z".
 * Exit 0 = alles ok, 1 = Assertion/Fehler, auch bei Konsolenfehlern.
 */
const { chromium } = require("playwright");
const URL = process.argv[2] || "http://localhost:5199/";
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.error("FAIL:", msg); } else console.log("ok  :", msg); };
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = []; pg.on("pageerror", (e) => errs.push(String(e))); pg.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  await pg.goto(URL); await pg.waitForFunction(() => window.__editor);
  const dach = { id: "d1", name: "Dach", typ: "dach", aufbauten: [], zonen: [], vorgaben: {}, attika: [], tuerschwellen: [], kontur: [{id:"a",x:0,y:0},{id:"b",x:10,y:0},{id:"c",x:10,y:8},{id:"d",x:0,y:8}], entwaesserung: [] };
  const m = { ...(await pg.evaluate(() => window.__editor.modell)), dachflaechen: [dach] };
  await pg.evaluate((m) => window.__editor.lade(m), m);
  const status = async () => (await pg.textContent("[data-k=projekt-status]")) || "";
  const namen = () => pg.$$eval("button.variante", (e) => e.map((x) => x.textContent.trim()));
  const aktiv = () => pg.$$eval("button.variante", (e) => e.findIndex((x) => x.getAttribute("aria-current")));
  const flaechen = () => pg.evaluate(() => window.__editor.modell.dachflaechen.length);
  const settle = () => pg.waitForTimeout(150);
  const n0 = (await namen()).length;
  ok(!/ungespeichert/.test(await status()), "Start: nicht ungespeichert");

  // Anlegen
  await pg.click("[data-k=variante-neu]"); await settle();
  ok((await namen()).length === n0 + 1 && (await flaechen()) === 0, "Anlegen: leere Variante aktiv");
  ok(/ungespeichert/.test(await status()), "Anlegen: Status ungespeichert");
  await pg.keyboard.press("Control+z"); await settle();
  ok((await namen()).length === n0 && (await flaechen()) === 1, "Anlegen: Strg+Z");
  await pg.keyboard.press("Control+y"); await settle();
  ok((await namen()).length === n0 + 1, "Anlegen: Strg+Y");
  await pg.keyboard.press("Control+z"); await settle();

  // Duplizieren
  await pg.click("[data-k=variante-duplizieren]"); await settle();
  ok((await namen()).length === n0 + 1 && (await flaechen()) === 1, "Duplizieren: Kopie mit Dachfläche");
  await pg.keyboard.press("Control+z"); await settle();
  ok((await namen()).length === n0, "Duplizieren: Strg+Z");
  await pg.keyboard.press("Control+y"); await settle();
  ok((await namen()).length === n0 + 1, "Duplizieren: Strg+Y");

  // Umbenennen
  await pg.fill("[data-k=variante-name]", "Testname"); await pg.press("[data-k=variante-name]", "Enter"); await settle();
  ok((await namen()).includes("Testname"), "Umbenennen");
  await pg.keyboard.press("Control+z"); await settle();
  ok(!(await namen()).includes("Testname"), "Umbenennen: Strg+Z");
  await pg.keyboard.press("Control+y"); await settle();
  ok((await namen()).includes("Testname"), "Umbenennen: Strg+Y");

  // Umschalten behält Verlauf
  await pg.click("button.variante >> nth=0"); await settle();
  ok((await aktiv()) === 0, "Umschalten auf erste Variante");
  await pg.keyboard.press("Control+z"); await settle();
  ok(!(await namen()).includes("Testname"), "Umschalten: Undo-Verlauf bleibt (Umbenennen zurückgenommen)");
  await pg.keyboard.press("Control+y"); await settle();
  ok((await namen()).includes("Testname"), "Umschalten: Redo funktioniert");

  // Löschen
  const anzahl = (await namen()).length;
  await pg.click("[data-k=variante-loeschen]");
  const txt = await pg.textContent(".dialog-bg, [class*=dialog]");
  ok(/Rückgängig mit Strg\+Z/.test(txt || ""), "Löschen-Dialog nennt Strg+Z");
  await pg.click("[data-k=dialog-loeschen]"); await settle();
  ok((await namen()).length === anzahl - 1, "Löschen");
  await pg.keyboard.press("Control+z"); await settle();
  ok((await namen()).length === anzahl, "Löschen: Strg+Z");
  await pg.keyboard.press("Control+y"); await settle();
  ok((await namen()).length === anzahl - 1, "Löschen: Strg+Y");

  ok(errs.length === 0, "Keine Konsolenfehler " + JSON.stringify(errs));
  await b.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("FEHLER:", e.message); process.exit(1); });
