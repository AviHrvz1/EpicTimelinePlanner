"use client";

import { closestCenter, DndContext, type DragEndEvent, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, horizontalListSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronRight,
  Layers3,
  ListFilter,
  Plus,
  Search,
  Tag,
  User,
  UserPen,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import type { CSSProperties, FocusEvent, KeyboardEvent, ReactNode } from "react";
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { AssigneeCombobox } from "@/components/ui/assignee-combobox";
import { Button } from "@/components/ui/button";
import { EditRowIconButton } from "@/components/ui/edit-row-icon-button";
import { PermissionFolderIcon } from "@/components/ui/permission-folder-icon";
import { TableColumnDragGrip } from "@/components/ui/table-column-drag-grip";
import { TeamIdCombobox, blurActiveField } from "@/components/ui/team-id-combobox";
import { MONTH_TEAM_COLUMNS, MONTH_TEAM_IDS } from "@/lib/month-team-board";
import { TABLE_ZEBRA_BASE_BG, TABLE_ZEBRA_STRIPE_BG } from "@/lib/table-zebra";
import {
  WORKSPACE_USER_PERMISSIONS,
  normalizeWorkspaceUserPermission,
  normalizeWorkspaceUserTeam,
  teamLabelForWorkspaceUser,
} from "@/lib/workspace-users";
import { cn } from "@/lib/utils";

export type WorkspaceUserRow = {
  id: string;
  name: string;
  email: string;
  team: string;
  permission: string;
  /** Lowercase in DB; displayed capitalized in UI. Omitted on older API payloads until migrate. */
  status?: string;
  createdAt: string;
  updatedAt: string;
};

type PermissionFilter = "all" | "Admin" | "Editor" | "Viewer";
type SortKey = "name" | "email" | "team" | "permission" | "status";
type SortState = { key: SortKey; dir: "asc" | "desc" };
type UserEditField = "name" | "email" | "team" | "permission";

const USER_DIRECTORY_DEFAULT_COLUMN_ORDER: SortKey[] = ["name", "email", "team", "permission", "status"];
const USERS_DIRECTORY_COLUMN_ORDER_STORAGE_KEY = "epic-planner.users-directory.column-order.v1";
/** Custom team slugs registered from “Add team” (no server entity; merged into combobox + filter hints). */
const USERS_DIRECTORY_EXTRA_TEAMS_STORAGE_KEY = "epic-planner.users-directory.extra-teams.v1";
const USERS_DIRECTORY_GROUP_LEVELS_STORAGE_KEY = "epic-planner.users-directory.group-levels.v1";

type UserDirectoryGroupLevel = "team" | "permission" | "status";
const USER_DIRECTORY_GROUP_LEVEL_ORDER: UserDirectoryGroupLevel[] = ["team", "permission", "status"];
const USER_DIRECTORY_GROUP_LEVEL_LABELS: Record<UserDirectoryGroupLevel, string> = {
  team: "Team",
  permission: "Permission",
  status: "Status",
};

function userDirectoryGroupLevelIcon(level: UserDirectoryGroupLevel, size: "tree" | "menu" = "tree"): ReactNode {
  const cls = size === "menu" ? "size-3.5 shrink-0 text-slate-500" : "size-4 shrink-0 text-slate-500";
  switch (level) {
    case "team":
      return <Users className={cls} strokeWidth={2} aria-hidden />;
    case "permission":
      return <PermissionFolderIcon className={cls} />;
    case "status":
      return <ListFilter className={cls} strokeWidth={2} aria-hidden />;
  }
}

/** Horizontal shift per tree depth for group folder rows and grouped user name cells (px). */
const USER_DIRECTORY_TREE_LEVEL_STEP_PX = 40;

/** When the viewport is narrower than this, the directory keeps this layout width and scrolls horizontally (aligned with roadmap right-panel floor). */
const USER_DIRECTORY_MIN_LAYOUT_WIDTH_PX = 1100;

const USER_DIRECTORY_COLUMN_LABELS: Record<SortKey, string> = {
  name: "User name",
  email: "Email",
  team: "Team",
  permission: "Permission",
  status: "Status",
};

/** With `table-fixed`, share of row width — name column gets most of the table. */
const USER_DIRECTORY_COL_WIDTH_CLASS: Record<SortKey, string> = {
  name: "w-[48%]",
  email: "w-[22%]",
  team: "w-[10%]",
  permission: "w-[12%]",
  status: "w-[8%]",
};

const USER_DIR_TH_CLASS =
  "relative w-full min-w-0 whitespace-nowrap px-3 py-2.5 text-left align-middle";

const USER_DIR_TD_BASE = "min-w-0 px-2 py-2 align-middle";

/** Drawer field captions — larger than inputs (`cellInputCn` keeps control heights unchanged). */
const USER_DRAWER_FIELD_LABEL_CLASS = "mb-1.5 block text-[15px] font-semibold text-slate-800";

function isSortKey(v: string): v is SortKey {
  return v === "name" || v === "email" || v === "team" || v === "permission" || v === "status";
}

function normalizeUserDirectoryColumnOrder(order: SortKey[]): SortKey[] {
  const seen = new Set<SortKey>();
  const next: SortKey[] = [];
  for (const k of order) {
    if (!seen.has(k)) {
      seen.add(k);
      next.push(k);
    }
  }
  for (const k of USER_DIRECTORY_DEFAULT_COLUMN_ORDER) {
    if (!seen.has(k)) next.push(k);
  }
  const nameIdx = next.indexOf("name");
  if (nameIdx > 0) {
    next.splice(nameIdx, 1);
    next.unshift("name");
  }
  return next;
}

function parseStoredUserDirectoryColumnOrder(raw: string | null): SortKey[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const keys = parsed.filter((x): x is SortKey => typeof x === "string" && isSortKey(x));
    if (keys.length === 0) return null;
    return normalizeUserDirectoryColumnOrder(keys);
  } catch {
    return null;
  }
}

const PERMISSION_FILTER_SUGGESTIONS = [...WORKSPACE_USER_PERMISSIONS] as const;

const cellInputCn =
  "h-9 w-full min-w-0 rounded-md border border-slate-200 bg-white px-2 text-[16px] outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-200/80 disabled:opacity-60";

function emptyForm() {
  return { name: "", email: "", team: "" as string, permission: "Viewer" as string };
}

function teamFilterLabel(f: string): string {
  if (f === "all") return "";
  if (f === "__none__") return "Unassigned only";
  return teamLabelForWorkspaceUser(f);
}

function parseStoredExtraTeamSlugs(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const p = JSON.parse(raw) as unknown;
    if (!Array.isArray(p)) return [];
    const out = new Set<string>();
    for (const x of p) {
      if (typeof x !== "string") continue;
      const n = normalizeWorkspaceUserTeam(x);
      if (n) out.add(n);
    }
    return [...out];
  } catch {
    return [];
  }
}

