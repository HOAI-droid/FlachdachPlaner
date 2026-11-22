# DESIGN.md – Flachdachplaner

## 1. Leitidee und Stimmung
Wie ein Zeichentisch mit Transparentpapier: ruhige warme Papierfläche, graphitfarbene Linien, Farbe nur da, wo sie etwas bedeutet (Einzugsflächen, Warnungen, Auswahl). Die Oberfläche tritt hinter den Plan zurück. Sie ist dicht, ausgerichtet und rechnet sichtbar mit echten Maßen: Zahlen stehen in Festbreitenschrift, Einheiten immer dabei, deutsches Zahlenformat (`12,345 m`, `2,0 %`, `318 m²`).
**Adjektive:** präzise, sachlich, ruhig.

Verboten: Verläufe, Glas-/Blur-Effekte, Schatten über `--shadow-1`, verschachtelte Karten, farbige Seitenstreifen an Listeneinträgen, Verlaufstext, Hero-/Marketing-Elemente, Emojis.

## 2. Farben (CSS-Tokens, `:root` = hell, `[data-theme="dark"]` = dunkel)

| Token | Hell | Dunkel | Verwendung |
|---|---|---|---|
| `--bg` | `#F4F2EC` | `#17181A` | App-Hintergrund, Zeichenfläche |
| `--surface` | `#FBFAF7` | `#202124` | Panels, Leisten |
| `--surface-2` | `#ECE9E1` | `#2A2B2F` | Hover, Eingabefelder, Tabellenkopf |
| `--line` | `#D6D2C7` | `#3A3B40` | Trennlinien 1 px |
| `--line-strong` | `#A9A498` | `#55575D` | Feldrahmen, Fokus-nahe Rahmen |
| `--text` | `#1C1D1F` | `#E8E6E1` | Fließtext, Werte |
| `--text-muted` | `#5A5C60` | `#A3A29D` | Labels, Einheiten, Sekundäres |
| `--accent` | `#1F4FA3` | `#8CAEF0` | Auswahl, aktives Werkzeug, Primärbutton, Fokus |
| `--on-accent` | `#FFFFFF` | `#111214` | Text auf Akzent |
| `--accent-soft` | `#DCE5F5` | `#26324A` | Hintergrund aktives Werkzeug / gewählte Zeile |
| `--ok` | `#2E6B3A` | `#7CC48A` | Prüfung bestanden |
| `--warn` | `#8A5A00` | `#E6B450` | Hinweis (z. B. Einzugsfläche >= 300 m²) |
| `--warn-soft` | `#F6E7C4` | `#3A3020` | Hinweis-Badge-Grund |
| `--error` | `#B3261E` | `#F28B82` | Fehler (z. B. > 350 m²) |
| `--error-soft` | `#F7DAD7` | `#43201E` | Fehler-Badge-Grund |
| `--snap` | `#D4007A` | `#FF5CB8` | Fangpunkt-Marker (nur Zeichenfläche) |
| `--underlay-opacity` | `0.45` | `0.35` | PDF/DXF-Unterlage (DXF in `--text-muted` umgefärbt) |

**Kontrast (WCAG AA, geprüft):** text/bg 16,2:1 · 13,9:1; muted/bg 6,0:1 · 6,9:1; accent/bg 6,9:1 · 8,0:1; on-accent/accent 7,8:1 · 8,4:1; warn/bg 5,2:1; error/bg 5,8:1; ok/bg 5,6:1; Dunkel-Statusfarben alle > 7:1. Texte auf `*-soft` nutzen die volle Statusfarbe (>= 4,6:1). Nie `--text-muted` auf farbigem Grund.

**Status nie nur über Farbe:** Hinweis = Dreieck-Icon, Fehler = Achteck-Icon, OK = Kreis mit Haken, jeweils plus Textwort.

### Einzugsflächen-Palette (12, nach Paul Tol, farbenblind-geprüft)
Füllung mit `fill-opacity: 0.35` (dunkel `0.30`), Rand 1,5 px in Randfarbe. **Keine Schraffur auf Einzugsflächen** (Nutzerentscheid): nur Farbe + ID/m²-Label.

