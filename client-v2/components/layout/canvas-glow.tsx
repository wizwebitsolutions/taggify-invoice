"use client";

import { useEffect, useRef } from "react";

/** How far the light moves toward the cursor each frame: low enough to drift, high enough to follow. */
const EASE = 0.08;
const HOME = { x: 50, y: 40 };

/**
 * The page's last layer (13 Oct): the .canvas-glow gradient fixed behind
 * everything, with its light spot gliding after the cursor. Mounted once in
 * the root layout. Holds still for reduced motion and touch screens.
 */
export function CanvasGlow() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !window.matchMedia("(pointer: fine)").matches) return;

    const target = { ...HOME };
    const at = { ...HOME };
    let frame = 0;

    const step = () => {
      at.x += (target.x - at.x) * EASE;
      at.y += (target.y - at.y) * EASE;
      el.style.setProperty("--glow-x", `${at.x.toFixed(2)}%`);
      el.style.setProperty("--glow-y", `${at.y.toFixed(2)}%`);
      // Stop once it has caught up; the next pointer move starts it again.
      frame = Math.abs(target.x - at.x) + Math.abs(target.y - at.y) > 0.05 ? requestAnimationFrame(step) : 0;
    };
    const onMove = (e: PointerEvent) => {
      target.x = (e.clientX / window.innerWidth) * 100;
      target.y = (e.clientY / window.innerHeight) * 100;
      if (!frame) frame = requestAnimationFrame(step);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(frame);
    };
  }, []);

  return <div ref={ref} aria-hidden data-testid="canvas-glow" className="canvas-glow pointer-events-none fixed inset-0 -z-10" />;
}
