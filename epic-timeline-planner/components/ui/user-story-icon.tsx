"use client";

import { StickyNote } from "lucide-react";
import { cn } from "@/lib/utils";

type UserStoryIconProps = {
  className?: string;
};

/**
 * User-story glyph — a Lucide StickyNote, tinted sky-500 by default so it
 * matches the initiative (Zap, sky-500) and roadmap icons. Tintable via
 * `text-*` classes from the caller.
 */
export function UserStoryIcon({ className }: UserStoryIconProps) {
  return (
    <StickyNote
      className={cn("size-4 shrink-0 text-sky-500", className)}
      strokeWidth={1.9}
      aria-hidden
    />
  );
}
