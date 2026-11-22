# PLAN.md – Flachdachplaner (Gefälleplanung)

Grundlage: `docs/intent/gefaelleplanung.md`, `DESIGN.md`. Definition of Done je Schritt: Abnahmekriterien erfüllt, `bash scripts/check.sh` grün, bei UI `visual-qa` ABGENOMMEN.

## 1. Ziel und Umfang
Lokale Web-App (später Tauri) zur Gefälleplanung von Flachdächern: Unterlage (PDF/DXF) laden und kalibrieren, Dachflächen mit Punktfang zeichnen, Entwässerungspunkte (Gully, Dachreiter, LES) setzen (Modus B), Höhenkoten/Gefälle und farbige Einzugsflächen berechnen, gegen versionierte Rule-Packs prüfen, Notentwässerungsbereich und Anzahl Notabläufe schätzen, 3D ansehen, als PDF/DXF exportieren.
**V1 = Meilensteine M1–M4 (Modus B).** M5 (Modus C, Vorschlag) folgt direkt danach als V1.1.
**Bewusst NICHT:** DWG-Import/-Export (später, Konverter), Tauri-Paket (M6), hydraulische Bemessung (nur Schätzung), Materialmengen/Keilplan-Stückliste über Gefällekeil-Zuordnung hinaus, Statik, Mehrbenutzer/Server/Login, Mobil-Layout, Geocoding per Adresse.

## 2. Annahmen
- A1 Einheiten im Kern: Meter, m², l/s; Koordinaten projektlokal, y nach oben. Bildschirm-Transformation nur in der UI.
- A2 Gefällemodell V1: Höhenfeld `h(x) = min_i (z_i + s · d(x, E_i))` über alle Entwässerungselemente E_i (Punkt, Linie für LES, Randpunkt für Dachreiter). Metrik `d` wählbar: L∞ in Dachachsrichtung (ebene Gefälleflächen mit Graten/Kehlen, Standard) oder euklidisch. Einzugsflächen = Zellen dieses Felds, an Dachkontur und Aufbauten geschnitten. Engineer darf das Verfahren verfeinern, die Abnahmetests unten bleiben gültig.
- A3 Sprünge/Abstufungen: Zonen mit eigenem Höhenversatz; jede Zone wird getrennt berechnet, Zonengrenze ist Stufenlinie.
- A4 Rule-Packs sind JSON mit `id`, `version`, `quelle`, `ausgabe`, `gueltigAb`, `geprueft: boolean`. Ungeprüfte Packs (aktuell alle, inkl. Bauder LES) erzeugen in der Prüfliste den Hinweis "Regelwerk ungeprüft".
- A5 Projekte werden als `*.fdp.json` gespeichert (inkl. Rule-Pack-IDs + Versionen), Autosave in IndexedDB.
- A6 Regenspende wird für V1 manuell oder aus einem Offline-KOSTRA-Pack gelesen (siehe Risiken R1).

## 3. Tech-Stack
- **TypeScript strict + Vite**: schnelle Web-Entwicklung, später direkt in Tauri einbettbar.
- **Vitest** (+ fast-check für Eigenschaftstests der Geometrie): ein Testrunner für Kern und UI-Logik.
- **Kern ohne DOM** (`src/core`, eigene `tsconfig` mit `lib: ES2022`, ESLint-Regel verbietet Importe aus `src/ui`/`three`/DOM).
- **clipper2-js** (Polygon-Boolesche Operationen, robust), **polylabel** (Labelposition), **Ajv** (JSON-Schema-Validierung der Rule-Packs, sprachneutral).
- **Preact + @preact/signals** für Panels (klein, schnell); Zeichenfläche als eigenes **Canvas 2D**.
- **pdfjs-dist** (PDF-Unterlage), **dxf-parser** (DXF-Import), eigener DXF-R12/R2000-Writer (wenige Entitäten, keine Abhängigkeit), **pdf-lib** (Vektor-PDF-Export mit eingebetteter Plex-Schrift), **three.js** (3D).
- Playwright nur für wenige Smoke-/Screenshot-Tests (visual-qa-Grundlage).

## 4. Struktur
```
src/core/          geometry/ model/ slope/ catchment/ drainage/ rules/ checks/ io/ (JSON, DXF-Geometrie)
src/core/index.ts  öffentliche API (einziger Import-Punkt für die UI)
src/ui/            app/ canvas/ tools/ snap/ underlay/ panels/ checklist/ view3d/ export/
src/styles/        tokens.css (aus DESIGN.md), fonts/ (woff2)
rulepacks/         schema/*.schema.json, zvdh-2026/, din18531/, bauder-les/, kostra-dwd-2020/, abflussbeiwerte/
tests/fixtures/    Referenzdächer (*.fdp.json), DXF/PDF-Beispiele
e2e/               Playwright-Smoke-Tests
```