| # | Füllung | Rand |
|---|---|---|
| 1 | `#77AADD` | `#2B5F94` |
| 2 | `#EE8866` | `#A8441F` |
| 3 | `#EEDD88` | `#8C7A1E` |
| 4 | `#FFAABB` | `#B0435A` |
| 5 | `#99DDFF` | `#2E7FA8` |
| 6 | `#44BB99` | `#1E6E57` |
| 7 | `#BBCC33` | `#66711A` |
| 8 | `#AAAA00` | `#5C5C00` |
| 9 | `#AA4499` | `#6B2A60` |
| 10 | `#CC6677` | `#7F2E3B` |
| 11 | `#117733` | `#0B4A21` |
| 12 | `#332288` | `#1E1450` |

Regeln: Nachbarflächen bekommen nie dieselbe Farbe (Greedy-Graphfärbung über gemeinsame Kanten). Ab Fläche 13 wiederholt sich die Palette (nicht benachbart, Label unterscheidet). Farbwechsel sind sehr weich (Verlauf zwischen Zellen nicht nötig, flache Töne). Jede Fläche trägt eine ID (`E1`, `E2` …), die auch im Ablauf-Label und in der Liste steht.

## 3. Typografie
- **UI:** `IBM Plex Sans Condensed` (400, 500, 600), selbst gehostet als woff2 (offline). Fallback `"Segoe UI", system-ui, sans-serif`.
- **Werte, Koordinaten, Koten:** `IBM Plex Mono` (400, 500), `font-variant-numeric: tabular-nums`.
- **Planexport:** `IBM Plex Sans Condensed` (eingebettet).

| Token | Größe / Zeilenhöhe | Gewicht | Einsatz |
|---|---|---|---|
| `--fs-xs` | 11 px / 14 px | 500, Versalien, +0,04 em | Gruppenüberschriften im Panel, Tabellenkopf |
| `--fs-sm` | 12 px / 16 px | 400 | Statusleiste, Hilfetexte, Plan-Labels |
| `--fs-md` | 13 px / 18 px | 400/500 | Standard-UI, Felder, Listen |
| `--fs-lg` | 15 px / 20 px | 600 | Panel-Titel, Dialogtitel |
| `--fs-xl` | 18 px / 24 px | 600 | Projektname in der Kopfleiste, leere Zustände |

Keine Schrift über 18 px in der App. Einheiten in `--text-muted`, durch schmales Leerzeichen (U+202F) getrennt.

## 4. Layout und Abstände
**Spacing (4-px-Basis):** `--sp-1 2px`, `--sp-2 4px`, `--sp-3 8px`, `--sp-4 12px`, `--sp-5 16px`, `--sp-6 24px`, `--sp-7 32px`.
**Radien:** `--r-1 2px` (Felder, Buttons), `--r-2 4px` (Panels, Dialoge, Badges). Kein Pill-Radius außer m²-Badges im Plan.
**Schatten:** nur `--shadow-1: 0 2px 8px rgb(0 0 0 / .12)` für schwebende Menüs, Tooltips, Dialoge.

**App-Raster (CSS Grid, volle Fensterhöhe, kein Seiten-Scroll):**
```
[ Kopfleiste 40px                                         ]
[ Werkzeugleiste 44px | Zeichenfläche / 3D | Eigenschaften 320px ]
[                     | Prüfliste 200px (resizable 120–480)      ]
[ Statusleiste 24px                                       ]
```
- Werkzeugleiste: vertikal, Icon-Buttons 32x32, Gruppen durch 1-px-Linie + 8 px getrennt (Auswahl · Zeichnen · Entwässerung · Messen/Kalibrieren).
- Eigenschaften-Panel: resizable 280–440 px, Abschnitte einklappbar, Label-Spalte 112 px, Wertspalte rechtsbündig (Zahlen).
- Prüfliste: Tabelle, Zeilenhöhe 28 px, Spalten Stufe | Meldung | Objekt | Regel + Quelle.
- Statusleiste: Cursor-Koordinaten (m, 3 Nachkommastellen), Maßstab (`1:100`), Fang an/aus + aktive Fangarten, Regelwerk-Version.
- 2D/3D: Umschalter in der Kopfleiste (Segment-Control), optional Split vertikal 50/50.

**Breakpoints:** Mindestbreite 1280 px (darunter Hinweisleiste). `>= 1600`: Panel 360 px. `>= 1920`: Prüfliste standardmäßig 240 px. Keine Mobil-Layouts.

