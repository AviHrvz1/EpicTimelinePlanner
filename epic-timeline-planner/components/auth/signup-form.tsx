"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Eye, EyeOff, Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { signUp } from "@/lib/auth-client";
import { scorePassword } from "@/lib/password-strength";
import { cn } from "@/lib/utils";

import { OAuthButtons } from "./oauth-buttons";
import { PasswordStrengthMeter } from "./password-strength-meter";

/**
 * Signup form with live password-strength meter, show/hide password, and OAuth fallback.
 *
 * The submit button is disabled until the password reaches `scorePassword.acceptable`, so the
 * user can never POST a too-weak password. The server enforces the same rule independently
 * via lib/auth.ts → emailAndPassword.minPasswordLength + Better Auth's password complexity rules.
 */
export function SignupForm({
  enabledProviders,
}: {
  enabledProviders: { google: boolean; apple: boolean; microsoft: boolean };
}) {
  const router = useRouter();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [pending, setPending] = useState(false);

  const strength = scorePassword(password);
  const canSubmit =
    name.trim().length >= 2 && email.includes("@") && strength.acceptable && acceptTerms;

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || pending) return;
    setPending(true);
    try {
      const result = await signUp.email({
        name: name.trim(),
        email: email.trim(),
        password,
        callbackURL: "/",
      });
      if ("error" in result && result.error) {
        const msg = result.error.message || "Unable to create your account";
        toast.error(msg);
        return;
      }
      toast.success(`Welcome, ${name.trim()}!`);
      router.push("/");
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unable to create your account";
      toast.error(msg);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="signup-name" className="text-[12px] font-semibold text-slate-700">
          Name
        </label>
        <input
          id="signup-name"
          name="name"
          type="text"
          autoComplete="name"
          required
          minLength={2}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          placeholder="Your name"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="signup-email" className="text-[12px] font-semibold text-slate-700">
          Email
        </label>
        <input
          id="signup-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          placeholder="you@example.com"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="signup-password" className="text-[12px] font-semibold text-slate-700">
          Password
        </label>
        <div className="relative">
          <input
            id="signup-password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 pr-10 text-sm text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 transition-colors hover:text-slate-600"
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        <PasswordStrengthMeter password={password} />
      </div>

      <label className="flex items-start gap-2 text-[12px] text-slate-600">
        <input
          type="checkbox"
          checked={acceptTerms}
          onChange={(e) => setAcceptTerms(e.target.checked)}
          className="mt-0.5 size-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-400"
        />
        <span>
          I agree to the terms of service and acknowledge the privacy policy.
        </span>
      </label>

      <button
        type="submit"
        disabled={!canSubmit || pending}
        className={cn(
          "inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border-0 px-4 text-[13px] font-bold text-white shadow-sm transition-all",
          "bg-gradient-to-br from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
          "disabled:cursor-not-allowed disabled:opacity-60",
        )}
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
        <span>{pending ? "Creating your account…" : "Create account"}</span>
      </button>

      <OAuthButtons enabledProviders={enabledProviders} />

      <p className="pt-2 text-center text-[12px] text-slate-500">
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-indigo-600 hover:text-indigo-700 hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
