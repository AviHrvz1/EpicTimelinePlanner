"use client";

/**
 * App-wide cache of team slug → logo URL, so any surface that shows a team
 * can paint the team's uploaded image (falling back to a default icon) the
 * same way `UserAvatar` paints a person's photo.
 *
 * Design: a module-level singleton store fed by one `/api/teams` fetch
 * (deduped across all consumers), exposed through `useSyncExternalStore`.
 * Components don't need a provider in the tree — the first `useTeamImages()`
 * mount triggers the load, and every consumer re-renders when it resolves.
 * Call `refreshTeamImages()` after a team create/edit/delete to repaint.
 */
import { useSyncExternalStore } from "react";

type TeamLite = { slug: string; image: string | null };

const EMPTY: ReadonlyMap<string, string> = new Map();

let imageBySlug: ReadonlyMap<string, string> = EMPTY;
let status: "idle" | "loading" | "loaded" = "idle";
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

async function load(): Promise<void> {
  if (status === "loading") return;
  status = "loading";
  try {
    const res = await fetch("/api/teams");
    if (res.ok) {
      const data = (await res.json()) as TeamLite[];
      const next = new Map<string, string>();
      for (const t of data) {
        if (t.slug && t.image) next.set(t.slug, t.image);
      }
      imageBySlug = next;
    }
  } catch {
    // Team logos are decorative — on failure we keep the last map (or empty)
    // and every consumer just shows its default icon.
  } finally {
    status = "loaded";
    emit();
  }
}

/** Force a re-fetch (after a team was created / edited / deleted). */
export function refreshTeamImages(): void {
  status = "idle";
  void load();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  if (status === "idle") void load();
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): ReadonlyMap<string, string> {
  return imageBySlug;
}

function getServerSnapshot(): ReadonlyMap<string, string> {
  return EMPTY;
}

/** Reactive map of team slug → logo URL. Empty until the first load resolves. */
export function useTeamImages(): ReadonlyMap<string, string> {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Convenience: resolve a single team's logo URL (or null). */
export function useTeamImage(slug: string | null | undefined): string | null {
  const map = useTeamImages();
  if (!slug) return null;
  return map.get(slug) ?? null;
}