## 5. Komponenten
Alle Bedienelemente 28 px hoch (kompakt), Icon-Buttons 32x32 (Werkzeugleiste) bzw. 24x24 (Panel). Icons: 16 px, 1,5-px-Strich, eigene SVG-Sätze, ohne Füllung.

**Buttons**
| Variante | Normal | Hover | Aktiv/gedrückt | Deaktiviert |
|---|---|---|---|---|
| Primär | `--accent` Grund, `--on-accent` Text | Helligkeit -8 % | -14 %, 1 px nach unten | `opacity .4`, `cursor: not-allowed` |
| Sekundär | transparent, 1 px `--line-strong` | `--surface-2` | `--line` Grund | wie oben |
| Werkzeug | transparent, Icon `--text` | `--surface-2` | gewählt: `--accent-soft` Grund + Icon `--accent`, Rahmen 1 px `--accent` | wie oben |
| Gefährlich | Text `--error`, Rahmen `--error` | `--error-soft` | – | wie oben |
Fokus (alle): `outline: 2px solid var(--accent); outline-offset: 1px`, nur `:focus-visible`. Jeder Werkzeug-Button hat Tooltip mit Name + Tastenkürzel (z. B. `Gully setzen  G`).

**Panels/Abschnitte:** flach, `--surface`, Trennung nur durch 1-px-`--line`. Keine Karten in Panels; Abschnittskopf 28 px, `--fs-xs` Versalien, Chevron rechts.

**Formularfelder:** 28 px hoch, `--surface-2` Grund, 1 px `--line`, Padding 0 8 px. Hover: Rahmen `--line-strong`. Fokus: Rahmen `--accent` + Fokus-Outline. Fehler: Rahmen `--error`, Meldung darunter in `--fs-sm` `--error` mit Achteck-Icon. Deaktiviert: Grund `--bg`, Text `--text-muted`. Zahlenfelder: Mono, rechtsbündig, Einheit als Suffix im Feld, Pfeiltasten +/- Schrittweite (Shift = x10). Abgeleitete Werte (berechnet, nicht editierbar) ohne Rahmen, mit `=` davor.

**Badges (Prüfstufe):** 20 px hoch, `--r-2`, `*-soft` Grund, Statusfarbe für Icon + Text.

**Prüfliste:** Zeile Hover `--surface-2`, Auswahl `--accent-soft`. Klick zentriert und markiert das Objekt im Plan (Puls siehe Bewegung). Sortierung: Fehler, Hinweis, OK. Kopf zeigt Zähler `2 Fehler · 5 Hinweise`.

**Dialoge:** max. 560 px breit, `--surface`, `--shadow-1`, Backdrop `rgb(0 0 0 / .3)`. Buttons rechts unten, Primär ganz rechts.

## 6. Zeichenfläche und Plansymbole
Größen in **Bildschirm-px bei 100 %** (skalieren nicht mit Zoom, außer Geometrie). Im PDF-Export gelten die mm-Werte in Klammern.

