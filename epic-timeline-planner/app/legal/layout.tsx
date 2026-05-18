import Link from "next/link";

/**
 * Shared layout for /legal/privacy and /legal/terms. A simple centered page with
 * a back-link to the app — these pages are linked from the signup form's consent
 * checkbox so people can read the policy without losing their place.
 */
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto w-full max-w-3xl px-6 py-12 sm:px-10 sm:py-16">
        <Link
          href="/"
          className="mb-8 inline-flex items-center gap-2 text-[12px] font-semibold tracking-tight text-slate-500 transition-colors hover:text-slate-800"
        >
          <span className="inline-block size-1.5 rounded-full bg-gradient-to-br from-sky-500 to-indigo-600" />
          Back to Bird Eye Viewer
        </Link>
        {/* Typography rules baked into the article wrapper so the two policy
            pages don't have to repeat them. Targets descendant tags with
            Tailwind v4's arbitrary descendant selectors. */}
        <article
          className="rounded-2xl border border-slate-200 bg-white p-8 text-[14px] leading-relaxed text-slate-700 shadow-sm ring-1 ring-slate-200/50 sm:p-12
            [&_h1]:mb-3 [&_h1]:text-[30px] [&_h1]:font-extrabold [&_h1]:tracking-tight [&_h1]:text-slate-900
            [&_h2]:mt-8 [&_h2]:mb-2 [&_h2]:text-[16px] [&_h2]:font-bold [&_h2]:tracking-tight [&_h2]:text-slate-900
            [&_p]:my-3
            [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_li]:my-1
            [&_strong]:font-semibold [&_strong]:text-slate-900
            [&_a]:text-indigo-600 [&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:text-indigo-700
            [&_hr]:my-10 [&_hr]:border-slate-200"
        >
          {children}
        </article>
      </div>
    </main>
  );
}
