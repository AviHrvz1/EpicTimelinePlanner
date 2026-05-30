"use client";

import {
  ArrowUpDown,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  Flag,
  ListTodo,
  PlayCircle,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { UserAvatar, resolveAssigneeAvatar } from "@/components/ui/user-avatar";
import type { UserStoryItem } from "@/lib/types";
import { cn } from "@/lib/utils";

type SortKey = "id" | "title" | "sprint" | "assignee" | "status";
type SortState = { key: SortKey; dir: "asc" | "desc" } | null;
type ColFilter = { title: string; sprint: string; assignee: string; status: string };
const EMPTY_FILTER: ColFilter = { title: "", sprint: "", assignee: "", status: "" };

const STATUS_LABEL: Record<string, string> = {
  todo: "To do",
  inProgress: "In progress",
  done: "Done",
  approved: "Approved",
};

const STATUS_SORT_RANK: Record<string, number> = {
  todo: 0,
  inProgress: 1,
  done: 2,
  approved: 3,
};

function statusFromLabel(label: string): UserStoryItem["status"] | null {
  if (label === "To do") return "todo";
  if (label === "In progress") return "inProgress";
  if (label === "Done") return "done";
  if (label === "Approved") return "approved";
  return null;
}

function StatusPill({ status }: { status: UserStoryItem["status"] }) {
  const meta = (() => {
    switch (status) {
      case "approved":
        return { label: "Approved", Icon: CheckCircle2, color: "text-violet-600" };
      case "done":
        return { label: "Done", Icon: CheckCheck, color: "text-emerald-600" };
      case "inProgress":
        return { label: "In progress", Icon: PlayCircle, color: "text-blue-600" };
      default:
        return { label: "To do", Icon: ListTodo, color: "text-amber-600" };
    }
  })();
  const { Icon } = meta;
  return (
    <span className="inline-flex items-center gap-1.5 font-semibold">
      <Icon className={cn("size-3.5 shrink-0", meta.color)} aria-hidden />
      <span className="truncate text-slate-700">{meta.label}</span>
    </span>
  );
}

function SortHeader({
  label,
  column,
  sort,
  onSortChange,
}: {
  label: string;
  column: SortKey;
  sort: SortState;
  onSortChange: (next: SortState) => void;
}) {
  const active = sort?.key === column;
  const dir = active ? sort!.dir : null;
  return (
    <button
      type="button"
      className="group/sort inline-flex items-center gap-1 text-left transition hover:text-amber-200"
      onClick={() => {
        if (!active) onSortChange({ key: column, dir: "asc" });
        else if (sort!.dir === "asc") onSortChange({ key: column, dir: "desc" });
        else onSortChange(null);
      }}
    >
      <span>{label}</span>
      {dir === "asc" ? (
        <ChevronUp className="size-3.5 shrink-0" />
      ) : dir === "desc" ? (
        <ChevronDown className="size-3.5 shrink-0" />
      ) : (
        <ArrowUpDown className="size-3 shrink-0 opacity-0 transition-opacity group-hover/sort:opacity-40" />
      )}
    </button>
  );
}

function FilterText({ value, onChange, ariaLabel }: { value: string; onChange: (v: string) => void; ariaLabel: string }) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder="Filter…"
      aria-label={ariaLabel}
      className="h-6 w-full min-w-0 rounded border border-slate-200 bg-white px-1.5 text-[12px] text-slate-700 placeholder:text-slate-400 focus:border-slate-300 focus:outline-none"
    />
  );
}

