# PLAN.md – Flachdachplaner (Gefälleplanung)

Grundlage: `docs/intent/gefaelleplanung.md`, `DESIGN.md` (inkl. §11 Gefälledämmplan), Referenzen `docs/referenz/`. Definition of Done je Schritt: Abnahmekriterien erfüllt, `bash scripts/check.sh` grün, bei UI `visual-qa` ABGENOMMEN.

## 1. Ziel und Umfang
Lokale Web-App (später Tauri) zur Gefälleplanung von Flachdächern: Unterlage (PDF/DXF) laden und kalibrieren, Dachflächen mit Punktfang zeichnen, Entwässerung (Gully, Dachreiter, LES) setzen (Modus B), Höhenkoten/Gefälle und farbige Einzugsflächen berechnen, gegen versionierte Rule-Packs prüfen, Regenspende aus KOSTRA zum Projektstandort ziehen, Notentwässerung schätzen, **Gefälledämmplan (Verlegeplan) mit Plattentypen, Kehlkeilen und Stückliste** erzeugen, 2D/3D ansehen, PDF/DXF exportieren.
**V1 = M1–M5 (Modus B + Gefälledämmplan).** M6 (Modus C, Vorschlag) folgt direkt als V1.1.
**Bewusst NICHT:** DWG (entfällt), Stückliste und LES-Sets (Nutzerentscheid), Tauri-Paket (M7), hydraulische Bemessung (nur Schätzung), Preise/Bestellung, Statik, Server/Login, Mobil-Layout, Online-Kartenkacheln, Adress-Geocoding als Pflichtfunktion.

## 2. Annahmen
- A1 Einheiten im Kern: m, m², m³, l/s, l/(s·ha); Koordinaten projektlokal, y nach oben. Zahlenformatierung nur in der UI.
- A2 Gefällemodell V1: Höhenfeld `h(x) = min_i (z_i + s · d(x, E_i))` über Entwässerungselemente E_i (Punkt, Segment für LES, Randpunkt für Dachreiter). Metrik Standard L∞ in Dachachsrichtung, ergibt ebene Facetten mit 45°-Kehlen/Graten wie im Referenz-Verlegeplan. Einzugsflächen = Zellen dieses Felds, an Kontur/Aufbauten geschnitten.
- A3 Sprünge/Abstufungen: Zonen mit eigenem Höhenversatz, getrennt berechnet.
- A4 Rule-Packs: JSON mit `id`, `version`, `quelle`, `ausgabe`, `gueltigAb`, `geprueft`. Ungeprüfte Packs erzeugen den Hinweis "Regelwerk ungeprüft".
- A5 Plattensystem (Referenz): Typ n = Gefälleplatte der n-ten Dickenstufe (Dicke am Ende Typ n = Anfang Typ n+1); Reihen quer zur Fallrichtung; Kehlkeile Kn L/R an Kehlen; über der höchsten Stufe Zusatzlage ("n+1", gelb) und Neustart der Reihe; "8A" = Ausgleichs-/Sonderplatte laut Katalog (Bedeutung offen, siehe R6). An Graten treffen Platten gespiegelt ohne Keil zusammen.
- A6 Projekte als `*.fdp.json` (inkl. Pack-Versionen, Standort, Regenspende Pack- und Nutzerwert), Autosave in IndexedDB.

## 3. Tech-Stack
- **TypeScript strict + Vite**: Web zuerst, später in Tauri einbettbar. **Vitest** + **fast-check** (Eigenschaftstests).
- **Kern ohne DOM** (`src/core`, eigene tsconfig `lib: ES2022`, ESLint verbietet Importe aus `src/ui`, `three`, DOM).
- **clipper2-js** (Polygon-Boolesche Operationen), **polylabel** (Labels), **Ajv** (JSON-Schema, sprachneutral für Packs).
- **Preact + @preact/signals** (Panels), eigenes **Canvas 2D** (Zeichenfläche), **three.js** (3D).
- **pdfjs-dist** (PDF-Unterlage), **dxf-parser** (Import), eigener DXF-Writer, **pdf-lib** (Vektor-PDF, eingebettete Plex-Schrift).
- **proj4** nur für WGS84 ↔ KOSTRA-Raster-CRS. Playwright für wenige Smoke-/Screenshot-Tests.

