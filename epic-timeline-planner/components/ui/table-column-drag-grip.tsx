"use client";

import { cn } from "@/lib/utils";

/**
 * 2×3 bead grip for reordering table columns on the cyan header bar (`#0897d5` family).
 * Shared by Backlog and Users Directory.
 */
export function TableColumnDragGrip() {
  return (
    <span className="grid grid-cols-2 gap-[1.5px] place-content-center" aria-hidden>
      {Array.from({ length: 6 }).map((_, i) => (
        <span
          key={i}
          className={cn(
            "size-[3.5px] rounded-full border border-white/22",
            "bg-gradient-to-br from-[#4dc4eb] from-10% via-[#1cabe3] to-[#0a86b8]",
            "shadow-[inset_0_1px_1.5px_rgba(255,255,255,0.35),inset_0_-1px_1px_rgba(0,55,78,0.28),0_0.5px_1.5px_rgba(0,40,60,0.28)]",
          )}
        />
      ))}
    </span>
  );
}
