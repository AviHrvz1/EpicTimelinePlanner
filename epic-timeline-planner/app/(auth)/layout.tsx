import Link from "next/link";

import { BrandPanel } from "@/components/auth/brand-panel";

/**
 * Shared shell for /login, /signup, /forgot-password, and /reset-password/[token].
 *
 * Full-page split layout (monday.com-style):
 *   - Two columns at lg+: form on the left (white background), BrandPanel on
 *     the right (gradient + illustration). No centered card; the split goes
 *     edge-to-edge.
 *   - Below `lg`, the BrandPanel hides and the form takes the full width.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-r from-sky-100 via-indigo-100 to-violet-100 px-4 py-10 sm:px-8 sm:py-14">
      {/* Centered card that wraps both columns — keeps the auth surface
          a reasonable size instead of stretching edge-to-edge across the
          whole viewport on wide screens. */}
      <div className="grid w-full max-w-7xl overflow-hidden rounded-3xl bg-white shadow-[0_30px_80px_-30px_rgba(15,23,42,0.25)] ring-1 ring-slate-200/70 lg:min-h-[720px] lg:grid-cols-[1fr_1fr]">
        {/* Form column — left half on desktop, full width on mobile. */}
        <section className="relative flex flex-col px-8 py-10 sm:px-12 sm:py-12 lg:px-14 lg:py-12">
          <div className="my-auto w-full max-w-[520px]">{children}</div>
          <p className="mt-auto pt-8 text-[12.5px] text-slate-400">
            © {new Date().getFullYear()} Bird Eye Viewer · Need help?{" "}
            <Link href="/forgot-password" className="font-medium text-slate-500 hover:text-slate-700">
              Reset your password
            </Link>
          </p>
        </section>

        <BrandPanel />
      </div>
    </main>
  );
}
