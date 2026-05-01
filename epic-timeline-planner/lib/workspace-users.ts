import { MONTH_TEAM_COLUMNS, MONTH_TEAM_IDS, isKnownEpicTeamId } from "@/lib/month-team-board";

export const WORKSPACE_USER_PERMISSIONS = ["Admin", "Editor", "Viewer"] as const;
export type WorkspaceUserPermission = (typeof WORKSPACE_USER_PERMISSIONS)[number];

export function normalizeWorkspaceUserPermission(raw: string | null | undefined): string {
  const t = (raw ?? "").trim();
  if (!t) return "Viewer";
  const match = WORKSPACE_USER_PERMISSIONS.find((p) => p.toLowerCase() === t.toLowerCase());
  return match ?? t.slice(0, 64);
}

export function normalizeWorkspaceUserTeam(raw: string | null | undefined): string {
  const t = (raw ?? "").trim();
  if (!t) return "";
  return isKnownEpicTeamId(t) ? t : "";
}

export function teamLabelForWorkspaceUser(teamId: string): string {
  if (!teamId) return "—";
  return MONTH_TEAM_COLUMNS.find((c) => c.id === teamId)?.label ?? teamId;
}

export { MONTH_TEAM_IDS };
