import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import {
  convertLocal,
  isLocalFile,
  localTargets,
  type LocalTarget,
} from "../lib/conversion";
import { convertOffice, extension, OFFICE_FORMATS } from "../lib/office";
import "./converter.css";

type Output = { name: string; blob: Blob; url: string };
type Entry = {
  id: string;
  file: File;
  target: string;
  state: "ready" | "working" | "done" | "error";
  error?: string;
  outputs: Output[];
};
const size = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.ceil(bytes / 1024)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
function Icon({
  kind = "arrow",
}: {
  kind?: "arrow" | "upload" | "file" | "check" | "download";
}) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {kind === "upload" ? (
        <>
          <path d="M12 16V3m-5 5 5-5 5 5" />
          <path d="M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5" />
        </>
      ) : kind === "file" ? (
        <>
          <path d="M14 3H5v18h14V8z" />
          <path d="M14 3v5h5M8 13h8M8 17h5" />
        </>
      ) : kind === "check" ? (
        <path d="m5 12 4 4L19 6" />
      ) : kind === "download" ? (
        <>
          <path d="M12 3v13m-5-5 5 5 5-5M4 18v3h16v-3" />
        </>
      ) : (
        <path d="M4 12h16m-6-6 6 6-6 6" />
      )}
    </svg>
  );
}

