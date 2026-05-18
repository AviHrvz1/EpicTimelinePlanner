import Image from "next/image";
import Link from "next/link";

import { BrandPanel } from "@/components/auth/brand-panel";

/**
 * Shared shell for /login, /signup, /forgot-password, and /reset-password/[token].
 *
 * Layout follows the "Magnificent Accounting" reference the user shared:
 *   - A soft tinted backdrop with pastel decorative blobs floating in the corners.
 *   - A centered white card that wraps BOTH the form column and the brand panel,
 *     with a generous outer margin so the card feels like an artifact resting on
 *     the page rather than edge-to-edge chrome.
 *   - Inside the card: form on the left, gradient brand panel on the right.
 *   - Below `lg`, the brand panel collapses and only the form column shows so
 *     phones stay focused.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-slate-50">
      {/* Pastel decorative blobs in the page corners — softly tint the slate
          backdrop so the centered card feels like it's resting on a designed
          surface, not a flat color. Pure CSS, heavily blurred to dissolve into
          ambient tint rather than read as shapes. */}
      <div className="pointer-events-none absolute -top-32 -left-32 size-[28rem] rounded-full bg-sky-200/60 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -right-32 size-[34rem] rounded-full bg-violet-200/60 blur-3xl" />
      <div className="pointer-events-none absolute top-1/2 left-[60%] size-[20rem] -translate-y-1/2 rounded-full bg-indigo-200/40 blur-3xl" />

      <div className="relative z-10 flex min-h-screen items-center justify-center px-4 py-10 sm:px-8 sm:py-14">
        {/* Centered card — wraps both columns. Rounded, soft shadow, a faint
            slate ring so the edge is visible against the tinted backdrop. */}
        <div className="grid w-full max-w-6xl overflow-hidden rounded-3xl bg-white shadow-[0_30px_80px_-30px_rgba(15,23,42,0.25)] ring-1 ring-slate-200/70 lg:grid-cols-2">
          {/* Form column — left half on desktop, full width on mobile. */}
          <section className="relative flex flex-col px-8 py-10 sm:px-12 sm:py-14 lg:px-14 lg:py-16">
            <Link href="/" aria-label="Bird Eye Viewer — home" className="inline-block">
              <Image
                src="/bird-eye-lockup-wide.png"
                alt="Bird Eye Viewer"
                width={630}
                height={207}
                priority
                quality={100}
                sizes="260px"
                className="h-20 w-auto"
              />
            </Link>

            <div className="my-auto w-full max-w-[420px] py-10">{children}</div>

            <p className="text-[11px] text-slate-400">
              © {new Date().getFullYear()} Bird Eye Viewer · Need help?{" "}
              <Link href="/forgot-password" className="font-medium text-slate-500 hover:text-slate-700">
                Reset your password
              </Link>
            </p>
          </section>

          <BrandPanel />
        </div>
      </div>
    </main>
  );
}