## 4. Struktur
```
src/core/   geometry/ model/ slope/ catchment/ drainage/ rain/ insulation/ rules/ checks/ io/
src/core/index.ts   einzige öffentliche API für die UI
src/ui/     app/ canvas/ tools/ snap/ underlay/ panels/ checklist/ location/ insulation-plan/ view3d/ export/
src/styles/ tokens.css, fonts/
rulepacks/  schema/ zvdh-2026/ din18531/ bauder-les/ daemmplatten/ kostra-dwd-2020/ orte-plz/ abflussbeiwerte/
tools/      kostra-build.ts, plz-build.ts (Pack-Erzeugung, Node)
tests/fixtures/  Referenzdächer (*.fdp.json, inkl. L-Dach aus Referenzbild 10,60 × 15,30 m), DXF/PDF
```

## 5. Kern-Schnittstelle
```ts
computeSlope(m: ProjectModel): SlopeResult              // Höhenfeld, Facetten, Koten HP/TP, Grate/Kehlen, Pfeile
computeCatchments(m, s: SlopeResult): Catchment[]       // Polygon, m², drainId, Farbindex
resolveRain(loc: Location, kostra: RulePack): RainData  // r(5,5), r(5,100), Zelle, Quelle; null wenn außerhalb
estimateEmergency(m, c: Catchment[], rain: RainData): EmergencyEstimate[]
layoutInsulation(m, s: SlopeResult, cat: PlateCatalog): InsulationLayout // Platten, Keile, Zusatzlagen, N0, Pfeile
runChecks(m, r: Results, packs: RulePack[]): Finding[]  // {stufe, meldung, objektId, regelId, quelle}
```
Alle Funktionen rein und deterministisch; Toleranz `EPS = 1e-9 m` zentral.

## 6. Schritte
**[E]** = `engineer` (Opus, Kernlogik), **[X]** = `executor` (Hauptsession, Sonnet).

### M0 Grundgerüst
1. **[X] Setup**: Vite+TS strict, ESLint, Vitest, Skripte `lint typecheck test build`. *Abnahme:* `check.sh` grün; ESLint schlägt fehl, wenn `src/core` DOM oder `src/ui` importiert.

### M1 Kern-Bibliothek (UI-unabhängig)
2. **[E] Geometrie**: Polygon, Fläche, Punkt-in-Polygon, Abstände, Schnitt, Clipper-Adapter. *Abnahme:* 20×10 = 200 m²; Referenz-L-Dach exakt; fast-check: Fläche invariant unter Verschiebung/Drehung.
3. **[E] Datenmodell + Projekt-JSON** inkl. Versionsfeld/Migration. *Abnahme:* Round-Trip identisch; ungültiges Projekt → strukturierte Fehlerliste.
4. **[E] Rule-Pack-Schemas + Loader** (Regeln, Grenzwerte, Abläufe, LES, Dachreiter (korrekte Herstellermaße), Abflussbeiwerte, Regenspenden, Dämmplatten, Orte). *Abnahme:* Beispiel-Packs validieren; Pack ohne `quelle` abgelehnt; Grenzwerte 300/350 m² nur aus Pack (Test mit 250/280 ändert Ergebnis).
5. **[E] Höhenfeld (Punktabläufe)**: Facetten, Koten, HP/TP, Grate/Kehlen, Pfeile. *Abnahme:* 20×10, Gully Mitte z=0, 2 %: Ecken +0,200 m, 4 Facetten, 4 Kehlen; 2 Gullys (5|5),(15|5): Grat x=10, HP +0,100 m.
6. **[E] LES und Dachreiter**: Segment-Distanz; Dachreiter mit exakten Maßen aus Pack (Nutzerwunsch). **Keine LES-Sets** (Nutzerentscheid). LES-Gefälle aus Pack (Bauder): längs 1 %, quer 4 %, diagonal 3,5 %; LES liegt AUF der Gefälledämmung (additiv zum Höhenfeld). *Abnahme:* LES 6 m, Keil 1,50 m je Seite: Dicke 10→70 mm (längs 1 %, quer 4 %, ±1 mm); Facetten senkrecht zur LES; Dachreiter-Maße aus Pack, ungeprüfte Packs erzeugen Hinweis.
7. **[E] Einzugsflächen**: Zellen, Schnitt, Abzug Aufbauten, m², Greedy-Färbung (12 Farben, ohne Schraffur). *Abnahme:* Summe = Dachfläche − Aufbauten ± 0,01 m²; 2 Gullys = 2×100 m²; Nachbarn nie gleiche Farbe (Eigenschaftstest). **Attika-Fläche (Nutzeranforderung):** Attika = umlaufender Streifen (Breite b je Segment, zum Dach geneigt) entlang der Kontur, NICHT Teil von Gefälle-/Dämmplan, aber Fläche (Länge × b, Horizontalprojektion) wird dem Ablauf der angrenzenden Dachzelle zugeschlagen und zählt für 300/350 m². Je Ablauf werden Dachfläche, Attikafläche und Gesamtfläche getrennt ausgewiesen. *Abnahme Attika:* Rechteck 20×10 m, Attika b=0,30 m umlaufend, ein Gully: Dach 200 m², Attika 18,0 m² (Fläche Streifen), Gesamt 218,0 m²; Test mit Pack-Grenze 215 löst Hinweis nur durch Attikaanteil aus; Attika erscheint nicht in `layoutInsulation`.
8. **[E] Zonen/Stufen + Vorgaben** (max. HP, min. TP, 0 %-Zonen mit Begründung). *Abnahme:* Terrassenzone −0,10 m getrennt berechnet; Überschreitung max. HP → Befund mit Differenz.
9. **[E] Regelprüfung**: Mindestgefälle, Pfützen (Raster 0,1 m), 300/350 m², Anschlusshöhen Attika/Türschwelle, barrierefreie Schwelle (≤ 10,0 m, Überflutungskante ≥ 5 cm), Pack ungeprüft, Regenspende manuell überschrieben. *Abnahme:* je Regel ein positiver und ein negativer Test; jeder Befund mit `regelId` + `quelle`.
10. **[E] Regenspende + Notentwässerung**: `resolveRain` (Koordinate → Rasterzelle), Q = r·C·A/10000, n_not = ceil(Q·2/Q_Ablauf@35 mm), min. 1, empfohlener Bereich. *Abnahme:* 318 m², r=500, C=0,5 → Q=7,95 l/s, Q_Ablauf=6 → n=3; Koordinate außerhalb Deutschland → null + Befund; fehlende Abflusstabelle → Befund, keine Zahl.
11. **[X] Pack-Werkzeuge**: `tools/kostra-build.ts` (DWD KOSTRA-2020, D=5 min, T=5/100 a → kompaktes Raster-Pack), `tools/plz-build.ts` (PLZ/Ort → Schwerpunkt-Koordinate, offene Lizenz). *Abnahme:* 3 Referenzorte stimmen mit dem KOSTRA-Viewer überein; Pack-Größe < 5 MB; Quelle/Stand im Pack.

