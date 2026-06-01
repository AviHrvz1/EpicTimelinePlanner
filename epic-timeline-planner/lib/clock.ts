/**
 * Single source of "what time is it" for the planner. Every sprint-end /
 * month-end / quarter-end / year-end check should read through `now()` or
 * `nowMs()` instead of `new Date()` / `Date.now()` directly, so the demo
 * builder's time-travel buttons can simulate any calendar instant without
 * waiting for real time.
 *
 * Client-side: reads `sessionStorage.__clockOverride` (ISO string). When set,
 * every consumer sees that fake "now" instead of the real clock — enough to
 * exercise rollover, year-end continuations, and other time-driven UX paths
 * end-to-end. Reset by clearing the key (the demo panel has a button).
 *
 * Server-side: always real time. Server routes that need a stable clock for
 * tests should accept an explicit instant parameter; the override is a
 * dev-only client convenience.
 */
const CLOCK_OVERRIDE_KEY = "__clockOverride";

function overrideMs(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(CLOCK_OVERRIDE_KEY);
    if (!raw) return null;
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
  }
}

export function now(): Date {
  const ms = overrideMs();
  return ms == null ? new Date() : new Date(ms);
}

export function nowMs(): number {
  return overrideMs() ?? Date.now();
}

export function clockOverrideKey(): string {
  return CLOCK_OVERRIDE_KEY;
}
