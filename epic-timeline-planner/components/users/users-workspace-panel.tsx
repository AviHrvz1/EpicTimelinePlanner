"use client";

import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  Plus,
  Search,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { AssigneeCombobox } from "@/components/ui/assignee-combobox";
import { Button } from "@/components/ui/button";
import { EditRowIconButton } from "@/components/ui/edit-row-icon-button";
import { TeamIdCombobox, blurActiveField } from "@/components/ui/team-id-combobox";
import { MONTH_TEAM_COLUMNS } from "@/lib/month-team-board";
import {
  WORKSPACE_USER_PERMISSIONS,
  normalizeWorkspaceUserPermission,
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

type TeamFilter = "all" | "platform" | "experience" | "data" | "__none__";
type PermissionFilter = "all" | "Admin" | "Editor" | "Viewer";
type SortKey = "name" | "email" | "team" | "permission" | "status";
type SortState = { key: SortKey; dir: "asc" | "desc" };
type UserEditField = "name" | "email" | "team" | "permission";

const TEAM_FILTER_SUGGESTIONS = [...MONTH_TEAM_COLUMNS.map((c) => c.label), "Unassigned only"] as const;

const PERMISSION_FILTER_SUGGESTIONS = [...WORKSPACE_USER_PERMISSIONS] as const;

const cellInputCn =
  "h-9 w-full min-w-0 rounded-md border border-slate-200 bg-white px-2 text-[16px] outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-200/80 disabled:opacity-60";

function emptyForm() {
  return { name: "", email: "", team: "" as string, permission: "Viewer" as string };
}

function teamFilterLabel(f: TeamFilter): string {
  if (f === "all") return "";
  if (f === "__none__") return "Unassigned only";
  return MONTH_TEAM_COLUMNS.find((t) => t.id === f)?.label ?? f;
}

function resolveTeamFilterQuery(q: string): TeamFilter {
  const t = q.trim().toLowerCase();
  if (!t || t === "all teams" || t === "all") return "all";
  if (t === "unassigned only" || t === "unassigned") return "__none__";
  const exact = MONTH_TEAM_COLUMNS.find((c) => c.label.toLowerCase() === t);
  if (exact) return exact.id as TeamFilter;
  const prefix = MONTH_TEAM_COLUMNS.find((c) => c.label.toLowerCase().startsWith(t));
  if (prefix) return prefix.id as TeamFilter;
  const byId = MONTH_TEAM_COLUMNS.find((c) => c.id.toLowerCase() === t);
  if (byId) return byId.id as TeamFilter;
  return "all";
}

function permissionFilterLabel(f: PermissionFilter): string {
  if (f === "all") return "";
  return f;
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

function SortHeader({
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
    <th className="whitespace-nowrap px-3 py-2.5 text-left align-middle">
      <button
        type="button"
        onClick={() => onToggle(col)}
        className="inline-flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-[0.02em] text-white transition hover:text-white/95"
      >
        {label}
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
  idx,
  saving,
  editField,
  onEditField,
  onCancelEdit,
  onRowView,
  patchUser,
}: {
  row: WorkspaceUserRow;
  idx: number;
  saving: boolean;
  editField: UserEditField | null;
  onEditField: (field: UserEditField) => void;
  onCancelEdit: () => void;
  onRowView: (row: WorkspaceUserRow) => void;
  patchUser: (
    id: string,
    body: { name?: string; email?: string; team?: string; permission?: string },
  ) => Promise<boolean>;
}) {
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
    if (teamId === row.team) {
      onCancelEdit();
      return;
    }
    const ok = await patchUser(row.id, { team: teamId });
    if (ok) onCancelEdit();
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

  return (
    <tr
      className={cn(
        "group border-t border-[#7cd3f7]/95 text-[16px] text-slate-800 transition-colors hover:bg-[#c5ebff]",
        idx % 2 === 0 ? "bg-[#d8f2ff]" : "bg-white",
        saving && "opacity-70",
        !rowBusy && "cursor-pointer",
      )}
      onClick={() => {
        if (rowBusy) return;
        onRowView(row);
      }}
    >
      <td className="max-w-[280px] px-2 py-2 align-middle">
        {editing("name") ? (
          <div className="flex min-w-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <input
              value={name}
              disabled={saving}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveName();
                if (e.key === "Escape") onCancelEdit();
              }}
              className={cn(cellInputCn, "min-w-0 flex-1 font-semibold text-slate-900")}
              aria-label={`Edit name for ${row.email}`}
              autoFocus
            />
            <EditCommitButtons disabled={saving} onSave={saveName} onCancel={onCancelEdit} />
          </div>
        ) : (
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 flex-1 truncate px-1 py-1.5 font-semibold text-slate-900">{row.name}</span>
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
      <td className="min-w-[220px] max-w-[280px] px-2 py-2 align-middle">
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
          <button
            type="button"
            disabled={saving || editField != null}
            onClick={(e) => {
              e.stopPropagation();
              onEditField("email");
            }}
            className="w-full break-all rounded-md px-1 py-1.5 text-left text-violet-700 underline decoration-violet-200 underline-offset-2 transition hover:bg-white/35 hover:text-violet-900 disabled:cursor-default disabled:opacity-60 disabled:no-underline disabled:hover:bg-transparent"
            aria-label={`Edit email (${row.email})`}
          >
            {row.email}
          </button>
        )}
      </td>
      <td className="min-w-[200px] px-2 py-2 align-middle">
        {editing("team") ? (
          <div className="flex min-w-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <div className="min-w-0 flex-1">
              <TeamIdCombobox
                teamId={teamId}
                onTeamIdChange={setTeamId}
                disabled={saving}
                placeholder="Team…"
                className={cellInputCn}
              />
            </div>
            <EditCommitButtons disabled={saving} onSave={saveTeam} onCancel={onCancelEdit} />
          </div>
        ) : (
          <button
            type="button"
            disabled={saving || editField != null}
            onClick={(e) => {
              e.stopPropagation();
              onEditField("team");
            }}
            className="w-full rounded-md px-1 py-1.5 text-left transition hover:bg-white/35 disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent"
            aria-label={`Edit team for ${row.name}`}
          >
            {row.team ? (
              <span
                className={cn(
                  "inline-flex rounded-full px-2.5 py-0.5 text-[13px] font-semibold leading-tight ring-1",
                  row.team === "platform" && "bg-sky-50 text-sky-800 ring-sky-200/80",
                  row.team === "experience" && "bg-violet-50 text-violet-800 ring-violet-200/80",
                  row.team === "data" && "bg-amber-50 text-amber-900 ring-amber-200/80",
                )}
              >
                {teamLabelForWorkspaceUser(row.team)}
              </span>
            ) : (
              <span className="text-[13px] text-slate-400">Unassigned</span>
            )}
          </button>
        )}
      </td>
      <td className="min-w-[160px] px-2 py-2 align-middle">
        {editing("permission") ? (
          <div className="flex min-w-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <div className="min-w-0 flex-1">
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
          <button
            type="button"
            disabled={saving || editField != null}
            onClick={(e) => {
              e.stopPropagation();
              onEditField("permission");
            }}
            className="w-full rounded-md px-1 py-1.5 text-left font-medium text-slate-700 transition hover:bg-white/35 disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent"
            aria-label={`Edit permission (${row.permission})`}
          >
            {row.permission}
          </button>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2 align-middle">
        <span
          className="inline-flex rounded-full bg-emerald-50 px-2.5 py-0.5 text-[13px] font-semibold leading-tight text-emerald-900 ring-1 ring-emerald-200/90"
          title="Status is managed by the system"
        >
          {formatUserStatusLabel(row.status ?? "active")}
        </span>
      </td>
    </tr>
  );
}

type UserPanelState = { kind: "add" } | { kind: "view"; user: WorkspaceUserRow };

export function UsersWorkspacePanel() {
  const [rows, setRows] = useState<WorkspaceUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState("");
  const [teamFilter, setTeamFilter] = useState<TeamFilter>("all");
  const [permissionFilter, setPermissionFilter] = useState<PermissionFilter>("all");
  const [teamFilterInput, setTeamFilterInput] = useState("");
  const [permFilterInput, setPermFilterInput] = useState("");
  const [userPanel, setUserPanel] = useState<UserPanelState | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [savingRowIds, setSavingRowIds] = useState<Set<string>>(() => new Set());
  const [editCell, setEditCell] = useState<{ rowId: string; field: UserEditField } | null>(null);
  const [sort, setSort] = useState<SortState>({ key: "name", dir: "asc" });

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
    setTeamFilterInput(teamFilterLabel(teamFilter));
  }, [teamFilter]);

  useEffect(() => {
    setPermFilterInput(permissionFilterLabel(permissionFilter));
  }, [permissionFilter]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (editCell) {
        setEditCell(null);
        return;
      }
      if (userPanel) {
        if (saving) return;
        setUserPanel(null);
        setForm(emptyForm());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editCell, userPanel, saving]);

  const toggleSort = useCallback((key: SortKey) => {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
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

  const nameSuggestions = useMemo(() => {
    const s = new Set<string>();
    for (const r of displayed.slice(0, 40)) s.add(r.name);
    return [...s].sort();
  }, [displayed]);

  const openCreate = () => {
    setForm(emptyForm());
    setUserPanel({ kind: "add" });
  };

  const closePanel = () => {
    setUserPanel(null);
    setForm(emptyForm());
  };

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
    setSaving(true);
    try {
      const res = await fetch("/api/workspace-users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          team: form.team || "",
          permission,
        }),
      });
      const err = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      toast.success("User added");
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
    if ((form.team || "") !== (viewUser.team || "")) body.team = form.team || "";
    if (permission !== viewUser.permission) body.permission = permission;
    if (Object.keys(body).length === 0) {
      closePanel();
      return;
    }
    setSaving(true);
    try {
      const ok = await patchUser(viewUser.id, body);
      if (ok) {
        toast.success("User updated");
        closePanel();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 p-6 sm:p-8">
      <header className="flex flex-col gap-4 border-b border-slate-200/90 pb-6 sm:flex-row sm:items-center sm:justify-between">
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
        <Button
          type="button"
          onClick={openCreate}
          className="h-10 shrink-0 gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-4 font-semibold shadow-md shadow-violet-500/20 hover:from-violet-500 hover:to-indigo-500"
        >
          <Plus className="size-4" aria-hidden />
          Add User
        </Button>
      </header>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-3">
        <div className="relative min-w-0 w-full flex-1 lg:max-w-md">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
            aria-hidden
          />
          <input
            list="users-name-suggestions"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Search name, email, team, or permission…"
            className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3 text-[14px] text-slate-900 shadow-sm outline-none ring-slate-200/80 transition placeholder:text-slate-400 focus:border-violet-300 focus:ring-2 focus:ring-violet-200/80"
            aria-label="Search users"
          />
          <datalist id="users-name-suggestions">
            {nameSuggestions.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-full min-w-[160px] max-w-[220px] shrink-0 sm:w-[200px]">
            <AssigneeCombobox
              value={teamFilterInput}
              onChange={setTeamFilterInput}
              suggestions={TEAM_FILTER_SUGGESTIONS}
              placeholder="All Teams"
              aria-label="Filter by team"
              className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] shadow-sm outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-200/80"
              onSuggestionPick={(s) => {
                const next = resolveTeamFilterQuery(s);
                setTeamFilter(next);
                setTeamFilterInput(teamFilterLabel(next));
              }}
              onInputBlur={(v) => {
                const next = resolveTeamFilterQuery(v);
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
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-none bg-white text-[16px]">
        <table className="w-full min-w-[860px] border-collapse text-left">
          <thead className="sticky top-0 z-10 border-b border-[#19abeb]/70 bg-[#0897d5] shadow-sm">
            <tr>
              <SortHeader label="User name" col="name" sort={sort} onToggle={toggleSort} />
              <SortHeader label="Email" col="email" sort={sort} onToggle={toggleSort} />
              <SortHeader label="Team" col="team" sort={sort} onToggle={toggleSort} />
              <SortHeader label="Permission" col="permission" sort={sort} onToggle={toggleSort} />
              <SortHeader label="Status" col="status" sort={sort} onToggle={toggleSort} />
            </tr>
          </thead>
          <tbody className="bg-white">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-16 text-center text-slate-500">
                  Loading users…
                </td>
              </tr>
            ) : sortedRows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-16 text-center text-slate-500">
                  No users match the current filters.
                </td>
              </tr>
            ) : (
              sortedRows.map((row, idx) => (
                <UsersTableRow
                  key={row.id}
                  row={row}
                  idx={idx}
                  saving={savingRowIds.has(row.id)}
                  editField={editCell?.rowId === row.id ? editCell.field : null}
                  onEditField={(field) => setEditCell({ rowId: row.id, field })}
                  onCancelEdit={() => setEditCell(null)}
                  onRowView={(r) => {
                    setEditCell(null);
                    setForm({
                      name: r.name,
                      email: r.email,
                      team: r.team,
                      permission: r.permission,
                    });
                    setUserPanel({ kind: "view", user: r });
                  }}
                  patchUser={patchUser}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-center text-[12px] text-slate-500">
        Showing {sortedRows.length} of {rows.length} loaded
        {teamFilter !== "all" || permissionFilter !== "all" ? " (server-filtered)" : ""}
        {q ? " · search narrows further in the browser" : ""}
        {` · sorted by ${sort.key} (${sort.dir})`}
      </p>

      {userPanel ? (
        <div className="fixed inset-0 z-[100] flex justify-end">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px]"
            aria-label="Close panel"
            onClick={closePanel}
          />
          <div
            className="relative flex h-full w-full max-w-2xl flex-col border-l border-slate-200 bg-white shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="users-drawer-title"
          >
            {userPanel.kind === "add" ? (
              <>
                <div className="border-b border-slate-100 bg-gradient-to-r from-violet-600 to-indigo-600 px-5 py-4 text-white">
                  <h2 id="users-drawer-title" className="text-lg font-semibold">
                    Add User
                  </h2>
                  <p className="mt-0.5 text-[13px] text-violet-100">
                    New entries appear in the table; click a row to view details or edit fields from the grid.
                  </p>
                </div>
                <div className="flex-1 space-y-4 overflow-y-auto p-5">
                  <label className="block">
                    <span className="mb-1.5 block text-[12px] font-semibold text-slate-700">Name</span>
                    <input
                      value={form.name}
                      onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                      className="h-10 w-full rounded-lg border border-slate-200 px-3 text-[13px] outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-200/80"
                      autoComplete="name"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[12px] font-semibold text-slate-700">Email</span>
                    <input
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                      className="h-10 w-full rounded-lg border border-slate-200 px-3 text-[13px] outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-200/80"
                      autoComplete="email"
                    />
                  </label>
                  <div className="block">
                    <span className="mb-1.5 block text-[12px] font-semibold text-slate-700">Team</span>
                    <TeamIdCombobox
                      teamId={form.team}
                      onTeamIdChange={(id) => setForm((f) => ({ ...f, team: id }))}
                      disabled={saving}
                      placeholder="Type or pick a team (optional)"
                      className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-200/80"
                    />
                  </div>
                  <div className="block">
                    <span className="mb-1.5 block text-[12px] font-semibold text-slate-700">Permission</span>
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
                <div className="flex gap-2 border-t border-slate-100 p-4">
                  <Button type="button" variant="outline" className="flex-1" onClick={closePanel} disabled={saving}>
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    className="flex-1 bg-violet-600 font-semibold hover:bg-violet-500"
                    onClick={() => void saveNewUser()}
                    disabled={saving}
                  >
                    {saving ? "Saving…" : "Add User"}
                  </Button>
                </div>
              </>
            ) : viewUser ? (
              <>
                <div className="border-b border-slate-100 bg-gradient-to-r from-violet-600 to-indigo-600 px-5 py-4 text-white">
                  <h2 id="users-drawer-title" className="text-lg font-semibold">
                    Edit user
                  </h2>
                  <p className="mt-0.5 text-[13px] text-violet-100">Update fields and save, or cancel to discard.</p>
                </div>
                <div className="flex-1 space-y-4 overflow-y-auto p-5">
                  <label className="block">
                    <span className="mb-1.5 block text-[12px] font-semibold text-slate-700">Name</span>
                    <input
                      value={form.name}
                      onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                      className="h-10 w-full rounded-lg border border-slate-200 px-3 text-[13px] outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-200/80"
                      autoComplete="name"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[12px] font-semibold text-slate-700">Email</span>
                    <input
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                      className="h-10 w-full rounded-lg border border-slate-200 px-3 text-[13px] outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-200/80"
                      autoComplete="email"
                    />
                  </label>
                  <div className="block">
                    <span className="mb-1.5 block text-[12px] font-semibold text-slate-700">Team</span>
                    <TeamIdCombobox
                      teamId={form.team}
                      onTeamIdChange={(id) => setForm((f) => ({ ...f, team: id }))}
                      disabled={saving}
                      placeholder="Type or pick a team (optional)"
                      className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-200/80"
                    />
                  </div>
                  <div className="block">
                    <span className="mb-1.5 block text-[12px] font-semibold text-slate-700">Permission</span>
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
                  <div>
                    <div className="mb-1.5 text-[12px] font-semibold text-slate-700">Status</div>
                    <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-0.5 text-[13px] font-semibold text-emerald-900 ring-1 ring-emerald-200/90">
                      {formatUserStatusLabel(viewUser.status ?? "active")}
                    </span>
                    <p className="mt-1.5 text-[12px] text-slate-500">Status is managed by the system.</p>
                  </div>
                </div>
                <div className="flex gap-2 border-t border-slate-100 p-4">
                  <Button type="button" variant="outline" className="flex-1" onClick={closePanel} disabled={saving}>
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    className="flex-1 bg-violet-600 font-semibold hover:bg-violet-500"
                    onClick={() => void saveEditedUser()}
                    disabled={saving}
                  >
                    {saving ? "Saving…" : "Save changes"}
                  </Button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
