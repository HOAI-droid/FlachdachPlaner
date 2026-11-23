/**
 * E2E: Export-Dialog (Variantenwahl) und Projektangaben-Maske.
 * Start:  NODE_PATH=$(npm root -g) node scripts/e2e-dialoge.cjs [URL]   (Dev-Server auf 5199)
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
  const settle = () => pg.waitForTimeout(150);
  await pg.click("[data-k=variante-duplizieren]"); await settle();

  // Export-Dialog
  await pg.click("text=Plan als PDF"); await settle();
  const boxen = await pg.$$("input[data-k^=export-]");
  ok(boxen.length === 2, "Export-Dialog: zwei Varianten wählbar");
  const exp = pg.locator("[data-k=dialog-export]");
  ok(await exp.isEnabled(), "Export: mit aktiver Variante aktiv");
  for (const c of boxen) await c.uncheck();
  ok(await exp.isDisabled(), "Export: ohne Auswahl deaktiviert");
  ok(await pg.locator(".note.warn").isVisible(), "Export: Hinweis sichtbar");
  await boxen[0].check();
  ok(await exp.isEnabled(), "Export: wieder aktiv nach Auswahl");
  await pg.click("[data-k=dialog-abbrechen]"); await settle();
  ok((await pg.$$("input[data-k^=export-]")).length === 0, "Export: Abbrechen schließt");

  // Angaben-Maske
  const meta = () => pg.evaluate(() => window.__editor.modell.meta);
  await pg.click("[data-k=projektangaben]"); await settle();
  await pg.fill("[data-k=angabe-bauherr]", "Muster GmbH"); await pg.press("[data-k=angabe-bauherr]", "Tab"); await settle();
  ok((await meta()).bauherr === "Muster GmbH", "Angaben: Bauherr übernommen");
  await pg.click("[data-k=angabe-planDatum-heute]"); await settle();
  ok(/^\d{4}-\d{2}-\d{2}$/.test((await meta()).planDatum || ""), "Angaben: Heute setzt Plandatum");
  await pg.fill("[data-k=angabe-name]", ""); await pg.press("[data-k=angabe-name]", "Tab"); await settle();
  ok(await pg.locator("#angabe-name-fehler").isVisible(), "Angaben: leerer Projektname zeigt Fehler");
  ok((await meta()).name !== "", "Angaben: leerer Name wird nicht übernommen");
  await pg.fill("[data-k=angabe-name]", "Haus 7"); await pg.press("[data-k=angabe-name]", "Tab"); await settle();
  ok(!(await pg.locator("#angabe-name-fehler").isVisible()), "Angaben: Fehler verschwindet");
  await pg.click("[data-k=dialog-fertig]"); await settle();
  ok(/ungespeichert/.test((await pg.textContent("[data-k=projekt-status]")) || ""), "Angaben: Status ungespeichert");
  await pg.keyboard.press("Control+z"); await settle();
  ok((await meta()).name !== "Haus 7", "Angaben: Strg+Z nimmt zurück");

  ok(errs.length === 0, "Keine Konsolenfehler " + JSON.stringify(errs));
  await b.close(); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("FEHLER:", e.message); process.exit(1); });