### M2 2D-Editor
12. **[X] App-Shell + Tokens** (Grid, Theme, Fonts lokal). *Abnahme:* DESIGN §10 Punkte 1, 3, 4, 12, 14.
13. **[X] Zeichenfläche** (Pan/Zoom, Transformation, Reihenfolge). *Abnahme:* Transformationstests; 60 fps bei 5 000 Unterlagen-Linien.
14. **[E] Punktfang** (End-, Mittel-, Schnittpunkt, Lot, Ortho; Spatial-Index). *Abnahme:* Test je Fangart; Suche < 2 ms bei 20 000 Segmenten.
15. **[X] DXF-Unterlage** (LINE, LWPOLYLINE, ARC, CIRCLE, INSERT, $INSUNITS, Layer). *Abnahme:* Fixture-Maße ± 1 mm; fangbar.
16. **[X] PDF-Unterlage + Kalibrierung** (1:n oder Zwei-Punkt). *Abnahme:* bekannte Strecke ± 0,5 %; Maßstab in Statusleiste.
17. **[X] Zeichenwerkzeuge** (Kontur, Attika, Aufbauten, Terrasse, Türschwelle, Undo/Redo). *Abnahme:* E2E L-Dach, Fläche korrekt; Undo/Redo-Tests. **Attika-Tool:** Breite eingeben, dann entlang der Dachkontur Segmente anklicken/umlaufend zeichnen (Punktfang auf Kontur, Breite je Segment änderbar). *Abnahme:* E2E Attika b=0,25 m um Rechteck, Fläche im Panel = Umfang × 0,25 (Ecken beachtet).
18. **[X] Entwässerungswerkzeuge Modus B** (Gully, Notablauf, Dachreiter, LES aus Pack). *Abnahme:* Neuberechnung beim Setzen; Symbole laut DESIGN §6.

