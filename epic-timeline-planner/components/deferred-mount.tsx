"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Crossfade-mount wrapper used by surfaces whose first paint is heavy (large
 * trees with many `useMemo` / chart re-layouts). Shows `placeholder`
 * immediately while React schedules the real children off-screen, then
 * fades them in once the work has settled.
 *
 * Phases:
 *  1. `placeholder`  — only the skeleton is in the DOM (no `children`).
 *  2. `settling`     — children mount underneath (opacity 0) so React commits
 *                      the heavy tree off-screen while the skeleton stays painted.
 *  3. `ready`        — skeleton fades out, children fade in.
 *  4. `done`         — skeleton unmounts after the fade completes.
 *
 * Stacked `requestAnimationFrame`s in step 2 → 3 give charts a paint to
 * measure via `ResponsiveContainer` before the fade. Without that buffer
 * the fade also reveals settle-jank we're trying to hide.
 */
const DEFERRED_MOUNT_FADE_MS = 160;

export function DeferredMount({
  placeholder,
  children,
  debugLabel,
}: {
  placeholder: ReactNode;
  children: ReactNode;
  /** Optional tag used by `[deferred-mount]` console logs so multiple
   *  surfaces using this wrapper can be told apart in the overlay. */
  debugLabel?: string;
}) {
  type Phase = "placeholder" | "settling" | "ready" | "done";
  const [phase, setPhase] = useState<Phase>("placeholder");
  const mountTsRef = useRef<number>(typeof performance !== "undefined" ? performance.now() : 0);
  const lastPhaseTsRef = useRef<number>(mountTsRef.current);

  useEffect(() => {
    if (typeof performance === "undefined") return;
    const now = performance.now();
    const sinceMount = Math.round(now - mountTsRef.current);
    const sinceLast = Math.round(now - lastPhaseTsRef.current);
    lastPhaseTsRef.current = now;
    console.log("[deferred-mount] phase", { label: debugLabel ?? "(unlabeled)", phase, sinceMountMs: sinceMount, sinceLastMs: sinceLast });
  }, [phase, debugLabel]);

  useEffect(() => {
    if (phase !== "placeholder") return;
    const id = requestAnimationFrame(() => setPhase("settling"));
    return () => cancelAnimationFrame(id);
  }, [phase]);

  useEffect(() => {
    if (phase !== "settling") return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setPhase("ready"));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [phase]);

  useEffect(() => {
    if (phase !== "ready") return;
    const t = window.setTimeout(() => setPhase("done"), DEFERRED_MOUNT_FADE_MS + 20);
    return () => window.clearTimeout(t);
  }, [phase]);

  if (phase === "placeholder") return <>{placeholder}</>;

  // CRITICAL: every post-placeholder phase MUST return the same root JSX
  // shape so React never tears `children` out of the tree once mounted.
  // The previous version returned `<>{children}</>` for the `done` phase
  // and `<div>...<div>{children}</div>...</div>` for `settling`/`ready`,
  // which caused React to unmount and remount the entire children tree
  // when the wrapper went away — for the backlog panel that was a second
  // 3+ second mount of all 500 stories' worth of useMemos. Keep one shape
  // and only toggle the placeholder overlay's visibility.
  const fadeIn = phase === "ready" || phase === "done";
  const placeholderMounted = phase !== "done";
  // Slide-up: content lifts from 10px below into place as it fades in.
  // Pairs with the opacity transition for a single, cohesive entrance.
  const SLIDE_PX = 10;
  return (
    <div className="relative">
      <div
        className="transition-[opacity,transform] ease-out motion-reduce:transition-none motion-reduce:transform-none"
        style={{
          opacity: fadeIn ? 1 : 0,
          transform: fadeIn ? "translateY(0px)" : `translateY(${SLIDE_PX}px)`,
          transitionDuration: `${DEFERRED_MOUNT_FADE_MS}ms`,
        }}
      >
        {children}
      </div>
      {placeholderMounted ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 transition-opacity ease-out"
          style={{
            opacity: fadeIn ? 0 : 1,
            transitionDuration: `${DEFERRED_MOUNT_FADE_MS}ms`,
          }}
        >
          {placeholder}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Quick neutral skeleton used by the Backlog tab while its 7k-line panel
 * mounts. Visually matches the panel's toolbar + grid stripes enough to
 * stop the tab feeling frozen on click.
 */
export function BacklogPanelSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3 sm:p-5">
      <div className="flex items-center gap-2">
        <div className="h-8 w-48 animate-pulse rounded-md bg-slate-200/80" />
        <div className="h-8 w-40 animate-pulse rounded-md bg-slate-200/60" />
        <div className="ml-auto h-8 w-24 animate-pulse rounded-md bg-slate-200/60" />
        <div className="h-8 w-8 animate-pulse rounded-md bg-slate-200/60" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-7 w-24 animate-pulse rounded-full bg-slate-200/60" />
        ))}
      </div>
      <div className="flex-1 overflow-hidden rounded-xl border border-slate-200/80 bg-white">
        <div className="grid grid-cols-[1fr,140px,120px,120px,80px] gap-3 border-b border-slate-200/80 px-4 py-2.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-3.5 animate-pulse rounded bg-slate-200/70" />
          ))}
        </div>
        {Array.from({ length: 12 }).map((_, row) => (
          <div
            key={row}
            className="grid grid-cols-[1fr,140px,120px,120px,80px] gap-3 border-b border-slate-100 px-4 py-3"
          >
            {Array.from({ length: 5 }).map((_, col) => (
              <div
                key={col}
                className="h-3 animate-pulse rounded bg-slate-100"
                style={{ animationDelay: `${(row * 5 + col) * 25}ms` }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
