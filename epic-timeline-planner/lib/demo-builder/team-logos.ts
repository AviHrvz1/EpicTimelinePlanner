/**
 * Demo-builder helper: generate a self-contained SVG monogram logo per team,
 * returned as a `data:image/svg+xml;base64,...` URL. We don't ship binary
 * logo assets, so a generated monogram keeps the seed dependency-free while
 * still giving each Team row a real image. Colors mirror the team-chip
 * palette used in the Users directory so the logo reads as "the same team".
 *
 * Stored straight into `Team.image` (a plain URL string), so swapping to real
 * uploaded logos later is just overwriting that column — no schema change.
 */
import type { DemoTeamSlug } from "@/lib/demo-builder/data";

/** Gradient stops + monogram letter per team. Stops match the directory chip
 *  colors (platform=sky, mobile=emerald, experience=violet, data=amber,
 *  growth=rose) so the logo and the text chip agree visually. */
const TEAM_LOGO_THEME: Record<DemoTeamSlug, { from: string; to: string; letter: string }> = {
  platform: { from: "#6366f1", to: "#0ea5e9", letter: "P" },
  mobile: { from: "#10b981", to: "#14b8a6", letter: "M" },
  experience: { from: "#8b5cf6", to: "#ec4899", letter: "E" },
  data: { from: "#f59e0b", to: "#f97316", letter: "D" },
  growth: { from: "#ef4444", to: "#f43f5e", letter: "G" },
};

/**
 * Build the SVG markup for a team's monogram logo: a rounded-square gradient
 * tile with a large white initial centered on it.
 */
function buildTeamLogoSvg(slug: DemoTeamSlug): string {
  const theme = TEAM_LOGO_THEME[slug];
  // Unique gradient id per slug so multiple inline SVGs never collide if a
  // consumer ever drops them into one document.
  const gid = `tg-${slug}`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">`,
    `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1">`,
    `<stop offset="0" stop-color="${theme.from}"/>`,
    `<stop offset="1" stop-color="${theme.to}"/>`,
    `</linearGradient></defs>`,
    `<rect width="128" height="128" rx="28" fill="url(#${gid})"/>`,
    `<text x="64" y="68" font-family="Inter, system-ui, -apple-system, sans-serif" font-size="62" font-weight="700" fill="#ffffff" text-anchor="middle" dominant-baseline="central">${theme.letter}</text>`,
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
