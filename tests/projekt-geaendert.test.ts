import { describe, expect, it, vi } from "vitest";
import { createProject, neuerVerlauf, ausfuehren, rueckgaengig, istGeaendert, setAttika } from "../src/core/index";
import { schuetzeTauriFenster, type FensterApi } from "../src/ui/schliessen";

const m0 = createProject("T", "2026-01-01T00:00:00.000Z");
const aender = { label: "Änderung", anwenden: (m: typeof m0) => ({ ...m, meta: { ...m.meta, name: "Neu" } }) };

describe("Änderungsstatus", () => {
  it("nach Befehl geändert, nach Undo bis zum Stand wieder nicht", () => {
    const v0 = neuerVerlauf(m0);
    expect(istGeaendert(v0, m0)).toBe(false);
    const v1 = ausfuehren(v0, aender);
    expect(istGeaendert(v1, m0)).toBe(true);
    expect(istGeaendert(rueckgaengig(v1), m0)).toBe(false);
  });
  it("nach Speichern (neuer Stand = aktuelles Modell) nicht geändert", () => {
    const v1 = ausfuehren(neuerVerlauf(m0), aender);
    expect(istGeaendert(v1, v1.aktuell)).toBe(false);
    expect(istGeaendert(rueckgaengig(v1), v1.aktuell)).toBe(true);
  });
  it("unverändernder Befehl bleibt ungeändert", () => {
    const v = ausfuehren(neuerVerlauf(m0), { label: "nichts", anwenden: (m) => m });
    expect(istGeaendert(v, m0)).toBe(false);
    void setAttika;
  });
});

function fenster() {
  let handler: ((e: { preventDefault(): void }) => void | Promise<void>) | null = null;
  const api: FensterApi = { onCloseRequested: async (h) => { handler = h; return () => {}; }, destroy: vi.fn(async () => {}) };
  const schliesse = async () => { const e = { preventDefault: vi.fn() }; await handler!(e); return e; };
  return { api, schliesse };
}

describe("Tauri-Schließlogik (gemockte Fenster-API)", () => {
  it("Abbrechen → preventDefault, nie destroy", async () => {
    const f = fenster(); await schuetzeTauriFenster(f.api, async () => false);
    const e = await f.schliesse();
    expect(e.preventDefault).toHaveBeenCalled(); expect(f.api.destroy).not.toHaveBeenCalled();
  });
  it("Speichern/Verwerfen erlaubt → destroy", async () => {
    const f = fenster(); await schuetzeTauriFenster(f.api, async () => true);
    await f.schliesse(); expect(f.api.destroy).toHaveBeenCalledTimes(1);
  });
  it("Fehler im Speichern → nicht schließen", async () => {
    const f = fenster(); await schuetzeTauriFenster(f.api, async () => { throw new Error("x"); });
    await f.schliesse(); expect(f.api.destroy).not.toHaveBeenCalled();
  });
});
