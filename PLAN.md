# PLAN.md – Flachdachplaner (Gefälleplanung)

Grundlage: `docs/intent/gefaelleplanung.md`, `DESIGN.md` (inkl. §11 Gefälledämmplan), Referenzen `docs/referenz/`. Definition of Done je Schritt: Abnahmekriterien erfüllt, `bash scripts/check.sh` grün, bei UI `visual-qa` ABGENOMMEN.

## 1. Ziel und Umfang
Lokale Web-App (später Tauri) zur Gefälleplanung von Flachdächern: Unterlage (PDF/DXF) laden und kalibrieren, Dachflächen mit Punktfang zeichnen, Entwässerung (Gully, Dachreiter, LES) setzen (Modus B), je Ablauf die **Tiefenlage (Kote Tiefpunkt)** festlegen, Höhenkoten/Gefälle, **mittlere Gefälledämmdicke je Dachfläche** und farbige Einzugsflächen berechnen, gegen versionierte Rule-Packs prüfen, Regenspende aus KOSTRA zum Projektstandort ziehen, Notentwässerung schätzen, **Gefälledämmplan (Verlegeplan) mit Plattentypen, Kehlkeilen und Stückliste** erzeugen, 2D/3D ansehen, PDF/DXF exportieren.
**V1 = M1–M5 (Modus B + Gefälledämmplan).** M6 (Modus C, Vorschlag) folgt direkt als V1.1.
**Bewusst NICHT:** DWG (entfällt), Stückliste und LES-Sets (Nutzerentscheid), Tauri-Paket (M7), hydraulische Bemessung (nur Schätzung), Preise/Bestellung, Statik, Server/Login, Mobil-Layout, Online-Kartenkacheln, Adress-Geocoding als Pflichtfunktion.

## 2. Annahmen
- A1 Einheiten im Kern: m, m², m³, l/s, l/(s·ha); Koordinaten projektlokal, y nach oben. Zahlenformatierung nur in der UI.
- A2 Gefällemodell V1: Höhenfeld `h(x) = min_i (z_i + s · d(x, E_i))` über Entwässerungselemente E_i (Punkt, Segment für LES, Randpunkt für Dachreiter). Metrik Standard L∞ in Dachachsrichtung, ergibt ebene Facetten mit 45°-Kehlen/Graten wie im Referenz-Verlegeplan. Einzugsflächen = Zellen dieses Felds, an Kontur/Aufbauten geschnitten.
- A2a **Ablauftiefe (Nutzeranforderung):** Jeder Ablauf (Gully, Notablauf, Dachreiter, LES) hat eine einstellbare Kote `z` seines Tiefpunkts (m, OK Abdichtung, Bezug Projekt-Nullpunkt; Standard 0). Die Gefällesituation ergibt sich maßgeblich daraus: `h(x) = min_i (z_i + s · d(x, E_i))`; unterschiedliche `z` verschieben Grate/Kehlen zum höher liegenden Ablauf und ändern HP/TP-Koten. LES: `z` am tieferen Ende, Gegenende aus LES-Längsgefälle (Schritt 6).
- A2b **Mittlere Gefälledämmung (Nutzeranforderung, bauphysikalisch maßgebend, z. B. für den Wärmeschutznachweis):** Je Dachfläche (und je Einzugsfläche) wird die flächengewichtete mittlere Dämmdicke `d_m = d_TP + (1/A)·∫(h(x) − h_min) dA` in mm ausgegeben, zusätzlich Min/Max. `d_TP` = Mindestdämmdicke am Tiefpunkt (Vorgabe je Dachfläche, Standard aus Pack, ungeprüft). Fläche A ohne Aufbauten, Attika zählt nicht. Terrassenzonen mit eigenem Versatz (A3) werden getrennt gemittelt und als Fläche gewichtet zusammengeführt. Reine Ausgabe der Dicke, **kein U-Wert-Nachweis** in V1. Zonen mit eigenem Höhenversatz, getrennt berechnet.
- A4 Rule-Packs: JSON mit `id`, `version`, `quelle`, `ausgabe`, `gueltigAb`, `geprueft`. Ungeprüfte Packs erzeugen den Hinweis "Regelwerk ungeprüft".
- A5 Plattensystem (Referenz): Typ n = Gefälleplatte der n-ten Dickenstufe (Dicke am Ende Typ n = Anfang Typ n+1); Reihen quer zur Fallrichtung; Kehlkeile Kn L/R an Kehlen; über der höchsten Stufe Zusatzlage ("n+1", gelb) und Neustart der Reihe; "8A" = Ausgleichs-/Sonderplatte laut Katalog (Bedeutung offen, siehe R6). An Graten treffen Platten gespiegelt ohne Keil zusammen.
- A6 Projekte als `*.fdp.json` (inkl. Pack-Versionen, Standort, Regenspende Pack- und Nutzerwert), Autosave in IndexedDB.

