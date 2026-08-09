# Stichansagen – Auswertung

Mobile-first Web-App zum Auswerten des Kartenspiels **Stichansagen** (Stiche ansagen / Wizard / Oh Hell).
Reines HTML, CSS und JavaScript – **kein Build, kein Framework, kein Login, kein Server**.
Alle Spielstände liegen ausschließlich im `localStorage` des jeweiligen Browsers.

## Funktionen

- **Spiel anlegen**: 2–10 Mitspieler, Sitzreihenfolge = Ansagereihenfolge, Geber rotiert automatisch.
- **Rundenverlauf** wählbar: auf und ab (1…max…1), aufsteigend, absteigend, ab und auf oder feste Rundenzahl.
  Die maximale Kartenzahl wird aus Deckgröße ÷ Spieleranzahl vorgeschlagen (Wizard 60, 52, 36, 32) und ist überschreibbar.
- **Einer-Runden zum Schluss** (Hausregel, bei „Auf und ab" voreingestellt): nach dem regulären Verlauf
  folgt je Spieler eine Runde mit nur einer Karte, sodass darin jeder genau einmal gibt.
  Bei 4 Spielern und max. 5 Karten also `1,2,3,4,5,4,3,2,1` + `1,1,1,1` = 13 Runden. Abschaltbar.
- **Erfassung in zwei Schritten** je Runde: erst Ansagen, dann Stiche – jeweils per großer Zahlenknöpfe statt Tastatur.
  - Live-Summe der Ansagen mit Hinweis „x zu viel/zu wenig angesagt".
  - Runde lässt sich erst abschließen, wenn die Stiche exakt der Kartenzahl entsprechen.
  - Optionale Geber-Regel: Die Ansagen dürfen nicht aufgehen – der verbotene Wert des Gebers wird gesperrt.
- **Wertung** als Preset oder frei konfigurierbar:

  | Preset | Regel |
  |---|---|
  | Wizard | richtig: 20 + 10 je Stich · falsch: −10 je Stich Differenz |
  | Klassisch | richtig: 10 + 1 je Stich · falsch: −1 je Stich Differenz · **ab Runde 7 zählt eine getroffene Ansage von 0 Stichen fest 20 Punkte** |
  | Stiche + Bonus | Stiche zählen immer, bei richtiger Ansage +10 |
  | Nur Differenz | 1 Minuspunkt je Stich Differenz, **wenigste Punkte gewinnen** |
  | Eigene | Bonus, Punkte je Stich, Punkte je Differenz, Grundwert bei falsch, Null-Ansage-Bonus ab Runde X, Stiche auch bei falscher Ansage, wenigste Punkte gewinnen |

  Der **Null-Ansage-Bonus** ist in jedem Preset frei einstellbar: Wer ab der eingestellten Runde
  0 Stiche ansagt und auch keinen macht, bekommt genau diese Punktzahl statt der normalen Formel.
  `0` schaltet die Regel ab. Maßgeblich ist die Rundennummer, nicht die Kartenzahl.

- **Tabelle** mit laufender Summe je Runde, Ansage/Stiche und Rundenpunkten in der Zelle, fixierter Kopf- und Rundenspalte.
- **Runden nachträglich korrigieren**: Zeile in der Tabelle antippen, Werte ändern, speichern.
- **Endstand** mit Platzierung und Trefferquote je Spieler.
- **Mehrere Spiele** parallel, laufende und beendete getrennt gelistet.
- **Export/Import** aller Daten als JSON-Datei (Backup, Wechsel auf ein anderes Gerät).
- Hell/Dunkel/System-Design, Offline-Betrieb über Service Worker, installierbar als PWA.

## Lokal ausprobieren

Die Datei `index.html` funktioniert direkt per Doppelklick; für Service Worker und Manifest wird jedoch ein
lokaler Webserver benötigt:

```bash
cd stichansagen
python3 -m http.server 8080     # oder: npx serve .
# http://localhost:8080
```

## Auf GitHub Pages veröffentlichen

Alle Pfade sind relativ, die App läuft daher unverändert unter `https://<name>.github.io/<repo>/`.

```bash
cd stichansagen
git init -b main
git add .
git commit -m "Stichansagen-Auswertung"
git remote add origin git@github.com:<dein-account>/stichansagen.git
git push -u origin main
```

Danach im Repository unter **Settings → Pages**:

- **Source**: `Deploy from a branch`
- **Branch**: `main`, Ordner `/ (root)`

Nach ein bis zwei Minuten ist die App unter `https://<dein-account>.github.io/stichansagen/` erreichbar.
Auf dem Handy über „Zum Startbildschirm hinzufügen" installieren – danach läuft sie auch ohne Netz.

### Optional: Deploy über GitHub Actions

Nur nötig, wenn vor dem Veröffentlichen noch Schritte laufen sollen – für diese App reicht der
Branch-Deploy oben. Der Push eines Workflows erfordert den `workflow`-Scope
(`gh auth refresh -s workflow`). Datei `.github/workflows/pages.yml`:

```yaml
name: Deploy to GitHub Pages
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: .
      - id: deployment
        uses: actions/deploy-pages@v4
```

In **Settings → Pages** dann als **Source** `GitHub Actions` wählen.

> Nach jedem Deploy in `sw.js` die Konstante `CACHE` hochzählen (`stichansagen-v2`, …),
> damit alte Dateien sicher aus dem Cache fliegen.

## Datenhaltung

- Speicherort: `localStorage`, Schlüssel `stichansagen.v1` (Design: `stichansagen.theme`).
- Die Daten sind an Browser **und** Domain gebunden. Privater Modus, „Websitedaten löschen"
  oder ein Gerätewechsel entfernen sie – dafür gibt es Export/Import auf dem Startbildschirm.
- Es werden keinerlei Daten übertragen; die Seite lädt nichts von fremden Servern.

## Tests

`test/app.test.js` fährt die App in jsdom hoch und spielt eine komplette Partie durch
(Setup, Geber-Regel, beide Eingabephasen, Punkte, Tabelle, nachträgliche Korrektur, Neuladen aus
dem `localStorage`, Rundenverläufe, alle Wertungsformeln).

```bash
npm install     # nur jsdom, ausschließlich für die Tests
npm test
```

## Dateien

| Datei | Zweck |
|---|---|
| `index.html` | Aufbau aller Bildschirme |
| `styles.css` | Mobile-first Styles, Hell/Dunkel |
| `app.js` | Spiellogik, Wertung, Speicherung, Rendering |
| `sw.js` | Service Worker für Offline-Betrieb |
| `manifest.webmanifest`, `icon*.svg` | PWA-Installation |
| `.nojekyll` | verhindert Jekyll-Verarbeitung auf GitHub Pages |
| `test/app.test.js` | Integrationstest in jsdom |