- **Dachfläche:** Kontur 1,5 px `--text` (0,50 mm). Attika: Doppellinie, Abstand = reale Breite; Füllung in der Farbe der zugehörigen Einzugsfläche (helleres Tint, keine Schraffur); Label `E3 · Dach 296 m² + Attika 24 m² = 320 m²`. Aufbauten: 1 px Kontur, Kreuz diagonal. Dachterrasse: **keine Schraffur** (Nutzerentscheid), Füllung flach `--line-strong` mit 12 % Deckkraft, Label `Terrasse`.
- **Auswahl:** Kontur 2 px `--accent`, Griffe 7x7 px weiß mit 1 px `--accent`. Hover über Objekt: Kontur 2 px `--accent` mit 50 % Deckkraft.
- **Fang:** Endpunkt = Quadrat 9 px, Mittelpunkt = Dreieck, Schnittpunkt = X, Lot = rechter Winkel, jeweils 1,5 px `--snap`; Hilfslinien gestrichelt 4/4 `--snap` 60 %. Fang-Art als Text 11 px neben dem Cursor.
- **Höhenkote:** gleichseitiges Dreieck 8 px, Spitze nach unten auf dem Punkt, halb gefüllt; Text Mono 12 px rechts oben: `+12,345` (m, 3 Stellen, Vorzeichen immer). Hochpunkt `HP`, Tiefpunkt `TP` als Präfix. Höhe OK Abdichtung = Standard; OK Belag zusätzlich in Klammern.
- **Gefällepfeil (Nutzerentscheid: Gefällerichtung wird IMMER mit Pfeilen angegeben, je Facette/Dachfläche mindestens ein Pfeil, in 2D, Dämmplan und Export; auch Terrasse, Attika zum Dach hin und LES-Keile):** Linie 1 px, offene Pfeilspitze 8 px in Fließrichtung (bergab), Text `2,0 %` mittig über der Linie, mitgedreht, nie kopfstehend. Unter Mindestgefälle: Pfeil + Text `--warn`. 0 %-Flächen (begründet): Text `0 %` + Kürzel der Begründung.
- **Gully:** Kreis Ø 12 px, 1,5 px, innen Kreuz. **Notablauf:** Kreis Ø 12 px mit `N`, zusätzlich gestrichelter Ring Ø 20 px. **Dachreiter (Speier):** Rechteck 14x6 px an der Attika, Dreieck nach außen. **LES:** Doppellinie in realer Länge, Abstand 6 px, Querstriche alle 8 px, Länge als Label (`LES 6,00 m`). **Empfohlener Notentwässerungsbereich:** Fläche gestrichelt 6/3 `--warn`, Füllung 10 %, Label `Bereich Notentwässerung`.
- **Ablauf-Kote und Ø Gefälledämmung (Nutzeranforderung):** Am Ablaufsymbol zusätzlich die Tiefenlage als Kote `z` (Mono 12 px, Format wie Höhenkote, z. B. `z −0,050`), im Eigenschaften-Panel als editierbares Feld. Je Dachfläche ein Kennwert-Badge (Stil wie Einzugsflächen-Label, Mono 12 px): `Ø Dämmung 128 mm` mit zweiter Zeile `min 20 · max 220 mm`; im Ergebnis-Panel und im PDF-Schriftfeld als Tabelle (Dachfläche, Ø, min, max).
- **Einzugsflächen-Label:** an der Flächenmitte (Polylabel), Badge mit Pill-Radius: `E3 · 318 m²`, Mono 12 px, Grund `--surface` 90 %, Rand in Flächen-Randfarbe. Ab 300 m²: Grund `--warn-soft`, Dreieck-Icon. Über 350 m²: Grund `--error-soft`, Achteck-Icon, Flächenkontur zusätzlich 2 px gestrichelt 6/3 `--error`. Ablaufsymbol bekommt dieselbe ID.
- **Zeichnungsreihenfolge:** Unterlage < Einzugsflächen < Dachkontur/Aufbauten < Pfeile < Symbole < Koten/Labels < Auswahl < Fang.
- **Label-Kollision:** Labels dürfen sich nicht überlappen; bei Kollision Führungslinie 1 px `--text-muted`.

## 7. 3D-Ansicht (three.js)
Hintergrund `--bg`. Licht: Hemisphere (Himmel `#FFFFFF`, Boden `#B8B2A4`, 0,8) + Directional 0,6 von Südwest 45°; keine harten Schatten. Material `MeshStandardMaterial`, `roughness 0.9`, `metalness 0`. Dachoberfläche in Einzugsflächenfarbe (voll deckend, 15 % heller), Attika/Aufbauten `#C9C4B8` (dunkel `#5A5C60`), Kanten als `LineSegments` 1 px `--text` 60 %. Höhenüberhöhung wählbar 1x/5x/10x (Standard 5x, Wert sichtbar in der Ecke). Kompass und Achsenkreuz unten links, 48 px. Wasserfluss optional als feine Pfeile auf der Fläche, keine Partikel.

## 8. Bewegung
- `--dur-fast 100ms` (Hover, Toggle), `--dur-base 160ms` (Menüs, Einklappen), `--dur-slow 280ms` (3D-Kamerafahrt, Panelgröße). Easing `cubic-bezier(.2,0,0,1)`.
- Animiert: Hover-Farben, Einklappen von Abschnitten, Tooltip-Einblendung (Verzögerung 400 ms), Zoom-auf-Objekt (280 ms), Markier-Puls bei Klick in der Prüfliste (2x Kontur-Deckkraft 1 → 0,3, insgesamt 600 ms).
- Bewusst **nicht** animiert: Zeichnen, Fang, Pan/Zoom per Maus (sofort, 60 fps), Neuberechnung von Flächen/Koten (Werte springen), Theme-Wechsel, Prüfergebnisse.
- `prefers-reduced-motion: reduce` → alle Dauern 0, Puls ersetzt durch statische 3-px-Kontur für 1,5 s.

