/**
 * Dachaufbau aus drei Eingaben je Dachfläche: mittlere Dämmstärke, min. Tiefpunkt, max. Hochpunkt.
 * Aus ihnen werden Tiefpunktdicke (`daemmdickeTiefpunkt`) und Ablaufkoten abgeleitet; die Höhen im Plan
 * folgen daraus (Höhenfeld = Ablaufkoten + Gefälle). Rein, ohne UI.
 */
import { computeSlope, type SlopeOptionen } from "../slope";
import type { Dachflaeche, Id, ProjectModel } from "../model/types";
import type { Befehl } from "./history";

export interface Dachaufbau {
  /** Mittlere Gefälledämmdicke in mm. */
  readonly daemmMittel?: number;
  /** Tiefster zulässiger Ablaufpunkt z in m (legt die Kote des tiefsten Ablaufs fest). */
  readonly minTiefpunkt?: number;
  /** Höchster zulässiger Punkt z in m; leer = keine Warnung. */
  readonly maxHochpunkt?: number;
}

/** Mindestdicke am Tiefpunkt in mm, wenn die Mittelwert-Vorgabe sonst darunter käme. */
export const MIN_TIEFPUNKT_DICKE = 20;

export const dachaufbauVon = (d: Dachflaeche): Dachaufbau => ({
  ...(d.daemmMittel !== undefined ? { daemmMittel: d.daemmMittel } : {}),
  ...(d.vorgaben.minTiefpunkt !== undefined ? { minTiefpunkt: d.vorgaben.minTiefpunkt } : {}),
  ...(d.vorgaben.maxHochpunkt !== undefined ? { maxHochpunkt: d.vorgaben.maxHochpunkt } : {}),
});

const hauptAbl = (d: Dachflaeche) => d.entwaesserung.filter((e) => e.art !== "notablauf");

function ohneFeld<T extends object>(o: T, k: keyof T): T {
  if (!Object.hasOwn(o, k)) return o;
  const r = { ...o }; delete r[k]; return r;
}
function mitOptional<T extends object, K extends keyof T>(o: T, k: K, v: T[K] | undefined): T {
  if (v === undefined) return ohneFeld(o, k);
  return o[k] === v ? o : { ...o, [k]: v };
}

/**
 * Leitet für eine Dachfläche mit `daemmMittel` Tiefpunktdicke und Ablaufkoten ab:
 * d_TP = max(Mindestdicke, d_m − mittlerer Anstieg); tiefster Hauptablauf auf `minTiefpunkt`
 * (sonst OK Rohdecke (0) + d_TP); alle Abläufe werden gleichmäßig verschoben (relative Lagen bleiben).
 * Mit `verschieben` false bleiben die Koten (nur die Tiefpunktdicke wird neu bestimmt).
 * Ohne `daemmMittel` oder ohne Hauptablauf unverändert.
 */
export function leiteHoehenAb(m: ProjectModel, dachId: Id, opt: SlopeOptionen = {}, verschieben = true): ProjectModel {
  const d = m.dachflaechen.find((x) => x.id === dachId);
  if (!d || d.daemmMittel === undefined || hauptAbl(d).length === 0) return m;
  const dg = computeSlope(m, opt).dachflaechen.find((x) => x.dachflaecheId === dachId);
  if (!dg?.daemmung) return m;
  const anstieg = dg.daemmung.mittel - dg.daemmung.tiefpunktDicke;
  const dtp = Math.max(MIN_TIEFPUNKT_DICKE, d.daemmMittel - anstieg);
  const zTief = d.vorgaben.minTiefpunkt ?? (d.vorgaben.okRohdecke ?? 0) + dtp / 1000;
  const verschub = zTief - Math.min(...hauptAbl(d).map((e) => e.z));
  const neu: Dachflaeche = {
    ...d, daemmdickeTiefpunkt: dtp,
    entwaesserung: !verschieben || Math.abs(verschub) < 1e-9 ? d.entwaesserung : d.entwaesserung.map((e) => ({ ...e, z: e.z + verschub })),
  };
  return { ...m, dachflaechen: m.dachflaechen.map((x) => (x.id === dachId ? neu : x)) };
}

/**
 * Setzt die drei Eingaben (`undefined` entfernt) und leitet die Höhen neu ab.
 * Negative/nicht endliche Werte ändern nichts.
 */
export function setDachaufbau(dachId: Id, werte: Dachaufbau, opt: SlopeOptionen = {}): Befehl {
  return {
    label: "Dachaufbau ändern",
    anwenden: (m) => {
      const d = m.dachflaechen.find((x) => x.id === dachId);
      if (!d) return m;
      if (werte.daemmMittel !== undefined && !(Number.isFinite(werte.daemmMittel) && werte.daemmMittel >= 0)) return m;
      for (const v of [werte.minTiefpunkt, werte.maxHochpunkt]) if (v !== undefined && !Number.isFinite(v)) return m;
      let n = mitOptional(d, "daemmMittel", werte.daemmMittel);
      let vorg = mitOptional(d.vorgaben, "minTiefpunkt", werte.minTiefpunkt);
      vorg = mitOptional(vorg, "maxHochpunkt", werte.maxHochpunkt);
      if (vorg !== d.vorgaben) n = { ...n, vorgaben: vorg };
      if (werte.daemmMittel === undefined && n.daemmdickeTiefpunkt !== undefined && d.daemmMittel !== undefined) n = ohneFeld(n, "daemmdickeTiefpunkt");
      if (n === d) return m;
      return leiteHoehenAb({ ...m, dachflaechen: m.dachflaechen.map((x) => (x.id === dachId ? n : x)) }, dachId, opt);
    },
  };
}

/**
 * Hüllt einen Befehl, der Abläufe setzt: bei Dachflächen mit `daemmMittel` bekommt der neue Ablauf die Kote
 * des tiefsten vorhandenen Hauptablaufs, danach werden die Höhen abgeleitet.
 */
export function mitAbleitung(b: Befehl, dachId: Id, opt: SlopeOptionen = {}): Befehl {
  return {
    label: b.label,
    anwenden: (m) => {
      const vorher = m.dachflaechen.find((x) => x.id === dachId);
      const r = b.anwenden(m);
      const d = r.dachflaechen.find((x) => x.id === dachId);
      if (!vorher || !d || d.daemmMittel === undefined || r === m) return r;
      const alt = new Set(vorher.entwaesserung.map((e) => e.id));
      const z0 = hauptAbl(vorher).length > 0 ? Math.min(...hauptAbl(vorher).map((e) => e.z)) : undefined;
      const angepasst = z0 === undefined ? r : {
        ...r, dachflaechen: r.dachflaechen.map((x) => (x.id !== dachId ? x
          : { ...x, entwaesserung: x.entwaesserung.map((e) => (alt.has(e.id) || e.art === "notablauf" ? e : { ...e, z: z0 })) })),
      };
      // Nur der erste Ablauf legt die Höhenlage fest; später gesetzte oder von Hand angehobene Koten bleiben.
      return leiteHoehenAb(angepasst, dachId, opt, z0 === undefined);
    },
  };
}
