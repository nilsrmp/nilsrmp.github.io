import { BackgroundPattern } from "@appica/ui-react/background-pattern";
import { FormEvent, lazy, Suspense, useEffect, useRef, useState } from "react";
import MagneticButton from "./components/MagneticButton";
import { ACCESS_CODES } from "./lib/access";

const Converter = lazy(() => import("./components/Converter"));

export default function App() {
  const [route, setRoute] = useState(window.location.hash);
  const [isAccessOpen, setIsAccessOpen] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const change = () => {
      setRoute(window.location.hash);
      setError("");
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);

  useEffect(() => {
    if (!isAccessOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsAccessOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isAccessOpen]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(
      new FormData(event.currentTarget).get("access-code") ?? "",
    )
      .trim()
      .toUpperCase();
    const destination = ACCESS_CODES[code];
    if (typeof destination === "string") {
      window.location.hash = destination;
      setIsAccessOpen(false);
    } else {
      setError("Dieser Code ist nicht bekannt.");
      inputRef.current?.select();
    }
  }

  if (route.startsWith("#/convert"))
    return (
      <Suspense
        fallback={
          <main className="loading-screen">Konverter wird geladen …</main>
        }
      >
        <Converter
          section={route === "#/convert/dokumente" ? "documents" : "images"}
        />
      </Suspense>
    );

  return (
    <main className="landing-shell">
      <BackgroundPattern
        spotlight={150}
        className="landing-pattern"
        onPointerDown={(event) => {
          if (!(event.target as Element).closest(".magnetic-control"))
            setIsAccessOpen(false);
        }}
      >
        <div className="access-stage">
          <MagneticButton
            label="nilsrump"
            isAccessOpen={isAccessOpen}
            inputRef={inputRef}
            onOpen={() => {
              setError("");
              setIsAccessOpen(true);
            }}
            onSubmit={handleSubmit}
          />
          <p
            id="access-note"
            className={`access-note ${error ? "access-error" : ""}`}
            role="status"
          >
            {error ||
              (isAccessOpen
                ? "Dein Code. Dein Bereich."
                : "Ein Code öffnet neue Möglichkeiten.")}
          </p>
        </div>
      </BackgroundPattern>
    </main>
  );
}
