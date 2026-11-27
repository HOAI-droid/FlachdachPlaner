# FlachdachPlaner

Lokales Planungswerkzeug für die **Gefälleplanung von Flachdächern**. Es ersetzt die heute meist händische Arbeit: Grundriss laden, Dachfläche nachzeichnen, Entwässerung setzen – die Software berechnet Höhenkoten, Gefälle und Einzugsflächen, prüft gegen das Regelwerk und erzeugt einen **Gefälledämmplan (Verlegeplan)**.

> **Status:** in Entwicklung. Der Rechenkern entsteht Schritt für Schritt (siehe [`PLAN.md`](PLAN.md)); die Oberfläche folgt. Dieses README beschreibt den geplanten Funktionsumfang von V1 und kennzeichnet, was bereits umgesetzt ist.
> Screenshots folgen, sobald die Oberfläche steht.

## Für wen?

Architekten und Zeichner im Büro, die Flachdächer (meist Warmdach mit Gründach, bituminöse Abdichtung) planen. Der Fokus liegt bewusst auf der **Gefälleplanung**, nicht auf allgemeiner Dachplanung.

## Funktionen (V1)

### Unterlage und Zeichnen
- **PDF- und DXF-Unterlagen** laden und darüberzeichnen (DWG ist ausdrücklich nicht vorgesehen).
- **Deckkraft-Regler** im Panel Unterlage (5–100 %).
- **Maßstab/Kalibrierung:** Eingabe 1:n oder Zwei-Punkt-Kalibrierung über eine bekannte Strecke; der Maßstab steht in der Statusleiste.
- **Punktfang:** Endpunkt, Mittelpunkt, Schnittpunkt, Lot, Ortho – auch auf den Linien der Unterlage.
- **Zeichenwerkzeuge:** Dachkontur (Rechteck, L, U und freie Formen), Attika, Aufbauten (Lichtkuppel, Lüfter, Aufzug …), Dachterrassen, Türschwellen; Undo/Redo.
- **Planaktualisierung:** Wird die Unterlage durch eine neue Version ersetzt, werden Maßstab und Lage über zwei Passpunkte übernommen. Die Software meldet gezeichnete Punkte, die um mehr als eine Toleranz (Standard 2 cm) von den neuen Fangpunkten abweichen, und schlägt die Korrektur vor – einzeln oder gesammelt nachziehbar.

### Entwässerung
- **Modus B (V1):** Der Nutzer setzt Entwässerungspunkte, die Software berechnet und prüft.
  - Gully, Notablauf, **Dachreiter** (mit exakten Herstellermaßen) und **Linienentwässerung (LES)** (z. B. Bauder: Gefälle längs 1 %, quer 4 %, diagonal 3,5 %, Keil 6,00 m × 1,50 m je Seite, 10 → 70 mm).
  - Abläufe lassen sich nach dem Markieren mit der Maus ziehen (Fang wie beim Zeichnen, ein Undo-Schritt, Esc bricht ab).
  - Herstellerdaten stammen aus Datenpaketen, nicht aus dem Code. Es gibt keine LES-Sets.
- **Modus C (V1.1):** Die Software schlägt Anzahl und Position der Abläufe sowie die Gefälleaufteilung vor.

### Berechnung
- **Ablauftiefe:** Für jeden Ablauf (Tiefpunkt) lässt sich angeben, wie tief er sitzt (Kote `z`). Daraus ergibt sich maßgeblich die Gefällesituation: Unterschiedlich tiefe Abläufe verschieben Grate und Kehlen sowie die Koten.
- **Mittlere Gefälledämmung:** Je Dachfläche wird die mittlere Dämmdicke in mm ausgegeben (zusätzlich Minimum und Maximum), flächengewichtet und ohne Aufbauten. Das ist bauphysikalisch ein maßgeblicher Wert; ein U-Wert-Nachweis ist in V1 nicht enthalten.
- **Höhenfeld** aus Entwässerungselementen, deren Tiefenlage und Gefälle (Standard 2 %): ebene Facetten, Hochpunkte (HP), Tiefpunkte (TP), Grate und Kehlen, Höhenkoten und Gefällepfeile.
- **Einzugsflächen** je Ablauf, **farbig und ohne Schraffur**, mit Flächengröße in m². Aufbauten werden abgezogen. Die **Attikafläche** (Horizontalprojektion) wird dem angrenzenden Ablauf zugeschlagen. Je Ablauf werden Dachfläche, Attikafläche und Gesamtfläche getrennt ausgewiesen, z. B. `E3 · Dach 296 m² + Attika 24 m² = 320 m²`.
- **Zonen und Stufen:** Dachterrassen mit reduziertem Aufbau (z. B. −0,10 m für Barrierefreiheit), 0-%-Zonen mit Begründung, Vorgaben für maximale Höhe des Hochpunkts und Mindesthöhe des Tiefpunkts.
- **Regenspende** aus KOSTRA zum Projektstandort (offline, Datenquelle OpenKOSTRA): Standort per Koordinate (WGS84/UTM), PLZ/Ort oder Klick auf eine Deutschlandkarte. Der Pack-Wert bleibt sichtbar, ein manuell überschriebener Wert wird mit Differenz ausgewiesen.
- **Notentwässerung (Schätzung):** Q = r · C · A / 10 000 (l/s) je Einzugsfläche, Anzahl und Bereich der Notabläufe. Das ist eine Schätzung, **keine hydraulische Bemessung**.