## 3. Tech-Stack
- **TypeScript strict + Vite**: Web zuerst, später in Tauri einbettbar. **Vitest** + **fast-check** (Eigenschaftstests).
- **Kern ohne DOM** (`src/core`, eigene tsconfig `lib: ES2022`, ESLint verbietet Importe aus `src/ui`, `three`, DOM).
- **clipper2-ts** (statt clipper2-js: dort defekter PolyTree, Angular-Abhängigkeiten, 2 High-Audit-Funde) (Polygon-Boolesche Operationen), **polylabel** (Labels), **Ajv** (JSON-Schema, sprachneutral für Packs).
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
computeSlope(m: ProjectModel): SlopeResult              // Höhenfeld (aus Ablauf-Koten z), Facetten, Koten HP/TP, Grate/Kehlen, Pfeile, mittlere Gefälledämmung je Dachfläche (mm, min/max)
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
1. **[X] ✅ Setup**: Vite+TS strict, ESLint, Vitest, Skripte `lint typecheck test build`. *Abnahme:* `check.sh` grün; ESLint schlägt fehl, wenn `src/core` DOM oder `src/ui` importiert.

### M1 Kern-Bibliothek (UI-unabhängig)
2. **[E] ✅ Geometrie**: Polygon, Fläche, Punkt-in-Polygon, Abstände, Schnitt, Clipper-Adapter. *Abnahme:* 20×10 = 200 m²; Referenz-L-Dach exakt; fast-check: Fläche invariant unter Verschiebung/Drehung.
3. **[E] ✅ Datenmodell + Projekt-JSON** inkl. Versionsfeld/Migration. *Abnahme:* Round-Trip identisch; ungültiges Projekt → strukturierte Fehlerliste.
4. **[E] ✅ Rule-Pack-Schemas + Loader** (Regeln, Grenzwerte, Abläufe, LES, Dachreiter (korrekte Herstellermaße), Abflussbeiwerte, Regenspenden, Dämmplatten, Orte). *Abnahme:* Beispiel-Packs validieren; Pack ohne `quelle` abgelehnt; Grenzwerte 300/350 m² nur aus Pack (Test mit 250/280 ändert Ergebnis).
5. **[E] ✅ Höhenfeld (Punktabläufe)**: Facetten, Koten, HP/TP, Grate/Kehlen, Pfeile. **Datenmodell zuerst erweitern:** Feld `z` (Kote Tiefpunkt, m, Standard 0) an allen Entwässerungselementen, Feld `daemmdickeTiefpunkt` (mm, optional) je Dachfläche; schemaVersion/Migration (alte Projekte: z=0), Validierung. Dazu **mittlere Gefälledämmdicke** je Dachfläche (A2b). *Abnahme:* 20×10, Gully Mitte z=0, 2 %: Ecken +0,200 m, 4 Facetten, 4 Kehlen; 2 Gullys (5|5),(15|5) beide z=0: Grat x=10, HP +0,100 m; **dieselben Gullys, z₂ = −0,05 m (rechter Ablauf tiefer): Grat wandert nach x=8,75 m, Ecke (0|0) bleibt +0,100 m, Ecke (20|0) +0,050 m; Test: Änderung von z ändert Koten und Grat.** Mittel: 20×10, ein Gully Mitte, 2 % → mittlere Höhe über Tiefpunkt 108,3 mm (± 0,5), mit `daemmdickeTiefpunkt` 20 mm → d_m = 128,3 mm; Eigenschaftstest: d_m ≥ d_TP und ≤ Max; Verschieben aller z um denselben Betrag ändert d_m nicht.
6. **[E] ✅ LES und Dachreiter**: Segment-Distanz; Dachreiter mit exakten Maßen aus Pack (Nutzerwunsch). **Keine LES-Sets** (Nutzerentscheid). LES-Gefälle aus Pack (Bauder): längs 1 %, quer 4 %, diagonal 3,5 %; LES liegt AUF der Gefälledämmung (additiv zum Höhenfeld). *Abnahme:* LES 6 m, Keil 1,50 m je Seite: Dicke 10→70 mm (längs 1 %, quer 4 %, ±1 mm); Facetten senkrecht zur LES; Dachreiter-Maße aus Pack, ungeprüfte Packs erzeugen Hinweis.
7. **[E] Einzugsflächen**: Zellen, Schnitt, Abzug Aufbauten, m², Greedy-Färbung (12 Farben, ohne Schraffur). *Abnahme:* Summe = Dachfläche − Aufbauten ± 0,01 m²; 2 Gullys = 2×100 m²; Nachbarn nie gleiche Farbe (Eigenschaftstest). **Attika-Fläche (Nutzeranforderung):** Attika = umlaufender Streifen (Breite b je Segment, zum Dach geneigt) entlang der Kontur, NICHT Teil von Gefälle-/Dämmplan, aber Fläche (Länge × b, Horizontalprojektion) wird dem Ablauf der angrenzenden Dachzelle zugeschlagen und zählt für 300/350 m². Je Ablauf werden Dachfläche, Attikafläche und Gesamtfläche getrennt ausgewiesen. *Abnahme Attika:* Rechteck 20×10 m, Attika b=0,30 m umlaufend, ein Gully: Dach 200 m², Attika 18,0 m² (Fläche Streifen), Gesamt 218,0 m²; Test mit Pack-Grenze 215 löst Hinweis nur durch Attikaanteil aus; Attika erscheint nicht in `layoutInsulation`.
8. **[E] Zonen/Stufen + Vorgaben** (max. HP, min. TP, Mindestdämmdicke am Tiefpunkt, 0 %-Zonen mit Begründung). *Abnahme:* Terrassenzone −0,10 m getrennt berechnet und in d_m flächengewichtet; Überschreitung max. HP → Befund mit Differenz; Ablauf-Kote `z` und Mindestdicke am TP fließen in die Vorgabenprüfung ein.
9. **[E] Regelprüfung**: Mindestgefälle, Pfützen (Raster 0,1 m), 300/350 m², Anschlusshöhen Attika/Türschwelle, barrierefreie Schwelle (≤ 10,0 m, Überflutungskante ≥ 5 cm), Pack ungeprüft, Regenspende manuell überschrieben. *Abnahme:* je Regel ein positiver und ein negativer Test; jeder Befund mit `regelId` + `quelle`.
10. **[E] Regenspende + Notentwässerung**: `resolveRain` (Koordinate → Rasterzelle), Q = r·C·A/10000, n_not = ceil(Q·2/Q_Ablauf@35 mm), min. 1, empfohlener Bereich. *Abnahme:* 318 m², r=500, C=0,5 → Q=7,95 l/s, Q_Ablauf=6 → n=3; Koordinate außerhalb Deutschland → null + Befund; fehlende Abflusstabelle → Befund, keine Zahl.
11. **[X] Pack-Werkzeuge**: `tools/kostra-build.ts` (**OpenKOSTRA** als Datenquelle, Nutzerentscheid; D=5 min, T=5/100 a → kompaktes Raster-Pack; Lizenz/Quellenangabe von OpenKOSTRA ins Pack übernehmen; keine DWD-Lizenzanfrage), `tools/plz-build.ts` (PLZ/Ort → Schwerpunkt-Koordinate, offene Lizenz). *Abnahme:* 3 Referenzorte stimmen mit dem KOSTRA-Viewer überein; Pack-Größe < 5 MB; Quelle/Stand im Pack.

