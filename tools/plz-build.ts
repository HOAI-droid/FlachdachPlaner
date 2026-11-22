/**
 * Erzeugt rulepacks/orte-plz/pack.json aus der lokal abgelegten, entpackten GeoNames-Datei DE.txt.
 * Aufruf: node tools/plz-build.ts <DE.txt> [Ausgabe.json] [--ausgabe=Stand]
 * Quelle: https://download.geonames.org/export/zip/DE.zip (CC BY 4.0)
 */
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { baueOrtePack, parseGeonamesPlz } from "./plz-lib.ts";

const args = process.argv.slice(2);
const opt = (n: string) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const pos = args.filter((a) => !a.startsWith("--"));
if (pos.length < 1) {
  console.error("Aufruf: node tools/plz-build.ts <DE.txt> [Ausgabe.json] [--ausgabe=Stand]");
  process.exit(1);
}
const heute = new Date().toISOString().slice(0, 10);
const eintraege = parseGeonamesPlz(readFileSync(pos[0] ?? "", "utf8"));
if (eintraege.length === 0) { console.error("Keine gültigen PLZ-Zeilen gefunden."); process.exit(1); }
const pack = baueOrtePack(eintraege, { version: opt("version") ?? "1.0.0", ausgabe: opt("ausgabe") ?? `GeoNames-Abzug ${heute}`, gueltigAb: heute });
const ziel = pos[1] ?? "rulepacks/orte-plz/pack.json";
writeFileSync(ziel, JSON.stringify(pack) + "\n", "utf8");
console.log(`${ziel}: ${eintraege.length} Einträge, ${(statSync(ziel).size / 1024).toFixed(0)} KB`);