function resolveTeamFilterQuery(
  q: string,
  rows: readonly WorkspaceUserRow[],
  registeredTeamSlugs: readonly string[] = [],
): string {
  const t = q.trim().toLowerCase();
  if (!t || t === "all teams" || t === "all") return "all";
  if (t === "unassigned only" || t === "unassigned") return "__none__";
  const exact = MONTH_TEAM_COLUMNS.find((c) => c.label.toLowerCase() === t);
  if (exact) return exact.id;
  const prefix = MONTH_TEAM_COLUMNS.find((c) => c.label.toLowerCase().startsWith(t));
  if (prefix) return prefix.id;
  const byId = MONTH_TEAM_COLUMNS.find((c) => c.id.toLowerCase() === t);
  if (byId) return byId.id;

  const extras: { teamId: string; label: string }[] = [];
  const seenTeam = new Set<string>();
  for (const r of rows) {
    if (!r.team || seenTeam.has(r.team)) continue;
    seenTeam.add(r.team);
    extras.push({ teamId: r.team, label: teamLabelForWorkspaceUser(r.team) });
  }
  for (const slug of registeredTeamSlugs) {
    const n = normalizeWorkspaceUserTeam(slug);
    if (!n || seenTeam.has(n)) continue;
    seenTeam.add(n);
    extras.push({ teamId: n, label: teamLabelForWorkspaceUser(n) });
  }
  for (const { teamId, label } of extras) {
    if (label.toLowerCase() === t) return teamId;
  }
  for (const { teamId, label } of [...extras].sort((a, b) => b.label.length - a.label.length)) {
    if (label.toLowerCase().startsWith(t)) return teamId;
  }
  for (const { teamId } of extras) {
    if (teamId.toLowerCase() === t) return teamId;
  }
  return "all";
}

function permissionFilterLabel(f: PermissionFilter): string {
  if (f === "all") return "";
  return f;
}

/** True when `teamId` is a custom directory team not present on any other loaded user row. */
function shouldAnnounceNewDirectoryTeam(teamId: string, knownDirectoryTeamIds: readonly string[]): boolean {
  if (!teamId || MONTH_TEAM_IDS.includes(teamId)) return false;
  return !knownDirectoryTeamIds.includes(teamId);
}

function resolvePermissionFilterQuery(q: string): PermissionFilter {
  const t = q.trim().toLowerCase();
  if (!t || t === "all permissions" || t === "all") return "all";
  const exact = WORKSPACE_USER_PERMISSIONS.find((p) => p.toLowerCase() === t);
  if (exact) return exact;
  const prefix = WORKSPACE_USER_PERMISSIONS.find((p) => p.toLowerCase().startsWith(t));
  if (prefix) return prefix;
  return "all";
}

function compareUserRows(a: WorkspaceUserRow, b: WorkspaceUserRow, key: SortKey, dir: "asc" | "desc"): number {
  const mul = dir === "asc" ? 1 : -1;
  let cmp = 0;
  if (key === "team") {
    const va = teamLabelForWorkspaceUser(a.team).toLowerCase();
    const vb = teamLabelForWorkspaceUser(b.team).toLowerCase();
    cmp = va.localeCompare(vb);
  } else {
    const va = (key === "status" ? (a.status ?? "active") : a[key]).toLowerCase();
    const vb = (key === "status" ? (b.status ?? "active") : b[key]).toLowerCase();
    cmp = va.localeCompare(vb);
  }
  if (cmp !== 0) return cmp * mul;
  return a.id.localeCompare(b.id) * mul;
}

function formatUserStatusLabel(status: string): string {
  const s = (status || "active").trim();
  if (!s) return "Active";
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function parseStoredUserDirGroupLevels(raw: string | null): UserDirectoryGroupLevel[] {
  if (!raw) return [];
  try {
    const p = JSON.parse(raw) as unknown;
    if (!Array.isArray(p)) return [];
    const picked = new Set<UserDirectoryGroupLevel>();
    for (const x of p) {
      if (x === "team" || x === "permission" || x === "status") picked.add(x);
    }
    return USER_DIRECTORY_GROUP_LEVEL_ORDER.filter((l) => picked.has(l));
  } catch {
    return [];
  }
}

function userDirectoryRowGroupKey(
  row: WorkspaceUserRow,
  level: UserDirectoryGroupLevel,
): { key: string; label: string; sort: string } {
  if (level === "team") {
    const key = row.team || "__unassigned__";
    const label = row.team ? teamLabelForWorkspaceUser(row.team) : "Unassigned";
    return { key, label, sort: label.toLowerCase() };
  }
  if (level === "permission") {
    const perm = row.permission || "Viewer";
    return { key: perm.toLowerCase(), label: perm, sort: perm.toLowerCase() };
  }
  const raw = (row.status ?? "active").trim() || "active";
  const key = raw.toLowerCase();
  const label = formatUserStatusLabel(row.status ?? "active");
  return { key, label, sort: key };
}

function UserDirectorySortTrigger({
  label,
  col,
  sort,
  onToggle,
}: {
  label: string;
  col: SortKey;
  sort: SortState;
  onToggle: (k: SortKey) => void;
}) {
  const active = sort.key === col;
  return (
    <button
      type="button"
      onClick={() => onToggle(col)}
      className="inline-flex min-w-0 items-center gap-1.5 text-[13px] font-semibold uppercase tracking-[0.02em] text-white transition hover:text-white/95"
    >
      <span className="truncate">{label}</span>
      {active ? (
        sort.dir === "asc" ? (
          <ArrowUp className="size-3.5 shrink-0 text-white" aria-hidden />
        ) : (
          <ArrowDown className="size-3.5 shrink-0 text-white" aria-hidden />
        )
      ) : (
        <ArrowUpDown className="size-3.5 shrink-0 text-white/75" aria-hidden />
      )}
    </button>
  );
}

function UserDirectoryNameHeader({ sort, onToggle }: { sort: SortState; onToggle: (k: SortKey) => void }) {
  return (
    <th className={USER_DIR_TH_CLASS}>
      <UserDirectorySortTrigger label={USER_DIRECTORY_COLUMN_LABELS.name} col="name" sort={sort} onToggle={onToggle} />
    </th>
  );
}

function SortableUserDirectoryColumnHeader({
  id,
  sort,
  onToggle,
}: {
  id: Exclude<SortKey, "name">;
  sort: SortState;
  onToggle: (k: SortKey) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 2 : undefined,
  };
  const label = USER_DIRECTORY_COLUMN_LABELS[id];
  const centerHeader = id === "permission" || id === "status";
  return (
    <th ref={setNodeRef} style={style} className={cn(USER_DIR_TH_CLASS, centerHeader && "text-center")}>
      <div className={cn("flex w-full min-w-0 items-center gap-1", centerHeader && "justify-center")}>
        <button
          type="button"
          className="inline-flex h-5 w-5 shrink-0 touch-none cursor-grab items-center justify-center rounded outline-none hover:bg-[#0a8ec4]/45 active:cursor-grabbing"
          aria-label={`Drag to reorder ${label} column`}
          {...attributes}
          {...listeners}
        >
          <TableColumnDragGrip />
        </button>
        <UserDirectorySortTrigger label={label} col={id} sort={sort} onToggle={onToggle} />
      </div>
    </th>
  );
}

function EditCommitButtons({
  disabled,
  onSave,
  onCancel,
}: {
  disabled: boolean;
  onSave: () => void | Promise<void>;
  onCancel: () => void;
}) {
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      <button
        type="button"
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          onCancel();
        }}
        className="flex size-8 items-center justify-center rounded-md text-slate-500 ring-1 ring-slate-200/90 transition hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50"
        aria-label="Cancel edit"
      >
        <X className="size-4" aria-hidden />
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          void Promise.resolve(onSave());
        }}
        className="flex size-8 items-center justify-center rounded-md bg-emerald-600 text-white shadow-sm transition hover:bg-emerald-500 disabled:opacity-50"
        aria-label="Save"
      >
        <Check className="size-4" aria-hidden />
      </button>
    </span>
  );
}