### M2 2D-Editor
12. **[X] App-Shell + Tokens** (Grid, Theme, Fonts lokal). *Abnahme:* DESIGN §10 Punkte 1, 3, 4, 12, 14.
13. **[X] Zeichenfläche** (Pan/Zoom, Transformation, Reihenfolge). *Abnahme:* Transformationstests; 60 fps bei 5 000 Unterlagen-Linien.
14. **[E] Punktfang** (End-, Mittel-, Schnittpunkt, Lot, Ortho; Spatial-Index). *Abnahme:* Test je Fangart; Suche < 2 ms bei 20 000 Segmenten.
15. **[X] DXF-Unterlage** (LINE, LWPOLYLINE, ARC, CIRCLE, INSERT, $INSUNITS, Layer). *Abnahme:* Fixture-Maße ± 1 mm; fangbar.
16. **[X] PDF-Unterlage + Kalibrierung** (1:n oder Zwei-Punkt). *Abnahme:* bekannte Strecke ± 0,5 %; Maßstab in Statusleiste.
17. **[X] Zeichenwerkzeuge** (Kontur, Attika, Aufbauten, Terrasse, Türschwelle, Undo/Redo). *Abnahme:* E2E L-Dach, Fläche korrekt; Undo/Redo-Tests. **Attika-Tool:** Breite eingeben, dann entlang der Dachkontur Segmente anklicken/umlaufend zeichnen (Punktfang auf Kontur, Breite je Segment änderbar). *Abnahme:* E2E Attika b=0,25 m um Rechteck, Fläche im Panel = Umfang × 0,25 (Ecken beachtet).
18. **[X] Entwässerungswerkzeuge Modus B** (Gully, Notablauf, Dachreiter, LES aus Pack). Je Ablauf Eingabe der **Tiefenlage (Kote Tiefpunkt `z`)** beim Setzen und im Eigenschaften-Panel. *Abnahme:* Neuberechnung beim Setzen und bei Änderung von `z` (Grat/Koten wandern sichtbar); Symbole laut DESIGN §6.

