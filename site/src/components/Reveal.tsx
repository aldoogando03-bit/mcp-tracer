import { m, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { EASE_OUT } from "../motion";

/**
 * Fades content in once as it scrolls into view. Uses a transform string (hardware accelerated) and drops
 * the movement when the user prefers reduced motion, keeping only the fade.
 */
export function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <m.div
      className={className}
      initial={{ opacity: 0, transform: reduce ? "translateY(0px)" : "translateY(16px)" }}
      whileInView={{ opacity: 1, transform: "translateY(0px)" }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: reduce ? 0.2 : 0.6, ease: EASE_OUT, delay: reduce ? 0 : delay }}
    >
      {children}
    </m.div>
  );
}