export default function Converter({
  section,
}: {
  section: "images" | "documents";
}) {
  const documents = section === "documents";
  const [entries, setEntries] = useState<Entry[]>([]);
  const [quality, setQuality] = useState(90);
  const [drag, setDrag] = useState(false);
  const [notice, setNotice] = useState("");
  const [service, setService] = useState<"checking" | "ready" | "offline">(
    "checking",
  );
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const urls = useRef(new Set<string>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      urls.current.forEach(URL.revokeObjectURL);
      urls.current.clear();
    };
  }, []);
  useEffect(() => {
    document.title = documents
      ? "Dokumentkonverter · nilsrump"
      : "Bildkonverter · nilsrump";
    return () => {
      document.title = "nilsrump";
    };
  }, [documents]);
  useEffect(() => {
    const controller = new AbortController();
    setService("checking");
    fetch("/api/office/status", {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!controller.signal.aborted)
          setService(data?.available ? "ready" : "offline");
      })
      .catch(() => {
        if (!controller.signal.aborted) setService("offline");
      });
    return () => controller.abort();
  }, [section]);
  const visible = entries.filter(
    (entry) =>
      Boolean(OFFICE_FORMATS[extension(entry.file.name)]) === documents,
  );
  const pending = visible.filter((e) => e.state === "ready");
  const done = visible.filter((e) => e.state === "done");
  function addFiles(files: File[]) {
    if (busy) return;
    const errors: string[] = [];
    const added: Entry[] = [];
    for (const file of files) {
      const office = OFFICE_FORMATS[extension(file.name)];
      const targets = documents
        ? office
        : isLocalFile(file)
          ? localTargets(file)
          : undefined;
      if (!targets?.length) {
        errors.push(`${file.name}: Dateiformat wird hier nicht unterstützt.`);
        continue;
      }
      if (!file.size || file.size > (documents ? 25 : 30) * 1024 * 1024) {
        errors.push(
          `${file.name}: Bitte eine Datei zwischen 1 Byte und ${documents ? 25 : 30} MB wählen.`,
        );
        continue;
      }
      if (entries.length + added.length >= 20) {
        errors.push("Maximal 20 Dateien pro Sitzung.");
        break;
      }
      if (documents && visible.length + added.length >= 1) {
        errors.push(
          "Dokumente bitte einzeln konvertieren. Entferne zuerst die vorhandene Datei.",
        );
        break;
      }
      added.push({
        id: crypto.randomUUID(),
        file,
        target: documents
          ? "pdf"
          : extension(file.name) === "pdf"
            ? "png"
            : "jpg",
        state: "ready",
        outputs: [],
      });
    }
    setEntries((prev) => [...prev, ...added]);
    setNotice(errors.join(" "));
  }
  function remove(id: string) {
    const entry = entries.find((e) => e.id === id);
    entry?.outputs.forEach((o) => {
      URL.revokeObjectURL(o.url);
      urls.current.delete(o.url);
    });
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }
  function patch(id: string, changes: Partial<Entry>) {
    setEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, ...changes } : e)),
    );
  }
  async function convert() {
    if (busy || !pending.length || (documents && service !== "ready")) return;
    setBusy(true);
    setNotice("");
    for (const entry of pending) {
      if (!mounted.current) break;
      patch(entry.id, { state: "working" });
      try {
        const results = documents
          ? await convertOffice(entry.file, entry.target)
          : await convertLocal(
              entry.file,
              entry.target as LocalTarget,
              quality / 100,
            );
        if (!mounted.current) break;
        const outputs = results.map((result) => {
          const url = URL.createObjectURL(result.blob);
          urls.current.add(url);
          return { ...result, url };
        });
        patch(entry.id, { state: "done", outputs });
      } catch (error) {
        if (mounted.current)
          patch(entry.id, {
            state: "error",
            error:
              error instanceof Error
                ? error.message
                : "Konvertierung fehlgeschlagen.",
          });
      }
    }
    if (mounted.current) setBusy(false);
  }
  async function downloadAll() {
    try {
      const { zipSync } = await import("fflate");
      const files: Record<string, Uint8Array> = {};
      for (const entry of done)
        for (const output of entry.outputs) {
          let name = output.name;
          let n = 2;
          while (files[name]) {
            name = output.name.replace(/(\.[^.]+)$/, `-${n++}$1`);
          }
          files[name] = new Uint8Array(await output.blob.arrayBuffer());
        }
      const url = URL.createObjectURL(
        new Blob([zipSync(files, { level: 0 }) as BlobPart], {
          type: "application/zip",
        }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "konvertierte-dateien.zip";
      anchor.click();
      urls.current.add(url);
      setTimeout(() => {
        URL.revokeObjectURL(url);
        urls.current.delete(url);
      }, 30_000);
    } catch {
      setNotice(
        "Der ZIP-Download konnte nicht erstellt werden. Bitte lade die Ergebnisse einzeln herunter.",
      );
    }
  }
  return (
    <div className="converter-shell">
      <header className="converter-nav">
        <a href="#" className="wordmark">
          nilsrump<span> / tools</span>
        </a>
        <a className="back-link" href="#">
          Zur Startseite <span aria-hidden="true">↗</span>
        </a>
      </header>
      <main className="converter-main">
        <motion.div
          className="converter-intro"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <span className="eyebrow">
            <span className="status-dot" /> WENIGER UMWEGE. MEHR MÖGLICHKEITEN.
          </span>
          <h1>
            Deine Datei.
            <br />
            <span>Ein neues Format.</span>
          </h1>
          <p>
            Bilder und Dokumente unkompliziert umwandeln.
            <br className="desktop-break" /> Auswählen, konvertieren, fertig.
          </p>
        </motion.div>
        <motion.section
          className="converter-card"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.5 }}
          aria-label="Dateikonverter"
        >
          <div className="card-top">
            <nav className="converter-tabs" aria-label="Dateibereich">
              {(["images", "documents"] as const).map((tab) => (
                <a
                  key={tab}
                  href={
                    tab === "images"
                      ? "#/convert/bilder"
                      : "#/convert/dokumente"
                  }
                  className={section === tab ? "active" : ""}
                  aria-current={section === tab ? "page" : undefined}
                >
                  {section === tab && (
                    <motion.span
                      className="tab-highlight"
                      layoutId="tab"
                      transition={{
                        type: "spring",
                        stiffness: 400,
                        damping: 32,
                      }}
                    />
                  )}
                  <span>{tab === "images" ? "Bilder & PDF" : "Dokumente"}</span>
                </a>
              ))}
            </nav>
            <span className="processing-badge">
              {documents ? "Word · Excel · Slides" : "Lokal im Browser"}
            </span>
          </div>
          <div className="card-body">
            <input
              ref={input}
              type="file"
              className="sr-only"
              tabIndex={-1}
              aria-label="Dateien auswählen"
              multiple={!documents}
              accept={
                documents
                  ? ".doc,.docx,.odt,.xls,.xlsx,.ods,.ppt,.pptx,.odp"
                  : ".jpg,.jpeg,.png,.webp,.pdf"
              }
              onChange={(e) => {
                addFiles(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
            <button
              type="button"
              className={`drop-zone ${drag ? "dragging" : ""}`}
              disabled={busy}
              onClick={() => input.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                addFiles(Array.from(e.dataTransfer.files));
              }}
            >
              <span className="upload-orbit">
                <Icon kind="upload" />
              </span>
              <strong>
                {drag
                  ? "Hier loslassen"
                  : documents
                    ? "Dein Dokument beginnt hier."
                    : "Deine Dateien beginnen hier."}
              </strong>
              <span>
                Hier hineinziehen oder <b>Dateien auswählen</b>
              </span>
              <small>
                {documents
                  ? "DOCX, XLSX, ODT, ODS, PPTX und ältere Office-Formate · bis 25 MB"
                  : "JPG, PNG, WebP oder PDF · bis 30 MB pro Datei"}
              </small>
            </button>
            {documents && (
              <p
                className={`service-note ${service === "offline" ? "unavailable" : ""}`}
                role="status"
              >
                {service === "checking"
                  ? "Dokumentdienst wird geprüft …"
                  : service === "ready"
                    ? "Dokumente werden an den Konvertierungsdienst übertragen und nach der Verarbeitung gelöscht. Layouts können abweichen."
                    : "Der Dokumentdienst ist aktuell nicht verfügbar. Die Bild- und PDF-Konvertierung funktioniert weiterhin lokal."}
              </p>
            )}
            <div role="alert">
              {notice && <p className="conversion-error">{notice}</p>}
            </div>
            <div className="file-list" aria-live="polite">
              <AnimatePresence initial={false}>
                {visible.map((entry) => (
                  <motion.div
                    className="file-row"
                    key={entry.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                  >
                    <span
                      className={`file-icon ${entry.state === "done" ? "complete" : ""}`}
                    >
                      <Icon kind={entry.state === "done" ? "check" : "file"} />
                    </span>
                    <div className="file-info">
                      <strong title={entry.file.name}>{entry.file.name}</strong>
                      <small>
                        {size(entry.file.size)} ·{" "}
                        {entry.state === "working"
                          ? "Wird konvertiert …"
                          : entry.state === "done"
                            ? `${entry.outputs.length} ${entry.outputs.length === 1 ? "Datei bereit" : "Dateien bereit"}`
                            : entry.state === "error"
                              ? "Fehlgeschlagen"
                              : "Bereit"}
                      </small>
                      {entry.error && (
                        <p className="conversion-error">{entry.error}</p>
                      )}
                      {entry.state === "done" && (
                        <div className="result-links">
                          {entry.outputs.map((output) => (
                            <a
                              key={output.url}
                              href={output.url}
                              download={output.name}
                            >
                              {output.name} <span aria-hidden="true">↓</span>
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                    <span className="format-arrow" aria-hidden="true">
                      →
                    </span>
                    <select
                      aria-label={`Zielformat für ${entry.file.name}`}
                      value={entry.target}
                      disabled={busy || entry.state !== "ready"}
                      onChange={(e) =>
                        patch(entry.id, { target: e.target.value })
                      }
                    >
                      {(documents
                        ? OFFICE_FORMATS[extension(entry.file.name)]
                        : localTargets(entry.file)
                      ).map((format) => (
                        <option key={format} value={format}>
                          {format.toUpperCase()}
                        </option>
                      ))}
                    </select>
                    <button
                      className="remove-file"
                      aria-label={`${entry.file.name} entfernen`}
                      disabled={busy}
                      onClick={() => remove(entry.id)}
                    >
                      ×
                    </button>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
            {!documents &&
              visible.some(
                (e) =>
                  e.target === "jpg" ||
                  e.target === "jpeg" ||
                  e.target === "webp",
              ) && (
                <div className="quality-control">
                  <label htmlFor="quality">
                    Bildqualität <strong>{quality}%</strong>
                  </label>
                  <input
                    id="quality"
                    type="range"
                    min="10"
                    max="100"
                    step="5"
                    value={quality}
                    disabled={busy}
                    onChange={(e) => setQuality(Number(e.target.value))}
                  />
                  <small>
                    JPG erhält einen weißen Hintergrund. JPEG → JPG bleibt ohne
                    Qualitätsverlust.
                  </small>
                </div>
              )}
            <div className="converter-actions">
              <span className="queue-note">
                {visible.length
                  ? `${visible.length} ${visible.length === 1 ? "Datei ausgewählt" : "Dateien ausgewählt"}`
                  : documents
                    ? "Ein Dokument. Dein Wunschformat."
                    : "Mehrere Dateien. Ein einfacher Ablauf."}
              </span>
              <motion.button
                className="convert-button"
                whileHover={{ scale: 1.025 }}
                whileTap={{ scale: 0.975 }}
                onClick={convert}
                disabled={
                  !pending.length || busy || (documents && service !== "ready")
                }
              >
                {busy ? (
                  <>
                    <span className="spinner" /> Konvertiert …
                  </>
                ) : (
                  <>
                    Konvertieren <Icon />
                  </>
                )}
              </motion.button>
            </div>
            {done.length > 0 && (
              <button
                className="zip-button"
                onClick={downloadAll}
                disabled={busy}
              >
                <Icon kind="download" /> Alle Ergebnisse als ZIP herunterladen
              </button>
            )}
          </div>
        </motion.section>
        <div className="converter-benefits">
          <div>
            <span>01</span>
            <strong>Passendes Format.</strong>
            <p>
              {documents
                ? "Word, Excel und Präsentationen – mit sinnvollen Zielformaten."
                : "Bilder umwandeln, als PDF speichern oder PDF-Seiten als Bilder exportieren."}
            </p>
          </div>
          <div>
            <span>02</span>
            <strong>Einfach gehalten.</strong>
            <p>Nur die Optionen, die du brauchst. Ohne Umwege zum Download.</p>
          </div>
          <div>
            <span>03</span>
            <strong>
              {documents ? "Kurz gespeichert." : "Bleibt bei dir."}
            </strong>
            <p>
              {documents
                ? "Temporäre Dateien werden nach jedem Verarbeitungsvorgang gelöscht."
                : "Deine Bilder und PDFs verlassen für die Konvertierung deinen Browser nicht."}
            </p>
          </div>
        </div>
      </main>
      <footer className="converter-footer">
        <span>nilsrump tools</span>
        <span>Kleine Tools. Mehr Freiraum.</span>
      </footer>
    </div>
  );
}
