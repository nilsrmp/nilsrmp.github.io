import { BackgroundPattern } from "@appica/ui-react/background-pattern";
import { FormEvent, useEffect, useRef, useState } from "react";
import MagneticButton from "./components/MagneticButton";

export default function App() {
  const [isAccessOpen, setIsAccessOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isAccessOpen) return;

    inputRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsAccessOpen(false);
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isAccessOpen]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
  }

  return (
    <main className="landing-shell">
      <BackgroundPattern
        spotlight={150}
        className="landing-pattern"
        onPointerDown={(event) => {
          const target = event.target as Element;
          if (!target.closest(".magnetic-control")) setIsAccessOpen(false);
        }}
      >
        <div className="access-stage">
          <MagneticButton
            label="nilsrump"
            isAccessOpen={isAccessOpen}
            inputRef={inputRef}
            onOpen={() => setIsAccessOpen(true)}
            onSubmit={handleSubmit}
          />

          <p id="access-note" className="access-note">
            Access opens soon.
          </p>
        </div>
      </BackgroundPattern>
    </main>
  );
}
