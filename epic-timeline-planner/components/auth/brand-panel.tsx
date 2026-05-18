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
      {/* Shrink the entire image (gradient backdrop + bubble + text) to fit
          inside the panel with breathing room on all sides. object-contain
          preserves the image's aspect ratio; the matching panel gradient
          behind it extends seamlessly to the card's edge. Bump p-* up to make
          the image even smaller, down to reduce the margin. */}
      <Image
        src="/auth-hero.png"
        alt=""
        fill
        priority
        quality={100}
        sizes="(min-width: 1280px) 720px, 50vw"
        className="object-contain p-12 xl:p-16"
      />
    </aside>
  );
}
