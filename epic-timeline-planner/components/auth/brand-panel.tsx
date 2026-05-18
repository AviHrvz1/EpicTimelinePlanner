import Image from "next/image";

/**
 * Marketing column shown beside the auth form on desktop (hidden below `lg:`).
 * Mirrors the split-screen pattern from the design references the user shared:
 * a saturated gradient surface with the product mark, wordmark, tagline, and
 * soft decorative blobs to give the page a "designer revisit" feel.
 *
 * Lives only inside the (auth) layout — never imported elsewhere — so the
 * gradient and large logo don't leak into the app proper.
 */
export function BrandPanel() {
  return (
    <aside
      aria-hidden
      className="relative hidden overflow-hidden lg:block"
    >
      {/* Saturated diagonal gradient that anchors the page. Three-stop blend
          (sky → indigo → violet) matches the rest of the app's accent palette
          but at a stronger saturation level so the auth page feels premium. */}
      <div className="absolute inset-0 bg-gradient-to-br from-sky-500 via-indigo-600 to-violet-700" />

      {/* Decorative ambient blobs — pure CSS, no images. Positioned with
          mix-blend-screen so they tint without flat-pasting. Heavy blur softens
          them into a painted-glass effect rather than UI shapes. */}
      <div className="absolute -top-32 -left-24 size-[28rem] rounded-full bg-cyan-300/40 blur-3xl mix-blend-screen" />
      <div className="absolute -bottom-32 right-[-6rem] size-[32rem] rounded-full bg-fuchsia-400/30 blur-3xl mix-blend-screen" />
      <div className="absolute top-[38%] left-[55%] size-[22rem] rounded-full bg-blue-300/30 blur-3xl mix-blend-screen" />

      {/* Faint dotted grid for depth — sits between the gradient and the content. */}
      <div
        className="absolute inset-0 opacity-[0.12]"
        style={{
          backgroundImage:
            "radial-gradient(circle at center, rgba(255,255,255,0.7) 1px, transparent 1px)",
          backgroundSize: "26px 26px",
        }}
      />

      {/* Large faded watermark of the bubble mark in the corner — adds depth
          without competing with the centered hero artwork. */}
      <div className="pointer-events-none absolute -right-24 -bottom-20 opacity-[0.18] mix-blend-screen">
        <Image
          src="/bird-eye-bubble.png"
          alt=""
          width={520}
          height={520}
          className="size-[34rem] object-contain"
          priority
        />
      </div>

      <div className="relative z-10 flex h-full w-full flex-col justify-center gap-10 p-10 xl:p-14">
        {/* Centered hero block — mark sits prominently in the middle, with the
            WELCOME TO / headline / divider / tagline beneath. Mirrors the
            "Magnificent Accounting" reference layout. */}
        <div className="flex flex-col items-center text-center text-white">
          <Image
            src="/bird-eye-bubble.png"
            alt="Bird Eye Viewer"
            width={300}
            height={300}
            className="size-32 xl:size-40 drop-shadow-[0_24px_60px_rgba(15,23,42,0.45)]"
            priority
          />
          <p className="mt-8 text-[11px] font-bold tracking-[0.32em] text-white/75">
            WELCOME TO
          </p>
          <h1 className="mt-2 text-[34px] xl:text-[40px] font-extrabold leading-tight tracking-tight">
            Bird Eye Viewer
          </h1>
          <div className="mt-3 h-[2px] w-12 rounded-full bg-white/70" />
          <p className="mt-4 max-w-xs text-[13px] leading-relaxed text-white/85">
            Plan epics, track sprints, and see the bigger picture.
          </p>
        </div>
      </div>
    </aside>
  );
}
