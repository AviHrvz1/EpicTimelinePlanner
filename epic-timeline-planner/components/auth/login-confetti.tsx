"use client";

import { useEffect } from "react";
import confetti from "canvas-confetti";

const FLAG_KEY = "epicPlanner.justLoggedIn";

/**
 * Fires a short celebratory confetti burst once on mount when the
 * `epicPlanner.justLoggedIn` sessionStorage flag is present (set by the
 * login form right before navigating). The flag is cleared immediately
 * so refreshes or subsequent navigations don't re-trigger the effect.
 */
export function LoginConfetti() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (sessionStorage.getItem(FLAG_KEY) !== "1") return;
    sessionStorage.removeItem(FLAG_KEY);

    // Two side-cannons firing inward — small, ~1.2s total. Keeps the
    // celebration brief so it doesn't get in the way of work.
    const duration = 1200;
    const end = Date.now() + duration;
    const colors = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444"];

    (function frame() {
      confetti({
        particleCount: 4,
        angle: 60,
        spread: 55,
        startVelocity: 45,
        origin: { x: 0, y: 0.7 },
        colors,
      });
      confetti({
        particleCount: 4,
        angle: 120,
        spread: 55,
        startVelocity: 45,
        origin: { x: 1, y: 0.7 },
        colors,
      });
      if (Date.now() < end) requestAnimationFrame(frame);
    })();
  }, []);

  return null;
}