### M3 Auswertung in der UI
19. **[X] Ergebnisdarstellung**: Einzugsflächen farbig ohne Schraffur + Labels, Koten, Pfeile, Notentwässerungsbereich. *Abnahme:* DESIGN §10 Punkte 2, 7–11. Attikafläche in derselben Farbe wie die Dachzelle, in die sie entwässert (etwas hellere Tönung, gleiche Farbe, kein Muster); Label je Ablauf `E3 · Dach 296 m² + Attika 24 m² = 320 m²`. **Kennwert „Ø Gefälledämmung“** je Dachfläche (und je Einzugsfläche) als Badge/Tabelle im Ergebnis-Panel: `Ø 128 mm (min 20 · max 220 mm)`, Ablauf-Kote `z` am Ablaufsymbol.
20. **[X] Standort + Regenspende-Panel**: Eingabe per Koordinaten (WGS84/UTM), PLZ/Ort-Suche (offline Pack) oder Klick auf offline Deutschlandkarte mit KOSTRA-Raster; Anzeige Zelle, r(5,5), r(5,100), Quelle/Stand; Feld "manuell" überschreibt, Pack-Wert bleibt sichtbar (Abgleich, Differenz in %). Adress-Geocoding nur optional per Opt-in-Dialog, sendet nur die eingegebene Adresse. *Abnahme:* PLZ-Eingabe füllt Werte ohne Netz (Netz im E2E blockiert); Überschreiben erzeugt Hinweis; Reload behält beide Werte.
21. **[X] Eigenschaften-Panel + Prüfliste** (Befunde sortiert, Klick zentriert). *Abnahme:* Zähler korrekt; Klick markiert Objekt (E2E).
22. **[X] Speichern/Laden lokal (Datenschutz)**: Projekt als Datei (`.fdp`, JSON, versioniert) auf Festplatte speichern und wieder öffnen (File System Access API, Fallback Download/Datei-Dialog), Unterlage (PDF/DXF) standardmäßig nur per Verweis (Name + Prüfsumme, Original bleibt auf der Festplatte, wird beim Öffnen neu gewählt; bei Abweichung → Schritt 22a), Einbetten optional per Schalter; Autosave nur lokal (IndexedDB). Keine Datenübertragung, kein Backend, keine Telemetrie. *Abnahme:* Reload/Öffnen stellt Zustand inkl. Pack-Versionen her; fremde Version → Hinweis; E2E mit blockiertem Netz; keine Netzwerkanfragen mit Projektdaten (Test).
22a. **[X] Unterlage austauschen + Abweichungen nachziehen (Planaktualisierung)**: neue PDF/DXF-Version ersetzt die Unterlage; Maßstab/Ausrichtung per Zwei-Punkt-Zuordnung (Passpunkte) übernehmen. Danach prüft die Software jeden gezeichneten Punkt gegen die neuen Fangpunkte: Abweichungen > Toleranz (einstellbar, Standard 2 cm) werden in einer Liste markiert (alt → vorgeschlagener neuer Punkt). Nutzer zieht Punkte einzeln (Vorschlag übernehmen / händisch verschieben / unverändert lassen) oder gesammelt nach; Ergebnis neu berechnet, Prüfliste aktualisiert. *Abnahme:* DXF-Fixture v1→v2 mit 3 verschobenen Ecken: genau diese 3 werden gemeldet; Übernehmen setzt Punkt auf neuen Fangpunkt ± 1 mm; unveränderte Punkte bleiben; Undo/Redo je Aktion.
22b. **[X] Update-Funktion** (Datenschutz-konform): (1) *Rule-Packs:* `manifest.json` (Pack-ID, Version, Hash, Quelle, gültig ab) an einer in den Einstellungen festlegbaren Update-Quelle (URL oder lokaler Ordner/Netzlaufwerk; Standard: aus). Beim Start (abschaltbar) und per Knopf wird NUR das Manifest abgefragt, nie Projektdaten. Neuere Packs werden angezeigt (Version alt → neu, Änderungsnotiz), nach Bestätigung geladen, per Hash und Schema geprüft und lokal gespeichert; die alte Version bleibt wählbar (Rollback). Projekte merken ihre Pack-Version; Öffnen mit neuerer verfügbarer Version → Hinweis „Neu berechnen?". (2) *Programm:* Anzeige von Version/Build und Prüfung gegen die Update-Quelle; bis Tauri: `git pull && npm install && npm run build` bzw. neuer `dist/`-Ordner, mit Hinweistext in der App; mit Tauri (Schritt 32) signiertes Auto-Update. Offline/Quelle nicht erreichbar → still, App arbeitet mit dem lokalen Stand. *Abnahme:* Test mit lokaler Fake-Quelle: neueres Pack wird erkannt, geladen, validiert, aktiv; manipulierter Hash → abgelehnt; kein Netz → keine Fehlermeldung außer Statushinweis; Netzwerk-Mitschnitt zeigt nur Manifest-Anfrage ohne Projektdaten.

