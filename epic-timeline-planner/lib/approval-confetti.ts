/**
 * Short confetti burst played when a user story transitions from `done`
 * to `approved`. Same visual pattern as the now-removed login confetti:
 * two side-cannons firing inward from the bottom corners over ~500ms,
 * shooting small clusters each animation frame. Brief enough to feel
 * like a quick celebration without getting in the way of work.
 */

import confetti from "canvas-confetti";

export function fireApprovalConfetti(): void {
  if (typeof window === "undefined") return;
  // Temporarily disabled — remove this early return to re-enable.
  return;

  const duration = 500;
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
      disableForReducedMotion: true,
    });
    confetti({
      particleCount: 4,
      angle: 120,
      spread: 55,
      startVelocity: 45,
      origin: { x: 1, y: 0.7 },
      colors,
      disableForReducedMotion: true,
    });
    if (Date.now() < end) requestAnimationFrame(frame);
  })();
}