## 9. Planexport (PDF)
Immer hell, Papierweiß `#FFFFFF`, Linien Schwarz `#000000`; Strichstärken ISO 128: 0,18 / 0,25 / 0,35 / 0,50 / 0,70 mm. Einzugsflächen mit 25 % Tint, ohne Schraffur; im Graustufendruck unterscheidet das Label (ID + m²). Schriftfeld unten rechts 180 x 50 mm: Projekt, Planinhalt, Maßstab, Datum, Bearbeiter, Regelwerk + Version, Index. Legende (Symbole, Flächen-IDs mit m², Warnungen) rechts neben dem Plan. Textgrößen 2,5 / 3,5 / 5 mm. Nordpfeil und Maßstabsbalken Pflicht. Keine UI-Farben (`--accent`, `--snap`) im Export.

## 10. Abnahme-Checkliste (per Screenshot, hell und dunkel)
1. Schriften sind Plex Sans Condensed / Plex Mono; keine Schrift > 18 px in der App.
2. Alle Zahlen mit Einheit, deutschem Dezimalkomma, Koten mit Vorzeichen und 3 Nachkommastellen.
3. Grundraster stimmt: Kopfleiste 40, Werkzeugleiste 44, Panel 320, Statusleiste 24 px (+-1 px).
4. Nur Tokenfarben sichtbar; keine Verläufe, kein Blur, keine Schatten außer an schwebenden Elementen.
5. Keine Karte in Karte, keine farbigen Seitenstreifen an Listen-/Panel-Einträgen.
6. Aktives Werkzeug eindeutig erkennbar (Akzent-Grund + Rahmen); Fokus-Outline per Tab sichtbar.
7. Benachbarte Einzugsflächen haben unterschiedliche Farbe; jede Fläche hat ID + m²-Label.
8. Fläche >= 300 m² zeigt Hinweis-Badge mit Dreieck, > 350 m² Fehler-Badge mit Achteck und gestrichelte rote Kontur; beide auch in der Prüfliste mit Regel + Quelle.
9. Symbole Gully, Notablauf, Dachreiter, LES sind im Plan ohne Legende unterscheidbar (auch in Graustufen).
10. Gefällepfeile zeigen bergab, Text nie kopfstehend; Labels überlappen nicht.
11. Unterlage blass genug, dass eigene Linien klar dominieren.
12. Dunkelmodus: kein reines Schwarz/Weiß, Kontraste wie in Abschnitt 2, Einzugsflächen weiterhin unterscheidbar.
13. PDF-Export: weißer Grund, Schriftfeld, Legende, Nordpfeil, Maßstabsbalken; Flächen im Graustufen-Druck unterscheidbar.
14. Bei 1280 x 800 kein abgeschnittenes UI, kein Seiten-Scrollbalken.

## 11. Gefälledämmplan (Verlegeplan) – Referenz docs/referenz/gefaelledaemmplan-*.{jpg,webp}
Eigene Planansicht und eigener Export (2D und 3D), Nutzerwunsch: Aufbau wie die Referenzbilder.
- 2D: Dachkontur stark (0,70 mm), Bemaßung außen, Verlegestart-Markierung + N0-Ursprung, Plattenraster als dünne Linien, je Platte Typ-Beschriftung (1…8, 8A, Kehlkeile K1…Kn), Verlegerichtungspfeil je Plattenreihe, Kehl- und Gratlinien diagonal. Nur Linien und Schrift, keine Schraffur, Flächen weiß; Hervorhebung nur durch Tint (z. B. Doppelplatten gelb).
- 3D: Dämmkörper als Block mit Plattengrenzen, Plattentyp-Beschriftung (rot), Keil-Detail als Aufzieh-Callout; Farbe nur zur Unterscheidung von Lagen (gelb = zusätzliche Platte).
- Im Plan angegeben: **Ø Gefälledämmung** je Dachfläche (mm), Ablauf-Koten `z`.
- Keine Stückliste (Nutzerentscheid).