## 5. Kern-Schnittstelle (Vertrag zwischen Kern und UI)
```ts
interface ProjectModel { roofs: Roof[]; drains: Drain[]; zones: Zone[]; fixtures: Fixture[]; params: SlopeParams; rulePacks: PackRef[] }
function computeSlope(m: ProjectModel): SlopeResult        // Höhenfeld, Koten (HP/TP), Gefällepfeile, Grate/Kehlen
function computeCatchments(m: ProjectModel, s: SlopeResult): Catchment[]  // Polygon, Fläche m², drainId
function estimateEmergency(m: ProjectModel, c: Catchment[], rain: RainData): EmergencyEstimate[] // Bereich, n_not
function runChecks(m: ProjectModel, r: Results, packs: RulePack[]): Finding[] // {stufe, meldung, objektId, regelId, quelle}
```
Alle Funktionen rein, deterministisch, ohne Seiteneffekte; Toleranz `EPS = 1e-9 m` zentral.

## 6. Schritte
Kennung: **[E]** = `engineer` (Opus), **[X]** = `executor` (Hauptsession, Sonnet).

### M0 Grundgerüst
1. **[X] Projekt-Setup**: Vite+TS strict, ESLint, Vitest, Skripte `lint typecheck test build`, getrennte tsconfig für `src/core`. *Abnahme:* `check.sh` grün mit 1 Dummy-Test; ESLint schlägt fehl, wenn `src/core` `document` oder `src/ui` importiert (Test-Fixture).

### M1 Kern-Bibliothek (UI-unabhängig)
2. **[E] Geometrie-Basis**: Punkt/Segment/Polygon, Fläche, Orientierung, Punkt-in-Polygon, Abstand Punkt–Segment, Schnitt, Clipper-Adapter. *Abnahme:* Rechteck 20×10 = 200 m²; L-Form bekannter Fläche exakt; fast-check: Fläche invariant unter Verschiebung/Drehung; Schnitt zweier Polygone ≤ min(Flächen).
3. **[E] Datenmodell + Projekt-JSON**: Typen aus §5, Serialisierung, Versionsfeld, Migration v0→v1. *Abnahme:* Round-Trip Fixture → JSON → Modell identisch; ungültiges Projekt liefert strukturierte Fehlerliste.
4. **[E] Rule-Pack-Schema + Loader**: JSON-Schemas (Regeln, Grenzwerte, Abläufe/Abflusstabellen, LES-Sets, Dachreiter, Abflussbeiwerte, Regenspenden), Ajv-Validierung, Versionsauflösung. *Abnahme:* Beispiel-Packs (ZVDH 2026 Entwurf, Bauder LES ungeprüft) validieren; Pack ohne `quelle` oder mit falschem Typ wird abgelehnt; Grenzwerte 300/350 m² kommen aus dem Pack, nicht aus Code (Test mit 250/280 ändert Ergebnis).
5. **[E] Höhenfeld/Gefälle (Punktabläufe)**: Modell A2, Koten an Ecken, HP/TP, Grate/Kehlen, Gefällepfeile. *Abnahme:* Rechteck 20×10, Gully Mitte z=0, 2 %, L∞: Ecken +0,200 m; zwei Gullys bei (5|5),(15|5): Grat bei x=10, HP +0,100 m; Gefälle jeder Teilfläche = Vorgabe ± 1e-6.
6. **[E] Linien- und Randentwässerung**: LES (Segment-Distanz, Länge, Set-Zuordnung aus Pack), Dachreiter an Attika. *Abnahme:* LES 6 m in Rechteck liefert ebene Flächen senkrecht zur LES; Set-Zuordnung LES 1–10 laut Pack-Tabelle; Länge > 10 m erzeugt Hinweis "objektspezifisch".
7. **[E] Einzugsflächen**: Zellen je Ablauf, Schnitt mit Kontur, Abzug Aufbauten, Flächen in m², Nachbarschaftsgraph + Greedy-Färbung (12 Farben). *Abnahme:* Summe der Einzugsflächen = Dachfläche − Aufbauten (± 0,01 m²); Beispiel 2 Gullys = 2×100 m²; Nachbarn nie gleiche Farbe (Eigenschaftstest).
8. **[E] Zonen/Stufen + Vorgaben**: Zonen mit Höhenversatz, max. HP-Höhe, min. TP-Höhe, 0 %-Zonen mit Begründungskürzel. *Abnahme:* Terrassenzone −0,10 m wird getrennt berechnet; Überschreitung max. HP erzeugt Befund mit Differenz in m.
9. **[E] Regelprüfung**: Mindestgefälle, Pfützen (lokale Minima ohne Ablauf, Raster 0,1 m), Einzugsfläche ≥ 300 Hinweis / > 350 Fehler, Anschlusshöhen Attika/Türschwelle, barrierefreie Schwelle (Abstand ≤ 10,0 m, Überflutungskante ≥ 5 cm unter OK Flüssigkunststoff), Pack ungeprüft. *Abnahme:* je Regel ein positiver und ein negativer Fixture-Test; jeder Befund trägt `regelId` + `quelle` aus dem Pack.
10. **[E] Notentwässerung (Schätzung)**: Q = r·C·A/10000, n_not = ceil(Q·2/Q_Ablauf@35 mm), min. 1; empfohlener Bereich (Randstreifen der Einzugsfläche an Attika, tiefste Randlage). *Abnahme:* Handrechnung 318 m², r=500 l/(s·ha), C=0,5 → Q=7,95 l/s; Q_Ablauf=6 l/s → n=3; fehlende Abflusstabelle → Befund "Herstellerdaten fehlen", keine Zahl.
11. **[X] KOSTRA-Pack-Werkzeug**: Node-Skript wandelt DWD-KOSTRA-2020-Rasterdaten (D=5 min, T=5/100 a) in kompaktes Pack (Rasterindex → Wert) + Lookup über Koordinate. *Abnahme:* 3 Referenzpunkte stimmen mit KOSTRA-Viewer überein; manuelle Eingabe überschreibt Pack-Wert.

