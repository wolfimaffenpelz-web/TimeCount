# TimeCount

Persönliche Arbeitszeiterfassung als lokale, offlinefähige PWA. Deutsche Oberfläche, Android und Desktop, Hell-/Dunkelmodus. Keine Konten, kein Backend, keine Telemetrie und keine externen Laufzeitdienste. Die Anwendung besteht aus HTML, CSS und JavaScript-Modulen ohne Framework.

## Start

Node.js 22 oder neuer (getestet: 24). Die App selbst benötigt keine npm-Pakete:

```sh
cd /workspace/TimeCount
npm start
```

Der mitgelieferte statische Entwicklungsserver lauscht auf Port 4173, konfigurierbar mit `PORT`. Auf dem eigenen Rechner im Browser `http://localhost:4173` öffnen. Der Server speichert keine Nutzerdaten. Für andere Geräte die statischen Dateien über **HTTPS** bereitstellen; unverschlüsseltes HTTP auf einer LAN-IP ermöglicht keine zuverlässige PWA-/Service-Worker-Nutzung. Es ist kein Build erforderlich. Beim Hosting in einem Unterverzeichnis relative Pfade beibehalten.

## Android installieren

Die HTTPS-Adresse in Chrome öffnen, das erste vollständige Laden abwarten und im Browsermenü **App installieren** / **Zum Startbildschirm hinzufügen** wählen. Ein Installationsbutton erscheint unter Einstellungen, wenn der Browser ihn anbietet. Dort wird auch der Offline-Cache-Status angezeigt. Danach funktioniert die gesamte reguläre Nutzung ohne Internet. Ein echtes Android-Gerät wurde in der Cloud nicht getestet; Chromium wurde automatisiert in mobiler Darstellung und offline geprüft.

## Alltag und Korrekturen

Unter **Heute** Arbeit starten, bei Bedarf Pause starten/beenden und Arbeit beenden. Mehrere Arbeitsblöcke pro Tag sind möglich. Der Zustand wird vor einer Erfolgsmeldung gespeichert. Laufende Erfassungen überstehen Reloads und Browser-Neustarts; ein JavaScript-Timer ist dafür nicht erforderlich. Wiederholte Klicks werden kurz gesperrt.

Im **Kalender** einen Tag öffnen, Blöcke und zugehörige Pausen bearbeiten oder ergänzen, Faktoren ändern und Einträge nach Bestätigung löschen. Eine leere Endzeit bedeutet „läuft“. Abwesenheiten lassen sich für einen Tag oder Zeitraum speichern; bestehende Abwesenheiten werden dabei nicht überschrieben. Feiertage können je Tag ergänzt, entfernt oder wieder auf die Automatik zurückgesetzt werden.

Unter **Einstellungen** gelten Sollzeitregeln jeweils ab ihrem Stichtag bis zur nächsten Regel. Rückwirkende Änderungen sind möglich; Regeln mit demselben Stichtag werden abgewiesen. Anfangssaldo und separate Saldoanpassungen erzeugen keine fiktiven Arbeitsblöcke.

## Zeitberechnung und fachliche Entscheidungen