### M3 Auswertung in der UI
19. **[X] Ergebnisdarstellung**: Einzugsflächen farbig ohne Schraffur + Labels, Koten, Pfeile, Notentwässerungsbereich. *Abnahme:* DESIGN §10 Punkte 2, 7–11. Attikafläche in derselben Farbe wie die Dachzelle, in die sie entwässert (etwas hellere Tönung, gleiche Farbe, kein Muster); Label je Ablauf `E3 · Dach 296 m² + Attika 24 m² = 320 m²`.
20. **[X] Standort + Regenspende-Panel**: Eingabe per Koordinaten (WGS84/UTM), PLZ/Ort-Suche (offline Pack) oder Klick auf offline Deutschlandkarte mit KOSTRA-Raster; Anzeige Zelle, r(5,5), r(5,100), Quelle/Stand; Feld "manuell" überschreibt, Pack-Wert bleibt sichtbar (Abgleich, Differenz in %). Adress-Geocoding nur optional per Opt-in-Dialog, sendet nur die eingegebene Adresse. *Abnahme:* PLZ-Eingabe füllt Werte ohne Netz (Netz im E2E blockiert); Überschreiben erzeugt Hinweis; Reload behält beide Werte.
21. **[X] Eigenschaften-Panel + Prüfliste** (Befunde sortiert, Klick zentriert). *Abnahme:* Zähler korrekt; Klick markiert Objekt (E2E).
22. **[X] Speichern/Laden + Autosave**. *Abnahme:* Reload stellt Zustand inkl. Pack-Versionen her; fremde Version → Hinweis.

### M4 Gefälledämmplan (Kern + 2D)
23. **[E] Plattenkatalog-Pack**: Hersteller, Produkt, Format (L×B), Gefälle, Dickenstufen je Typ, Sonderplatten (8A), Zusatzlagen, Kehlkeile Kn L/R mit Maßen. Nur **korrekte Plattenmaße** zählen; keine LES-Sets. *Abnahme:* Beispielpack (fiktiv, `geprueft:false`) validiert; Loader meldet Lücke, wenn Enddicke Typ n ≠ Anfangsdicke Typ n+1.
24. **[E] Plattenaufteilung `layoutInsulation`**: je Facette Reihen quer zur Fallrichtung ab Tiefpunkt, Typ aus Höhe, Zuschnitt an Facettengrenzen und Kontur, Kehlkeile an Kehlen, Spiegelung an Graten, Zusatzlage + Neustart über höchstem Typ, N0 und Verlegestart. *Abnahme:* 10×5 m mit LES an Längsseite, Plattenbreite 1 m → 5 Reihen Typ 1–5; Gully mittig → Kehlkeile L/R symmetrisch gleich viele; Dämmdicke an jeder Plattenecke = Höhenfeld ± 1 mm; Gefällelänge über Typ 8 → Bezeichnung "1+1"; Referenz-L-Dach ergibt keine Lücken/Überlappungen (Flächensumme = Dachfläche ± 0,01 m²); Kehle ≠ 45° (ungleiche Gefälle) → Befund "Kehlkeil nicht im Katalog".
25. **[E] Maß- und Lückenprüfung Verlegeplan**: Plattenmaße exakt aus Katalog, Zuschnitte/Kehlkeile mit Maßen. **Keine Stückliste** (Nutzerentscheid, nicht in V1). *Abnahme:* Fläche der Platten = Dachfläche ± 0,01 m²; keine Lücken/Überlappungen; Ergebnis deterministisch (Snapshot).
26. **[X] 2D-Ansicht Dämmplan**: Plattenraster, Typ-Nummern, Kn L/R, Verlegepfeile, Kehl-/Gratlinien, N0/Verlegestart, Bemaßung außen (DESIGN §11, ohne Stückliste). *Abnahme:* Referenz-L-Dach visuell wie `gefaelledaemmplan-2d.jpg` (visual-qa); Labels überlappen nicht.

### M5 3D und Export (Abschluss V1)
27. **[X] 3D-Ansicht**: Dachfläche aus Höhenfeld, Überhöhung 1/5/10×; Modus Dämmplan mit Plattenblöcken, Typ-Labels, Zusatzlage gelb. *Abnahme:* Mesh-Unit-Test (Eckhöhen = Koten, Blockhöhen = Plattendicken); DESIGN §7 und §11.
28. **[X] PDF-Export** (Gefälleplan + Dämmplan; Schriftfeld, Legende, Nordpfeil, Maßstabsbalken). *Abnahme:* 10 m bei 1:100 = 100 mm ± 0,2 mm; DESIGN §10 Punkt 13.
29. **[X] DXF-Export** (Layer je Objektart, Plattenraster, Texte). *Abnahme:* Re-Import ± 1 mm; 
30. **Review V1** (`reviewer`), Fixes, Feldtest mit 2 Bürodächern (inkl. Abgleich mit einem Hersteller-Verlegeplan).