### Regelprüfung
Jeder Befund nennt Stufe, Objekt, **Regel-ID und Quelle**. Geprüft werden unter anderem:
- Mindestgefälle und stehendes Wasser (Pfützen, Tiefpunkte)
- Fläche je Ablauf: Hinweis ab 300 m², Fehler über 350 m² (Werte aus dem Regelwerk-Paket)
- Anschlusshöhen an Attika, Wandanschluss, Türschwelle (mit/ohne Rinne) und Aufbauten: Anschlusshöhe = OK Anschluss − OK fertige Oberfläche (über OK Belag) an der ungünstigsten Stelle; Sollwerte nur aus dem Regelwerk-Paket (ungeprüft)
- Notentwässerung: Überflutungskante, Überfallhöhe und Notwasserstand als **Schätzung** (Pack-Wert oder Nutzerwert; ohne Produktdaten nur die Kante); Befund bei Kante unter der Hauptentwässerung
- Barrierefreie Schwellen (Abstand ≤ 10,0 m, Überflutungskante ≥ 5 cm tiefer)
- Hinweise „Regelwerk ungeprüft“ und „Regenspende manuell überschrieben“

Die Prüfliste ist nach Schwere sortiert; ein Klick springt zum betroffenen Objekt.

### Gefälledämmplan (Verlegeplan)
- Plattenaufteilung je Facette: Reihen quer zur Fallrichtung ab Tiefpunkt, Plattentypen aus der Höhe, Zuschnitte an Facettengrenzen und Kontur.
- **Kehlkeile** (Kn L/R) an Kehlen, gespiegelte Platten an Graten, **Zusatzlage** über dem höchsten Typ mit Neustart der Reihe, N0 und Verlegestart.
- Rechnung zunächst mit Platten **1,00 × 1,00 m**; Format, Dickenstufen und Typen sind Pack-Parameter. Ein Herstellerkatalog folgt später.
- Maß- und Lückenprüfung: Plattenfläche = Dachfläche, keine Lücken, keine Überlappungen. Kehlen, die nicht 45° haben, werden als Befund gemeldet.
- **Keine Stückliste** in V1.

### Ansichten und Export
- **2D** mit Koten, Pfeilen, Einzugsflächen, Ablauf-Koten, Ø Gefälledämmung je Dachfläche und Dämmplan inkl. Maßketten.
- **3D** aus dem Höhenfeld mit wählbarer Überhöhung (1/5/10×) mit Gefällepfeilen; der Dämmplan zeigt dieselbe Dachfläche zusätzlich mit den Plattenfugen quer zum Gefälle (Umschalter Gefälle/Dämmplan in der Kopfzeile).
- **PDF-Export** (maßstäblich, Vektor) mit Schriftfeld, Legende, Nordpfeil und Maßstabsbalken sowie Tabelle der Ablauf-Koten und der mittleren Gefälledämmung.
- **DXF-Export** mit Layern je Objektart.

## Regelwerk als Datenpakete (Rule-Packs)

Richtlinien, Grenzwerte, Herstellerdaten und Regenspenden stehen als **versionierte JSON-Pakete** in `rulepacks/`, getrennt vom Code. Jedes Paket enthält `id`, `version`, `quelle`, `ausgabe`, `gueltigAb` und `geprueft`; Pakete ohne Quelle werden abgelehnt. Pakete, die nicht als geprüft markiert sind, lösen den Hinweis „Regelwerk ungeprüft“ aus.

