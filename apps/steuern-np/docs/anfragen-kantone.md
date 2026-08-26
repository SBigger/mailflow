# Anfragen an die Steuerverwaltungen — Entwürfe

Zwei versandfertige Anfragen zur Klärung der offenen Punkte aus
[`recherche-und-architektur.md`](./recherche-und-architektur.md).

**Vor dem Versand anpassen:** Absenderangaben, UID, Kontaktperson, allfällige bestehende
TH-ID. Die Platzhalter sind mit `«…»` markiert.

**Warum zwei getrennte Anfragen:** Die ZH-Anfrage klärt, *wie* wir anbinden. Die TG-Anfrage
klärt, *ob* TG überhaupt in den Projektumfang gehört. Beide haben mehrwöchige Vorlaufzeit
und sollten gleichzeitig rausgehen.

---

## A) Kantonales Steueramt Zürich — Treuhänder-Register / elektronische Einreichung

**Empfänger:** Kantonales Steueramt Zürich, Treuhänder-Register
(Kontaktweg über die Treuhänder-Seite des KStA; ZHprivateTax-Hotline 0800 22 88 11 nur als
Rückfallebene — die Fragen unten sind für eine Telefon-Hotline zu technisch.)

**Betreff:** Technische Anbindung an das Treuhänder-Register — Anfrage eines
Softwareanbieters zur elektronischen Einreichung der Steuererklärung natürlicher Personen

---

Sehr geehrte Damen und Herren

Die «Artis Treuhand GmbH» entwickelt eine interne Softwarelösung, mit der wir die
Steuererklärungen natürlicher Personen unserer Mandantinnen und Mandanten aufbereiten und
elektronisch einreichen möchten. Wir sind «bereits / noch nicht» im Treuhänder-Register des
Kantons Zürich eingetragen «(TH-ID: …)».

Auf Ihrer Website ist erwähnt, dass für Drittsoftware-Anbieter eine direkte Schnittstelle
besteht, über die Funktionen des Treuhänder-Registers in die eigene Software integriert und
Deklarationen direkt hochgeladen werden können. Zu dieser Schnittstelle haben wir folgende
Fragen:

**1. Zugang zur Spezifikation**
Wie erhalten wir die technische Spezifikation der Schnittstelle, und ist dafür eine
Vereinbarung oder Registrierung als Softwareanbieter erforderlich?

**2. Protokoll und Datenformat**
Welches Übertragungsprotokoll wird verwendet (REST, SOAP/Webservice, SFTP oder anderes)?
Wird das Deklarationspaket nach **eCH-0119 «E-Tax Filing»** erwartet? Falls ja: welche
Version des Standards ist für die Steuerperiode «2026» massgebend, und welche kantonalen
Erweiterungen (`cantonExtension`) sind zwingend zu befüllen?

**3. Authentifizierung**
In den uns vorliegenden Unterlagen ist von starker Authentisierung mittels SuisseID oder
mTAN die Rede. Da SuisseID eingestellt wurde: Welches Authentifizierungsverfahren gilt
heute? Konkret ist für uns entscheidend, ob ein **serverseitiger, nicht interaktiver Upload**
möglich ist (z. B. über technische Zugangsdaten oder Zertifikat), oder ob jede Übermittlung
eine interaktive Anmeldung einer natürlichen Person voraussetzt.

**4. Zulassung**
Gibt es ein formales Zulassungs-, Zertifizierungs- oder Testierungsverfahren für
Softwareanbieter, bevor produktiv eingereicht werden darf? Falls ja: Ablauf, Dauer und
allfällige Kosten.

**5. Testumgebung**
Steht eine Test- bzw. Abnahmeumgebung mit Testdaten zur Verfügung?

**6. Beilagen**
Welche Dateiformate sind für die elektronisch mitzuliefernden Belege zugelassen, und welche
maximale Grösse gilt pro Beilage und pro Gesamtpaket?

**7. Quittung**
In welcher Form wird der Eingang bestätigt (synchrone Antwort, Quittungsdokument,
Abholung)? Welche Rechtswirkung hat diese Bestätigung, und wie lange müssen wir sie
aufbewahren?

**8. Fehlerfälle und Korrekturen**
Wie wird eine fehlerhafte Übermittlung zurückgemeldet (Validierungsfehler gegen das
Schema)? Innert welcher Frist und auf welchem Weg kann eine bereits eingereichte
Steuererklärung korrigiert oder ersetzt werden?

**9. Vollmachten**
Wie wird die Vertretungsbefugnis bei elektronischer Einreichung technisch nachgewiesen —
genügt der Registereintrag mit TH-ID in Verbindung mit der hinterlegten Vollmacht, oder ist
je Steuerperiode ein zusätzlicher Nachweis zu übermitteln?