### M6 Modus C (V1.1), M7 Desktop
31. **[E] Vorschlag Abläufe**: Anzahl/Position so, dass alle Flächen ≤ Grenzwert und HP ≤ max. *Abnahme:* 40×20 → ≥ 3 Abläufe, alle < 300 m²; deterministisch.
32. **[X] Tauri-Wrapper** (DWG entfällt, Nutzerentscheid).

## 7. Teststrategie
- Kern: Vitest-Unit-Tests, fast-check-Eigenschaften (Flächensumme, Invarianz, Färbung, Lückenfreiheit der Platten), Golden-Fixtures mit erwarteten Koten, Flächen, Plattenlisten. Ziel ≥ 90 % Zeilenabdeckung in `src/core`.
- Rule-Packs: Schema-Validierung aller Packs in `npm test`; Snapshot der Befunde und Stücklisten je Fixture.
- UI: Tests für Transformation, Fang, Werkzeug-Zustände; Playwright-Smoke (Laden, Zeichnen, Standort offline, Export) + Screenshots für `visual-qa`.
- Export: PDF/DXF maßlich geprüft (Re-Import bzw. PDF-Koordinaten).

## 8. Risiken und offene Fragen
- **R1 KOSTRA.** DWD stellt KOSTRA-DWD-2020 als Open Data bereit (Raster ca. 5×5 km); Nutzungsbedingungen und Pflicht zur Quellenangabe vor Einsatz prüfen. Eine Punktabfrage-API mit CORS ist nicht gesichert, Online-Abruf widerspricht "lokal". **Empfehlung:** Offline-Pack (Schritt 11), Standort offline per Koordinate/PLZ/Kartenklick, Wert sichtbar und überschreibbar, Quellenangabe im Export; Online nur als optionaler Pack-Update-Download.
- **R2 Geocoding/Datenschutz:** Adressen sind Projektdaten. Online-Geocoding nur nach Opt-in, Anbieter offen (z. B. BKG oder Nominatim, Nutzungsbedingungen prüfen); Standard bleibt offline.
- R3 Regelwerkswerte (ZVDH 01/2026, DIN 18531, DIN 1986-100 für r(5,5)/r(5,100)) ungeprüft; bis zur Prüfung `geprueft:false`.
- R4 Bauder-LES-Daten widersprüchlich; Loro-Abflusstabelle fehlt.
- R5 Modell A2 bei L/U-Formen: Distanz kann die Kontur verlassen; der Engineer prüft eine geodätische Variante.
- **R6 Plattenkatalog fehlt:** Hersteller, Formate, Dickenstufen, Bedeutung "8A", Keilmaße und Zusatzlagen-Regel vom Nutzer nötig; bis dahin fiktives Pack. Ohne echten Katalog keine verbindliche Stückliste.
- R7 Kehlen ≠ 45° und schräge Konturen: Keilsortiment evtl. nicht passend; V1 meldet Befund statt Sonderzuschnitt.
- Offen: Anschlusshöhen/Notabdichtung; Abflussbeiwert Gründach; Erfolgskriterium V1 (Vorschlag: Bürodach inkl. Dämmplan in < 30 min, Ergebnis vom Planer bestätigt).

## Übergabe
- Nächster Schritt: **1 Setup** (executor).
- Stand: DESIGN.md (inkl. §11 Dämmplan, Einzugsflächen ohne Schraffur), Intent, Referenzbilder vorhanden; noch kein Code.
- Entscheidungen: Kern rein in `src/core`; Regeln, Herstellerdaten, KOSTRA, PLZ nur in `rulepacks/`; V1 = M1–M5 inkl. Gefälledämmplan; Standort offline, Geocoding optional per Opt-in.
- Vom Nutzer anfordern: Plattenkatalog (R6), Loro-Tabelle, LES-Klärung, KOSTRA-Lizenzprüfung, Original-Regelwerk.
- Stolperfallen: keine Grenzwerte im Code; Regenspende immer Pack-Wert und Nutzerwert speichern; Einzugsflächen nie schraffieren; Attikafläche zählt zur Ablauffläche, steht aber nie im Gefälle-/Dämmplan; Koten 3 Nachkommastellen nur in der UI formatieren.