### M2 2D-Editor
12. **[X] App-Shell + Tokens**: Grid-Layout, Theme hell/dunkel, Fonts lokal. *Abnahme:* Checkliste DESIGN §10 Punkte 1,3,4,12,14.
13. **[X] Zeichenfläche**: Pan/Zoom, Welt↔Bildschirm, Zeichnungsreihenfolge. *Abnahme:* Transformations-Unit-Tests; 60 fps bei 5 000 Unterlagen-Linien (Performance-Messung im Test).
14. **[E] Punktfang**: End-, Mittel-, Schnittpunkt, Lot, Orthogonal, Spatial-Index. *Abnahme:* Unit-Tests je Fangart; Fangsuche < 2 ms bei 20 000 Segmenten.
15. **[X] DXF-Unterlage**: Import LINE/LWPOLYLINE/ARC/CIRCLE/INSERT, Einheiten ($INSUNITS), Layer ein/aus. *Abnahme:* Fixture-DXF, Maße ± 1 mm korrekt; fangbar.
16. **[X] PDF-Unterlage + Kalibrierung**: Seite rendern, Maßstab 1:n oder Zwei-Punkt-Kalibrierung. *Abnahme:* bekannte Strecke im Fixture-PDF misst nach Kalibrierung ± 0,5 %; Maßstab in Statusleiste.
17. **[X] Werkzeuge Zeichnen**: Dachkontur (Ortho-Modus), Attika, Aufbauten, Terrassenzone, Türschwelle; Undo/Redo. *Abnahme:* E2E: L-Dach zeichnen, Fläche im Panel korrekt; Undo/Redo-Tests.
18. **[X] Werkzeuge Entwässerung (Modus B)**: Gully, Notablauf, Dachreiter, LES mit Produkt aus Pack. *Abnahme:* Setzen löst Neuberechnung aus; Symbole laut DESIGN §6.

### M3 Auswertung in der UI
19. **[X] Ergebnisdarstellung**: Einzugsflächen farbig + Labels (Polylabel, Kollision), Koten, Gefällepfeile, Notentwässerungsbereich. *Abnahme:* DESIGN §10 Punkte 2,7,8,9,10,11.
20. **[X] Eigenschaften-Panel + Prüfliste**: Parameter (Gefälle, HP/TP, Aufbau, Regenspende/KOSTRA), Befunde sortiert, Klick zentriert Objekt. *Abnahme:* Zähler korrekt; Klick markiert Objekt (E2E).
21. **[X] Projekt speichern/laden + Autosave**. *Abnahme:* Reload stellt Zustand inkl. Rule-Pack-Version wieder her; fremde Pack-Version → Hinweis.

