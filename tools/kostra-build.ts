/**
 * Erzeugt rulepacks/kostra-dwd-2020/pack.json aus lokal abgelegten KOSTRA-DWD-2020-Rasterdateien (ASC, entpackt).
 * Aufruf: node tools/kostra-build.ts <Rn_..._D00005_T005.asc> <Rn_..._D00005_T100.asc> [Ausgabe.json] [--ausgabe=JJJJ-MM-TT]
 * Quelle: https://opendata.dwd.de/climate_environment/CDC/grids_germany/return_periods/precipitation/KOSTRA/KOSTRA_DWD_2020/asc/
 *         (StatRR_KOSTRA-DWD-2020_D00005_ASC.zip → Rn_*_T005.asc, Rn_*_T100.asc)
 */
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { baueKostraPack, parseAsc, STANDARD_OPTIONEN } from "./kostra-lib.ts";

const args = process.argv.slice(2);
const opt = (n: string) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const pos = args.filter((a) => !a.startsWith("--"));
if (pos.length < 2) {
  console.error("Aufruf: node tools/kostra-build.ts <Rn_T005.asc> <Rn_T100.asc> [Ausgabe.json] [--ausgabe=JJJJ-MM-TT]");
  process.exit(1);
}
const heute = new Date().toISOString().slice(0, 10);
const pack = baueKostraPack(parseAsc(readFileSync(pos[0] ?? "", "utf8")), parseAsc(readFileSync(pos[1] ?? "", "utf8")), {
  ...STANDARD_OPTIONEN,
  version: opt("version") ?? "1.0.0",
  ausgabe: opt("ausgabe") ?? "KOSTRA-DWD-2020 (DWD-Veröffentlichung Dezember 2022)",
  gueltigAb: heute,
  quelleDetail: "opendata.dwd.de/climate_environment/CDC/grids_germany/return_periods/precipitation/KOSTRA/KOSTRA_DWD_2020/asc",
});
const ziel = pos[2] ?? "rulepacks/kostra-dwd-2020/pack.json";
writeFileSync(ziel, JSON.stringify(pack) + "\n", "utf8");
console.log(`${ziel}: ${(statSync(ziel).size / 1024).toFixed(0)} KB`);
