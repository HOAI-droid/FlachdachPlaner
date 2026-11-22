# Arbeitsweise in diesem Projekt

Projekte: Spiele, Anwendungen und Websites. Antworte auf Deutsch. Ziel: sehr hohe Qualität bei sparsamem Tokenverbrauch (20-€-Abo, Limits sind knapp).

## Modelle und Rollen
- Hauptsession: **Sonnet** (Umsetzung, Tests, Routine). Du arbeitest meist selbst.
- `designer` (Fable): schreibt `DESIGN.md`. **Höchstens einmal pro Projekt** oder bei Redesign. Nie für Code.
- `architect` (Opus): `PLAN.md` mit testbaren Abnahmekriterien. Zu Projektstart und bei größeren Änderungen.
- `engineer` (Opus): nur für Kernlogik (Engine, Datenmodell, Sicherheit, Performance) und wenn ein Problem nach zwei eigenen Versuchen nicht gelöst ist.
- `reviewer` (Opus): Review an Meilensteinen, nicht öfter.
- `visual-qa` (Sonnet): Screenshot-Prüfung gegen DESIGN.md nach sichtbaren Änderungen.
- `helper` (Haiku): Suche, Testläufe, Logs, einfache Doku.

## Ablauf
0. Vage Projektidee ("bau mir X" ohne Zielgruppe, Zweck, Erfolgskriterium): zuerst den Skill `interview-me` anwenden (eine Frage nach der anderen, jeweils mit eigener Vermutung). Ergebnis nach Bestätigung in `docs/intent/<thema>.md` speichern. Erst danach `designer` und `architect`. Nicht im unbeaufsichtigten Betrieb.
1. Neues Projekt: `designer` → `DESIGN.md`, dann `architect` → `PLAN.md`. Beides kurz mit dem Nutzer abstimmen.
2. Plan Schritt für Schritt umsetzen, immer nur ein Schritt pro Durchgang. Tests zuerst bzw. gleichzeitig.
3. Nach jedem Schritt: `bash scripts/check.sh` (über `helper`). Nur bei grün weitermachen.
4. Nach sichtbaren Änderungen: `visual-qa`. Nur bei **ABGENOMMEN** weitermachen.
5. Nach jedem Meilenstein: `reviewer`, danach Fixes umsetzen und `PLAN.md` abhaken.
5b. Bei Gestaltungsmängeln empfiehlt `visual-qa` `/impeccable critique`, vor Projektende `/impeccable polish` (nur Web-UI, sofern die Impeccable-Skills installiert sind, siehe INSTALL.md). `check.sh` meldet Design-Funde des Detektors als Warnung; behebe sie, bevor du `visual-qa` rufst.
6. Danach `/clear` und mit `PLAN.md` weiterarbeiten.

## Token sparen
- Subagenten antworten kurz (Pfad, Ergebnis, Beleg), nie ganze Dateien.
- Große Ausgaben (Logs, Suchergebnisse) immer über `helper` zusammenfassen lassen.
- Triviale Einzelschritte selbst erledigen, nicht delegieren. Nach mehr als ca. 4 Tool-Aufrufen am Stück mit mechanischem Inhalt an `helper` delegieren.
- Keine ganzen Dateien ausgeben, wenn eine Änderung reicht. Keine neuen Abhängigkeiten ohne kurze Begründung.

## Kontext-Hygiene (Erinnerungen)
Du kannst `/clear` und `/compact` nicht selbst ausführen. Du bereitest den Wechsel vor und erinnerst den Nutzer.

**Sichere Zäsur** (dann am Ende deiner Antwort erinnern: "Zäsur erreicht: bitte `/clear` eingeben"), nur wenn ALLE Punkte stimmen:
1. Der Planschritt oder Meilenstein ist abgeschlossen und die Abnahmekriterien sind erfüllt.
2. `check.sh` ist grün, bei UI ist `visual-qa` ABGENOMMEN.
3. `PLAN.md` ist aktualisiert: Schritt abgehakt, Abschnitt **Übergabe** mit nächstem Schritt, offenen Punkten, wichtigen Entscheidungen und Stolperfallen (kurz, 5-10 Zeilen).
4. Änderungen sind committet (oder der Nutzer hat bewusst darauf verzichtet).
Wenn etwas davon fehlt, hole es nach, bevor du zum `/clear` rätst.

**Nicht zum `/clear` raten**, wenn mitten in einer Fehlersuche, einem halbfertigen Umbau, einer offenen Rückfrage an den Nutzer oder wenn wichtige Erkenntnisse nur im Verlauf stehen. Schreibe sie vorher in `PLAN.md` (Übergabe), oder rate in solchen Fällen zu `/compact <Fokus>`.

**Weitere Erinnerungen:**
- Kontext über ca. 150k Tokens (`/context`): nach dem aktuellen Schritt auf eine Zäsur hinarbeiten und das ansprechen.
- Einfache Nebenfrage mitten in einer langen Session: kurz beantworten, aber auf eine frische Session für Nebenthemen hinweisen.
- Neue Session: Lies zuerst `PLAN.md` (Abschnitt Übergabe), `DESIGN.md` nur bei UI-Arbeit, sonst nichts auf Vorrat.
- Automatisches Zusammenfassen läuft bei ca. 200k (`.claude/settings.json`). Prüfe mit `/autocompact`, dass der Wert greift.

## Qualität
- Definition of Done pro Schritt: Abnahmekriterien erfüllt, `check.sh` grün, bei UI `visual-qa` ABGENOMMEN.
- Halte dich an `DESIGN.md` (Tokens, Typografie, Abstände). Keine Abweichungen ohne Rücksprache.
