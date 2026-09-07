import {
  AnimatePresence,
  motion,
  useMotionValue,
  useSpring,
  useReducedMotion,
} from "motion/react";
import { FormEvent, RefObject, useEffect, useRef, useState } from "react";

const RANGE_PER_POINT = 18;
const MAX_PULL = 0.5;

interface MagneticButtonProps {
  label: string;
  isAccessOpen: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onOpen: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export default function MagneticButton({
  label,
  isAccessOpen,
  inputRef,
  onOpen,
  onSubmit,
}: MagneticButtonProps) {
  const reducedMotion = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState(false);
  const [origin, setOrigin] = useState({ x: 0, y: 0, diameter: 0 });
  const hoverRef = useRef(false);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const springX = useSpring(x, { stiffness: 260, damping: 18, mass: 0.4 });
  const springY = useSpring(y, { stiffness: 260, damping: 18, mass: 0.4 });

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (isAccessOpen || reducedMotion) {
      x.set(0);
      y.set(0);
      setHover(false);
      return;
    }
    const control = node;

    const magnet = 10;
    const pull = (magnet / 20) * MAX_PULL;
    const reach = magnet * RANGE_PER_POINT;

    function onMove(event: PointerEvent) {
      if (event.pointerType !== "mouse") return;
      const rect = control.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2 - springX.get();
      const centerY = rect.top + rect.height / 2 - springY.get();
      const deltaX = event.clientX - centerX;
      const deltaY = event.clientY - centerY;
      const inside =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;

      const edgeX = Math.max(0, Math.abs(deltaX) - rect.width / 2);
      const edgeY = Math.max(0, Math.abs(deltaY) - rect.height / 2);
      const gap = Math.hypot(edgeX, edgeY);

      if (inside !== hoverRef.current) {
        const localX = Math.max(
          0,
          Math.min(rect.width, event.clientX - rect.left),
        );
        const localY = Math.max(
          0,
          Math.min(rect.height, event.clientY - rect.top),
        );
        setOrigin({
          x: localX,
          y: localY,
          diameter: 2 * Math.hypot(rect.width, rect.height),
        });
        hoverRef.current = inside;
        setHover(inside);
      }

      if (gap > reach) {
        x.set(0);
        y.set(0);
        return;
      }

      const falloff = 1 - gap / reach;
      x.set(deltaX * pull * falloff);
      y.set(deltaY * pull * falloff);
    }

    function reset() {
      x.set(0);
      y.set(0);
      hoverRef.current = false;
      setHover(false);
    }

    window.addEventListener("pointermove", onMove);
    document.addEventListener("pointerleave", reset);
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", reset);
    };
  }, [springX, springY, x, y, isAccessOpen, reducedMotion]);

  return (
    <motion.div
      ref={ref}
      className="magnetic-control"
      style={{ x: springX, y: springY }}
    >
      <AnimatePresence initial={false} mode="wait">
        {!isAccessOpen ? (
          <motion.button
            key="button"
            type="button"
            className="magnetic-trigger"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            onClick={onOpen}
          >
            <motion.span
              className="magnetic-sweep"
              aria-hidden="true"
              initial={false}
              animate={{ scale: hover ? 1 : 0 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              style={{
                left: origin.x,
                top: origin.y,
                width: origin.diameter,
                height: origin.diameter,
                marginLeft: -origin.diameter / 2,
                marginTop: -origin.diameter / 2,
              }}
            />
            <motion.span
              className="magnetic-label"
              initial={false}
              animate={{ color: hover ? "#ffffff" : "#171717" }}
              transition={{ duration: 0.2 }}
            >
              {label}
            </motion.span>
          </motion.button>
        ) : (
          <motion.form
            key="input"
            className="access-form"
            aria-label="Zugangscode eingeben"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            onSubmit={onSubmit}
          >
            <label className="sr-only" htmlFor="access-code">
              Zugangscode
            </label>
            <input
              ref={inputRef}
              autoFocus
              required
              maxLength={64}
              id="access-code"
              name="access-code"
              type="password"
              inputMode="text"
              autoComplete="one-time-code"
              placeholder="••••••"
              aria-describedby="access-note"
            />
            <button type="submit" aria-label="Code senden">
              <span aria-hidden="true">→</span>
            </button>
          </motion.form>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
