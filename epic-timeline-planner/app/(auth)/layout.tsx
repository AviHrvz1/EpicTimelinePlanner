import Image from "next/image";
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
    <div className="flex min-h-screen flex-col bg-gradient-to-r from-sky-100 via-indigo-100 to-violet-100">
      {/* Brand strip — slim header above the centered card, modeled after
          monday.com's login layout. Logo on the left, transparent so the
          underlying page gradient shows through. */}
      <header className="flex items-center border-b border-slate-200/70 bg-white px-5 py-3 shadow-sm sm:px-8">
        <Link href="/" aria-label="Bird Eye Viewer home" className="inline-flex items-center">
          <Image
            src="/downloads/Designer.png"
            alt="Bird Eye Viewer"
            width={1024}
            height={1024}
            priority
            className="block h-14 w-auto select-none"
          />
        </Link>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-10 sm:px-8 sm:pb-14">
      {/* Centered card that wraps both columns — keeps the auth surface
          a reasonable size instead of stretching edge-to-edge across the
          whole viewport on wide screens. */}
      <div className="grid w-full max-w-7xl overflow-hidden rounded-3xl bg-white shadow-[0_30px_80px_-30px_rgba(15,23,42,0.25)] ring-1 ring-slate-200/70 lg:min-h-[340px] lg:grid-cols-[1fr_1fr]">
        {/* Form column — left half on desktop, full width on mobile.
            The brand banner is a sibling of the padded form content so it
            can span the panel's true edges without fighting horizontal
            padding. */}
        <div className="relative flex flex-col">
          <section className="flex flex-1 flex-col px-10 pb-8 pt-6 sm:px-14 sm:pb-10 sm:pt-7 lg:px-16 lg:pb-10">
            <div className="my-auto w-full max-w-[720px]">{children}</div>
            <p className="mt-auto pt-5 text-[12.5px] text-slate-400">
              © {new Date().getFullYear()} Bird Eye Viewer · Need help?{" "}
              <Link href="/forgot-password" className="font-medium text-slate-500 hover:text-slate-700">
                Reset your password
              </Link>
            </p>
          </section>
        </div>

        <BrandPanel />
      </div>
    </main>
    </div>
  );
}
