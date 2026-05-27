/**
 * Short confetti burst played when a user story transitions from `done`
 * to `approved`. Kept intentionally brief (~600ms) so it celebrates the
 * approval without becoming intrusive — the call sites fire it once per
 * transition and forget.
 */

import confetti from "canvas-confetti";

export function fireApprovalConfetti(): void {
  if (typeof window === "undefined") return;
  // Two small staggered bursts angled inward from the bottom corners.
  // Together they take ~600ms; canvas-confetti cleans up its own DOM.
  const baseDefaults = {
    spread: 55,
    startVelocity: 38,
    ticks: 90,
    gravity: 1.05,
    scalar: 0.85,
    colors: ["#7c3aed", "#a78bfa", "#22c55e", "#f59e0b", "#0ea5e9"],
    disableForReducedMotion: true,
  };

  confetti({
    ...baseDefaults,
    particleCount: 28,
    angle: 60,
    origin: { x: 0.15, y: 0.85 },
  });
  confetti({
    ...baseDefaults,
    particleCount: 28,
    angle: 120,
    origin: { x: 0.85, y: 0.85 },
  });
}
