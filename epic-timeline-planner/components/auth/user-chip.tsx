"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LogIn, LogOut, Settings, User } from "lucide-react";
import { toast } from "sonner";

import { signOut, useSession } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

/**
 * The user identity chip in the global header bar. Renders one of three states:
 *
 *  1. Loading — neutral skeleton-style placeholder (avoids "Sign in" flashing on page load)
 *  2. Unauthenticated — "Sign in" link styled like the toolbar chips
 *  3. Authenticated — avatar + name + dropdown (Profile stub / Sign out)
 *
 * Dropdown is keyboard-friendly (Esc closes, click-outside closes). Initials in the avatar
 * are derived deterministically from the user id so a given user always gets the same color.
 */
export function UserChip() {
  const { data, isPending } = useSession();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const [pendingSignOut, setPendingSignOut] = useState(false);

  // Close on click-outside / Esc.
  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(event.target as Node)) setMenuOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  if (isPending) {
    return (
      <div
        aria-busy
        className="inline-flex h-[26px] w-[26px] shrink-0 animate-pulse rounded-full bg-slate-200"
      />
    );
  }

  if (!data?.user) {
    return (
      <Link
        href="/login"
        className="inline-flex h-[26px] shrink-0 items-center gap-1 whitespace-nowrap rounded-full border-0 bg-gradient-to-br from-indigo-100 via-indigo-200 to-indigo-200 px-3 text-[12px] font-semibold leading-none tracking-wide text-indigo-950 ring-1 ring-indigo-300/75 transition-shadow hover:shadow-sm"
      >
        <LogIn className="size-3.5 shrink-0 opacity-50" aria-hidden />
        Sign in
      </Link>
    );
  }

  const user = data.user;
  const displayName = user.name || user.email;
  const initials = getInitials(user.name, user.email);
  const avatarBg = stableColor(user.id);

  async function handleSignOut() {
    if (pendingSignOut) return;
    setPendingSignOut(true);
    try {
      await signOut();
      toast.success("Signed out");
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unable to sign out";
      toast.error(msg);
    } finally {
      setPendingSignOut(false);
      setMenuOpen(false);
    }
  }

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title={displayName}
        className="group inline-flex h-[26px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border-0 bg-white px-1 pr-2.5 text-[12px] font-semibold leading-none tracking-wide text-slate-800 ring-1 ring-slate-200 transition-shadow hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
      >
        {user.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.image}
            alt=""
            className="size-[22px] shrink-0 rounded-full object-cover"
          />
        ) : (
          <span
            className="inline-flex size-[22px] shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
            style={{ background: avatarBg }}
            aria-hidden
          >
            {initials}
          </span>
        )}
        <span className="max-w-[140px] truncate">{displayName}</span>
      </button>

      {menuOpen && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1.5 min-w-[220px] overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-xl"
        >
          <div className="px-3 py-2 border-b border-slate-100">
            <p className="truncate text-[12px] font-semibold text-slate-800">{displayName}</p>
            <p className="truncate text-[11px] text-slate-500">{user.email}</p>
          </div>
          <button
            type="button"
            disabled
            className={cn(
              "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[12px] font-medium text-slate-400",
              "cursor-not-allowed",
            )}
            title="Coming soon"
          >
            <Settings className="size-3.5" />
            <span>Account settings</span>
            <span className="ml-auto text-[10px] uppercase tracking-wide">Soon</span>
          </button>
          <button
            type="button"
            disabled
            className={cn(
              "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[12px] font-medium text-slate-400",
              "cursor-not-allowed",
            )}
            title="Coming soon"
          >
            <User className="size-3.5" />
            <span>Profile</span>
            <span className="ml-auto text-[10px] uppercase tracking-wide">Soon</span>
          </button>
          <div className="my-1 border-t border-slate-100" />
          <button
            type="button"
            disabled={pendingSignOut}
            onClick={handleSignOut}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[12px] font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-60"
          >
            <LogOut className="size-3.5" />
            <span>{pendingSignOut ? "Signing out…" : "Sign out"}</span>
          </button>
        </div>
      )}
    </div>
  );
}

function getInitials(name: string | null | undefined, email: string): string {
  const source = (name && name.trim()) || email;
  const parts = source.replace(/@.*$/, "").split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  if (parts.length === 1) {
    const p = parts[0];
    return (p.length >= 2 ? p.slice(0, 2) : p[0] + p[0]).toUpperCase();
  }
  return "??";
}

/**
 * Pick a stable hue from a user id so the avatar color persists across sessions but the
 * dashboard feels visually varied across many users. HSL with a fixed saturation/lightness
 * looks consistent against the white chip background.
 */
function stableColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  const hue = ((hash % 360) + 360) % 360;
  return `hsl(${hue} 65% 48%)`;
}