### M4 Gefälledämmplan (Kern + 2D)
23. **[E] Plattenformat-Pack (vorerst 1,00 × 1,00 m, kein Herstellerkatalog; Nutzerentscheid)** – ursprünglich Katalog: Hersteller, Produkt, Format (L×B), Gefälle, Dickenstufen je Typ, Sonderplatten (8A), Zusatzlagen, Kehlkeile Kn L/R mit Maßen. Nur **korrekte Plattenmaße** zählen; keine LES-Sets. *Abnahme:* Beispielpack (fiktiv, `geprueft:false`) validiert; Loader meldet Lücke, wenn Enddicke Typ n ≠ Anfangsdicke Typ n+1.
24. **[E] Plattenaufteilung `layoutInsulation`**: je Facette Reihen quer zur Fallrichtung ab Tiefpunkt, Typ aus Höhe, Zuschnitt an Facettengrenzen und Kontur, Kehlkeile an Kehlen, Spiegelung an Graten, Zusatzlage + Neustart über höchstem Typ, N0 und Verlegestart. *Abnahme:* 10×5 m mit LES an Längsseite, Plattenbreite 1 m → 5 Reihen Typ 1–5; Gully mittig → Kehlkeile L/R symmetrisch gleich viele; Dämmdicke an jeder Plattenecke = Höhenfeld ± 1 mm; Gefällelänge über Typ 8 → Bezeichnung "1+1"; Referenz-L-Dach ergibt keine Lücken/Überlappungen (Flächensumme = Dachfläche ± 0,01 m²); Kehle ≠ 45° (ungleiche Gefälle) → Befund "Kehlkeil nicht im Katalog".
25. **[E] Maß- und Lückenprüfung Verlegeplan**: Plattenmaße exakt aus Katalog, Zuschnitte/Kehlkeile mit Maßen. **Keine Stückliste** (Nutzerentscheid, nicht in V1). *Abnahme:* Fläche der Platten = Dachfläche ± 0,01 m²; keine Lücken/Überlappungen; Ergebnis deterministisch (Snapshot).
26. **[X] 2D-Ansicht Dämmplan**: Plattenraster, Typ-Nummern, Kn L/R, Verlegepfeile, Kehl-/Gratlinien, N0/Verlegestart, Bemaßung außen (DESIGN §11, ohne Stückliste). *Abnahme:* Referenz-L-Dach visuell wie `gefaelledaemmplan-2d.jpg` (visual-qa); Labels überlappen nicht; Ø Gefälledämmung aus dem Plattenlayout weicht um höchstens 2 mm vom Höhenfeld-Wert (A2b) ab und wird im Plan angegeben.

