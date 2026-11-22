import { version } from "../core/index";

const root = document.getElementById("app");
if (root) root.textContent = `Flachdachplaner ${version}`;
