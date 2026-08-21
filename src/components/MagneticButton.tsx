import { motion, useMotionValue, useSpring } from "motion/react";
import { useEffect, useRef, useState } from "react";

const RANGE_PER_POINT = 18;
const MAX_PULL = 0.5;

interface MagneticButtonProps {
  label: string;
  onClick: () => void;
}

export default function MagneticButton({ label, onClick }: MagneticButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
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
    const button = node;

    const magnet = 10;
    const pull = (magnet / 20) * MAX_PULL;
    const reach = magnet * RANGE_PER_POINT;

    function onMove(event: PointerEvent) {
      const rect = button.getBoundingClientRect();
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
        const localX = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
        const localY = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
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
  }, [springX, springY, x, y]);

  return (
    <motion.button
      ref={ref}
      layoutId="access-control"
      type="button"
      className="magnetic-button"
      style={{ x: springX, y: springY }}
      onClick={onClick}
      whileTap={{ scale: 0.97 }}
      transition={{ type: "spring", stiffness: 330, damping: 28 }}
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
  );
}