function UsersTableRow({
  row,
  columnOrder,
  saving,
  editField,
  onEditField,
  onCancelEdit,
  onRowView,
  patchUser,
  directoryTeamIds,
  nameTreeDepth = 0,
}: {
  row: WorkspaceUserRow;
  columnOrder: SortKey[];
  saving: boolean;
  editField: UserEditField | null;
  onEditField: (field: UserEditField) => void;
  onCancelEdit: () => void;
  onRowView: (row: WorkspaceUserRow) => void;
  patchUser: (
    id: string,
    body: { name?: string; email?: string; team?: string; permission?: string },
  ) => Promise<boolean>;
  directoryTeamIds: readonly string[];
  /** Nesting depth when directory is grouped (each active group level adds one step). */
  nameTreeDepth?: number;
}) {
  const treeDepth = Math.max(0, Math.floor(Number(nameTreeDepth) || 0));
  /** Table cells need inset on the `<td>`; padding on inner flex was unreliable with table-fixed + nested groups. */
  const nameTdStyle =
    treeDepth > 0
      ? ({
          paddingLeft: `${8 + treeDepth * USER_DIRECTORY_TREE_LEVEL_STEP_PX}px`,
        } as const)
      : undefined;
  const [name, setName] = useState(row.name);
  const [email, setEmail] = useState(row.email);
  const [teamId, setTeamId] = useState(row.team);
  const [perm, setPerm] = useState(row.permission);

  useEffect(() => {
    if (editField !== "name") setName(row.name);
  }, [row.name, row.id, editField]);

  useEffect(() => {
    if (editField !== "email") setEmail(row.email);
  }, [row.email, row.id, editField]);

  useEffect(() => {
    if (editField !== "team") setTeamId(row.team);
  }, [row.team, row.id, editField]);

  useEffect(() => {
    if (editField !== "permission") setPerm(row.permission);
  }, [row.permission, row.id, editField]);

  const saveName = async () => {
    const t = name.trim();
    if (!t) {
      toast.message("Name cannot be empty.");
      return;
    }
    if (t === row.name) {
      onCancelEdit();
      return;
    }
    const ok = await patchUser(row.id, { name: t });
    if (ok) onCancelEdit();
  };

  const saveEmail = async () => {
    const t = email.trim().toLowerCase();
    if (!t) {
      toast.message("Email cannot be empty.");
      return;
    }
    if (!t.includes("@")) {
      toast.error("Enter a valid email address.");
      return;
    }
    if (t === row.email) {
      onCancelEdit();
      return;
    }
    const ok = await patchUser(row.id, { email: t });
    if (ok) onCancelEdit();
  };

  const saveTeam = async () => {
    blurActiveField();
    const normalized = normalizeWorkspaceUserTeam(teamId);
    if (normalized === row.team) {
      onCancelEdit();
      return;
    }
    const announceNewTeam = shouldAnnounceNewDirectoryTeam(normalized, directoryTeamIds);
    const ok = await patchUser(row.id, { team: normalized });
    if (ok) {
      if (announceNewTeam) {
        toast.success(`New team created: ${teamLabelForWorkspaceUser(normalized)}`);
      }
      onCancelEdit();
    }
  };

  const savePermission = async () => {
    const n = normalizeWorkspaceUserPermission(perm);
    if (n === row.permission) {
      onCancelEdit();
      return;
    }
    const ok = await patchUser(row.id, { permission: n });
    if (ok) onCancelEdit();
  };

  const editing = (f: UserEditField) => editField === f;
  const rowBusy = saving || editField != null;

  const cells: Record<SortKey, ReactNode> = {
    name: (
      <td key="name" className={USER_DIR_TD_BASE} style={nameTdStyle}>
        {editing("name") ? (
          <div className="flex min-w-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <User className="size-4 shrink-0 text-slate-500" strokeWidth={2} aria-hidden />
            <input
              value={name}
              disabled={saving}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveName();
                if (e.key === "Escape") onCancelEdit();
              }}
              className={cn(cellInputCn, "min-w-0 flex-1 font-normal text-slate-900")}
              aria-label={`Edit name for ${row.email}`}
              autoFocus
            />
            <EditCommitButtons disabled={saving} onSave={saveName} onCancel={onCancelEdit} />
          </div>
        ) : (
          <div className="flex min-w-0 items-center gap-1">
            <User className="size-4 shrink-0 text-slate-500" strokeWidth={2} aria-hidden />
            <span className="min-w-0 flex-1 truncate py-1.5 pr-1 font-normal text-slate-900">{row.name}</span>
            {!saving && editField == null ? (
              <div className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                <div onClick={(e) => e.stopPropagation()}>
                  <EditRowIconButton
                    label="Edit name"
                    onClick={() => {
                      onEditField("name");
                    }}
                  />
                </div>
              </div>
            ) : null}
          </div>
        )}
      </td>
    ),
    email: (
      <td key="email" className={USER_DIR_TD_BASE}>
        {editing("email") ? (
          <div className="flex min-w-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <input
              type="email"
              value={email}
              disabled={saving}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveEmail();
                if (e.key === "Escape") onCancelEdit();
              }}
              className={cn(cellInputCn, "min-w-0 flex-1")}
              aria-label={`Edit email for ${row.name}`}
              autoFocus
            />
            <EditCommitButtons disabled={saving} onSave={saveEmail} onCancel={onCancelEdit} />
          </div>
        ) : (
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 flex-1 break-all px-1 py-1.5 text-violet-700 underline decoration-violet-200 underline-offset-2">
              {row.email}
            </span>
            {!saving && editField == null ? (
              <div className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                <div onClick={(e) => e.stopPropagation()}>
                  <EditRowIconButton label="Edit email" onClick={() => onEditField("email")} />
                </div>
              </div>
            ) : null}
          </div>
        )}
      </td>
    ),
    team: (
      <td key="team" className={USER_DIR_TD_BASE}>
        {editing("team") ? (
          <div className="flex min-w-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <div className="min-w-0 flex-1">
              <TeamIdCombobox
                teamId={teamId}
                onTeamIdChange={setTeamId}
                disabled={saving}
                placeholder="Pick a team or create new…"
                className={cellInputCn}
                allowCustomTeam
                extraTeamIds={directoryTeamIds}
              />
            </div>
            <EditCommitButtons disabled={saving} onSave={saveTeam} onCancel={onCancelEdit} />
          </div>
        ) : (
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 flex-1 px-1 py-1.5">
              {row.team ? (
                <span
                  className={cn(
                    "inline-flex rounded-full px-2.5 py-0.5 text-[13px] font-semibold leading-tight ring-1",
                    row.team === "platform" && "bg-sky-50 text-sky-800 ring-sky-200/80",
                    row.team === "experience" && "bg-violet-50 text-violet-800 ring-violet-200/80",
                    row.team === "data" && "bg-amber-50 text-amber-900 ring-amber-200/80",
                    row.team !== "platform" &&
                      row.team !== "experience" &&
                      row.team !== "data" &&
                      "bg-slate-50 text-slate-800 ring-slate-200/80",
                  )}
                >
                  {teamLabelForWorkspaceUser(row.team)}
                </span>
              ) : (
                <span className="text-[13px] text-slate-400">Unassigned</span>
              )}
            </span>
            {!saving && editField == null ? (
              <div className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                <div onClick={(e) => e.stopPropagation()}>
                  <EditRowIconButton label="Edit team" onClick={() => onEditField("team")} />
                </div>
              </div>
            ) : null}
          </div>
        )}
      </td>
    ),
    permission: (
      <td key="permission" className={cn(USER_DIR_TD_BASE, "text-center")}>
        {editing("permission") ? (
          <div
            className="flex min-w-0 flex-wrap items-center justify-center gap-1"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="min-w-0 w-full max-w-[240px] sm:max-w-[280px]">
              <AssigneeCombobox
                value={perm}
                onChange={setPerm}
                suggestions={WORKSPACE_USER_PERMISSIONS}
                disabled={saving}
                placeholder="Permission…"
                aria-label={`Edit permission for ${row.name}`}
                className={cellInputCn}
              />
            </div>
            <EditCommitButtons disabled={saving} onSave={savePermission} onCancel={onCancelEdit} />
          </div>
        ) : (
          <div className="flex min-w-0 items-center justify-center gap-2">
            <span className="min-w-0 truncate px-1 py-1.5 text-center font-medium text-slate-700">{row.permission}</span>
            {!saving && editField == null ? (
              <div className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                <div onClick={(e) => e.stopPropagation()}>
                  <EditRowIconButton label="Edit permission" onClick={() => onEditField("permission")} />
                </div>
              </div>
            ) : null}
          </div>
        )}
      </td>
    ),
    status: (
      <td key="status" className={cn(USER_DIR_TD_BASE, "whitespace-nowrap text-center")}>
        <span
          className="inline-flex rounded-full bg-emerald-50 px-2.5 py-0.5 text-[13px] font-semibold leading-tight text-emerald-900 ring-1 ring-emerald-200/90"
          title="Status is managed by the system"
        >
          {formatUserStatusLabel(row.status ?? "active")}
        </span>
      </td>
    ),
  };

  return (
    <tr
      data-users-zebra-row="true"
      className={cn(
        "group border-t border-[#7cd3f7]/95 text-[16px] text-slate-800 transition-colors hover:bg-[#c5ebff]",
        saving && "opacity-70",
        !rowBusy && "cursor-pointer",
      )}
      onClick={() => {
        if (rowBusy) return;
        onRowView(row);
      }}
    >
      {columnOrder.map((col) => cells[col])}
    </tr>
  );
}

