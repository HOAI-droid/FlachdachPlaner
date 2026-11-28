import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { neuerePacks, parseManifest, pruefePackDatei, vergleicheVersion } from "../src/core/index";

const hashFn = async (b: Uint8Array) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", b as BufferSource)), (x) => x.toString(16).padStart(2, "0")).join("");
const text = readFileSync("rulepacks/daemmplatten/pack.json", "utf8");
const neuText = JSON.stringify({ ...JSON.parse(text), version: "0.3.0" });
const manifest = async (t = neuText, hash?: string) => ({
  packs: [{ id: "daemmplatten", version: "0.3.0", hash: hash ?? (await hashFn(new TextEncoder().encode(t))), datei: "packs/daemmplatten-0.3.0.json", notiz: "Test" }],
  programm: { version: "9.9.9" },
});

describe("Update-Funktion (22b)", () => {
  it("Versionsvergleich numerisch", () => {
    expect(vergleicheVersion("1.10.0", "1.9.0")).toBeGreaterThan(0);
    expect(vergleicheVersion("1.0", "1.0.0")).toBe(0);
  });
  it("erkennt neueres Pack, lädt, validiert", async () => {
    const m = parseManifest(await manifest()); if (!m.ok) throw new Error(m.meldung);
    const u = neuerePacks(m.manifest, { daemmplatten: "0.2.0", zvdh: "1.0.0" });
    expect(u).toHaveLength(1); expect(u[0]).toMatchObject({ alt: "0.2.0", neu: "0.3.0" });
    const r = await pruefePackDatei(u[0]!.eintrag, neuText, hashFn);
    expect(r.ok && r.pack.version).toBe("0.3.0");
  });
  it("gleiche oder ältere Version wird nicht angeboten", async () => {
    const m = parseManifest(await manifest()); if (!m.ok) throw new Error();
    expect(neuerePacks(m.manifest, { daemmplatten: "0.3.0" })).toHaveLength(0);
  });
  it("manipulierter Hash/Inhalt wird abgelehnt", async () => {
    const m = parseManifest(await manifest()); if (!m.ok) throw new Error();
    const r = await pruefePackDatei(m.manifest.packs[0]!, neuText.replace("0.02", "0.03"), hashFn);
    expect(r.ok).toBe(false);
  });
  it("Schemaverletzung trotz passendem Hash wird abgelehnt", async () => {
    const kaputt = JSON.stringify({ ...JSON.parse(neuText), daten: { format: 1 } });
    const m = parseManifest(await manifest(kaputt)); if (!m.ok) throw new Error();
    expect((await pruefePackDatei(m.manifest.packs[0]!, kaputt, hashFn)).ok).toBe(false);
  });
  it("Manifest mit absoluter/ausbrechender Pfadangabe wird abgelehnt", async () => {
    const base = await manifest();
    for (const datei of ["https://evil.example/x.json", "../x.json", "/etc/x"]) {
      expect(parseManifest({ ...base, packs: [{ ...base.packs[0], datei }] }).ok).toBe(false);
    }
  });
});
