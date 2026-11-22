# Intent: Gefälleplanung Flachdach (Entwurf, Stand Interview 6/6)

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

## Ergänzungen (Interview 6)
- **Maßstab beim Import** der Unterlage angeben (z. B. 1:100) bzw. per Zwei-Punkt-Kalibrierung (bekannte Strecke). Maßstab/Größe ist wesentlich.
- **Entwässerungssysteme**: Gully/Ablauf, **Dachreiter** und **Linienentwässerung (LES)** herstellerabhängig (Beispiel Bauder PIR T LES: Keil-Sets, Systeme bis 10 m Länge, größere Längen objektspezifisch). Herstellerdaten als Datenbibliothek, nicht im Code.
- **Einzugsflächen farbig**: jede Teilfläche, die in einen Ablauf entwässert, in eigener Farbe, mit **Flächengröße in m²** am Ablauf/an der Fläche.
- **Grenzwerte (konfigurierbar)**: Hinweis ab **300 m²**, Fehler/Verstoß über **350 m²** je Ablauf/Einzugsfläche.
- Gefällekeile (Kehlgefälleplatten, Dämmkeile, Grunddämmung) sind Teil der Aufbau- und Materialausgabe.

## Regelwerk (vom Nutzer angegeben, VOR Einsatz gegen Originaltext prüfen)
Flachdachrichtlinie (ZVDH) Ausgabe Januar 2026 + DIN 18531: Planungsziel i. d. R. 2 %; in begründeten Fällen (Retention, Intensivbegrünung, barrierefreie Übergänge, niedrige Anschlusshöhen) Flächen ohne Gefälle zulässig; unter 5 % gilt stehendes Wasser als normal. Regeln als konfigurierbare Parameter umsetzen, nicht hart verdrahten.

## Offen
- Frage 6: Umfang der ersten Version (MVP) und Erfolgskriterium.
- Konkrete Maße Abdichtung/Notabdichtung/Anschlusshöhen.

## Herstellerdaten Bauder PIR T LES (Auszug aus PDF, UNGEPRÜFT)
- Sets 1-5 (Bestell-Nr. 9610 8140/8240/8340/8440/8540), Breite 2000 mm; Höhenbereiche laut Grafik: Set 1 10-30, Set 2 30-50, Set 3 50-70, Set 4 70-90, Set 5 90-110 mm.
- LES 1-10 (bis 10 m): Sets werden addiert (LES 1-2 = Set 1; 3-4 = 1+2; 5-6 = 1+2+3; 7-8 = 1+2+3+4; 9-10 = 1+2+3+4+5). Ab LES 11 objektspezifisch, längere Lieferzeit.
- Die Auswertung nennt Höhe 0,25 m je m Länge und Gefälle 1/3,5/4 % ohne klare Zuordnung: widerspricht den mm-Höhen der Grafik. Vor Umsetzung mit Original-PDF/Hersteller klären.

## Entwässerung: Regeln und Berechnung (aus Flachdachrichtlinie 12/2025, S. 56/57, Nutzer-Scan; vor Einsatz gegen Original prüfen)
- Flächengrenzen **je Ablauf** (nicht je Dachfläche): Hinweis ab 300 m², Fehler > 350 m².
- **Barrierefreie Schwellen** (Balkone, Loggien, Dachterrassen): Hauptentwässerung Sicherheitsbeiwert ≥ 1; **Notentwässerung Sicherheitsbeiwert ≥ 2** und für den gesamten Jahrhundertregen; Haupt- und Notentwässerung ≤ 10,0 m Abstand vom Übergang.
- **Anstauhöhe** der Notentwässerung max. **35 mm** (Abflussleistung nur bis dort ansetzen, nicht die 75-mm-Spalte der Herstellertabelle). Wehrhöhe zählt erst ab Wehrkante (z. B. Loro 37 mm).
- **Überflutungskante Notentwässerung ≥ 5 cm niedriger** als OK Flüssigkunststoff am Schwellenprofil.
- Anschlusshöhe barrierefrei ≥ 5 cm; Aufkantung OK Flächenabdichtung bis OK Flüssigkunststoff ≥ 10 cm (Belag inkl. Stelzlager/Kies ≥ 10 cm).
- Gefälle Abdichtung zur Hauptentwässerung bei Kies/Splitt und Stelzlagern **soll/sollte ≥ 1 %**; Kies: Drainagematte ≥ 1,5 cm, Stichkanäle ≥ 20 cm² im Abstand ≤ 2,1 m; Stelzlager ≥ 2 cm. Beläge ≥ 1 % Gefälle zu Gullys/Speiern.
- Ab Schneelastzone 3: Rinnen/Abläufe/Speier beheizt.
- **Anzahl Notabläufe (Schätzung)**: Q = r · C · A / 10 000 (l/s) je Einzugsfläche; n_not = aufrunden(Q_Notfall · 2 / Q_Ablauf bei 35 mm Anstau), mindestens 1. Eingaben: Regenspende (Standort, Jahrhundertregen), Abflussbeiwert (Gründach), Abflussleistungstabelle des Ablaufs (Herstellerdaten, z. B. Loro). Ausgabe als Schätzung mit Bereich/Position, keine Bemessung.
