/**
 * Demo-builder helper: generate a self-contained SVG logo per team,
 * returned as a `data:image/svg+xml;base64,...` URL. We don't ship binary
 * logo assets, so a generated SVG keeps the seed dependency-free while
 * still giving each Team row a real image. Colors mirror the team-chip
 * palette used in the Users directory; the centered glyph is a Lucide
 * icon path so the logo reads as "a real product team badge" instead
 * of a plain monogram.
 *
 * Stored straight into `Team.image` (a plain URL string), so swapping to
 * real uploaded logos later is just overwriting that column — no schema
 * change.
 */
import type { DemoTeamSlug } from "@/lib/demo-builder/data";

/**
 * Per-team gradient stops + a Lucide-icon SVG fragment. Icon fragments are
 * the raw <path>/<rect>/<circle> children copied from Lucide (24×24 viewBox,
 * stroke-based). They render in white with stroke-width 2 once embedded.
 *
 *  - platform   → Cpu        (chip)
 *  - mobile     → Smartphone (handheld)
 *  - experience → Palette    (designer)
 *  - data       → BarChart3  (analytics)
 *  - growth     → Sprout     (rising)
 */
const TEAM_LOGO_THEME: Record<DemoTeamSlug, { from: string; to: string; icon: string }> = {
  platform: {
    from: "#6366f1",
    to: "#0ea5e9",
    icon:
      '<rect width="16" height="16" x="4" y="4" rx="2"/>' +
      '<rect width="6" height="6" x="9" y="9" rx="1"/>' +
      '<path d="M15 2v2"/><path d="M15 20v2"/>' +
      '<path d="M2 15h2"/><path d="M2 9h2"/>' +
      '<path d="M20 15h2"/><path d="M20 9h2"/>' +
      '<path d="M9 2v2"/><path d="M9 20v2"/>',
  },
  mobile: {
    from: "#10b981",
    to: "#14b8a6",
    icon:
      '<rect width="14" height="20" x="5" y="2" rx="2" ry="2"/>' +
      '<path d="M12 18h.01"/>',
  },
  experience: {
    from: "#8b5cf6",
    to: "#ec4899",
    icon:
      '<circle cx="13.5" cy="6.5" r=".5" fill="#ffffff"/>' +
      '<circle cx="17.5" cy="10.5" r=".5" fill="#ffffff"/>' +
      '<circle cx="8.5" cy="7.5" r=".5" fill="#ffffff"/>' +
      '<circle cx="6.5" cy="12.5" r=".5" fill="#ffffff"/>' +
      '<path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>',
  },
  data: {
    from: "#f59e0b",
    to: "#f97316",
    icon:
      '<path d="M3 3v18h18"/>' +
      '<path d="M18 17V9"/>' +
      '<path d="M13 17V5"/>' +
      '<path d="M8 17v-3"/>',
  },
  growth: {
    from: "#ef4444",
    to: "#f43f5e",
    icon:
      '<path d="M7 20h10"/>' +
      '<path d="M10 20c5.5-2.5.8-6.4 3-10"/>' +
      '<path d="M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8z"/>' +
      '<path d="M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1 1.6-2.3 1.7-4.6-2.7.1-4 1-4.9 2z"/>',
  },
};

/**
 * Build the SVG markup for a team's logo: a rounded-square gradient tile
 * with a centered Lucide icon scaled to roughly 60 % of the tile.
 */
function buildTeamLogoSvg(slug: DemoTeamSlug): string {
  const theme = TEAM_LOGO_THEME[slug];
  // Unique gradient id per slug so multiple inline SVGs never collide if a
  // consumer ever drops them into one document.
  const gid = `tg-${slug}`;
  // Icon is a 24×24 viewBox; place it in a 72×72 box centered on the
  // 128×128 tile (offset 28,28) so the glyph fills ~56 % of the tile.
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">`,
    `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1">`,
    `<stop offset="0" stop-color="${theme.from}"/>`,
    `<stop offset="1" stop-color="${theme.to}"/>`,
    `</linearGradient></defs>`,
    `<rect width="128" height="128" rx="28" fill="url(#${gid})"/>`,
    // Nested SVG re-establishes the 24×24 viewBox so the icon's path
    // coordinates render at their native scale, then the outer width/height
    // (72×72 at offset 28,28) does the visual sizing.
    `<svg x="28" y="28" width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">`,
    theme.icon,
    `</svg>`,
    `</svg>`,
  ].join("");
}

/**
 * Return the team's logo as a base64 data URL suitable for `Team.image`.
 * Base64 (not raw utf8) so the string is safe to drop into an `<img src>`
 * and a DB text column without escaping concerns.
 */
export function buildTeamLogoDataUrl(slug: DemoTeamSlug): string {
  const svg = buildTeamLogoSvg(slug);
  const base64 = Buffer.from(svg, "utf8").toString("base64");
  return `data:image/svg+xml;base64,${base64}`;
}
