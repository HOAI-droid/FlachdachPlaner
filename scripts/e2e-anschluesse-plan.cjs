/** E2E Schritt 46: Ebene „Anschlüsse“ im 2D-Plan (Screenshot + Schalter). Start wie e2e-anschluesse-eingabe.cjs. Optional 2. Arg: Screenshot-Pfad. */
const { chromium } = require("playwright");
const URL = process.argv[2] || "http://localhost:5199/";
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.error("FAIL:", msg); } else console.log("ok  :", msg); };
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = []; pg.on("pageerror", (e) => errs.push(String(e))); pg.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  await pg.goto(URL); await pg.waitForFunction(() => window.__editor && window.__stage);
  const dach = { id: "d1", name: "Dach", typ: "dach", aufbauten: [], zonen: [], vorgaben: {}, attika: [{ id: "at1", kante: "a", breite: 0.3, oberkante: 0.1 }], tuerschwellen: [{ id: "t1", lage: { kante: "b", abstand: 3 }, breite: 1 }], wandanschluesse: [{ id: "wa1", name: "Wand", lage: { kante: "c", abstand: 2 }, laenge: 3, oberkante: 0.5 }],
    kontur: [{id:"a",x:0,y:0},{id:"b",x:10,y:0},{id:"c",x:10,y:8},{id:"d",x:0,y:8}], entwaesserung: [{ id: "g1", art: "gully", name: "G1", position: { x: 5, y: 4 }, z: 0 }, { id: "n1", art: "notablauf", name: "N1", position: { x: 2, y: 4 }, z: 0, ueberlaufKante: 0.085 }] };
  const m = { ...(await pg.evaluate(() => window.__editor.modell)), dachflaechen: [dach] };
  await pg.evaluate((m) => window.__editor.lade(m), m);
  await pg.evaluate(() => window.__stage.fit(-1, -1, 11, 9));
  await pg.waitForTimeout(400);
  ok(await pg.locator("#ebene-anschluesse").count() === 1, "Schalter Ebene Anschlüsse vorhanden");
  ok(await pg.locator("#ebene-anschluesse").isChecked(), "Ebene standardmäßig an");
  if (process.argv[3]) await pg.screenshot({ path: process.argv[3] });
  await pg.locator("#ebene-anschluesse").uncheck(); await pg.waitForTimeout(200);
  ok(!(await pg.locator("#ebene-anschluesse").isChecked()), "Ebene abschaltbar");
  ok(errs.length === 0, "keine Konsolenfehler " + errs.join(";"));
  await b.close(); process.exit(fails ? 1 : 0);
})();
