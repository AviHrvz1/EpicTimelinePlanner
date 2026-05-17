import Link from "next/link";

/**
 * Shared shell for /login, /signup, /forgot-password, and /reset-password/[token].
 * Centered card layout against the same slate-50 backdrop the planner uses, so the
 * auth pages feel like part of the app — not a transplant from another product.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <Link
          href="/"
          className="block text-center text-[13px] font-bold tracking-tight text-slate-700 hover:text-slate-900"
        >
          Epic Timeline Planner
        </Link>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-lg ring-1 ring-slate-200/50">
          {children}
        </div>
        <p className="text-center text-[11px] text-slate-400">
          Protected by rate limits and brute-force lockout. Need help?{" "}
          <Link href="/forgot-password" className="font-medium text-slate-500 hover:text-slate-700">
            Reset your password
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
