"use client";

import { BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";

type UserStoryIconProps = {
  className?: string;
};

/**
 * User-story glyph — a Lucide `BookOpen`, tinted sky-500 by default so it
 * matches the initiative (Zap, sky-500) and roadmap icons. Tintable via
 * `text-*` classes from the caller.
 *
 * Previously rendered as `StickyNote`. The `BookOpen` swap was driven by
 * the Stories KPI block on the hero — the planner liked the open-book
 * glyph there and asked to mirror it everywhere user stories are
 * iconified. Centralising the glyph here means every consumer that uses
 * `<UserStoryIcon />` updates for free; a handful of legacy direct uses
 * of `<StickyNote />` in story contexts were migrated to use this
 * component at the same time so the next swap stays 1-line.
 */
export function UserStoryIcon({ className }: UserStoryIconProps) {
  return (
    <BookOpen
      className={cn("size-4 shrink-0 text-sky-500", className)}
      strokeWidth={1.9}
      aria-hidden
    />
  );
}
