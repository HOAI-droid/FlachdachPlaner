# Intent: Gefälleplanung Flachdach (Entwurf, Stand Interview 5/6)

## Zweck
Zeichen- und Planungswerkzeug für ein Architekturbüro: Gefälleplanung von Flachdächern, die heute aufwendig von Hand gelöst wird. Fokus: **Gefälleplanung**, nicht allgemeine Dachplanung.

## Nutzer / Plattform
- Büro-intern (Architekten, Zeichner), Windows und Mac.
- Web-App (TypeScript, Canvas, three.js); Desktop-Installation später über Tauri-Wrapper. Rust/WASM nur für Rechenkerne, falls nötig.
- Lokal, ohne Server/Login.

## Kernfunktionen
1. **Unterlage laden**: PDF und DXF (DWG später über Konverter). Darüberzeichnen mit **Punktfang**.
2. **Dachflächen zeichnen**: meist rechtwinklig (L/U/Rechteck), komplexe Formen als Ausnahme; Aufbauten (Lichtkuppeln, Lüfter, Aufzug), Attiken, **Dachterrassen** als Flächentyp.
3. **Gefälle**: Wert wählbar/eingebbar (Standard 2 %). Vorgaben: max. Höhe Hochpunkt, Mindesthöhe Tiefpunkt.
4. **Entwässerung**: Ziel Freispiegel, Innenentwässerung möglich. Zwei Modi: **B** Nutzer setzt Entwässerungspunkte, Software berechnet/prüft; **C** Software schlägt Gullys und Gefälleaufteilung vor. Immer Hinweis, **in welchem Bereich eine Notentwässerung** zu platzieren ist.
5. **Sprünge/Abstufungen** innerhalb der Fläche (z. B. Dachterrasse mit reduzierter Aufbauhöhe für Barrierefreiheit).
6. **Dachaufbau**: überwiegend **Warmdach als Gründach**, bituminöse Abdichtung; Maße für Abdichtung und Notabdichtung (Anschlusshöhen etc.) als parametrierbare Werte.
7. **Prüfung**: Mindestgefälle, Pfützen/Tiefpunkte, Höhenkonflikte (Attika, Türschwellen).
8. **3D-Ansicht** zum Verständnis.
9. **Export**: PDF und DXF (DWG später).

## Regelwerk (vom Nutzer angegeben, VOR Einsatz gegen Originaltext prüfen)
Flachdachrichtlinie (ZVDH) Ausgabe Januar 2026 + DIN 18531: Planungsziel i. d. R. 2 %; in begründeten Fällen (Retention, Intensivbegrünung, barrierefreie Übergänge, niedrige Anschlusshöhen) Flächen ohne Gefälle zulässig; unter 5 % gilt stehendes Wasser als normal. Regeln als konfigurierbare Parameter umsetzen, nicht hart verdrahten.

## Offen
- Frage 6: Umfang der ersten Version (MVP) und Erfolgskriterium.
- Konkrete Maße Abdichtung/Notabdichtung/Anschlusshöhen.
