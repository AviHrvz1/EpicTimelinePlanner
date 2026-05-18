"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import { Eye, EyeOff, Loader2, LogIn } from "lucide-react";
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
}: {
  enabledProviders: { google: boolean; apple: boolean; microsoft: boolean };
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

  const needsCaptcha = failedAttempts >= TURNSTILE_THRESHOLD;
  const captchaConfigured = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim());
  const captchaBlocking = needsCaptcha && captchaConfigured && !turnstileToken;

  const handleTurnstileSuccess = useCallback((token: string) => {
    setTurnstileToken(token);
  }, []);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || captchaBlocking) return;
    setPending(true);
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
        setFailedAttempts((n) => n + 1);
        setTurnstileToken(null);
        toast.error(msg);
        return;
      }
      toast.success("Welcome back!");
      router.push(callbackURL);
      router.refresh();
    } catch (err) {
      setFailedAttempts((n) => n + 1);
      setTurnstileToken(null);
      const msg = err instanceof Error ? err.message : "Unable to sign in";
      toast.error(msg);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="space-y-2">
        <label htmlFor="login-email" className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
          Email
        </label>
        <input
          id="login-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-[14px] text-slate-900 outline-none transition-shadow focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
          placeholder="you@example.com"
        />
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
        <div className="relative">
          <input
            id="login-password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 pr-11 text-[14px] text-slate-900 outline-none transition-shadow focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
            placeholder="••••••••••"
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
        disabled={pending || captchaBlocking}
        className={cn(
          "inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border-0 px-6 text-[13px] font-bold uppercase tracking-[0.12em] text-white shadow-lg shadow-indigo-500/25 transition-all",
          "bg-gradient-to-r from-sky-500 via-indigo-600 to-violet-600",
          "hover:shadow-indigo-500/40 hover:from-sky-400 hover:via-indigo-500 hover:to-violet-500",
          "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-indigo-200",
          "disabled:cursor-not-allowed disabled:opacity-60",
        )}
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}
        <span>{pending ? "Signing in…" : "Login"}</span>
      </button>

      {captchaBlocking && (
        <p className="text-center text-[11px] text-amber-700">
          Please complete the security check above to continue.
        </p>
      )}

      <OAuthButtons enabledProviders={enabledProviders} callbackURL={callbackURL} />

      <p className="pt-1 text-center text-[12px] text-slate-500">
        Don&apos;t have an account?{" "}
        <Link href="/signup" className="font-semibold text-indigo-600 hover:text-indigo-700 hover:underline">
          Create account
        </Link>
      </p>
    </form>
  );
}
