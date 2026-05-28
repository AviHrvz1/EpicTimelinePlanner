"use client";

import type { ReactNode } from "react";
import { Users } from "lucide-react";

import { useTeamImage } from "@/lib/use-team-images";
import { cn } from "@/lib/utils";

/**
 * Paints a team's logo when one exists, otherwise a fallback glyph — the
 * team-side mirror of `UserAvatar`. Image lookup is automatic: pass the team
 * `slug` and the shared `useTeamImage` store resolves the uploaded logo.
 *
 * Pass `fallback` to keep a call site's existing icon exactly as-is when the
 * team has no logo (so converting a site is purely additive). Omit it to get
 * the default Lucide `Users` glyph at `sizePx`.
 */
export function TeamAvatar({
  slug,
  sizePx = 16,
  className,
  rounded = "rounded-[5px]",
  fallback,
  title,
}: {
  slug: string | null | undefined;
  /** Square pixel size of the rendered logo. */
  sizePx?: number;
  className?: string;
  /** Corner rounding for the image (logos are rounded-squares, not circles). */
  rounded?: string;
  /** What to render when the team has no logo. Defaults to the `Users` icon. */
  fallback?: ReactNode;
  title?: string;
}) {
  const image = useTeamImage(slug);
  if (image) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img
        src={image}
        alt=""
        title={title}
        draggable={false}
        style={{ width: sizePx, height: sizePx }}
        className={cn("inline-block shrink-0 object-cover ring-1 ring-black/5", rounded, className)}
      />
    );
  }
  if (fallback !== undefined) return <>{fallback}</>;
  return (
    <Users
      style={{ width: sizePx, height: sizePx }}
      className={cn("shrink-0 text-slate-500", className)}
      aria-hidden
    />
  );
}