type UserPanelState = { kind: "add" } | { kind: "view"; user: WorkspaceUserRow };

export function UsersWorkspacePanel() {
  const [rows, setRows] = useState<WorkspaceUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState("");
  const [searchSuggestOpen, setSearchSuggestOpen] = useState(false);
  const searchFieldWrapRef = useRef<HTMLDivElement>(null);
  const [teamFilter, setTeamFilter] = useState<string>("all");
  const [permissionFilter, setPermissionFilter] = useState<PermissionFilter>("all");
  const [teamFilterInput, setTeamFilterInput] = useState("");
  const [permFilterInput, setPermFilterInput] = useState("");
  const [userPanel, setUserPanel] = useState<UserPanelState | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [savingRowIds, setSavingRowIds] = useState<Set<string>>(() => new Set());
  const [editCell, setEditCell] = useState<{ rowId: string; field: UserEditField } | null>(null);
  const [sort, setSort] = useState<SortState>({ key: "name", dir: "asc" });
  const [columnOrder, setColumnOrder] = useState<SortKey[]>(() => [...USER_DIRECTORY_DEFAULT_COLUMN_ORDER]);
  const [userDrawerEntered, setUserDrawerEntered] = useState(false);
  const userDrawerCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextUserDirColumnPersist = useRef(true);
  const [registeredTeamSlugs, setRegisteredTeamSlugs] = useState<string[]>([]);
  const [addTeamOpen, setAddTeamOpen] = useState(false);
  const [newTeamNameInput, setNewTeamNameInput] = useState("");
  const [userDirGroupLevels, setUserDirGroupLevels] = useState<UserDirectoryGroupLevel[]>([]);
  const [userDirOpenGroups, setUserDirOpenGroups] = useState<Record<string, boolean>>({});
  const [userDirGroupMenuOpen, setUserDirGroupMenuOpen] = useState(false);
  const userDirGroupMenuRef = useRef<HTMLDivElement>(null);
  const userDirZebraTbodyRef = useRef<HTMLTableSectionElement>(null);
  const skipNextUserDirGroupPersist = useRef(true);
  const defaultUserDirGroupExpanded = true;

  const cancelDrawerClose = useCallback(() => {
    if (userDrawerCloseTimerRef.current) {
      clearTimeout(userDrawerCloseTimerRef.current);
      userDrawerCloseTimerRef.current = null;
    }
  }, []);

  const viewUser =
    userPanel?.kind === "view" ? (rows.find((r) => r.id === userPanel.user.id) ?? userPanel.user) : null;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (teamFilter !== "all") params.set("team", teamFilter);
      if (permissionFilter !== "all") params.set("permission", permissionFilter);
      const res = await fetch(`/api/workspace-users?${params.toString()}`);
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as WorkspaceUserRow[];
      setRows(data);
    } catch (e) {
      console.error(e);
      toast.error("Failed to load users");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [teamFilter, permissionFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const stored = parseStoredUserDirectoryColumnOrder(
      localStorage.getItem(USERS_DIRECTORY_COLUMN_ORDER_STORAGE_KEY),
    );
    if (stored) setColumnOrder(stored);
  }, []);

  useEffect(() => {
    setRegisteredTeamSlugs(parseStoredExtraTeamSlugs(localStorage.getItem(USERS_DIRECTORY_EXTRA_TEAMS_STORAGE_KEY)));
  }, []);

  useEffect(() => {
    const stored = parseStoredUserDirGroupLevels(localStorage.getItem(USERS_DIRECTORY_GROUP_LEVELS_STORAGE_KEY));
    if (stored.length > 0) setUserDirGroupLevels(stored);
  }, []);

  useEffect(() => {
    if (skipNextUserDirGroupPersist.current) {
      skipNextUserDirGroupPersist.current = false;
      return;
    }
    localStorage.setItem(USERS_DIRECTORY_GROUP_LEVELS_STORAGE_KEY, JSON.stringify(userDirGroupLevels));
  }, [userDirGroupLevels]);

  useEffect(() => {
    if (!userDirGroupMenuOpen) return;
    const fn = (e: MouseEvent) => {
      if (userDirGroupMenuRef.current?.contains(e.target as Node)) return;
      setUserDirGroupMenuOpen(false);
    };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, [userDirGroupMenuOpen]);

  const persistRegisteredTeamSlugs = useCallback((next: string[]) => {
    const merged = [...new Set(next.filter(Boolean))];
    localStorage.setItem(USERS_DIRECTORY_EXTRA_TEAMS_STORAGE_KEY, JSON.stringify(merged));
    setRegisteredTeamSlugs(merged);
  }, []);

  const saveRegisteredTeamFromModal = useCallback(() => {
    const slug = normalizeWorkspaceUserTeam(newTeamNameInput);
    if (!slug) {
      toast.error("Enter a valid team name (use letters or numbers).");
      return;
    }
    if (MONTH_TEAM_IDS.includes(slug)) {
      toast.message(
        "That name matches a built-in delivery team. Choose Platform, Experience, or Data & analytics when editing users.",
      );
      setAddTeamOpen(false);
      setNewTeamNameInput("");
      return;
    }
    if (registeredTeamSlugs.includes(slug)) {
      toast.message(`“${teamLabelForWorkspaceUser(slug)}” is already on your team list.`);
      setAddTeamOpen(false);
      setNewTeamNameInput("");
      return;
    }
    persistRegisteredTeamSlugs([...registeredTeamSlugs, slug]);
    toast.success(
      `Team “${teamLabelForWorkspaceUser(slug)}” added. It appears in team fields—assign users when you add or edit them.`,
    );
    setAddTeamOpen(false);
    setNewTeamNameInput("");
  }, [newTeamNameInput, persistRegisteredTeamSlugs, registeredTeamSlugs]);

  useEffect(() => {
    if (skipNextUserDirColumnPersist.current) {
      skipNextUserDirColumnPersist.current = false;
      return;
    }
    localStorage.setItem(USERS_DIRECTORY_COLUMN_ORDER_STORAGE_KEY, JSON.stringify(columnOrder));
  }, [columnOrder]);

  useEffect(() => {
    setTeamFilterInput(teamFilterLabel(teamFilter));
  }, [teamFilter]);

  useEffect(() => {
    setPermFilterInput(permissionFilterLabel(permissionFilter));
  }, [permissionFilter]);

  useLayoutEffect(() => {
    if (!userPanel) {
      setUserDrawerEntered(false);
      return;
    }
    cancelDrawerClose();
    setUserDrawerEntered(false);
    let alive = true;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (alive) setUserDrawerEntered(true);
      });
    });
    return () => {
      alive = false;
    };
  }, [userPanel, cancelDrawerClose]);

  useEffect(() => {
    return () => {
      if (userDrawerCloseTimerRef.current) clearTimeout(userDrawerCloseTimerRef.current);
    };
  }, []);

  const toggleSort = useCallback((key: SortKey) => {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  }, []);

  const toggleUserDirGroupLevel = useCallback((level: UserDirectoryGroupLevel) => {
    setUserDirGroupLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return USER_DIRECTORY_GROUP_LEVEL_ORDER.filter((l) => next.has(l));
    });
  }, []);

  const userDirGroupSummaryLabel = useMemo(
    () =>
      userDirGroupLevels.length === 0
        ? "None"
        : userDirGroupLevels.map((l) => USER_DIRECTORY_GROUP_LEVEL_LABELS[l]).join(" · "),
    [userDirGroupLevels],
  );

  const userDirColumnDragSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleUserDirectoryColumnDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const aid = active.id as SortKey;
    const oid = over.id as SortKey;
    if (aid === "name" || oid === "name") return;
    setColumnOrder((prev) => {
      const oldIndex = prev.indexOf(aid);
      const newIndex = prev.indexOf(oid);
      if (oldIndex < 0 || newIndex < 0) return prev;
      return normalizeUserDirectoryColumnOrder(arrayMove(prev, oldIndex, newIndex));
    });
  }, []);

  const patchUser = useCallback(
    async (id: string, body: { name?: string; email?: string; team?: string; permission?: string }) => {
      if (Object.keys(body).length === 0) return true;
      setSavingRowIds((s) => new Set(s).add(id));
      try {
        const res = await fetch(`/api/workspace-users/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await res.json()) as { error?: string } & Partial<WorkspaceUserRow>;
        if (!res.ok) {
          throw new Error(data.error ?? res.statusText);
        }
        const updated = data as WorkspaceUserRow;
        setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...updated } : r)));
        return true;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Update failed");
        await load();
        return false;
      } finally {
        setSavingRowIds((s) => {
          const n = new Set(s);
          n.delete(id);
          return n;
        });
      }
    },
    [load],
  );

  const q = searchText.trim().toLowerCase();
  const displayed = useMemo(() => {
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q) ||
        r.permission.toLowerCase().includes(q) ||
        teamLabelForWorkspaceUser(r.team).toLowerCase().includes(q) ||
        (r.status ?? "active").toLowerCase().includes(q),
    );
  }, [rows, q]);

  const sortedRows = useMemo(() => {
    const list = [...displayed];
    list.sort((a, b) => compareUserRows(a, b, sort.key, sort.dir));
    return list;
  }, [displayed, sort]);

  const directoryTeamIds = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) {
      if (r.team) s.add(r.team);
    }
    for (const slug of registeredTeamSlugs) {
      const n = normalizeWorkspaceUserTeam(slug);
      if (n) s.add(n);
    }
    return [...s];
  }, [rows, registeredTeamSlugs]);

  const userDirectoryTableRows = useMemo(() => {
    const renderLeaf = (list: WorkspaceUserRow[], nameTreeDepth: number) =>
      list.map((row) => (
        <UsersTableRow
          key={row.id}
          row={row}
          columnOrder={columnOrder}
          saving={savingRowIds.has(row.id)}
          editField={editCell?.rowId === row.id ? editCell.field : null}
          onEditField={(field) => setEditCell({ rowId: row.id, field })}
          onCancelEdit={() => setEditCell(null)}
          onRowView={(r) => {
            setEditCell(null);
            cancelDrawerClose();
            setForm({
              name: r.name,
              email: r.email,
              team: r.team,
              permission: r.permission,
            });
            setUserPanel({ kind: "view", user: r });
          }}
          patchUser={patchUser}
          directoryTeamIds={directoryTeamIds}
          nameTreeDepth={nameTreeDepth}
        />
      ));

    const renderTree = (list: WorkspaceUserRow[], levelIndex: number, path: string): ReactNode => {
      if (userDirGroupLevels.length === 0) return renderLeaf(list, 0);
      if (levelIndex >= userDirGroupLevels.length) {
        return renderLeaf(list, userDirGroupLevels.length);
      }
      const level = userDirGroupLevels[levelIndex];
      const groups = new Map<string, { label: string; sort: string; rows: WorkspaceUserRow[] }>();
      for (const row of list) {
        const { key, label, sort: sortKey } = userDirectoryRowGroupKey(row, level);
        if (!groups.has(key)) groups.set(key, { label, sort: sortKey, rows: [] });
        groups.get(key)!.rows.push(row);
      }
      return (
        <>
          {Array.from(groups.entries())
            .sort((a, b) => a[1].sort.localeCompare(b[1].sort))
            .map(([key, g]) => {
              const folderId = `${path}/${level}:${encodeURIComponent(key)}`;
              const isOpen = userDirOpenGroups[folderId] ?? defaultUserDirGroupExpanded;
              const indent = 8 + levelIndex * USER_DIRECTORY_TREE_LEVEL_STEP_PX;
              return (
                <Fragment key={folderId}>
                  <tr
                    data-users-zebra-row="true"
                    className="border-t border-[#7cd3f7]/95 text-[15px] text-slate-800"
                  >
                    <td colSpan={columnOrder.length} className="px-2 py-1.5">
                      <button
                        type="button"
                        className="flex min-w-0 max-w-full items-center gap-1.5 text-left font-semibold text-slate-800"
                        style={{ paddingLeft: indent }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setUserDirOpenGroups((prev) => ({
                            ...prev,
                            [folderId]: !(prev[folderId] ?? defaultUserDirGroupExpanded),
                          }));
                        }}
                      >
                        {isOpen ? (
                          <ChevronDown className="size-4 shrink-0 text-slate-600" aria-hidden />
                        ) : (
                          <ChevronRight className="size-4 shrink-0 text-slate-600" aria-hidden />
                        )}
                        {userDirectoryGroupLevelIcon(level)}
                        <span className="shrink-0 text-slate-600">{USER_DIRECTORY_GROUP_LEVEL_LABELS[level]}:</span>
                        <span className="min-w-0 truncate">{g.label}</span>
                        <span className="shrink-0 text-[12px] font-normal tabular-nums text-slate-500">
                          ({g.rows.length})
                        </span>
                      </button>
                    </td>
                  </tr>
                  {isOpen ? renderTree(g.rows, levelIndex + 1, folderId) : null}
                </Fragment>
              );
            })}
        </>
      );
    };

    return userDirGroupLevels.length === 0 ? (
      <>{renderLeaf(sortedRows, 0)}</>
    ) : (
      <>{renderTree(sortedRows, 0, "root")}</>
    );
  }, [
    sortedRows,
    userDirGroupLevels,
    userDirOpenGroups,
    columnOrder,
    savingRowIds,
    editCell,
    patchUser,
    directoryTeamIds,
    cancelDrawerClose,
  ]);

  useLayoutEffect(() => {
    const root = userDirZebraTbodyRef.current;
    if (!root) return;
    const rowEls = Array.from(root.querySelectorAll<HTMLElement>('[data-users-zebra-row="true"]'));
    rowEls.forEach((el, idx) => {
      el.style.backgroundColor = idx % 2 === 0 ? TABLE_ZEBRA_STRIPE_BG : TABLE_ZEBRA_BASE_BG;
    });
  }, [userDirectoryTableRows, loading, columnOrder]);

  const teamFilterSuggestions = useMemo(() => {
    const base = MONTH_TEAM_COLUMNS.map((c) => c.label);
    const seen = new Set(base.map((l) => l.toLowerCase()));
    const rest: string[] = [];
    for (const r of rows) {
      if (!r.team) continue;
      const lab = teamLabelForWorkspaceUser(r.team);
      if (lab === "—") continue;
      const k = lab.toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        rest.push(lab);
      }
    }
    for (const slug of registeredTeamSlugs) {
      const lab = teamLabelForWorkspaceUser(slug);
      if (lab === "—") continue;
      const k = lab.toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        rest.push(lab);
      }
    }
    rest.sort((a, b) => a.localeCompare(b));
    return [...base, ...rest, "Unassigned only"];
  }, [rows, registeredTeamSlugs]);

  const nameSuggestions = useMemo(() => {
    const s = new Set<string>();
    for (const r of displayed.slice(0, 40)) s.add(r.name);
    return [...s].sort();
  }, [displayed]);

  const closeSearchSuggestions = useCallback(() => {
    setSearchSuggestOpen(false);
  }, []);

  const handleDirectorySearchBlur = useCallback((event: FocusEvent<HTMLInputElement>) => {
    const next = event.relatedTarget as Node | null;
    if (next && searchFieldWrapRef.current?.contains(next)) return;
    window.requestAnimationFrame(() => {
      const active = document.activeElement;
      if (searchFieldWrapRef.current?.contains(active)) return;
      setSearchSuggestOpen(false);
    });
  }, []);

  const closePanel = useCallback(() => {
    if (!userPanel) {
      cancelDrawerClose();
      return;
    }
    setUserDrawerEntered(false);
    cancelDrawerClose();
    userDrawerCloseTimerRef.current = setTimeout(() => {
      userDrawerCloseTimerRef.current = null;
      setUserPanel(null);
      setForm(emptyForm());
      setUserDrawerEntered(false);
    }, 300);
  }, [userPanel, cancelDrawerClose]);

  const openCreate = () => {
    cancelDrawerClose();
    setForm(emptyForm());
    setUserPanel({ kind: "add" });
  };

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (addTeamOpen) {
        setAddTeamOpen(false);
        return;
      }
      if (editCell) {
        setEditCell(null);
        return;
      }
      if (userPanel) {
        if (saving) return;
        closePanel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [addTeamOpen, editCell, userPanel, saving, closePanel]);

  const handleSearchKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Escape" && searchSuggestOpen) {
        event.preventDefault();
        setSearchSuggestOpen(false);
      }
    },
    [searchSuggestOpen],
  );

  const saveNewUser = async () => {
    blurActiveField();
    const name = form.name.trim();
    const email = form.email.trim().toLowerCase();
    if (!name || !email) {
      toast.message("Name and email are required.");
      return;
    }
    if (!email.includes("@")) {
      toast.error("Enter a valid email address.");
      return;
    }
    const permission = normalizeWorkspaceUserPermission(form.permission);
    const nextTeam = normalizeWorkspaceUserTeam(form.team || "");
    const announceNewTeam = shouldAnnounceNewDirectoryTeam(nextTeam, directoryTeamIds);
    setSaving(true);
    try {
      const res = await fetch("/api/workspace-users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          team: nextTeam,
          permission,
        }),
      });
      const err = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      toast.success(
        announceNewTeam ? `User added · New team: ${teamLabelForWorkspaceUser(nextTeam)}` : "User added",
      );
      closePanel();
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const saveEditedUser = async () => {
    if (!viewUser) return;
    blurActiveField();
    const name = form.name.trim();
    const email = form.email.trim().toLowerCase();
    if (!name || !email) {
      toast.message("Name and email are required.");
      return;
    }
    if (!email.includes("@")) {
      toast.error("Enter a valid email address.");
      return;
    }
    const permission = normalizeWorkspaceUserPermission(form.permission);
    const body: { name?: string; email?: string; team?: string; permission?: string } = {};
    if (name !== viewUser.name) body.name = name;
    if (email !== viewUser.email) body.email = email;
    const nextTeam = normalizeWorkspaceUserTeam(form.team || "");
    const prevTeamNorm = normalizeWorkspaceUserTeam(viewUser.team || "");
    const teamChanged = nextTeam !== prevTeamNorm;
    if (teamChanged) body.team = nextTeam;
    if (permission !== viewUser.permission) body.permission = permission;
    const announceNewTeam =
      teamChanged && shouldAnnounceNewDirectoryTeam(nextTeam, directoryTeamIds);
    if (Object.keys(body).length === 0) {
      closePanel();
      return;
    }
    setSaving(true);
    try {
      const ok = await patchUser(viewUser.id, body);
      if (ok) {
        toast.success(
          announceNewTeam
            ? `User updated · New team: ${teamLabelForWorkspaceUser(nextTeam)}`
            : "User updated",
        );
        closePanel();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 min-w-0 flex-1 overflow-x-auto [scrollbar-gutter:stable]">
        <div
          className="box-border flex h-full min-h-0 w-full min-w-full flex-col gap-5 p-6 sm:p-8"
          style={{ minWidth: `max(100%, ${USER_DIRECTORY_MIN_LAYOUT_WIDTH_PX}px)` }}
        >
      <header className="flex shrink-0 flex-col gap-4 border-b border-slate-200/90 pb-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight text-slate-900">
            <span
              className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700 ring-1 ring-violet-200/80"
              aria-hidden
            >
              <Users className="size-5" />
            </span>
            Users Directory
          </h1>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setNewTeamNameInput("");
              setAddTeamOpen(true);
            }}
            className="h-8 shrink-0 gap-1.5 px-3 text-[13px] font-semibold"
          >
            <Tag className="size-3.5" aria-hidden />
            Add team
          </Button>
          <Button type="button" size="sm" onClick={openCreate} className="h-8 shrink-0 gap-1.5 px-3 text-[13px] font-bold">
            <Plus className="size-3.5" aria-hidden />
            Add User
          </Button>
        </div>
      </header>

      <div className="flex shrink-0 flex-col gap-3 pb-8 lg:flex-row lg:items-center lg:gap-3">
        <div ref={searchFieldWrapRef} className="relative min-w-0 w-full flex-1 lg:max-w-md">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 z-[1] size-4 -translate-y-1/2 text-slate-400"
            aria-hidden
          />
          <input
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            onFocus={() => setSearchSuggestOpen(true)}
            onBlur={handleDirectorySearchBlur}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search name, email, team, or permission…"
            className="relative z-[1] h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3 text-[14px] text-slate-900 shadow-sm outline-none ring-slate-200/80 transition placeholder:text-slate-400 focus:border-violet-300 focus:ring-2 focus:ring-violet-200/80"
            aria-label="Search users"
            aria-controls="users-directory-name-suggestions"
            aria-expanded={searchSuggestOpen && nameSuggestions.length > 0}
            aria-autocomplete="list"
            aria-haspopup="listbox"
            role="combobox"
            autoComplete="off"
          />
          {searchSuggestOpen && nameSuggestions.length > 0 ? (
            <div
              id="users-directory-name-suggestions"
              role="listbox"
              className="absolute left-0 right-0 top-full z-[70] mt-1 max-h-60 overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg ring-1 ring-slate-200/90"
            >
              {nameSuggestions.map((n) => (
                <button
                  key={n}
                  type="button"
                  role="option"
                  className="flex w-full items-center px-3 py-2 text-left text-[14px] text-slate-800 hover:bg-slate-50"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setSearchText(n);
                    closeSearchSuggestions();
                  }}
                >
                  {n}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-full min-w-[160px] max-w-[220px] shrink-0 sm:w-[200px]">
            <AssigneeCombobox
              value={teamFilterInput}
              onChange={setTeamFilterInput}
              suggestions={teamFilterSuggestions}
              placeholder="All Teams"
              aria-label="Filter by team"
              className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] shadow-sm outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-200/80"
              onSuggestionPick={(s) => {
                const next = resolveTeamFilterQuery(s, rows, registeredTeamSlugs);
                setTeamFilter(next);
                setTeamFilterInput(teamFilterLabel(next));
              }}
              onInputBlur={(v) => {
                const next = resolveTeamFilterQuery(v, rows, registeredTeamSlugs);
                setTeamFilter(next);
                setTeamFilterInput(teamFilterLabel(next));
              }}
            />
          </div>
          <div className="w-full min-w-[160px] max-w-[220px] shrink-0 sm:w-[200px]">
            <AssigneeCombobox
              value={permFilterInput}
              onChange={setPermFilterInput}
              suggestions={PERMISSION_FILTER_SUGGESTIONS}
              placeholder="All Permissions"
              aria-label="Filter by permission"
              className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] shadow-sm outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-200/80"
              onSuggestionPick={(s) => {
                const next = resolvePermissionFilterQuery(s);
                setPermissionFilter(next);
                setPermFilterInput(permissionFilterLabel(next));
              }}
              onInputBlur={(v) => {
                const next = resolvePermissionFilterQuery(v);
                setPermissionFilter(next);
                setPermFilterInput(permissionFilterLabel(next));
              }}
            />
          </div>
          <div className="relative h-10 shrink-0" ref={userDirGroupMenuRef}>
            <button
              type="button"
              onClick={() => setUserDirGroupMenuOpen((prev) => !prev)}
              className="flex h-10 min-w-[11rem] items-center justify-between rounded-lg bg-gradient-to-b from-indigo-50 to-violet-50 px-2.5 text-[13px] shadow-sm transition hover:from-indigo-100 hover:to-violet-100"
            >
              <span className="inline-flex items-center gap-1.5 font-semibold text-slate-700">
                <Layers3 className="size-3.5 text-indigo-500/90" strokeWidth={2} aria-hidden />
                Group by
              </span>
              <span className="ml-1 max-w-[7rem] truncate font-medium text-slate-600">{userDirGroupSummaryLabel}</span>
            </button>
            {userDirGroupMenuOpen ? (
              <div className="absolute left-0 z-20 mt-1 w-56 rounded-lg border border-slate-100 bg-white p-2 shadow-lg">
                {USER_DIRECTORY_GROUP_LEVEL_ORDER.map((level) => {
                  const checked = userDirGroupLevels.includes(level);
                  return (
                    <label
                      key={level}
                      className="mb-1 flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[13px] text-slate-700 last:mb-0"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleUserDirGroupLevel(level)}
                        className="h-3.5 w-3.5 rounded border-slate-300 accent-violet-600"
                      />
                      {userDirectoryGroupLevelIcon(level, "menu")}
                      {USER_DIRECTORY_GROUP_LEVEL_LABELS[level]}
                    </label>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden rounded-md bg-white">
        <div className="h-full min-h-0 overflow-auto text-[16px]">
          <DndContext
            sensors={userDirColumnDragSensors}
            collisionDetection={closestCenter}
            onDragEnd={handleUserDirectoryColumnDragEnd}
          >
            <table className="w-full min-w-[640px] table-fixed border-collapse text-left">
              <colgroup>
                {columnOrder.map((key) => (
                  <col key={key} className={USER_DIRECTORY_COL_WIDTH_CLASS[key]} />
                ))}
              </colgroup>
              <SortableContext
                items={columnOrder.filter((k) => k !== "name")}
                strategy={horizontalListSortingStrategy}
              >
                <thead className="sticky top-0 z-10 border-b border-[#19abeb]/70 bg-[#0897d5] shadow-[0_1px_0_rgba(15,23,42,0.04)]">
                  <tr>
                    {columnOrder.map((key) =>
                      key === "name" ? (
                        <UserDirectoryNameHeader key={key} sort={sort} onToggle={toggleSort} />
                      ) : (
                        <SortableUserDirectoryColumnHeader key={key} id={key} sort={sort} onToggle={toggleSort} />
                      ),
                    )}
                  </tr>
                </thead>
              </SortableContext>
              <tbody ref={userDirZebraTbodyRef} className="bg-white">
            {loading ? (
              <tr>
                <td colSpan={columnOrder.length} className="px-4 py-16 text-center text-slate-500">
                  Loading users…
                </td>
              </tr>
            ) : sortedRows.length === 0 ? (
              <tr>
                <td colSpan={columnOrder.length} className="px-4 py-16 text-center text-slate-500">
                  No users match the current filters.
                </td>
              </tr>
            ) : (
              userDirectoryTableRows
            )}
              </tbody>
            </table>
          </DndContext>
        </div>
      </div>

      <p className="shrink-0 text-center text-[12px] text-slate-500">
        Showing {sortedRows.length} of {rows.length} loaded
        {teamFilter !== "all" || permissionFilter !== "all" ? " (server-filtered)" : ""}
        {q ? " · search narrows further in the browser" : ""}
        {` · sorted by ${sort.key} (${sort.dir})`}
        {userDirGroupLevels.length > 0 ? ` · grouped by ${userDirGroupSummaryLabel}` : ""}
      </p>
        </div>
      </div>

      {userPanel ? (
        <div className="fixed inset-0 z-[100] flex justify-end">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/30 backdrop-blur-[1px]"
            aria-label="Close panel"
            onClick={closePanel}
          />
          <div
            className={cn(
              "relative flex h-full w-full max-w-2xl flex-col overflow-hidden border-l border-slate-200/90 bg-white shadow-2xl ring-1 ring-black/[0.06] transition-transform duration-300 ease-out rounded-l-xl",
              userDrawerEntered ? "translate-x-0" : "translate-x-full",
            )}
            role="dialog"
            aria-modal="true"
            aria-labelledby="users-drawer-title"
          >
            {userPanel.kind === "add" ? (
              <>
                <div className="flex shrink-0 flex-col border-b border-slate-200 bg-slate-50">
                  <div className="flex items-start justify-between gap-3 px-5 py-4">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <span
                        className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700 ring-1 ring-violet-200/80"
                        aria-hidden
                      >
                        <UserPlus className="size-5" strokeWidth={2} />
                      </span>
                      <div className="min-w-0">
                        <h2 id="users-drawer-title" className="text-xl font-semibold tracking-tight text-slate-900">
                          Add User
                        </h2>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={closePanel}
                      aria-label="Close panel"
                      disabled={saving}
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                </div>
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                  <div className="flex-1 overflow-y-auto p-5">
                    <div className="w-full max-w-[400px] space-y-4">
                      <label className="block">
                        <span className={USER_DRAWER_FIELD_LABEL_CLASS}>Name</span>
                        <input
                          value={form.name}
                          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                          className="h-10 w-full rounded-lg border border-slate-200 px-3 text-[13px] outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-200/80"
                          autoComplete="name"
                        />
                      </label>
                      <label className="block">
                        <span className={USER_DRAWER_FIELD_LABEL_CLASS}>Email</span>
                        <input
                          type="email"
                          value={form.email}
                          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                          className="h-10 w-full rounded-lg border border-slate-200 px-3 text-[13px] outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-200/80"
                          autoComplete="email"
                        />
                      </label>
                      <div className="block">
                        <span className={USER_DRAWER_FIELD_LABEL_CLASS}>Team</span>
                        <TeamIdCombobox
                          teamId={form.team}
                          onTeamIdChange={(id) => setForm((f) => ({ ...f, team: id }))}
                          disabled={saving}
                          placeholder="Pick a team or create new (optional)"
                          className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-200/80"
                          allowCustomTeam
                          extraTeamIds={directoryTeamIds}
                        />
                      </div>
                      <div className="block">
                        <span className={USER_DRAWER_FIELD_LABEL_CLASS}>Permission</span>
                        <AssigneeCombobox
                          value={form.permission}
                          onChange={(permission) => setForm((f) => ({ ...f, permission }))}
                          suggestions={WORKSPACE_USER_PERMISSIONS}
                          disabled={saving}
                          placeholder="Type or pick a permission"
                          aria-label="Permission"
                          className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-200/80"
                        />
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-white px-5 py-4">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 min-w-[100px] px-4 text-sm font-medium"
                      onClick={closePanel}
                      disabled={saving}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      className="h-8 min-w-[100px] gap-1.5 bg-gradient-to-r from-violet-600 to-indigo-600 px-4 text-sm font-semibold text-white shadow-sm shadow-violet-500/25 hover:from-violet-500 hover:to-indigo-500 disabled:opacity-50"
                      onClick={() => void saveNewUser()}
                      disabled={saving}
                    >
                      {saving ? "Saving…" : "Add User"}
                    </Button>
                  </div>
                </div>
              </>
            ) : viewUser ? (
              <>
                <div className="flex shrink-0 flex-col border-b border-slate-200 bg-slate-50">
                  <div className="flex items-center justify-between gap-3 px-5 py-4">
                    <div className="flex min-w-0 flex-1 items-center gap-2.5">
                      <span
                        className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700 ring-1 ring-violet-200/80"
                        aria-hidden
                      >
                        <UserPen className="size-4" strokeWidth={2} />
                      </span>
                      <div className="min-w-0 text-left">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 id="users-drawer-title" className="text-xl font-semibold tracking-tight text-slate-900">
                            Edit User
                          </h2>
                          <span
                            className="inline-flex rounded-full bg-emerald-50 px-2.5 py-0.5 text-[13px] font-semibold text-emerald-900 ring-1 ring-emerald-200/90"
                            aria-label={`Account status: ${formatUserStatusLabel(viewUser.status ?? "active")}`}
                          >
                            {formatUserStatusLabel(viewUser.status ?? "active")}
                          </span>
                        </div>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={closePanel}
                      aria-label="Close panel"
                      disabled={saving}
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                </div>
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                  <div className="flex-1 overflow-y-auto p-5">
                    <div className="w-full max-w-[400px] space-y-4">
                      <label className="block">
                        <span className={USER_DRAWER_FIELD_LABEL_CLASS}>Name</span>
                        <input
                          value={form.name}
                          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                          className="h-10 w-full rounded-lg border border-slate-200 px-3 text-[13px] outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-200/80"
                          autoComplete="name"
                        />
                      </label>
                      <label className="block">
                        <span className={USER_DRAWER_FIELD_LABEL_CLASS}>Email</span>
                        <input
                          type="email"
                          value={form.email}
                          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                          className="h-10 w-full rounded-lg border border-slate-200 px-3 text-[13px] outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-200/80"
                          autoComplete="email"
                        />
                      </label>
                      <div className="block">
                        <span className={USER_DRAWER_FIELD_LABEL_CLASS}>Team</span>
                        <TeamIdCombobox
                          teamId={form.team}
                          onTeamIdChange={(id) => setForm((f) => ({ ...f, team: id }))}
                          disabled={saving}
                          placeholder="Pick a team or create new (optional)"
                          className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-200/80"
                          allowCustomTeam
                          extraTeamIds={directoryTeamIds}
                        />
                      </div>
                      <div className="block">
                        <span className={USER_DRAWER_FIELD_LABEL_CLASS}>Permission</span>
                        <AssigneeCombobox
                          value={form.permission}
                          onChange={(permission) => setForm((f) => ({ ...f, permission }))}
                          suggestions={WORKSPACE_USER_PERMISSIONS}
                          disabled={saving}
                          placeholder="Type or pick a permission"
                          aria-label="Permission"
                          className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-200/80"
                        />
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-white px-5 py-4">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 min-w-[100px] px-4 text-sm font-medium"
                      onClick={closePanel}
                      disabled={saving}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      className="h-8 min-w-[100px] gap-1.5 bg-gradient-to-r from-violet-600 to-indigo-600 px-4 text-sm font-semibold text-white shadow-sm shadow-violet-500/25 hover:from-violet-500 hover:to-indigo-500 disabled:opacity-50"
                      onClick={() => void saveEditedUser()}
                      disabled={saving}
                    >
                      {saving ? "Saving…" : "Save"}
                    </Button>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {addTeamOpen ? (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4" role="presentation">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-[0.5px]"
            aria-label="Close dialog"
            onClick={() => setAddTeamOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-team-dialog-title"
            className="relative z-[1] w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-2xl ring-1 ring-black/[0.06]"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <h2 id="add-team-dialog-title" className="text-lg font-semibold tracking-tight text-slate-900">
                Add team
              </h2>
              <button
                type="button"
                onClick={() => setAddTeamOpen(false)}
                className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                aria-label="Close"
              >
                <X className="size-4" />
              </button>
            </div>
            <p className="mb-3 text-[13px] leading-snug text-slate-600">
              Register a team for this browser. It shows up in team pickers and filters; people get the team when you edit
              them in the table or in Add User.
            </p>
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-semibold text-slate-800">Team name</span>
              <input
                value={newTeamNameInput}
                onChange={(e) => setNewTeamNameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    saveRegisteredTeamFromModal();
                  }
                }}
                className="h-10 w-full rounded-lg border border-slate-200 px-3 text-[13px] outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-200/80"
                placeholder="e.g. Design Ops"
                autoComplete="off"
                autoFocus
              />
            </label>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setAddTeamOpen(false)}>
                Cancel
              </Button>
              <Button type="button" size="sm" className="font-semibold" onClick={saveRegisteredTeamFromModal}>
                Save team
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
