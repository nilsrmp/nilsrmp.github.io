# nilsrump.me

Minimal personal landing page built with React, Appica UI and Motion.

```bash
npm install
npm run dev
```

## Konverter lokal starten

`npm run dev` startet die Seite auf http://127.0.0.1:5173. Für Office-Dateien zusätzlich in einem zweiten Terminal `npm run office` starten; benötigt eine lokale LibreOffice-Installation (Details in [server/README.md](server/README.md)).

Codes: `CONVERT` oder `BILDER` öffnen Bilder/PDF, `OFFICE` öffnet Dokumente. Die Zuordnung steht in `src/lib/access.ts`. Codes sind Navigationskürzel für öffentliche Tools, kein Zugriffsschutz. Hash-Routen funktionieren auch auf GitHub Pages.

Bilder (JPG/JPEG, PNG, WebP) und PDFs werden lokal im Browser verarbeitet; bis 30 MB, 40 Megapixel bzw. 40 PDF-Seiten. Dokumente werden nur bei verfügbarem Office-Dienst übertragen. Auf GitHub Pages bleiben Office-Konvertierungen ohne separat freigegebenen Backend-Betrieb deaktiviert. Audio, Video, CSV und PDF-zu-Office sind nicht Teil dieser Version.

Prüfung: `npm run build`, `npm run test:office`, `npm run test:browser` (einmalig `npx playwright install chromium`). Die Browsertests starten benötigte lokale Dienste bei Bedarf selbst.