- Zeitstempel und Dauern werden als ganzzahlige Millisekunden gespeichert. Anzeigen zeigen volle Minuten in `HH:MM`; ein negativer Sekundenrest kann daher als `−00:00` erscheinen. CSV-Zeitstempel enthalten UTC inklusive Millisekunden. JSON enthält die vollständige Präzision.
- **Tatsächliche Arbeit** = Anwesenheit minus echte Pausen. **Netto nach Abzug** = tatsächliche Arbeit minus rechnerisch fehlende Mindestpause. **Angerechnet** = Summe dieser Nettozeiten multipliziert mit dem jeweiligen Blockfaktor. Die echte Arbeit bleibt unabhängig von der Bewertung sichtbar.
- Mehr als 6 Stunden tatsächliche Arbeit erfordern 30, mehr als 9 Stunden 45 Minuten Pause. Bereits erfasste Pausen reduzieren nur den fehlenden Zusatzabzug. Genau 6 Stunden lösen keinen Abzug aus, genau 9 Stunden noch keinen 45-Minuten-Abzug.
- **Grenzfallentscheidung:** Die Schwelle wird einmal anhand der tatsächlichen Arbeit **vor** dem rechnerischen Zusatzabzug bestimmt und danach nicht erneut geprüft. Beispielsweise werden aus 6:01 ohne Pause rechnerisch 5:31. Eine nachträgliche Schwellenprüfung würde zwischen „Abzug erforderlich“ und „nicht erforderlich“ oszillieren. Diese stabile Regel folgt der expliziten Vorgabe „Arbeitszeit ohne bereits erfasste Pausen“; ein rechnerischer Abzug ersetzt keine tatsächlich genommene Pause und ist keine arbeitsrechtliche Prüfung.
- Zusatzabzüge werden zuerst proportional auf Nettozeiten der Blöcke mit Faktor 1 verteilt. Reichen diese nicht, wird der Rest proportional auf die übrigen Blöcke verteilt. Größte Reste verteilen einzelne Millisekunden deterministisch, sodass nichts verloren geht. Erst danach wirkt der Faktor. Faktoren sind positiv, bis 1000 und mit bis zu sechs Nachkommastellen möglich. Die Bewertung wird einmal je Block auf Millisekunden gerundet (Ganzzahlarithmetik).
- Reguläre Arbeitstage sind Montag bis Freitag. Sollanteil pro Tag = gültiges Wochensoll / 5. Standard: 32:00 pro Woche, also 06:24 pro Werktag. Bei Regelwechseln innerhalb einer Woche wird jeder Tag separat berechnet.
- Urlaub, Krankheit und Feiertag entlasten diesen Sollanteil höchstens einmal. Wochenenden entlasten nichts. Freizeitausgleich entlastet nicht und baut dadurch Gleitzeit ab. Ein echter Feiertag bleibt auch bei gleichzeitigem Freizeitausgleich ein Feiertag. Arbeitszeit an freien Tagen wird zusätzlich mit ihrem individuellen Faktor angerechnet.
- Urlaubstage und Krankheitstage in Monatsberichten zählen reguläre Arbeitstage ohne gesetzliche Feiertage; der Kalender bewahrt auch über Wochenenden eingetragene Abwesenheiten.
- Der Anfangssaldo ist der Stand **zu Beginn** seines Stichtags. Ab diesem Datum werden Tagesdifferenzen und separate Anpassungen addiert; ältere Quelldaten bleiben erhalten. In der Heute-Ansicht zählt die gesamte laufende Woche bis Sonntag zum Soll. Dieser Kontostand ist ausdrücklich **vorläufig**. Er zeigt, wo das Konto ohne weitere Arbeit am Ende der Woche läge. Wochenübersichten zeigen unabhängig vom Kontostichtag die vollständige Woche.
- Monatsberichte verwenden ausschließlich Tagesanteile und zählen grenzüberschreitende Wochen nicht doppelt. Der Kontostand zum Monatsende berücksichtigt den Anfangsstichtag. Laufende und zukünftige Monate sind vorläufig und enthalten das gesamte Monatssoll.

## Feiertage

Offline-Osterberechnung und bundesweite sowie landesspezifische Regeln für alle 16 Bundesländer. Niedersachsen ist voreingestellt. Historische Änderungen umfassen Buß- und Bettag bis 1994, den bundesweiten Reformationstag 2017, norddeutsche Regeln ab 2018, den Frauentag in Berlin ab 2019 und Mecklenburg-Vorpommern ab 2023, den Weltkindertag in Thüringen und Berliner Sonderfeiertage 2020/2025.

Gemeindeabhängige Feiertage (Mariä Himmelfahrt in Bayern, Augsburger Friedensfest, Fronleichnam in Teilen Sachsens/Thüringens) sind separat auswählbar. Automatische Regeln sind auf die Bundesrepublik seit 1990 ausgerichtet; historische Sonderfälle vor 1990 und örtliche Änderungen müssen manuell überschrieben werden. Es handelt sich um einen berechneten Kalender ohne laufend aktualisierte externe Quelle. Künftig neu beschlossene Feiertage benötigen ein App-Update oder einen manuellen Eintrag. Die gewählte Region und örtlichen Optionen gelten global auch für historische Auswertungen; bei Umzügen historische Tage gezielt überschreiben.

## Speicherung und Backup

IndexedDB `timecount`, Schemaversion 1: getrennte Stores für Metadaten (Settings, InitialBalance, Revision), WorkSchedule, WorkSession, Break, Absence, HolidayOverride und BalanceAdjustment. Indizes auf Datum, Gültigkeitsbeginn und Blockzugehörigkeit. Alle Änderungen lesen, validieren und schreiben innerhalb einer gemeinsamen Transaktion. Die Revisionsprüfung verhindert verlorene Änderungen aus alten Formularen. `BroadcastChannel`, Fokus- und Sichtbarkeitsabgleich aktualisieren andere Tabs. Selbst ohne BroadcastChannel verhindert die Transaktion widersprüchliche aktive Erfassungen.

Unter Einstellungen **JSON-Backup herunterladen** sichert sämtliche Quelldaten einschließlich laufender Erfassung und Schema-/Exportversion. Backups enthalten persönliche Daten und sind unverschlüsselt; sicher aufbewahren. Beim Import werden Struktur, Version, IDs, Intervalle, Überlappungen, Faktoren und Verknüpfungen geprüft. Erst nach Vorschau und ausdrücklicher Bestätigung werden alle Daten in einer einzigen Transaktion ersetzt. Ein Fehler oder Abbruch lässt den bisherigen Stand unberührt. Kein automatisches Zusammenführen. Ein importierter laufender Block läuft ab seinem ursprünglichen Zeitstempel weiter, was nach längerer Zeit eine Kalenderkorrektur erfordert.

CSV unter **Auswertung** exportiert einen frei wählbaren Zeitraum: UTF-8 mit BOM und Semikolon für deutsche Tabellenkalkulationen. Pro Arbeitsblock eine Zeile, Tages-Soll/-Saldo/-Anpassung nur in der ersten Tageszeile. Tage ohne Arbeit enthalten eine eigene Zeile. Saldoanpassungen bleiben von Arbeitszeitsalden getrennt. Textfelder werden maskiert und Formelausführung durch übliche Tabellenpräfixe abgewehrt.