### M5 3D und Export (Abschluss V1)
27. **[X] 3D-Ansicht**: Dachfläche aus Höhenfeld, Überhöhung 1/5/10×; Modus Dämmplan mit Plattenblöcken, Typ-Labels, Zusatzlage gelb. *Abnahme:* Mesh-Unit-Test (Eckhöhen = Koten, Blockhöhen = Plattendicken); DESIGN §7 und §11.
28. **[X] PDF-Export** (Gefälleplan + Dämmplan; Schriftfeld, Legende, Nordpfeil, Maßstabsbalken; Tabelle Ablauf-Koten `z` und Ø/min/max Gefälledämmung je Dachfläche). *Abnahme:* 10 m bei 1:100 = 100 mm ± 0,2 mm; DESIGN §10 Punkt 13.
29. **[X] DXF-Export** (Layer je Objektart, Plattenraster, Texte). *Abnahme:* Re-Import ± 1 mm; 
30. **Review V1** (`reviewer`), Fixes, Feldtest mit 2 Bürodächern (inkl. Abgleich mit einem Hersteller-Verlegeplan).

### M6 Modus C (V1.1), M7 Desktop
31. **[E] Vorschlag Abläufe**: Anzahl/Position so, dass alle Flächen ≤ Grenzwert und HP ≤ max. *Abnahme:* 40×20 → ≥ 3 Abläufe, alle < 300 m²; deterministisch.
32. **[X] Tauri-Wrapper** inkl. signiertem Auto-Update (Tauri-Updater, Quelle privat/einstellbar) (bevorzugte Verteilung wegen Datenschutz: Installer statt öffentlicher Webseite; ein öffentliches GitHub Pages nur ohne Hersteller-/Kundendaten und nur nach Rücksprache) (DWG entfällt, Nutzerentscheid).

## 7. Teststrategie
- Kern: Vitest-Unit-Tests, fast-check-Eigenschaften (Flächensumme, Invarianz, Färbung, Lückenfreiheit der Platten), Golden-Fixtures mit erwarteten Koten, Flächen, Plattenlisten. Ziel ≥ 90 % Zeilenabdeckung in `src/core`.
- Rule-Packs: Schema-Validierung aller Packs in `npm test`; Snapshot der Befunde und Stücklisten je Fixture.
- UI: Tests für Transformation, Fang, Werkzeug-Zustände; Playwright-Smoke (Laden, Zeichnen, Standort offline, Export) + Screenshots für `visual-qa`.
- Export: PDF/DXF maßlich geprüft (Re-Import bzw. PDF-Koordinaten).

