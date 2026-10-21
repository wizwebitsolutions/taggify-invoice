"use client";

import { useEffect, useRef, useState } from "react";
import { animate, useInView, useReducedMotion, type Transition, type Variants } from "motion/react";

/**
 * Shared motion presets (plan: "Animation rules"). Durations mirror the tokens:
 * hover 120ms, micro 160ms, page 180ms, drawer 220ms, ease-out (.22,1,.36,1).
 * Reduced motion is honoured globally by <MotionConfig reducedMotion="user">
 * in app/providers.tsx, plus useCountUp below.
 */
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;

export const DURATION = { hover: 0.12, micro: 0.16, page: 0.18, drawer: 0.22 } as const;

export const easeOut = (duration: number = DURATION.page): Transition => ({ duration, ease: EASE_OUT });

/** Sheets and drawers: a firm spring with no bounce. */
export const sheetSpring: Transition = { type: "spring", stiffness: 420, damping: 40, mass: 0.9 };

/** Page enter: fade + 8px rise. */
export const pageEnter: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: easeOut(DURATION.page) },
};

/** Parent for staggered children (cards, rows, KPIs), 40ms apart. */
export const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04, delayChildren: 0.02 } },
};

/** Child of `stagger`. */
export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 6 },
  show: { opacity: 1, y: 0, transition: easeOut(DURATION.page) },
};

/** Buttons and tappable cards: a small press. */
export const pressable = { whileTap: { scale: 0.98 }, transition: easeOut(DURATION.hover) } as const;

/** Pipeline nodes fill left to right; `custom` = the node index. */
export const pipelineFill: Variants = {
  hidden: { scale: 0.6, opacity: 0 },
  show: (i: number = 0) => ({ scale: 1, opacity: 1, transition: { ...easeOut(DURATION.micro), delay: i * 0.08 } }),
};

/**
 * Ticks a number up from 0 to `value` once, when the element first scrolls into
 * view. Returns the ref to attach and the current value; with reduced motion it
 * returns `value` straight away.
 */
export function useCountUp<T extends Element = HTMLSpanElement>(value: number, duration = 0.6) {
  const ref = useRef<T>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const [current, setCurrent] = useState(reduce ? value : 0);

  useEffect(() => {
    if (reduce) {
      setCurrent(value);
      return;
    }
    if (!inView) return;
    const controls = animate(0, value, { duration, ease: EASE_OUT, onUpdate: (v) => setCurrent(Math.round(v)) });
    return () => controls.stop();
  }, [inView, value, duration, reduce]);

  return { ref, value: current };
}
