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
    <aside aria-hidden className="relative hidden overflow-hidden bg-[#1554d6] p-2 lg:flex lg:items-center lg:justify-center">
      {/* Image background is a flat deep blue that matches `bg-[#1554d6]` on
          the aside. Switching to `object-contain` lets us shrink the visible
          content while the surrounding solid blue from the aside fills the
          rest seamlessly. */}
      <Image
        src="/auth-hero.png"
        alt=""
        width={1024}
        height={1024}
        priority
        quality={100}
        unoptimized
        className="block max-h-full w-auto select-none object-contain"
      />
    </aside>
  );
}
