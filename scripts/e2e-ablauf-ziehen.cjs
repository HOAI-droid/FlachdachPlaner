/**
 * E2E Schritt 49: Ablauf per Ziehen verschieben.
 * Start:  (npx vite --port 5199 &)  NODE_PATH=$(npm root -g) node scripts/e2e-ablauf-ziehen.cjs [URL]
 * Prüft: Auswahl, Ziehen ändert Position (ein Undo-Schritt), Strg+Z stellt zurück, Esc bricht ab,
 *        Ziehen nach außerhalb der Kontur lässt die letzte gültige Lage stehen.
 */
const { chromium } = require("playwright");
const URL = process.argv[2] || "http://localhost:5199/";
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.error("FAIL:", msg); } else console.log("ok  :", msg); };
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = []; pg.on("pageerror", (e) => errs.push(String(e))); pg.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  await pg.goto(URL); await pg.waitForFunction(() => window.__editor && window.__stage);
  const dach = { id: "d1", name: "Dach", typ: "dach", aufbauten: [], zonen: [], vorgaben: {}, attika: [], tuerschwellen: [], kontur: [{id:"a",x:0,y:0},{id:"b",x:10,y:0},{id:"c",x:10,y:8},{id:"d",x:0,y:8}], entwaesserung: [{ id: "g1", art: "gully", name: "G1", position: { x: 5, y: 4 }, z: 0 }] };
  const m = { ...(await pg.evaluate(() => window.__editor.modell)), dachflaechen: [dach] };
  await pg.evaluate((m) => window.__editor.lade(m), m);
  await pg.evaluate(() => window.__stage.fit(-1, -1, 11, 9));
  await pg.waitForTimeout(200);
  const pos = () => pg.evaluate(() => window.__editor.modell.dachflaechen[0].entwaesserung[0].position);
  const schritte = () => pg.evaluate(() => window.__editor.verlauf?.zurueck?.length ?? -1);
  const scr = (x, y) => pg.evaluate(([x, y]) => { const v = window.__stage.viewport; const r = document.querySelector("canvas").getBoundingClientRect(); return [r.left + v.w / 2 + (x - v.cx) * v.scale, r.top + v.h / 2 - (y - v.cy) * v.scale]; }, [x, y]);
  const [sx, sy] = await scr(5, 4);
  await pg.mouse.click(sx, sy); await pg.waitForTimeout(100);
  // Ziehen nach (7,3)
  const [tx, ty] = await scr(7, 3);
  await pg.mouse.move(sx, sy); await pg.mouse.down(); await pg.mouse.move((sx + tx) / 2, (sy + ty) / 2, { steps: 4 }); await pg.mouse.move(tx, ty, { steps: 4 }); await pg.mouse.up();
  await pg.waitForTimeout(150);
  let p = await pos();
  ok(Math.abs(p.x - 7) < 0.3 && Math.abs(p.y - 3) < 0.3, `Ziehen: Position ~(7|3), ist (${p.x.toFixed(2)}|${p.y.toFixed(2)})`);
  await pg.keyboard.press("Control+z"); await pg.waitForTimeout(100);
  p = await pos();
  ok(Math.abs(p.x - 5) < 1e-9 && Math.abs(p.y - 4) < 1e-9, "Undo: ein Schritt stellt (5|4) wieder her");
  // Esc bricht ab
  await pg.mouse.click(sx, sy); await pg.waitForTimeout(100);
  await pg.mouse.move(sx, sy); await pg.mouse.down(); await pg.mouse.move(tx, ty, { steps: 6 });
  await pg.keyboard.press("Escape"); await pg.mouse.up(); await pg.waitForTimeout(100);
  p = await pos();
  ok(Math.abs(p.x - 5) < 1e-9 && Math.abs(p.y - 4) < 1e-9, "Esc: Ziehen abgebrochen, Position unverändert");
  // Außerhalb der Kontur: letzte gültige Lage bleibt
  const [ox, oy] = await scr(15, 4);
  await pg.mouse.click(sx, sy); await pg.waitForTimeout(100);
  await pg.mouse.move(sx, sy); await pg.mouse.down(); await pg.mouse.move(ox, oy, { steps: 10 }); await pg.mouse.up(); await pg.waitForTimeout(100);
  p = await pos();
  ok(p.x <= 10 + 1e-9 && p.x > 5, `Außerhalb: bleibt auf/in Kontur (x=${p.x.toFixed(2)})`);
  ok(errs.length === 0, "keine Konsolenfehler " + errs.join(";"));
  await b.close(); process.exit(fails ? 1 : 0);
})();
