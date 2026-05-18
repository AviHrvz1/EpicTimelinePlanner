"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LogOut, Settings, User } from "lucide-react";
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
    // Middleware redirects unauthenticated visitors to /login before they can
    // see the global header, so we should never actually render anything for
    // the unauthenticated state here. Return null defensively in case the
    // session check briefly returns no user mid-navigation.
    return null;
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
      // Redirect to /login after sign-out so the user lands on the auth page
      // instead of staying on an authenticated route that flashes empty data.
      router.push("/login");
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
        {/* Lucide User icon between the avatar and the display name — makes the
            "this chip represents your account" affordance explicit. */}
        <User className="size-3.5 shrink-0 text-indigo-500" strokeWidth={2.2} aria-hidden />
        <span className="max-w-[140px] truncate">{displayName}</span>
      </button>

      {menuOpen && (
        <div
          role="menu"
          className="absolute left-0 top-full z-[1000] mt-1.5 min-w-[220px] overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-xl"
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
/**
 * Stable avatar color, restricted to the project's sky → indigo → violet
 * palette (hue 200°–280°) so user avatars never land on red/orange tones that
 * clash with the rest of the UI. Saturation/lightness picked to read well as
 * a white-text avatar against the white chip background.
 */
function stableColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  const HUE_MIN = 200; // sky-500-ish
  const HUE_RANGE = 80; // → 280° ≈ violet-500
  const hue = HUE_MIN + (Math.abs(hash) % HUE_RANGE);
  return `hsl(${hue} 62% 52%)`;
}
