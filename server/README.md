# Lokaler Office-Dienst

Voraussetzungen: Node.js 22 oder neuer und eine lokal installierte LibreOffice-Version mit `soffice` im PATH. Bei Bedarf `SOFFICE_PATH=/voller/pfad/zu/soffice` setzen. Der Dienst nutzt nur Node-Standardmodule; die Tests nutzen außerdem das bereits im Projekt vorhandene `fflate`.

```sh
node server/office.mjs
node --test server/office.test.mjs
```

Der Start bindet ausschließlich `127.0.0.1:8787`. Die Vite-Entwicklungsoberfläche auf Port 5173 muss `/api/office` mit `changeOrigin: true` an diesen Dienst weiterleiten. Auf einer statisch veröffentlichten Website ist der Dienst nicht verfügbar.

- `GET /api/office/status` liefert `{ "available": true }`, wenn `soffice --version` beim Start erfolgreich war.
- `POST /api/office/convert?ext=docx&target=pdf` nimmt die Dateibytes mit `Content-Type: application/octet-stream` entgegen und liefert die konvertierte Datei binär. Der Client vergibt den Downloadnamen.
- DOC/DOCX/ODT → PDF/DOCX/ODT; XLS/XLSX/ODS → PDF/XLSX/ODS; PPT/PPTX/ODP → PDF. Eine Konvertierung ins Eingabeformat wird abgewiesen. CSV wird nicht angeboten.
- Fehler liefern JSON `{ "error": "…" }` mit passendem HTTP-Status. Verschlüsselte, beschädigte oder nicht unterstützte Dokumente können nicht konvertiert werden.

Ein- und Ausgabe sind auf jeweils 25 MiB begrenzt. Es laufen höchstens zwei Anfragen gleichzeitig. LibreOffice erhält 45 Sekunden pro Konvertierung, einen eigenen temporären Benutzerpfad und ein eigenes Ausgabeverzeichnis. Temporäre Dateien werden nach Erfolg und Fehler entfernt. Dateinamen und Dateiinhalte werden nicht protokolliert. Host-Prüfung und eine Origin-Allowlist für `http://localhost:5173` und `http://127.0.0.1:5173` begrenzen Browserzugriffe. Aufrufe ohne Origin sind für lokale CLI-Nutzung erlaubt. CORS-Zugriff wird nicht freigegeben; die Oberfläche verwendet den Vite-Proxy.

Dies ist ein lokaler Entwicklungsdienst für vertrauenswürdige Dateien. Ein separater LibreOffice-Benutzerpfad und deaktivierte nicht vertrauenswürdige Makros ersetzen keine Betriebssystem-Sandbox. Dokumentparser, externe Dokumentverknüpfungen, Laufzeitressourcen und Zugriffe anderer lokaler Prozesse sind damit nicht vollständig isoliert. Die ZIP-Vorprüfung begrenzt die deklarierte Entpackgröße, garantiert aber keine CPU-/Speichergrenze. Produktiver oder öffentlicher Betrieb benötigt eine gehärtete Sandbox mit Netzwerk- und Dateisystemisolierung, Ressourcenlimits, Authentifizierung und zusätzlicher Prüfung. Diesen Dienst nicht öffentlich weiterleiten.

Die Integrationstests führen echte ODT/DOCX/PDF- und ODS/XLSX/PDF-Konvertierungen aus und prüfen den Erhalt bekannter Text- und Zellinhalte in DOCX/XLSX. Zusätzlich werden vertrauenswürdige kleine Fixtures mit LibreOffice in DOC/XLS und PPT/PPTX umgewandelt und anschließend über die API zu PDF konvertiert; ODP wird direkt zu PDF geprüft. Fehlt LibreOffice, schlägt die entsprechende Prüfung ausdrücklich mit `BLOCKED` fehl; es werden keine Erfolge simuliert. Diese kleinen Fixtures prüfen die unterstützten Formate, jedoch nicht die Layouttreue beliebiger komplexer Dokumente.