Geplante Pakete: Regelwerk (ZVDH-Flachdachrichtlinie, DIN 18531), Entwässerung nach DIN 1986-100, LES (Bauder), Dämmplatten, KOSTRA-Regenspenden, Orte/PLZ, Abflussbeiwerte.

> Die Regelwerkswerte stammen aus Angaben des Nutzers und sind **vor dem Einsatz gegen den Originaltext zu prüfen**.

Projekte merken sich die verwendeten Paketversionen. Neue Ausgaben lassen sich später über eine Update-Quelle (URL oder Ordner, standardmäßig aus) laden; dabei wird nur ein Manifest abgefragt, nie Projektdaten. Die alte Version bleibt wählbar.

## Datenschutz

- Alles läuft **lokal**: kein Server, kein Login, keine Telemetrie.
- Projekte sind Dateien (`*.fdp.json`) auf der eigenen Festplatte; Autosave nur lokal (IndexedDB).
- Unterlagen (PDF/DXF) werden standardmäßig nur per Verweis (Name + Prüfsumme) gespeichert; Einbetten ist optional.
- Der Standort funktioniert offline. Adress-Geocoding gibt es höchstens optional nach ausdrücklicher Zustimmung und sendet nur die eingegebene Adresse.
- Verteilung über Installer statt öffentlicher Webseite; keine Hersteller- oder Kundendaten auf öffentlichem Hosting.

## Bewusst nicht enthalten

DWG-Import/-Export, Stückliste und LES-Sets, hydraulische Bemessung (nur Schätzung), Preise und Bestellung, Statik, Server/Login, Mobil-Layout, Online-Kartenkacheln. Der Vorschlagsmodus (C) folgt als V1.1, das Desktop-Paket (Tauri) als M7.

## Technik

| Bereich | Wahl |
|---|---|
| Sprache/Build | TypeScript (strict), Vite |
| Rechenkern | `src/core`, reines TypeScript ohne DOM, deterministisch, Einheiten m / m² / l/s |
| Geometrie | clipper2-ts (Boolesche Operationen), polylabel (Labels) |
| Regelpakete | JSON + Ajv-Schema-Validierung |
| UI | Preact + Signals, eigenes Canvas-2D, three.js (3D) |
| Import/Export | pdfjs-dist, dxf-parser, eigener DXF-Writer, pdf-lib |
| Tests | Vitest, fast-check (Eigenschaftstests), Playwright (Smoke/Screenshots) |
| Desktop (später) | Tauri mit signiertem Auto-Update |

Struktur:

```
src/core/     Rechenkern (geometry, model, slope, catchment, drainage, rain, insulation, rules, checks, io)
src/ui/       Oberfläche (Canvas, Werkzeuge, Panels, Ansichten, Export)
rulepacks/    Regelwerks- und Herstellerdaten als JSON
tools/        Erzeugung großer Pakete (KOSTRA, PLZ)
tests/        Tests und Referenzdächer (Fixtures)
docs/         Intent und Referenzmaterial
```

## Entwicklung

Voraussetzung: Node.js.

```bash
npm install
npm run dev        # Entwicklungsserver
npm test           # Tests (Vitest)
npm run lint       # ESLint (verbietet DOM-Importe im Kern)
npm run typecheck  # TypeScript strict
npm run build      # Typprüfung + Produktions-Build
bash scripts/check.sh   # alles zusammen (Definition of Done je Schritt)
```

## Roadmap

| Meilenstein | Inhalt |
|---|---|
| M0 | Grundgerüst (erledigt) |
| M1 | Rechenkern: Geometrie, Datenmodell, Rule-Packs, Höhenfeld, LES/Dachreiter, Einzugsflächen, Prüfungen, Regenspende |
| M2 | 2D-Editor: Zeichenfläche, Punktfang, DXF/PDF-Unterlage, Zeichen- und Entwässerungswerkzeuge |
| M3 | Auswertung in der UI, Standort/Regenspende, Prüfliste, Speichern/Laden, Planaktualisierung, Updates |
| M4 | Gefälledämmplan (Kern und 2D) |
| M5 | 3D und PDF/DXF-Export → **V1** |
| M9 | Anschlusshöhen und Notentwässerungshöhen (Prüfregeln, 2D-Label und Ebene „Anschlüsse“, PDF-Tabellen, DXF-Layer, Ablauf ziehen) |
| M6/M7 | Modus C (V1.1), Tauri-Desktop |

Den aktuellen Stand und die Abnahmekriterien je Schritt findet man in [`PLAN.md`](PLAN.md), das Gestaltungskonzept in [`DESIGN.md`](DESIGN.md).