Für Ihre Auskünfte danken wir Ihnen bestens. Gerne stehen wir für ein Gespräch zur
Verfügung, falls sich einzelne Punkte so einfacher klären lassen.

Freundliche Grüsse
«Name, Funktion»
«Artis Treuhand GmbH, Adresse, UID, Telefon, E-Mail»

---

## B) Steuerverwaltung Thurgau — elektronische Einreichung durch Vertreter

**Empfänger:** Steuerverwaltung des Kantons Thurgau
(E-Mail gemäss Website der Steuerverwaltung; für eFisc-Belange ist dort `fisc.sv@tg.ch`
angegeben — die Fragen unten gehen aber über eFisc hinaus und betreffen den
Vertreter-Kanal.)

**Betreff:** Elektronische Einreichung der Steuererklärung natürlicher Personen durch
Vertreter — Frage zur Unterschriftspflicht und zum Einreichungsweg für Fremdsoftware

---

Sehr geehrte Damen und Herren

Die «Artis Treuhand GmbH» erstellt Steuererklärungen natürlicher Personen und prüft derzeit
den Aufbau einer eigenen Softwarelösung zur Aufbereitung und elektronischen Einreichung. Für
die Beurteilung, ob und in welcher Form dies im Kanton Thurgau möglich ist, bitten wir Sie
um Auskunft zu folgenden Punkten:

**1. Unterschriftspflicht**
Nach den uns vorliegenden Unterlagen gilt eine elektronisch übermittelte Steuererklärung
erst dann als eingereicht, wenn die unterzeichnete Freigabequittung beim Gemeindesteueramt
eingetroffen ist. Entspricht das dem aktuellen Stand für die Steuerperiode «2026»?

**2. Vertreter-Kanal**
Gilt diese Unterschriftspflicht auch für **eingetragene Vertreter**, die über eine
Steuersoftware einreichen — oder ist auf diesem Weg eine vollständig papierlose Einreichung
möglich? Diese Frage ist für uns entscheidend, weil eine Freigabequittung auf Papier den
digitalen Prozess unterbricht.

**3. Einreichungsweg für Fremdsoftware**
Neben der kantonalen Software eFisc reichen offenbar auch Anbieter wie Dr. Tax im Kanton
Thurgau elektronisch ein. Über welchen Kanal erfolgt das, und welche Voraussetzungen
(Registereintrag, Vereinbarung, Zulassung) gelten für einen Softwareanbieter?

**4. Datenformat**
Wird ein Deklarationspaket nach **eCH-0119 «E-Tax Filing»** entgegengenommen? Falls ja:
welche Version ist massgebend, und welche kantonalen Erweiterungen sind zu befüllen?

**5. Authentifizierung**
Ist eine serverseitige, nicht interaktive Übermittlung möglich, oder setzt jede
Einreichung die interaktive Anmeldung einer natürlichen Person voraus?

**6. Belege**
In welcher Form sind die Belege beizulegen, welche Formate sind zugelassen und welche
Grössenbeschränkungen gelten?

**7. Korrekturfrist**
Uns ist bekannt, dass Korrekturen innert 24 Stunden durch erneute Einreichung möglich sind.
Gilt diese Frist unverändert, und wie ist vorzugehen, wenn ein Fehler später entdeckt wird?

**8. Online-Lösung**
Ist mittelfristig eine browserbasierte Lösung analog zu anderen Kantonen geplant, die eFisc
ablöst? Diese Information hilft uns bei der Planung, damit wir nicht auf eine auslaufende
Schnittstelle hin entwickeln.

Für Ihre Rückmeldung danken wir Ihnen bestens.

Freundliche Grüsse
«Name, Funktion»
«Artis Treuhand GmbH, Adresse, UID, Telefon, E-Mail»

---

## Nach Eingang der Antworten

Die Antworten beantworten die Backlog-Punkte V3, V4, V6, V7, V8 und V9 und entscheiden
zwei Dinge:

1. **Ob der Upload automatisierbar ist** (Frage A3 / B5). Fällt die Antwort auf
   «nur interaktiv» aus, endet die Automatisierung beim fertigen Paket und ein Mensch
   drückt ab. Das Modul bleibt wertvoll, die Erwartungshaltung muss aber angepasst werden.
2. **Ob TG in den Scope gehört** (Frage B1/B2). Bestätigt sich die Unterschriftspflicht auch
   für Vertreter, gehört TG in den Ausblick statt in die Planung.

Antworten bitte im Repo festhalten (Datum, Kanal, Ansprechperson) und den
Verifikations-Backlog in `recherche-und-architektur.md` §11 nachführen.