Browserdaten, privater Modus, Speicherbereinigung, geänderte Website-Adresse oder Deinstallation können lokale Daten entfernen oder unzugänglich machen. Regelmäßige externe JSON-Backups sind notwendig. „Dauerhafte Speicherung anfragen“ nutzt die Browserfunktion, garantiert aber keinen Schutz vor manuellem Löschen.

## PWA-Updates

Der Service Worker speichert ausschließlich die lokalen App-Dateien; IndexedDB wird niemals gelöscht. Ein Update wartet auf die Übernahme unter Einstellungen. Vor dem Versionswechsel sperren alle erreichbaren App-Tabs neue Schreibaktionen und lassen bereits laufende Transaktionen abschließen. Antwortet ein Tab nicht rechtzeitig, wird die Übernahme abgebrochen; andere Tabs schließen und erneut versuchen. Danach lädt die App neu. Laufende Erfassungen sind gespeichert und bleiben erhalten. Offene, ungespeicherte Formulare in anderen Tabs vorher abschließen.

**Bei jeder veröffentlichten Änderung an App-Dateien `CACHE` in `sw.js` erhöhen** und die Browser-Tests auf den neuen Cache-Namen anpassen. So bleibt ein komplettes altes Paket bis zur bewussten Übernahme aktiv und ein neues Paket wird separat vollständig geladen. Die Offlineprüfung in `app.js` muss denselben Namen verwenden. Keine externen Ressourcen hinzufügen. Der Entwicklungsserver setzt `no-cache`; nach Änderungen während der Entwicklung Service Worker über die Einstellungen aktualisieren.

## Tests

```sh
npm ci
npm run check
npm test
npm run test:browser
```

`npm test` verwendet nur Nodes eingebauten Testrunner. Playwright ist die einzige Entwicklungsabhängigkeit; die App lädt sie nicht. Der Browsertest nutzt `/usr/bin/chromium`, falls vorhanden, sonst Playwrights Chromium. Alternativ `CHROMIUM_PATH=/pfad/zu/chromium npm run test:browser`; gegebenenfalls einmal `npx playwright install chromium` ausführen. Die Browsertests starten ihren eigenen Server auf Port 4180, verwenden eine isolierte Browserdatenbank und prüfen echte IndexedDB-Transaktionen, UI-Abläufe, Import-Abbruch/-Ersetzung, mehrere Tabs, Downloads und Offline-Neustart. Screenshots entstehen in `.test-results/`. Der Testserver wird anschließend beendet.

## Projektstruktur

```text
index.html, styles.css       Oberfläche und Gestaltung
src/core.js                 Validierung, Zeit-/Saldo-/Exportlogik
src/holidays.js              Feiertagskalender
src/db.js                    IndexedDB und Transaktionen
src/app.js                   UI, Zustandsaktionen, Tab-Synchronisierung
manifest.webmanifest        PWA-Metadaten
sw.js, icons/               Offline-App-Paket und Installationsicons
server.mjs                  Statischer Entwicklungsserver ohne Backend
 tests/core.test.js          Reine Berechnungs-/Validierungstests
 tests/browser.mjs           Chromium-Integrationstests
 tests/pwa-update.mjs        Versionswechsel mit zwei App-Tabs
```

## Technische Grenzen

Arbeit über Mitternacht ist kein regulärer Anwendungsfall: Die laufende Zeit bleibt vollständig erhalten und wird zunächst dem ursprünglichen Tag zugeordnet. Die App warnt und verlangt für weitere Zustandsaktionen eine ausdrückliche Kalenderkorrektur. Sie schneidet nichts still ab. Überlappende und ungültige Intervalle werden abgewiesen.

Die Geräteuhr ist die Zeitquelle. Große Sprünge während einer geöffneten App und unplausible Zeitreihen werden erkannt, aber Änderungen während ausgeschaltetem Gerät lassen sich ohne externe Zeitquelle nicht sicher erkennen. Zeitstempel bleiben bei Zeitzonenwechsel erhalten; ihre Darstellung folgt der aktuellen Gerätezeitzone. Der erfasste Kalendertag bleibt unverändert, bis er im Editor bewusst geändert wird. Bei Sommerzeit-Rückstellung ist die doppelte lokale Stunde im Datum/Uhrzeit-Editor nicht eindeutig; entsprechende Zeitstempel können im JSON-Backup präzise geprüft und korrigiert importiert werden. Kein Versprechen einer gerichtsfesten oder automatisch arbeitsrechtlich geprüften Erfassung.

Es gibt keinen Produktionsbuild und keine Serverdatenbank. Veröffentlichung auf einem HTTPS-Host sowie Installation und Verhalten auf einem physischen Android-Gerät sind separate Schritte; die Cloudtests belegen Chromium-Funktion und Offlineverhalten, keine bereits erfolgte Veröffentlichung.
