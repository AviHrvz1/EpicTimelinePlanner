"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Eye, EyeOff, Loader2, LogIn, Lock, Mail } from "lucide-react";
import { toast } from "sonner";

import { signIn } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

import { OAuthButtons } from "./oauth-buttons";
import { Turnstile } from "./turnstile";

const TURNSTILE_THRESHOLD = 3;

/**
 * Email + password login form with:
 *  - Show/hide password toggle
 *  - "Remember me" (extends session 1 day → 30 days)
 *  - "Forgot password" link
 *  - OAuth buttons (only those with configured creds)
 *  - Cloudflare Turnstile shown after THREE failed attempts on the same email
 *  - Toast error with the server's message on failure (handles lockout / rate-limit cases)
 */
export function LoginForm({
  enabledProviders,
  onSwitchToSignup,
}: {
  enabledProviders: { google: boolean; apple: boolean; microsoft: boolean };
  /** When provided, the "Create account" link calls this instead of
   *  navigating to /signup — used by the login modal to switch to its
   *  signup view in-place rather than leaving the planner page. */
  onSwitchToSignup?: () => void;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackURL = searchParams.get("redirect") || "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Mounted gate — password-manager extensions (Keeper, 1Password, LastPass)
  // inject sibling elements into form inputs AFTER React's first paint, which
  // breaks SSR hydration with a child-list mismatch that suppressHydrationWarning
  // alone can't silence. By rendering a static placeholder on the server and
  // swapping to the real form only after `mounted` flips true (client-only),
  // hydration completes against the placeholder and the swap is a normal
  // re-render — no mismatch to flag.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // Inline error banner shown inside the form panel instead of a toast — toasts
  // are easy to miss and feel out of place for credential validation feedback.
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Client-side cooldown — after 5 failed attempts in this browser session we
  // disable the submit button for 60s and surface a countdown. Doesn't replace
  // the server-side rate limit (5/15min) — it just gives the user explicit
  // feedback and a hard pause before they can keep trying.
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [cooldownTick, setCooldownTick] = useState(0);

  const needsCaptcha = failedAttempts >= TURNSTILE_THRESHOLD;
  const captchaConfigured = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim());
  const captchaBlocking = needsCaptcha && captchaConfigured && !turnstileToken;
  const cooldownRemainingMs = cooldownUntil ? Math.max(0, cooldownUntil - Date.now()) : 0;
  const cooldownActive = cooldownRemainingMs > 0;
  const cooldownSeconds = Math.ceil(cooldownRemainingMs / 1000);
  const submitBlocked = pending || captchaBlocking || cooldownActive;

  // Keep the countdown text in sync while the cooldown is active. We only run
  // the interval when there's a live cooldown so we don't tick forever.
  useEffect(() => {
    if (!cooldownActive) return;
    const id = setInterval(() => setCooldownTick((t) => t + 1), 250);
    return () => clearInterval(id);
  }, [cooldownActive]);
  // cooldownTick is intentionally read so its change re-renders the countdown.
  void cooldownTick;

  const COOLDOWN_THRESHOLD = 5;
  const COOLDOWN_DURATION_MS = 60_000;

  const handleTurnstileSuccess = useCallback((token: string) => {
    setTurnstileToken(token);
  }, []);

  function registerFailure() {
    setTurnstileToken(null);
    setFailedAttempts((n) => {
      const next = n + 1;
      // Once the user crosses COOLDOWN_THRESHOLD failed attempts in this
      // session, start a 60-second hard pause. We re-arm the cooldown on every
      // subsequent failure too, so they can't squeeze in attempts at the edge.
      if (next >= COOLDOWN_THRESHOLD) {
        setCooldownUntil(Date.now() + COOLDOWN_DURATION_MS);
      }
      return next;
    });
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitBlocked) return;
    setPending(true);
    setErrorMessage(null);
    try {
      const result = await signIn.email({
        email: email.trim(),
        password,
        rememberMe,
        callbackURL,
        // Better Auth forwards arbitrary headers; we ride the captcha token along
        // as a request header so the verify hook can pick it up server-side.
        fetchOptions: turnstileToken
          ? { headers: { "x-turnstile-token": turnstileToken } }
          : undefined,
      });
      if ("error" in result && result.error) {
        const msg = result.error.message || "Unable to sign in";
        registerFailure();
        setErrorMessage(msg);
        return;
      }
      toast.success("Welcome back!");
      router.push(callbackURL);
      router.refresh();
    } catch (err) {
      registerFailure();
      const msg = err instanceof Error ? err.message : "Unable to sign in";
      setErrorMessage(msg);
    } finally {
      setPending(false);
    }
  }

  // Server-side / first-paint placeholder so hydration completes before the
  // real <input>s exist (no inputs → nothing for password-managers to inject).
  // Heights match the real form layout so there's no perceived layout shift
  // when the real form swaps in on the next tick.
  if (!mounted) {
    return (
      <div className="space-y-5" aria-hidden>
        <div className="h-[68px]" />
        <div className="h-[68px]" />
        <div className="h-5" />
        <div className="h-12 rounded-full bg-gradient-to-r from-sky-500 via-indigo-600 to-violet-600 opacity-60" />
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {/* Inline error banner — surfaces credential / lockout / rate-limit
          messages right above the inputs where the user is already looking,
          instead of relying on a toast notification that can be missed. */}
      {errorMessage && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[12.5px] font-medium text-rose-700"
        >
          <span aria-hidden className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-rose-500 text-[10px] font-bold text-white">!</span>
          <span>{errorMessage}</span>
        </div>
      )}
      {/* Cooldown banner — appears after 5 failed attempts and ticks down a
          60-second hard pause. The submit button below is disabled while this
          is on screen so the user can't keep brute-forcing. */}
      {cooldownActive && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[12.5px] font-medium text-amber-800"
        >
          <span aria-hidden className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-white">!</span>
          <span>
            Too many failed attempts. Please wait <strong>{cooldownSeconds}s</strong> before trying again.
          </span>
        </div>
      )}

      <div className="space-y-2">
        <label htmlFor="login-email" className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
          Email
        </label>
        <div className="group relative" suppressHydrationWarning>
          {/* Leading icon — sits inside the input's left padding so the cursor and
              text never collide with it. Color shifts to indigo on focus to echo
              the focus ring's hue. suppressHydrationWarning silences the noise
              from password-manager extensions (Keeper, 1Password, etc.) that
              inject their own siblings into this wrapper after mount. */}
          <Mail className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-indigo-500" />
          <input
            id="login-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => { setEmail(e.target.value); if (errorMessage) setErrorMessage(null); }}
            className="w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 py-3 text-[14px] text-slate-900 outline-none transition-shadow placeholder:text-slate-400 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
            placeholder="you@example.com"
            suppressHydrationWarning
          />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label htmlFor="login-password" className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
            Password
          </label>
          <Link
            href="/forgot-password"
            className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-700 hover:underline"
          >
            Forgot password?
          </Link>
        </div>
        <div className="group relative" suppressHydrationWarning>
          <Lock className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-indigo-500" />
          <input
            id="login-password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => { setPassword(e.target.value); if (errorMessage) setErrorMessage(null); }}
            className="w-full rounded-xl border border-slate-200 bg-white pl-10 pr-11 py-3 text-[14px] text-slate-900 outline-none transition-shadow placeholder:text-slate-400 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
            placeholder="••••••••••"
            suppressHydrationWarning
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-400 transition-colors hover:text-slate-600"
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </div>

      <label className="flex items-center gap-2.5 text-[12px] text-slate-600">
        <input
          type="checkbox"
          checked={rememberMe}
          onChange={(e) => setRememberMe(e.target.checked)}
          className="size-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-400"
        />
        <span>Remember me for 30 days</span>
      </label>

      <Turnstile visible={needsCaptcha} onSuccess={handleTurnstileSuccess} />

      <button
        type="submit"
        disabled={submitBlocked}
        className={cn(
          "inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border-0 px-6 text-[13px] font-bold uppercase tracking-[0.12em] text-white shadow-lg shadow-indigo-500/25 transition-all",
          "bg-gradient-to-r from-sky-500 via-indigo-600 to-violet-600",
          "hover:shadow-indigo-500/40 hover:from-sky-400 hover:via-indigo-500 hover:to-violet-500",
          "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-indigo-200",
          "disabled:cursor-not-allowed disabled:opacity-60",
        )}
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}
        <span>
          {pending
            ? "Signing in…"
            : cooldownActive
              ? `Locked · ${cooldownSeconds}s`
              : "Login"}
        </span>
      </button>

      {captchaBlocking && (
        <p className="text-center text-[11px] text-amber-700">
          Please complete the security check above to continue.
        </p>
      )}

      {(enabledProviders.google || enabledProviders.apple || enabledProviders.microsoft) && (
        <>
          {/* "or continue with" divider — only shown when there's actually an OAuth
              section to introduce. Two slate hairlines flank a small label so the
              transition between credential auth and social auth feels intentional. */}
          <div className="flex items-center gap-3 py-1">
            <div className="h-px flex-1 bg-slate-200" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
              or continue with
            </span>
            <div className="h-px flex-1 bg-slate-200" />
          </div>
          <OAuthButtons enabledProviders={enabledProviders} callbackURL={callbackURL} />
        </>
      )}

      <p className="pt-2 text-center text-[12px] text-slate-500">
        Don&apos;t have an account?{" "}
        {onSwitchToSignup ? (
          <button
            type="button"
            onClick={onSwitchToSignup}
            className="font-semibold text-indigo-600 hover:text-indigo-700 hover:underline"
          >
            Create account
          </button>
        ) : (
          <Link href="/signup" className="font-semibold text-indigo-600 hover:text-indigo-700 hover:underline">
            Create account
          </Link>
        )}
      </p>
    </form>
  );
}
