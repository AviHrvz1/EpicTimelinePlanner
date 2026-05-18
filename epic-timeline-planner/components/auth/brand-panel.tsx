import Image from "next/image";

/**
 * Marketing column shown beside the auth form on desktop (hidden below `lg:`).
 *
 * Uses a single pre-rendered hero image (`/auth-hero.png`) that bakes in the
 * gradient backdrop, the bubble mark, and the "WELCOME TO / Bird Eye Viewer"
 * typography from the design the user supplied. The image is sized via
 * object-cover so it fills the panel regardless of column proportions.
 */
export function BrandPanel() {
  return (
    <aside
      aria-hidden
      className="relative hidden overflow-hidden lg:block bg-gradient-to-br from-sky-500 via-indigo-600 to-violet-700"
    >
      {/* The hero PNG has the gradient + bubble + WELCOME copy baked in. By
          painting a matching gradient on the panel itself and switching the
          image to object-contain (instead of object-cover), the bubble + text
          shrinks to fit inside the column with comfortable padding while the
          gradient extends seamlessly behind it. Adjust the inset padding to
          change how much the artwork shrinks. */}
      <Image
        src="/auth-hero.png"
        alt=""
        fill
        priority
        quality={100}
        sizes="(min-width: 1280px) 720px, 50vw"
        className="object-contain p-8 xl:p-12"
      />
    </aside>
  );
}
