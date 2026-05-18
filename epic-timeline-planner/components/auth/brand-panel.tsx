import Image from "next/image";

/**
 * Marketing column shown beside the auth form on desktop (hidden below `lg:`).
 *
 * Uses the pre-rendered hero image (`/auth-hero.png`) that already has the
 * gradient backdrop, the bubble, and the WELCOME copy laid out at a balanced
 * size. `object-cover` fills the panel edge-to-edge.
 */
export function BrandPanel() {
  return (
    <aside aria-hidden className="relative hidden overflow-hidden lg:block">
      {/* object-cover fills the panel edge-to-edge. With this image's tight
          composition (small bubble + text centered in lots of gradient), the
          horizontal cropping just trims excess gradient on the sides — the
          content stays well within frame and there's no visible seam since
          the image is the only thing painting the panel background. */}
      <Image
        src="/auth-hero.png"
        alt=""
        fill
        priority
        quality={100}
        // Skip Next.js's image-optimization pipeline so the browser receives
        // the raw 1536×1024 PNG. Optimization picks a downscaled variant when
        // `sizes` is conservative, which makes object-cover's required upscale
        // worse. Serving the original gives object-cover the most pixels to
        // work with and is the fastest sharpness win without re-generating
        // the source asset at a higher resolution.
        unoptimized
        className="object-cover"
      />
    </aside>
  );
}
