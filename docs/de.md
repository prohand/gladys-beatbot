# Beatbot

Diese Integration verbindet Gladys mit Ihren **Beatbot-Poolrobotern**
(Baureihen AquaSense, Sora…) und deren **Reinigungsstation**, über die
Beatbot-Cloud.

## Bevor Sie beginnen

- Ihre Roboter müssen bereits in der **Beatbot-App** funktionieren (Konto
  erstellt, Roboter gekoppelt, WLAN eingerichtet).
- Beatbot-Roboter werden **ausschließlich über die Beatbot-Cloud** gesteuert:
  Gladys benötigt einen Internetzugang. Eine lokale Steuerung gibt es nicht.
- Ein tauchender Roboter verliert oft das WLAN: Er wird dann für einige
  Minuten als **Nicht erreichbar** angezeigt, das ist normal.

## Das Konto verknüpfen

1. Öffnen Sie den Tab **Konfiguration** der Integration.
2. Klicken Sie neben **Beatbot-Konto** auf **Verbinden**.
3. Die Anmeldeseite von Beatbot öffnet sich: Melden Sie sich an und erlauben
   Sie den Zugriff. Ihr Passwort wird auf der Seite von Beatbot eingegeben, es
   läuft nie über Gladys.
4. Zurück in Gladys wird der Verbindungsstatus grün und Ihre Roboter erscheinen
   im Tab **Entdecken**, bereit zum Hinzufügen.

Die Schaltfläche **Verbindung testen** listet die gefundenen Roboter, ihren
Status und ihren Akkustand auf.

### Die anderen Einstellungen

| Einstellung                     | Wozu sie dient                                                                                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Region**                      | Wo Ihr Konto gehostet wird (Europa, Nordamerika, China). **Automatisch** liest sie aus dem Konto: Ändern Sie sie nur, wenn Sie dazu aufgefordert werden.     |
| **Vollständige Aktualisierung** | Die Zustände kommen in Echtzeit an. Dieses vollständige Auslesen (standardmäßig alle 10 min) holt nach, was Ihnen durch einen Netzwerkausfall entgangen ist. |
| **OAuth-Client-ID**             | Erweitert. Behalten Sie den Standardwert, außer Beatbot hat Ihnen eine andere Client-ID gegeben.                                                             |

### Wenn die Beatbot-Seite die Anmeldung verweigert

Die Integration nutzt den „Open API“-Zugang, den Beatbot für die
Hausautomation veröffentlicht, mit der öffentlichen Client-ID von Beatbot.
Zeigt die Beatbot-Seite einen Fehler an (zum Beispiel zur Rücksprungadresse,
`redirect_uri`), akzeptiert Beatbot Ihre Gladys-Rücksprungadresse für diese
Client-ID noch nicht: Bitten Sie den Beatbot-Support um eine Client-ID für
Gladys, tragen Sie sie in **OAuth-Client-ID** ein, speichern Sie und klicken
Sie dann erneut auf **Verbinden**.

## Was Sie erhalten

Für jeden Roboter (und jede Station), je nachdem, was der Roboter anbietet:

| Funktion             | Detail                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------- |
| **Status**           | Gestoppt, Reinigung, pausiert, Fehler, kehrt zurück, lädt, an der Basis.                     |
| **Reinigung**        | Reinigung starten / pausieren.                                                               |
| **Zurück zur Basis** | Ruft den Roboter zurück (zu seiner Basis oder zur Wasserlinie, um ihn herauszunehmen).       |
| **Akku** / **Laden** | Akkustand in % und laufender Ladevorgang (nur Roboter, nicht die Station).                   |
| **Reinigungsmodus**  | Die Modi des Roboters (Boden, Wände, Wasserlinie…), so benannt wie bei Beatbot.              |
| **Kindersicherung**  | Sperrt die Tasten des Roboters.                                                              |
| **Nicht stören**     | Schaltet die Sprachansagen des Roboters aus (nur lesbar, wenn der Roboter es nicht zulässt). |

Jeder Roboter trägt ein Abzeichen **Cloud**, wenn er erreichbar ist, sonst
**Nicht erreichbar**.

## Szenen

Die Integration fügt dem Szeneneditor eigene Karten hinzu (Gladys 5.1 oder
neuer), unter **Integrationen**.

Auslöser:

- **Status des Poolroboters geändert** — optional nach Roboter und neuem
  Status filtern. Die folgenden Aktionen lesen `{{triggerEvent.data.status}}`,
  `{{triggerEvent.data.previous_status}}` und `{{triggerEvent.data.detail}}`
  (detaillierter Status: taucht ab, taucht auf…).
- **Poolreinigung beendet** — ein Zyklus wurde normal beendet. Variablen:
  `{{triggerEvent.data.duration_minutes}}` (leer, wenn der Zyklus vor der
  Integration begonnen hat) und `{{triggerEvent.data.battery}}`.
- **Störung des Poolroboters** — eine Störung ist gerade aufgetreten (Roboter
  steckt fest, Korb voll, Motorfehler…). Filtern Sie nach den Störungen, die
  Sie interessieren. Variablen: `{{triggerEvent.data.error}}`,
  `{{triggerEvent.data.label_de}}`.

Aktionen (jede gibt `sent` zurück: false, wenn der Roboter diesen Befehl nicht
anbietet):

- **Poolreinigung starten**
- **Poolreinigung pausieren**
- **Poolroboter zurückrufen**
- **Reinigungsmodus festlegen** — geben Sie den Namen des Modus so ein, wie er
  am Gerät in Gladys angezeigt wird.

Beispiele: „nach der Reinigung eine Nachricht mit ihrer Dauer erhalten“ oder
„alarmiert werden, wenn der Roboter feststeckt“.

## Dashboard

Fügen Sie das Widget **Poolroboter** hinzu und wählen Sie den Roboter: Es zeigt
den Akkustand live, den Status, die aktuelle Störung, die Verbindung, den Modus
und die Dauer der letzten Reinigung, mit den Schaltflächen **Starten**,
**Pause** und **Zurück**.

Wenn der Roboter das Ändern seines Reinigungsmodus erlaubt, öffnet eine
Schaltfläche **Reinigungsmodus** ein kleines Formular mit den Modi dieses
Roboters, mit dem aktuellen vorausgefüllt: Wählen Sie einen aus und senden Sie
ihn (Gladys 5.2 oder neuer, von der Integration vorausgesetzt).

## Fehlerbehebung

- **„Klicken Sie auf Verbinden…“**: Kein Konto verknüpft, oder die
  Autorisierung ist abgelaufen oder wurde widerrufen: Klicken Sie erneut auf
  **Verbinden**.
- **„Ihr Beatbot-Konto hat seine Region nicht angegeben“**: Wählen Sie sie in
  **Region** und speichern Sie.
- **„Beatbot-Cloud nicht erreichbar“**: Prüfen Sie den Internetzugang von
  Gladys; die Integration versucht es von selbst erneut.
- **Die Zustände ändern sich nicht mehr in Echtzeit**: Eine andere Software
  (zum Beispiel Home Assistant) nutzt möglicherweise dasselbe Beatbot-Konto und
  hat die Echtzeitverbindung übernommen. Die Zustände werden weiterhin bei jeder
  vollständigen Aktualisierung aktualisiert.
- Die Protokolle der Integration sind in Gladys verfügbar. Sie enthalten
  niemals Ihre Tokens.
