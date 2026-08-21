import { BackgroundPattern } from "@appica/ui-react/background-pattern";
import { AnimatePresence, motion } from "motion/react";
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
          if (event.target === event.currentTarget) setIsAccessOpen(false);
        }}
      >
        <div className="access-stage">
          <AnimatePresence initial={false} mode="popLayout">
            {!isAccessOpen ? (
              <MagneticButton
                key="button"
                label="nilsrump"
                onClick={() => setIsAccessOpen(true)}
              />
            ) : (
              <motion.form
                key="input"
                layoutId="access-control"
                className="access-form"
                aria-label="Zugangscode eingeben"
                onSubmit={handleSubmit}
                transition={{ type: "spring", stiffness: 330, damping: 28 }}
              >
                <label className="sr-only" htmlFor="access-code">
                  Zugangscode
                </label>
                <input
                  ref={inputRef}
                  id="access-code"
                  name="access-code"
                  type="password"
                  inputMode="text"
                  autoComplete="one-time-code"
                  placeholder="••••••"
                  aria-describedby="access-note"
                />
                <button type="submit" aria-label="Code senden" disabled>
                  <span aria-hidden="true">→</span>
                </button>
              </motion.form>
            )}
          </AnimatePresence>

          <p id="access-note" className="access-note">
            Access opens soon.
          </p>
        </div>
      </BackgroundPattern>
    </main>
  );
}
