/**
 * E2E Schritt 45: Eingabe Oberkanten/Rinne/Belagdicke/Überlaufkante, Live-Zeilen, Undo.
 * Start: (npx vite --port 5199 &)  NODE_PATH=$(npm root -g) node scripts/e2e-anschluesse-eingabe.cjs [URL]
 */
const { chromium } = require("playwright");
const URL = process.argv[2] || "http://localhost:5199/";
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.error("FAIL:", msg); } else console.log("ok  :", msg); };
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = []; pg.on("pageerror", (e) => errs.push(String(e))); pg.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  await pg.goto(URL); await pg.waitForFunction(() => window.__editor && window.__stage);
  const dach = { id: "d1", name: "Dach", typ: "dach", aufbauten: [], zonen: [], vorgaben: {}, attika: [{ id: "at1", kante: "a", breite: 0.3 }], tuerschwellen: [{ id: "t1", lage: { kante: "b", abstand: 3 }, breite: 1 }], wandanschluesse: [{ id: "wa1", name: "Wand", lage: { kante: "c", abstand: 2 }, laenge: 3 }],
    kontur: [{id:"a",x:0,y:0},{id:"b",x:10,y:0},{id:"c",x:10,y:8},{id:"d",x:0,y:8}], entwaesserung: [{ id: "g1", art: "gully", name: "G1", position: { x: 5, y: 4 }, z: 0 }, { id: "n1", art: "notablauf", name: "N1", position: { x: 2, y: 4 }, z: 0 }] };
  const m = { ...(await pg.evaluate(() => window.__editor.modell)), dachflaechen: [dach] };
  await pg.evaluate((m) => window.__editor.lade(m), m);
  await pg.waitForTimeout(300);
  const sel = async (art, id) => { await pg.evaluate(([a, i]) => window.__editor.waehle({ art: a, id: i, dachId: "d1" }), [art, id]); await pg.waitForTimeout(150); };
  const txt = (k) => pg.evaluate((k) => document.querySelector(`[data-k="${k}"]`)?.textContent ?? null, k);
  const modell = () => pg.evaluate(() => window.__editor.modell.dachflaechen[0]);
  // Attika
  await sel("attika", "at1");
  ok(await pg.locator("#f-oberkante").count() === 1, "Attika: Feld OK Attika vorhanden");
  await pg.fill("#f-oberkante", "0.30"); await pg.keyboard.press("Enter"); await pg.waitForTimeout(200);
  ok((await modell()).attika[0].oberkante === 0.3, "Attika OK gesetzt = 0,30");
  ok((await txt("ah-soll")) !== null, "Attika: Zeile Anschlusshöhe soll sichtbar: " + await txt("ah-soll"));
  await pg.keyboard.press("Control+z"); await pg.waitForTimeout(150);
  ok((await modell()).attika[0].oberkante === undefined, "Undo: Attika OK wieder leer");
  // Tür: Rinne
  await sel("tuerschwelle", "t1");
  await pg.check("#f-rinne"); await pg.waitForTimeout(150);
  ok((await modell()).tuerschwellen[0].rinne === true, "Tür: Rinne gesetzt");
  // Wandanschluss
  await sel("wandanschluss", "wa1");
  await pg.fill("#f-oberkante", "0.25"); await pg.keyboard.press("Enter"); await pg.waitForTimeout(200);
  ok((await modell()).wandanschluesse[0].oberkante === 0.25, "Wandanschluss OK gesetzt");
  // Notablauf: Überlaufkante
  await sel("entwaesserung", "n1");
  ok(await pg.locator("#f-ueberlauf-kante").count() === 1, "Notablauf: Feld Überlaufkante");
  await pg.fill("#f-ueberlauf-kante", "0.04"); await pg.keyboard.press("Enter"); await pg.waitForTimeout(200);
  ok((await modell()).entwaesserung[1].ueberlaufKante === 0.04, "Überlaufkante gesetzt");
  // Gully: Feld darf nicht erscheinen
  await sel("entwaesserung", "g1");
  ok(await pg.locator("#f-ueberlauf-kante").count() === 0, "Gully: keine Überlaufkante");
  // Belagdicke Dach
  await sel("dach", "d1");
  await pg.fill("#f-belag-dicke", "0.04"); await pg.keyboard.press("Enter"); await pg.waitForTimeout(200);
  ok((await modell()).belagDicke === 0.04, "Belagdicke gesetzt");
  ok(errs.length === 0, "keine Konsolenfehler " + errs.join(";"));
  await b.close(); process.exit(fails ? 1 : 0);
})();
