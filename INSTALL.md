# Einrichtung (v3)

Auf einem **neuen Branch** arbeiten: `git checkout -b claude-setup`

## 1. Dateien einspielen
Inhalt dieses Pakets in den Projekt-Hauptordner entpacken. Bestehende Dateien NICHT überschreiben:
- `CLAUDE.md` vorhanden: Inhalt der neuen unten anhängen oder Claude bitten, beide zusammenzuführen.
- `.claude/settings.json` vorhanden: nur die Zeile `CLAUDE_CODE_AUTO_COMPACT_WINDOW` im `env`-Block ergänzen.
- `scripts/check.sh` vorhanden: meine unter anderem Namen ablegen und in `CLAUDE.md` anpassen.

Enthalten: 6 Agents (designer/Fable, architect/Opus, engineer/Opus, reviewer/Opus, visual-qa/Sonnet, helper/Haiku), Skill `interview-me` (MIT, Addy Osmani), `scripts/check.sh`, `CLAUDE.md`.

## 2. Impeccable (nur für Web-Projekte, optional)
Der **Detektor** läuft schon ohne Installation über `npx impeccable detect` (in `check.sh` und im `visual-qa`).
Für die Befehle `/impeccable critique` und `/impeccable polish` die Skills ohne Hooks installieren:

    npx impeccable install --no-hooks

Danach in Claude Code neu laden. `/impeccable init` und `/impeccable document` NICHT nutzen: Das macht unser `designer` (sonst entstehen zwei `DESIGN.md`-Wege).
Warum `--no-hooks`: Impeccable-Hooks laufen auch dann, wenn du Claude eigene Befehle verbietest, und laden beim ersten Edit eine Engine nach. Wer sie trotzdem will, lässt `--no-hooks` weg und liest vorher `hooks.json`.

## 3. Playwright für Screenshots (`visual-qa`)
    npm i -D playwright && npx playwright install chromium

## 4. Starten
1. Neue Session mit Sonnet. `/autocompact` prüfen (soll 200k zeigen, sonst `/autocompact 200k`).
2. Sag: „Ich möchte X bauen.“ → Claude startet mit `interview-me`, danach `designer` und `architect`.

## 5. Prüfen
- `/agents` zeigt die sechs Agents. Modelle mit `/tasks` kontrollieren (`opus`/`sonnet` müssen auf 5.5 zeigen, sonst vollen Modellnamen eintragen).
- `bash scripts/check.sh` einmal von Hand laufen lassen.
- Detektor-Funde sind Warnungen. Streng machen mit `DESIGN_STRICT=1`, abschalten mit `DESIGN_CHECK=0`.