## 8. Risiken und offene Fragen
- **R1 KOSTRA.** Nutzerentscheid: OpenKOSTRA verwenden, DWD-Lizenzprüfung entfällt (Lizenz von OpenKOSTRA beim Bau des Packs im Pack vermerken). Ursprünglich: DWD stellt KOSTRA-DWD-2020 als Open Data bereit (Raster ca. 5×5 km); Nutzungsbedingungen und Pflicht zur Quellenangabe vor Einsatz prüfen. Eine Punktabfrage-API mit CORS ist nicht gesichert, Online-Abruf widerspricht "lokal". **Empfehlung:** Offline-Pack (Schritt 11), Standort offline per Koordinate/PLZ/Kartenklick, Wert sichtbar und überschreibbar, Quellenangabe im Export; Online nur als optionaler Pack-Update-Download.
- **R2 Geocoding/Datenschutz:** Adressen sind Projektdaten. Online-Geocoding nur nach Opt-in, Anbieter offen (z. B. BKG oder Nominatim, Nutzungsbedingungen prüfen); Standard bleibt offline.
- R3 Regelwerkswerte (ZVDH 01/2026, DIN 18531, DIN 1986-100 für r(5,5)/r(5,100)) ungeprüft; bis zur Prüfung `geprueft:false`.
- R4 Bauder-LES-Daten widersprüchlich; Loro-Abflusstabelle fehlt.
- R5 Modell A2 bei L/U-Formen: Distanz kann die Kontur verlassen; der Engineer prüft eine geodätische Variante.
- **R6 Plattenkatalog:** Nutzerentscheid: vorerst KEIN Katalog; gerechnet wird mit Platten 1,00 m × 1,00 m (Format als Pack-Parameter, später änderbar). Dickenstufen/Typen/"8A"/Kehlkeile als Pack-Parameter mit Standardwerten `geprueft:false`; echter Katalog später.
- R7 Kehlen ≠ 45° und schräge Konturen: Keilsortiment evtl. nicht passend; V1 meldet Befund statt Sonderzuschnitt.
- Offen: Anschlusshöhen/Notabdichtung; Abflussbeiwert Gründach; Erfolgskriterium V1 (Vorschlag: Bürodach inkl. Dämmplan in < 30 min, Ergebnis vom Planer bestätigt).