### M4 3D und Export (Abschluss V1)
22. **[X] 3D-Ansicht**: Dachfläche aus Höhenfeld trianguliert, Überhöhung 1/5/10×. *Abnahme:* Mesh-Erzeugung als Unit-Test (Eckhöhen = Koten); DESIGN §7.
23. **[X] PDF-Export**: Maßstabsgetreu, Schriftfeld, Legende, Nordpfeil, Maßstabsbalken. *Abnahme:* Strecke 10 m bei 1:100 = 100 mm ± 0,2 mm im PDF; DESIGN §10 Punkt 13.
24. **[X] DXF-Export**: Layer je Objektart, Koten als Text, Einzugsflächen als HATCH/Polylinie. *Abnahme:* Re-Import mit dxf-parser liefert gleiche Geometrie ± 1 mm.
25. **Review V1** (`reviewer`), Fixes, Feldtest mit 2 Bürodächern.

### M5 Modus C (V1.1), M6 Desktop
26. **[E] Vorschlag Abläufe**: Gullyanzahl/-position so, dass jede Fläche ≤ Grenzwert, HP ≤ max. Höhe; Varianten bewerten. *Abnahme:* Rechteck 40×20 → ≥ 3 Abläufe, alle Flächen < 300 m²; deterministisch.
27. **[X] Tauri-Wrapper** (Dateidialoge nativ), danach DWG über Konverter (ODA File Converter, extern).

## 7. Teststrategie
- Kern: Vitest-Unit-Tests + fast-check-Eigenschaften (Flächensumme, Invarianz, Färbung) + Golden-Fixtures (`tests/fixtures/*.fdp.json` mit erwarteten Koten/Flächen). Ziel ≥ 90 % Zeilenabdeckung in `src/core`.
- Rule-Packs: jedes Pack wird in CI gegen Schema validiert; Snapshot der Befunde je Fixture.
- UI: Unit-Tests für Transformation, Fang, Werkzeug-Zustandsmaschinen; Playwright-Smoke (Laden, Zeichnen, Export) + Screenshots für `visual-qa`.
- Export: PDF/DXF maßlich geprüft (Re-Import bzw. Koordinaten aus PDF-Operatoren).

## 8. Risiken und offene Fragen
- **R1 KOSTRA-Anbindung.** DWD stellt KOSTRA-DWD-2020 als Open Data (Raster ca. 5×5 km, Shape/CSV) bereit; Nutzungsbedingungen (Quellenangabe "Deutscher Wetterdienst") vor Einsatz prüfen. Eine offizielle Punktabfrage-API mit CORS ist nicht gesichert, Online-Abruf widerspricht zudem "lokal ohne Server". **Empfehlung:** Offline-Pack (Schritt 11) mit Quelle/Stand, Lookup über Koordinate (WGS84 → Raster-CRS), Pflichtfeld Quellenangabe im Export; Fallback manuelle Eingabe; Online-Aktualisierung nur als optionaler Pack-Download.
- R2 Regelwerkswerte (ZVDH 01/2026, DIN 18531, DIN 1986-100-Bezug für r(5,5)/r(5,100)) sind ungeprüft übernommen; vor Freigabe gegen Originale prüfen. Bis dahin `geprueft:false`.
- R3 Bauder-LES-Daten widersprüchlich (0,25 m/m vs. mm-Höhenbereiche); Loro-Abflusstabelle fehlt. Ohne Daten keine Notablauf-Zahl.
- R4 Gefällemodell A2 bei L-/U-Formen: gerade Distanz kann die Kontur verlassen. Engineer prüft geodätische Distanz bzw. Zerlegung; Befund, falls Pfad außerhalb liegt.
- R5 PDF-Unterlagen ohne Vektordaten: Fang nur auf eigene Geometrie; Hinweis anzeigen.
- Offen: konkrete Anschlusshöhen/Notabdichtungsmaße; Abflussbeiwert Gründach (Pack-Parameter); Erfolgskriterium V1 (Vorschlag: Bürodach in < 30 min statt Stunden, Ergebnisse von Planer bestätigt).

## Übergabe
- Nächster Schritt: **1 Projekt-Setup** (executor).
- Stand: DESIGN.md und Intent vorhanden, noch kein Code.
- Entscheidungen: Kern rein in `src/core` ohne DOM; Regeln/Herstellerdaten nur in `rulepacks/`; V1 = M1–M4 Modus B.
- Offene Punkte: R1–R3 mit Nutzer klären (Lizenz KOSTRA, Original-Regelwerk, Herstellerdaten).
- Stolperfallen: keine Grenzwerte im Code; Koten immer 3 Nachkommastellen, deutsches Zahlenformat nur in der UI, nie im Kern.
