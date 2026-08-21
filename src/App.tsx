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
      <BackgroundPattern spotlight={150} className="landing-pattern">
        <MagneticButton label="nilsrump" onClick={() => setIsAccessOpen(true)} />
      </BackgroundPattern>

      <AnimatePresence>
        {isAccessOpen && (
          <motion.div
            className="access-layer"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setIsAccessOpen(false);
            }}
          >
            <motion.section
              className="access-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="access-title"
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: 6 }}
              transition={{ type: "spring", stiffness: 360, damping: 30 }}
            >
              <button
                className="dialog-close"
                type="button"
                aria-label="Dialog schließen"
                onClick={() => setIsAccessOpen(false)}
              >
                ×
              </button>

              <p className="access-kicker">private access</p>
              <h1 id="access-title">Enter code</h1>

              <form onSubmit={handleSubmit}>
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
                <button type="submit" disabled aria-disabled="true">
                  Enter
                </button>
              </form>

              <p id="access-note" className="access-note">
                Access opens soon.
              </p>
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