## Übergabe
- Nächster Schritt: **7 Einzugsflächen** [E] via `engineer`. Schritte 1–6 erledigt (check.sh grün, 149 Tests). Schritt 6: `src/core/slope/quellen.ts` (Entwässerung → Höhenquellen), LES = Strecke mit L∞-Segmentabstand in eigener Achse (Kehle entlang LES, Seitenfacetten ⟂ LES), LES-Keil additiv (`DachGefaelle.les`, `keilDickeAm`), Dachreiter = Randstrecke mit Öffnungsbreite aus Pack (`DachGefaelle.dachreiter`). Packs kommen über `SlopeOptionen.packs`.
- API geändert: `Hoehenquelle` hat `bis`/`achse`; Hinweis `keine-punktablaeufe` → `keine-ablaeufe`; `ablauf-nicht-beruecksichtigt` entfällt; neu u. a. `pack-ungeprueft`, `les-*`, `dachreiter-*`.
- Offen aus Schritt 6: Pack `dachreiter` ohne echte Maße (→ Randpunkt + Hinweis `dachreiter-masse-fehlen`, Tests nutzen Test-Pack); LES-Diagonalgefälle 3,5 % ungenutzt (Keilseiten aus längs/quer); bei LES-Länge ≠ Pack-Keillänge wird der Keil aus den Gefällen hochgerechnet (Hinweis); Gully am tieferen LES-Ende nicht geprüft (Schritt 9); Keilflächen nicht in `facetten`/`pfeile`, HP/TP und `daemmung.min` ohne Keil (Mittel und Max mit Keil); Zonen weiter ignoriert (Schritt 8); Abstände um Löcher evtl. zu niedrig (R5); Facetten-Filter hängt an `CLIPPER_SCALE`; Dachachse = längste Konturkante.
- Stand: DESIGN.md (inkl. §11 Dämmplan, Einzugsflächen ohne Schraffur), Intent, Referenzbilder vorhanden; Setup-Code vorhanden (Vite, TS strict, ESLint, Vitest; `tsconfig.core.json` ohne DOM).
- Entscheidungen: Daten bleiben ausschließlich lokal (Datei auf Festplatte); kein öffentliches Hosting (siehe Schritt 22/32); Kern rein in `src/core`; Regeln, Herstellerdaten, KOSTRA, PLZ nur in `rulepacks/`; V1 = M1–M5 inkl. Gefälledämmplan; Standort offline, Geocoding optional per Opt-in.
- Vom Nutzer noch ausstehend (nicht blockierend): Loro-Abflussleistungstabelle (folgt); Original-Flachdachrichtlinie (folgt); Herkunft LES-Diagonalgefälle 3,5 % (nur Hinweis, wird wie gegeben verwendet); Ort der Update-Quelle.
- Entschieden (Nutzer, nicht erneut fragen): "Gefälle im Mittel" = **mittlere Gefälledämmdicke in mm je Dachfläche** (bestätigt, kein mittleres Gefälle in %); Ablauf-Tiefenlage `z` je Ablauf; Dachreiter/LES maßgenau nach den Bauder-Maßen und -Gefällen (docs/referenz/bauder-les-*.jpg, bauder-les-keil.jpg; längs 1 %, quer 4 %, diagonal 3,5 %; Keil 6,00 m × 1,50 m je Seite, 10→70 mm), keine Sets; Dämmplatten vorerst 1,00 × 1,00 m ohne Katalog; KOSTRA über OpenKOSTRA, keine DWD-Lizenzfrage; keine Schraffur (auch nicht bei Terrassen); Gefällerichtung immer mit Pfeilen; Loro-Tabelle und Flachdachrichtlinie reicht der Nutzer nach.
- Offene Rückfragen/Annahmen: "keine Stücklisten" = nicht in V1 (später evtl. nachrüsten?); Attika-Fläche in Horizontalprojektion; Modus C erst V1.1; Verteilung bis Tauri per npm (lokal), kein öffentliches Hosting; Unterlage standardmäßig nur per Verweis. Reste von "Stückliste" in Teststrategie/R6 bei Gelegenheit bereinigen.
- Offen aus Schritt 4: Packs `dachreiter`, `ablaeufe`, `abflussbeiwerte`, `kostra-dwd-2020`, `orte-plz` sind Platzhalter ohne echte Werte; `daemmplatten` hat erfundene Stufen (im Pack vermerkt); `gueltigAb` zvdh-2026 angenommen; Ajv nutzt `new Function` (bei strenger CSP in Tauri vorkompilieren); Abgleich Projekt-`packVersionen` ↔ geladene Packs kommt in Schritt 22/22b.
- Stolperfallen: LES `von` = tieferes Ende (Kote z), Richtung zählt; Einzugsflächen (Schritt 7) aus Facetten je `ablaufId` ableiten, LES/Dachreiter sind dort normale Quellen; Selbstschnitt/Lage von Zonen und Aufbauten prüft erst Schritt 8/9; Attika-Fläche (Schritt 7) als Summe Segmentlänge × b rechnen, nicht als Offset-Differenz (Offset außen 18,36 m² statt 18,00 m²; Nicht-Rechtecke und b je Segment noch klären); keine Grenzwerte im Code; Regenspende immer Pack-Wert und Nutzerwert speichern; Einzugsflächen nie schraffieren; Attikafläche zählt zur Ablauffläche, steht aber nie im Gefälle-/Dämmplan; Koten 3 Nachkommastellen nur in der UI formatieren.
