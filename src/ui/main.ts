import "@fontsource/ibm-plex-sans-condensed/latin-400.css";
import "@fontsource/ibm-plex-sans-condensed/latin-500.css";
import "@fontsource/ibm-plex-sans-condensed/latin-600.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "../styles/tokens.css";
import "../styles/app.css";
import { mountShell } from "./shell";
import { mountStage } from "./canvas/stage";
import { scaleDenominator } from "./canvas/viewport";
import { demoUnderlay } from "./demo";
import { zahl } from "./format";
import { mountEditor, SPEICHER_KEY } from "./editor";
import { parseProject } from "../core/index";

const root = document.getElementById("app");
if (root) {
  const shell = mountShell(root);
  const stage = mountStage(shell.stage);
  stage.onChange((vp, c) => {
    shell.status.cursor.textContent = c ? `x ${zahl(c[0], 3)} m  y ${zahl(c[1], 3)} m` : "x \u2013  y \u2013";
    shell.status.scale.textContent = `1:${Math.round(scaleDenominator(vp))}`;
  });
  const n = Number(new URLSearchParams(location.search).get("demo"));
  if (n > 0) {
    const d = demoUnderlay(n);
    stage.setLayer("unterlage", d.draw);
    stage.fit(...d.bounds);
  }
  let gespeichert: string | null = null;
  try { gespeichert = localStorage.getItem(SPEICHER_KEY); } catch { /* ohne Speicher weiter */ }
  const editor = mountEditor(shell, stage);
  try {
    if (gespeichert) { const r = parseProject(gespeichert); if (r.ok) editor.lade(r.projekt); }
  } catch { /* ohne Speicher weiter */ }
  (window as unknown as { __stage: typeof stage; __editor: typeof editor }).__stage = stage;
  (window as unknown as { __editor: typeof editor }).__editor = editor;
}
