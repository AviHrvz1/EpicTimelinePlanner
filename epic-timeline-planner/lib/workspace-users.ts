import { MONTH_TEAM_COLUMNS, MONTH_TEAM_IDS, isKnownEpicTeamId } from "@/lib/month-team-board";

export const WORKSPACE_USER_PERMISSIONS = ["Admin", "Editor", "Viewer"] as const;
export type WorkspaceUserPermission = (typeof WORKSPACE_USER_PERMISSIONS)[number];

const MAX_WORKSPACE_USER_TEAM_LEN = 64;

/** Title-cases a slug stored in `team` for ids outside the delivery trio. */
function humanizeWorkspaceUserTeamSlug(id: string): string {
  if (!id) return "";
  return id
    .split("-")
    .filter(Boolean)
    .map((w) => (w.length ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : ""))
    .filter(Boolean)
    .join(" ");
}

export function normalizeWorkspaceUserPermission(raw: string | null | undefined): string {
  const t = (raw ?? "").trim();
  if (!t) return "Viewer";
  const match = WORKSPACE_USER_PERMISSIONS.find((p) => p.toLowerCase() === t.toLowerCase());
  return match ?? t.slice(0, 64);
}

/** Canonical delivery ids, label aliases, or a slug for custom directory teams. */
export function normalizeWorkspaceUserTeam(raw: string | null | undefined): string {
  const t = (raw ?? "").trim();
  if (!t) return "";
  const lower = t.toLowerCase();
  if (isKnownEpicTeamId(t)) return t;
  const byLabel = MONTH_TEAM_COLUMNS.find((c) => c.label.toLowerCase() === lower);
  if (byLabel) return byLabel.id;
  const byIdGuess = MONTH_TEAM_COLUMNS.find((c) => c.id.toLowerCase() === lower);
  if (byIdGuess) return byIdGuess.id;
  const slug = lower
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_WORKSPACE_USER_TEAM_LEN);
  if (!slug) return "";
  if (MONTH_TEAM_IDS.includes(slug)) return slug;
  return slug;
}

export function teamLabelForWorkspaceUser(teamId: string): string {
  if (!teamId) return "—";
  const col = MONTH_TEAM_COLUMNS.find((c) => c.id === teamId);
  if (col) return col.label;
  return humanizeWorkspaceUserTeamSlug(teamId);
}

export { MONTH_TEAM_IDS };
