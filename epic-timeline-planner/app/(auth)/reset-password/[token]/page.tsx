"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useState } from "react";
import { Eye, EyeOff, KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { scorePassword } from "@/lib/password-strength";
import { cn } from "@/lib/utils";

import { PasswordStrengthMeter } from "@/components/auth/password-strength-meter";

/**
 * /reset-password/[token] — sets a new password using the token from the reset email.
 *
 * In Next.js 16 dynamic route params are wrapped in a Promise and must be unwrapped via
 * React's `use()` hook in a client component (or `await context.params` in a server
 * component). Better Auth verifies + consumes the token server-side; this page only
 * collects the new password (with the same strength meter as signup).
 */
export default function ResetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();

  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);

  const strength = scorePassword(password);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!strength.acceptable || pending) return;
    setPending(true);
    try {
      const result = await authClient.resetPassword({ token, newPassword: password });
      if ("error" in result && result.error) {
        const msg = result.error.message || "Reset link is invalid or expired";
        toast.error(msg);
        return;
      }
      toast.success("Password updated. Please sign in.");
      router.push("/login");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Reset link is invalid or expired";
      toast.error(msg);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1 text-center">
        <h1 className="text-lg font-bold text-slate-800">Set a new password</h1>
        <p className="text-[12px] text-slate-500">
          Choose a strong password. The reset link can only be used once.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="reset-password" className="text-[12px] font-semibold text-slate-700">
            New password
          </label>
          <div className="relative">
            <input
              id="reset-password"
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

        <button
          type="submit"
          disabled={!strength.acceptable || pending}
          className={cn(
            "inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border-0 px-4 text-[13px] font-bold text-white shadow-sm transition-all",
            "bg-gradient-to-br from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500",
            "disabled:cursor-not-allowed disabled:opacity-60",
          )}
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
          <span>{pending ? "Updating…" : "Update password"}</span>
        </button>

        <p className="pt-2 text-center text-[12px] text-slate-500">
          <Link href="/login" className="font-semibold text-indigo-600 hover:text-indigo-700 hover:underline">
            Back to sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
