"use client";

import { User as UserIcon, UserRound } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Render an assignee's avatar with three fallbacks:
 *
 *  1. Their uploaded `image` (if available on the WorkspaceUser).
 *  2. Initials of their name, in a stable hue derived from the name string.
 *  3. A generic Lucide `User` icon when no name is given.
 *
 * Used everywhere we previously showed a "first-initial circle" — sprint
 * kanban cards, capacity boards, assignee combos, dialogs. Image lookup is
 * the caller's job (resolve via the workspace directory and pass `image`);
 * this component only paints the result.
 */
export type UserAvatarProps = {
  /** Display name. Empty → renders the generic icon. */
  name?: string | null;
  /** URL of the user's uploaded photo. Null/empty → falls back to initials. */
  image?: string | null;
  /** Pixel size of the circle (square). Default 24. */
  size?: number;
  /** Override the inner text size — defaults to ~40% of `size`. */
  fontSizePx?: number;
  /** Optional class for the wrapper (e.g. extra ring/shadow). */
  className?: string;
  /** Optional tooltip. Defaults to `name`. */
  title?: string;
};

export function UserAvatar({
  name,
  image,
  size = 24,
  fontSizePx,
  className,
  title,
}: UserAvatarProps) {
  const trimmed = (name ?? "").trim();
  const fallbackTitle = title ?? trimmed ?? undefined;
  const baseStyle = { width: size, height: size } as const;
  const wrapperClass = cn(
    "inline-flex shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600 ring-1 ring-white/60",
    className,
  );

  if (image) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img
        src={image}
        alt=""
        title={fallbackTitle}
        draggable={false}
        style={baseStyle}
        className={cn(
          "shrink-0 rounded-full object-cover ring-1 ring-white/60",
          className,
        )}
      />
    );
  }
  if (!trimmed) {
    // Unassigned fallback: generic person icon in a neutral pill so it reads
    // as "no one" rather than a colored avatar without a label.
    const iconPx = Math.max(8, Math.round(size * 0.6));
    return (
      <span
        title={fallbackTitle ?? "Unassigned"}
        style={baseStyle}
        className={cn(wrapperClass, "bg-slate-100 text-slate-500")}
      >
        <UserIcon style={{ width: iconPx, height: iconPx }} strokeWidth={2} aria-hidden />
      </span>
    );
  }
  const initials = avatarInitials(trimmed);
  return (
    <span
      title={fallbackTitle}
      style={{ ...baseStyle, background: avatarColor(trimmed), color: "#ffffff", fontSize: fontSizePx ?? Math.max(9, Math.round(size * 0.42)) }}
      className={cn(wrapperClass, "font-bold")}
    >
      {initials}
    </span>
  );
}

function avatarInitials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  const p = parts[0] ?? "";
  return (p.length >= 2 ? p.slice(0, 2) : p[0] + (p[0] ?? "")).toUpperCase();
}

/**
 * Stable hue in the sky → indigo → violet band (200°–280°) so avatars feel
 * like part of the project's palette. Hash off the name so the same person
 * always gets the same color across surfaces.
 */
function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  const hue = 200 + (Math.abs(hash) % 80);
  return `hsl(${hue} 62% 52%)`;
}

/**
 * Leading decoration for the AssigneeCombobox input — shows the matching
 * user's photo when the typed value matches a directory entry, otherwise
 * the generic `UserRound` icon. Used as an absolute-positioned overlay
 * over a left-padded input so the avatar replaces the static "no one
 * selected" icon as soon as the field is filled.
 */
export function AssigneeFieldDecoration({
  value,
  directoryUsers,
  className,
}: {
  value: string;
  directoryUsers?: readonly { name: string; image?: string | null }[] | null;
  className?: string;
}) {
  const resolved = resolveAssigneeAvatar(value, directoryUsers);
  if (resolved.image) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img
        src={resolved.image}
        alt=""
        draggable={false}
        className={cn(
          "pointer-events-none absolute left-2 top-1/2 z-10 size-5 -translate-y-1/2 rounded-full object-cover ring-1 ring-white/60",
          className,
        )}
      />
    );
  }
  return (
    <UserRound
      className={cn(
        "pointer-events-none absolute left-2 top-1/2 z-10 size-3.5 -translate-y-1/2 text-slate-400",
        className,
      )}
      aria-hidden
    />
  );
}

/**
 * Looks up `image` (and resolves the canonical display name) for a given
 * assignee string against the workspace directory.
 *
 * 1. Case-insensitive full-name match (exact).
 * 2. Fallback: when the input is a single token (no spaces), match against
 *    each directory entry's first name. Lets stories that store just the
 *    first name (e.g. legacy data, or where a teammate is uniquely
 *    identifiable by first name like "Aaron") still pick up the photo for
 *    "Aaron Mendel". First match wins on ambiguous first names.
 *
 * Returns the original `rawName` (untouched) when no match — chip labels
 * stay as authored.
 */
export function resolveAssigneeAvatar(
  rawName: string | null | undefined,
  directory: readonly { name: string; image?: string | null }[] | null | undefined,
): { name: string; image: string | null } {
  const trimmed = (rawName ?? "").trim();
  if (!trimmed || !directory || directory.length === 0) {
    return { name: trimmed, image: null };
  }
  const lower = trimmed.toLowerCase();
  for (const u of directory) {
    if ((u.name ?? "").trim().toLowerCase() === lower) {
      return { name: u.name, image: u.image ?? null };
    }
  }
  if (!lower.includes(" ")) {
    for (const u of directory) {
      const dirName = (u.name ?? "").trim();
      const firstToken = dirName.split(/\s+/)[0]?.toLowerCase() ?? "";
      if (firstToken === lower) {
        return { name: u.name, image: u.image ?? null };
      }
    }
  }
  return { name: trimmed, image: null };
}