function FilterDropdown({
  value,
  options,
  onChange,
  renderOption,
  ariaLabel,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  renderOption?: (option: string) => React.ReactNode;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    function onDocDown(event: MouseEvent) {
      if (!wrapRef.current || wrapRef.current.contains(event.target as Node)) return;
      setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [open]);
  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={ariaLabel}
        className="flex h-6 w-full min-w-0 items-center justify-between rounded border border-slate-200 bg-white px-1.5 text-left text-[12px] text-slate-700 hover:border-slate-300 focus:outline-none"
      >
        <span className="truncate">{value || "All"}</span>
        <ChevronDown className="ml-1 size-3 shrink-0 text-slate-400" />
      </button>
      {open ? (
        <div className="absolute left-0 top-[110%] z-30 max-h-56 w-full min-w-[8rem] overflow-y-auto rounded-md border border-slate-200 bg-white p-1 shadow-md ring-1 ring-black/[0.04]">
          <button
            type="button"
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
            className={cn(
              "block w-full rounded px-1.5 py-1 text-left text-[12px] hover:bg-slate-50",
              value === "" && "bg-indigo-50 text-indigo-700",
            )}
          >
            All
          </button>
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => {
                onChange(opt);
                setOpen(false);
              }}
              className={cn(
                "block w-full rounded px-1.5 py-1 text-left text-[12px] hover:bg-slate-50",
                value === opt && "bg-indigo-50 text-indigo-700",
              )}
            >
              {renderOption ? renderOption(opt) : opt}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AssigneeCell({
  assignee,
  workspaceDirectoryUsers,
}: {
  assignee: string | null | undefined;
  workspaceDirectoryUsers?: readonly { name: string; team?: string; image?: string | null }[];
}) {
  const name = assignee?.trim();
  if (!name) {
    return <span className="text-slate-400">Unassigned</span>;
  }
  const resolved = resolveAssigneeAvatar(name, workspaceDirectoryUsers);
  const parts = resolved.name.split(/\s+/);
  const shortName = parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1]!.charAt(0)}.` : resolved.name;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5" title={resolved.name}>
      <UserAvatar name={resolved.name} image={resolved.image} size={16} className="ring-0" />
      <span className="min-w-0 truncate">{shortName}</span>
    </span>
  );
}

export function StoryStatusDrilldownTable({
  stories,
  initialStatus,
  workspaceDirectoryUsers,
  onOpenStory,
}: {
  stories: UserStoryItem[];
  /** Status the user clicked in the pie chart (label form: "To do", "Done", etc). */
  initialStatus: string | null;
  workspaceDirectoryUsers?: readonly { name: string; team?: string; image?: string | null }[];
  onOpenStory?: (storyId: string) => void;
}) {
  const [statusFilter, setStatusFilter] = useState<string | null>(initialStatus);
  const [colFilter, setColFilter] = useState<ColFilter>(EMPTY_FILTER);
  const [sort, setSort] = useState<SortState>(null);

  useEffect(() => {
    setStatusFilter(initialStatus);
    setColFilter(EMPTY_FILTER);
    setSort(null);
  }, [initialStatus]);

  const baseStories = useMemo(() => {
    if (!statusFilter) return stories;
    if (statusFilter === "All") return stories;
    const key = statusFromLabel(statusFilter);
    if (!key) return stories;
    return stories.filter((s) => s.status === key);
  }, [stories, statusFilter]);

  const sprintLabel = (story: UserStoryItem) => {
    const s = story.sprint;
    if (s == null) return "Unscheduled";
    if (s === 1 || s === 2) return `Sprint ${s}`;
    const lane = ((s - 1) % 2) + 1;
    return `Sprint ${lane}`;
  };

  const filtered = useMemo(() => {
    return baseStories.filter((story) => {
      if (colFilter.title && !story.title.toLowerCase().includes(colFilter.title.toLowerCase())) return false;
      if (colFilter.sprint && sprintLabel(story) !== colFilter.sprint) return false;
      const assigneeName = story.assignee?.trim() || "Unassigned";
      if (colFilter.assignee && assigneeName !== colFilter.assignee) return false;
      if (colFilter.status && STATUS_LABEL[story.status] !== colFilter.status) return false;
      return true;
    });
  }, [baseStories, colFilter]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const dir = sort.dir === "asc" ? 1 : -1;
    const arr = [...filtered];
    arr.sort((a, b) => {
      switch (sort.key) {
        case "id":
          return dir * a.id.localeCompare(b.id);
        case "title":
          return dir * a.title.localeCompare(b.title);
        case "sprint": {
          const sa = a.sprint ?? Number.POSITIVE_INFINITY;
          const sb = b.sprint ?? Number.POSITIVE_INFINITY;
          return dir * (sa - sb);
        }
        case "assignee": {
          const na = (a.assignee?.trim() || "Unassigned").toLowerCase();
          const nb = (b.assignee?.trim() || "Unassigned").toLowerCase();
          return dir * na.localeCompare(nb);
        }
        case "status":
          return dir * ((STATUS_SORT_RANK[a.status] ?? 99) - (STATUS_SORT_RANK[b.status] ?? 99));
        default:
          return 0;
      }
    });
    return arr;
  }, [filtered, sort]);

  const uniqueSprints = useMemo(
    () => Array.from(new Set(baseStories.map((s) => sprintLabel(s)))).filter(Boolean).sort(),
    [baseStories],
  );
  const uniqueAssignees = useMemo(
    () => Array.from(new Set(baseStories.map((s) => s.assignee?.trim() || "Unassigned"))).filter(Boolean).sort(),
    [baseStories],
  );
  const uniqueStatuses = useMemo(
    () => Array.from(new Set(baseStories.map((s) => STATUS_LABEL[s.status] ?? s.status))).sort(),
    [baseStories],
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto bg-white">
        <table className="w-full table-fixed border-collapse text-left text-[13px]">
          <colgroup>
            <col className="w-[12%]" />
            <col className="w-[32%]" />
            <col className="w-[20%]" />
            <col className="w-[20%]" />
            <col className="w-[16%]" />
          </colgroup>
          <thead className="sticky top-0 z-10 overflow-hidden rounded-t-md border-b border-[#19abeb]/70 bg-[#0897d5] text-white shadow-[0_1px_0_rgba(15,23,42,0.04)]">
            <tr>
              <th className="min-w-0 px-2 py-1 text-[14px] text-left">
                <SortHeader label="Story ID" column="id" sort={sort} onSortChange={setSort} />
              </th>
              <th className="min-w-0 px-2 py-1 text-[14px] text-left">
                <SortHeader label="Story name" column="title" sort={sort} onSortChange={setSort} />
              </th>
              <th className="min-w-0 px-2 py-1 text-[14px] text-left">
                <SortHeader label="Sprint" column="sprint" sort={sort} onSortChange={setSort} />
              </th>
              <th className="min-w-0 px-2 py-1 text-[14px] text-left">
                <SortHeader label="Assignee" column="assignee" sort={sort} onSortChange={setSort} />
              </th>
              <th className="min-w-0 px-2 py-1 text-[14px] text-left">
                <SortHeader label="Status" column="status" sort={sort} onSortChange={setSort} />
              </th>
            </tr>
            <tr className="bg-white/95">
              <th className="min-w-0 px-1 py-0.5" />
              <th className="min-w-0 px-1 py-0.5">
                <FilterText
                  value={colFilter.title}
                  onChange={(v) => setColFilter((p) => ({ ...p, title: v }))}
                  ariaLabel="Filter by story name"
                />
              </th>
              <th className="min-w-0 px-1 py-0.5">
                <FilterDropdown
                  value={colFilter.sprint}
                  options={uniqueSprints}
                  onChange={(v) => setColFilter((p) => ({ ...p, sprint: v }))}
                  renderOption={(opt) => (
                    <span className="inline-flex items-center gap-1.5">
                      <Flag className="size-3 shrink-0 text-rose-500" aria-hidden />
                      {opt}
                    </span>
                  )}
                  ariaLabel="Filter by sprint"
                />
              </th>
              <th className="min-w-0 px-1 py-0.5">
                <FilterDropdown
                  value={colFilter.assignee}
                  options={uniqueAssignees}
                  onChange={(v) => setColFilter((p) => ({ ...p, assignee: v }))}
                  renderOption={(name) => {
                    const resolved = resolveAssigneeAvatar(name, workspaceDirectoryUsers);
                    return (
                      <span className="inline-flex items-center gap-1.5">
                        <UserAvatar name={resolved.name} image={resolved.image} size={14} className="ring-0" />
                        <span className="truncate">{name}</span>
                      </span>
                    );
                  }}
                  ariaLabel="Filter by assignee"
                />
              </th>
              <th className="min-w-0 px-1 py-0.5">
                <FilterDropdown
                  value={colFilter.status}
                  options={uniqueStatuses}
                  onChange={(v) => setColFilter((p) => ({ ...p, status: v }))}
                  renderOption={(opt) => {
                    const key = statusFromLabel(opt);
                    return key ? <StatusPill status={key} /> : <span>{opt}</span>;
                  }}
                  ariaLabel="Filter by status"
                />
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-[13px] text-slate-400">
                  No stories match this filter
                </td>
              </tr>
            ) : (
              sorted.map((story) => (
                <tr
                  key={story.id}
                  className="border-t border-[#7cd3f7]/95 text-slate-700 odd:bg-[#f4f7fc] even:bg-white transition hover:bg-[#c5ebff]"
                >
                  <td className="min-w-0 px-2 py-0.5">
                    <button
                      type="button"
                      onClick={() => onOpenStory?.(story.id)}
                      className="block w-full max-w-full truncate text-left font-semibold text-blue-700 underline-offset-2 hover:underline"
                      title={story.id}
                    >
                      {story.id.slice(0, 8)}
                    </button>
                  </td>
                  <td className="min-w-0 px-2 py-0.5">
                    <span className="block min-w-0 truncate" title={story.title}>
                      {story.title}
                    </span>
                  </td>
                  <td className="min-w-0 px-2 py-0.5">
                    <span className="inline-flex min-w-0 items-center gap-1.5">
                      {story.sprint != null ? (
                        <>
                          <Flag className="size-3.5 shrink-0 text-rose-500" aria-hidden />
                          <span className="min-w-0 truncate">{sprintLabel(story)}</span>
                        </>
                      ) : (
                        <>
                          <Circle className="size-3.5 shrink-0 text-slate-400" aria-hidden />
                          <span className="min-w-0 truncate text-slate-400">Unscheduled</span>
                        </>
                      )}
                    </span>
                  </td>
                  <td className="min-w-0 px-2 py-0.5">
                    <AssigneeCell assignee={story.assignee} workspaceDirectoryUsers={workspaceDirectoryUsers} />
                  </td>
                  <td className="min-w-0 px-2 py-0.5">
                    <StatusPill status={story.status} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

