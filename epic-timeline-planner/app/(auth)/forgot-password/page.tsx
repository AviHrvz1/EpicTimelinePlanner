"use client";

import Link from "next/link";
import { useState } from "react";
import { Loader2, Mail } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

/**
 * /forgot-password — collects an email, asks Better Auth to send the reset link, and
 * ALWAYS shows the same success message (whether the email exists or not). This avoids
 * leaking which addresses are registered.
 *
 * Better Auth's `forgetPassword` writes to the Verification table and triggers
 * `sendResetPassword` from lib/auth.ts → lib/email/send-reset-email.ts (AWS SES).
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !email.trim()) return;
    setPending(true);
    setError(null);
    try {
      await authClient.requestPasswordReset({
        email: email.trim(),
        redirectTo: "/reset-password",
      });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to send reset email");
    } finally {
      setPending(false);
    }
  }

  if (sent) {
    return (
      <div className="space-y-4 text-center">
        <div className="mx-auto inline-flex size-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
          <Mail className="size-5" />
        </div>
        <h1 className="text-lg font-bold text-slate-800">Check your email</h1>
        <p className="text-[13px] text-slate-500">
          If an account exists for <span className="font-semibold text-slate-700">{email}</span>, we&apos;ve
          sent a password reset link. The link expires in 1 hour.
        </p>
        <Link
          href="/login"
          className="inline-block text-[12px] font-semibold text-indigo-600 hover:text-indigo-700 hover:underline"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1 text-center">
        <h1 className="text-lg font-bold text-slate-800">Reset your password</h1>
        <p className="text-[12px] text-slate-500">
          Enter your email and we&apos;ll send a link to reset your password.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="forgot-email" className="text-[12px] font-semibold text-slate-700">
            Email
          </label>
          <input
            id="forgot-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            placeholder="you@example.com"
          />
        </div>

        {error && (
          <p className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-[12px] text-red-600">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className={cn(
            "inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border-0 px-4 text-[13px] font-bold text-white shadow-sm transition-all",
            "bg-gradient-to-br from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500",
            "disabled:cursor-not-allowed disabled:opacity-60",
          )}
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
          <span>{pending ? "Sending…" : "Send reset link"}</span>
        </button>

        <p className="pt-2 text-center text-[12px] text-slate-500">
          Remembered your password?{" "}
          <Link href="/login" className="font-semibold text-indigo-600 hover:text-indigo-700 hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
