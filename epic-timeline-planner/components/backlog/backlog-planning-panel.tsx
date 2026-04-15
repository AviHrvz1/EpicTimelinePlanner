"use client";

import { ChevronDown, ChevronRight, Folder, FolderKanban, Search, Target } from "lucide-react";
import { useMemo, useState } from "react";

import { InitiativeItem } from "@/lib/types";
import { cn } from "@/lib/utils";

type BacklogPlanningPanelProps = {
  initiatives: InitiativeItem[];
  storyRefById: Record<string, string>;
  onOpenStory: (storyId: string) => void;
};

function statusChip(status: string) {
  if (status === "approved") return "bg-violet-100 text-violet-700";
  if (status === "done") return "bg-emerald-100 text-emerald-700";
  if (status === "inProgress") return "bg-blue-100 text-blue-700";
  return "bg-amber-100 text-amber-700";
}

function sprintLabel(sprint: number | null) {
  return sprint == null ? "Unscheduled" : `Sprint ${sprint}`;
}

function quarterFromMonth(month: number | null | undefined): string {
  if (month == null) return "-";
  if (month <= 3) return "Q1";
  if (month <= 6) return "Q2";
  if (month <= 9) return "Q3";
  return "Q4";
}

function monthLabel(month: number | null | undefined): string {
  if (month == null) return "-";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
  return months[month - 1] ?? "-";
}

export function BacklogPlanningPanel({
  initiatives,
  storyRefById,
  onOpenStory,
}: BacklogPlanningPanelProps) {
  const [query, setQuery] = useState("");
  const [openInitiatives, setOpenInitiatives] = useState<Record<string, boolean>>({});
  const [openEpics, setOpenEpics] = useState<Record<string, boolean>>({});
  const [statusFilter, setStatusFilter] = useState<"all" | "todo" | "inProgress" | "done" | "approved">("all");
  const [sprintFilter, setSprintFilter] = useState<"all" | "unscheduled" | "1" | "2">("all");
  const [yearFilter, setYearFilter] = useState<string>("all");
  const [quarterFilter, setQuarterFilter] = useState<"all" | "Q1" | "Q2" | "Q3" | "Q4">("all");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"titleAsc" | "titleDesc" | "assigneeAsc" | "estDesc" | "leftDesc" | "status">(
    "titleAsc",
  );

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    const byInitiative = [...initiatives].sort((a, b) => a.title.localeCompare(b.title));
    if (!q) return byInitiative;
    return byInitiative
      .map((initiative) => {
        const initiativeMatch =
          initiative.title.toLowerCase().includes(q) ||
          (initiative.assignee ?? "").toLowerCase().includes(q) ||
          initiative.status.toLowerCase().includes(q);
        const epics = (initiative.epics ?? [])
          .map((epic) => {
            const epicMatch =
              epic.title.toLowerCase().includes(q) || (epic.assignee ?? "").toLowerCase().includes(q);
            const stories = (epic.userStories ?? []).filter((story) => {
              const ref = storyRefById[story.id] ?? "";
              return (
                story.title.toLowerCase().includes(q) ||
                (story.assignee ?? "").toLowerCase().includes(q) ||
                story.status.toLowerCase().includes(q) ||
                sprintLabel(story.sprint).toLowerCase().includes(q) ||
                ref.includes(q)
              );
            });
            if (epicMatch) return { ...epic, userStories: epic.userStories ?? [] };
            return { ...epic, userStories: stories };
          })
          .filter((epic) => epic.title.toLowerCase().includes(q) || (epic.userStories ?? []).length > 0);

        if (initiativeMatch) return initiative;
        return { ...initiative, epics };
      })
      .filter((initiative) => initiative.title.toLowerCase().includes(q) || (initiative.epics ?? []).length > 0);
  }, [initiatives, q, storyRefById]);

  const filteredWithControls = useMemo(() => {
    const statusRank: Record<string, number> = { todo: 0, inProgress: 1, done: 2, approved: 3 };
    return filtered
      .map((initiative) => ({
        ...initiative,
        epics: (initiative.epics ?? [])
          .map((epic) => {
            const stories = [...(epic.userStories ?? [])]
              .filter((story) => {
                if (statusFilter !== "all" && story.status !== statusFilter) return false;
                if (sprintFilter === "unscheduled" && story.sprint != null) return false;
                if ((sprintFilter === "1" || sprintFilter === "2") && String(story.sprint ?? "") !== sprintFilter) return false;
                return true;
              })
              .sort((a, b) => {
                if (sortBy === "titleDesc") return b.title.localeCompare(a.title);
                if (sortBy === "assigneeAsc") return (a.assignee ?? "Unassigned").localeCompare(b.assignee ?? "Unassigned");
                if (sortBy === "estDesc") return (b.estimatedDays ?? 0) - (a.estimatedDays ?? 0);
                if (sortBy === "leftDesc") return (b.daysLeft ?? 0) - (a.daysLeft ?? 0);
                if (sortBy === "status") return (statusRank[a.status] ?? 99) - (statusRank[b.status] ?? 99);
                return a.title.localeCompare(b.title);
              });
            return { ...epic, userStories: stories };
          })
          .filter((epic) => (epic.userStories ?? []).length > 0 || statusFilter === "all" && sprintFilter === "all"),
      }))
      .filter((initiative) => (initiative.epics ?? []).length > 0 || (statusFilter === "all" && sprintFilter === "all"));
  }, [filtered, statusFilter, sprintFilter, sortBy]);

  const suggestions = useMemo(() => {
    const list: string[] = [];
    for (const initiative of initiatives) {
      list.push(initiative.title);
      for (const epic of initiative.epics ?? []) {
        list.push(epic.title);
        for (const story of epic.userStories ?? []) {
          const ref = storyRefById[story.id];
          if (ref) list.push(ref);
          list.push(story.title);
          if (story.assignee) list.push(story.assignee);
        }
      }
    }
    return [...new Set(list)].slice(0, 250);
  }, [initiatives, storyRefById]);

  const yearOptions = useMemo(() => {
    const years = Array.from(new Set(initiatives.map((initiative) => String(initiative.year)))).sort();
    return ["all", ...years];
  }, [initiatives]);

  const assigneeOptions = useMemo(() => {
    const names = new Set<string>(["Unassigned"]);
    for (const initiative of initiatives) {
      if (initiative.assignee?.trim()) names.add(initiative.assignee.trim());
      for (const epic of initiative.epics ?? []) {
        if (epic.assignee?.trim()) names.add(epic.assignee.trim());
        for (const story of epic.userStories ?? []) {
          if (story.assignee?.trim()) names.add(story.assignee.trim());
        }
      }
    }
    return ["all", ...Array.from(names).sort((a, b) => a.localeCompare(b))];
  }, [initiatives]);

  const fullyFiltered = useMemo(() => {
    return filteredWithControls
      .map((initiative) => {
        if (yearFilter !== "all" && String(initiative.year) !== yearFilter) return null;
        const initiativeQuarter = quarterFromMonth(initiative.startMonth);
        if (quarterFilter !== "all" && initiativeQuarter !== quarterFilter) return null;
        const initAssignee = initiative.assignee?.trim() || "Unassigned";
        const epics = (initiative.epics ?? [])
          .map((epic) => {
            const epicQuarter = quarterFromMonth(epic.planStartMonth ?? initiative.startMonth);
            if (quarterFilter !== "all" && epicQuarter !== quarterFilter) return null;
            const epicAssignee = epic.assignee?.trim() || "Unassigned";
            const stories = (epic.userStories ?? []).filter((story) => {
              if (assigneeFilter === "all") return true;
              const storyAssignee = story.assignee?.trim() || "Unassigned";
              return storyAssignee === assigneeFilter || epicAssignee === assigneeFilter || initAssignee === assigneeFilter;
            });
            if (assigneeFilter !== "all" && stories.length === 0 && epicAssignee !== assigneeFilter) return null;
            return { ...epic, userStories: stories };
          })
          .filter(Boolean) as typeof initiative.epics;

        if (assigneeFilter !== "all" && epics.length === 0 && initAssignee !== assigneeFilter) return null;
        if (epics.length === 0 && (yearFilter !== "all" || quarterFilter !== "all" || assigneeFilter !== "all")) return null;
        return { ...initiative, epics };
      })
      .filter(Boolean) as typeof filteredWithControls;
  }, [filteredWithControls, yearFilter, quarterFilter, assigneeFilter]);

  return (
    <section className="h-full min-h-0 overflow-hidden rounded-xl bg-card p-4 shadow-lg ring-1 ring-black/5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[20px] font-semibold tracking-tight text-slate-900">Backlog</h2>
          <p className="text-[14px] text-slate-600">Accordion table view across initiatives, epics, and stories.</p>
        </div>
      </div>

      <div className="mb-3 flex items-center gap-2 rounded-lg bg-slate-50 p-2 ring-1 ring-slate-200">
        <Search className="size-4 text-slate-500" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          list="backlog-search-suggestions"
          placeholder="Search work items..."
          className="h-9 w-full rounded-md bg-white px-3 text-[14px] outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-ring/40"
        />
        <datalist id="backlog-search-suggestions">
          {suggestions.map((item) => (
            <option key={item} value={item} />
          ))}
        </datalist>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-2 ring-1 ring-slate-200">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className="h-9 rounded-md bg-white px-2 text-[13px] ring-1 ring-slate-200 outline-none"
        >
          <option value="all">Status: All</option>
          <option value="todo">To do</option>
          <option value="inProgress">In progress</option>
          <option value="done">Done</option>
          <option value="approved">Approved</option>
        </select>
        <select
          value={sprintFilter}
          onChange={(e) => setSprintFilter(e.target.value as typeof sprintFilter)}
          className="h-9 rounded-md bg-white px-2 text-[13px] ring-1 ring-slate-200 outline-none"
        >
          <option value="all">Sprint: All</option>
          <option value="unscheduled">Unscheduled</option>
          <option value="1">Sprint 1</option>
          <option value="2">Sprint 2</option>
        </select>
        <select
          value={yearFilter}
          onChange={(e) => setYearFilter(e.target.value)}
          className="h-9 rounded-md bg-white px-2 text-[13px] ring-1 ring-slate-200 outline-none"
        >
          {yearOptions.map((year) => (
            <option key={year} value={year}>
              {year === "all" ? "Year: All" : `Year: ${year}`}
            </option>
          ))}
        </select>
        <select
          value={quarterFilter}
          onChange={(e) => setQuarterFilter(e.target.value as typeof quarterFilter)}
          className="h-9 rounded-md bg-white px-2 text-[13px] ring-1 ring-slate-200 outline-none"
        >
          <option value="all">Quarter: All</option>
          <option value="Q1">Q1</option>
          <option value="Q2">Q2</option>
          <option value="Q3">Q3</option>
          <option value="Q4">Q4</option>
        </select>
        <select
          value={assigneeFilter}
          onChange={(e) => setAssigneeFilter(e.target.value)}
          className="h-9 rounded-md bg-white px-2 text-[13px] ring-1 ring-slate-200 outline-none"
        >
          {assigneeOptions.map((assignee) => (
            <option key={assignee} value={assignee}>
              {assignee === "all" ? "Assignee: All" : `Assignee: ${assignee}`}
            </option>
          ))}
        </select>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
          className="h-9 rounded-md bg-white px-2 text-[13px] ring-1 ring-slate-200 outline-none"
        >
          <option value="titleAsc">Sort: Title (A-Z)</option>
          <option value="titleDesc">Title (Z-A)</option>
          <option value="assigneeAsc">Assignee</option>
          <option value="status">Status</option>
          <option value="estDesc">Est Days (High-Low)</option>
          <option value="leftDesc">Days Left (High-Low)</option>
        </select>
      </div>

      <div className="h-[calc(100%-6.2rem)] overflow-auto rounded-lg ring-1 ring-slate-200">
        <div className="sticky top-0 z-10 grid grid-cols-[minmax(18rem,1fr)_5rem_4rem_6rem_9rem_8rem_10rem_8rem_8rem] items-center gap-2 border-b border-slate-200 bg-slate-100 px-3 py-2 text-[13px] font-semibold text-slate-700">
          <span>Work item</span>
          <span>Year</span>
          <span>Q</span>
          <span>Month</span>
          <span>Status</span>
          <span>Sprint</span>
          <span>Assignee</span>
          <span>Est Days</span>
          <span>Days Left</span>
        </div>

        {fullyFiltered.length === 0 ? (
          <div className="p-4 text-[14px] text-slate-600">No items match your search/filter settings.</div>
        ) : (
          <div className="divide-y divide-slate-100 bg-white">
            {fullyFiltered.map((initiative) => {
              const isInitOpen = openInitiatives[initiative.id] ?? true;
              return (
                <div key={initiative.id}>
                  <div className="grid grid-cols-[minmax(18rem,1fr)_5rem_4rem_6rem_9rem_8rem_10rem_8rem_8rem] items-center gap-2 px-3 py-2 hover:bg-slate-50">
                    <button
                      type="button"
                      onClick={() => setOpenInitiatives((prev) => ({ ...prev, [initiative.id]: !isInitOpen }))}
                      className="flex min-w-0 items-center gap-2 text-left"
                    >
                      {isInitOpen ? (
                        <ChevronDown className="size-4 shrink-0 text-slate-500" />
                      ) : (
                        <ChevronRight className="size-4 shrink-0 text-slate-500" />
                      )}
                      <Target className="size-4 shrink-0 text-slate-700" />
                      <span className="truncate text-[15px] font-semibold text-slate-900">{initiative.title}</span>
                    </button>
                    <span className="text-[13px] text-slate-700">{initiative.year}</span>
                    <span className="text-[13px] text-slate-700">{quarterFromMonth(initiative.startMonth)}</span>
                    <span className="text-[13px] text-slate-700">{monthLabel(initiative.startMonth)}</span>
                    <span className="w-fit rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                      {initiative.status}
                    </span>
                    <span className="text-[13px] text-slate-500">-</span>
                    <span className="truncate text-[13px] text-slate-700">{initiative.assignee ?? "Unassigned"}</span>
                    <span className="text-[13px] text-slate-500">-</span>
                    <span className="text-[13px] text-slate-500">-</span>
                  </div>

                  {isInitOpen ? (
                    <div className="bg-slate-50/50">
                      {(initiative.epics ?? []).map((epic) => {
                        const isEpicOpen = openEpics[epic.id] ?? true;
                        return (
                          <div key={epic.id}>
                            <div className="grid grid-cols-[minmax(18rem,1fr)_5rem_4rem_6rem_9rem_8rem_10rem_8rem_8rem] items-center gap-2 px-3 py-2 hover:bg-slate-50">
                              <button
                                type="button"
                                onClick={() => setOpenEpics((prev) => ({ ...prev, [epic.id]: !isEpicOpen }))}
                                className="flex min-w-0 items-center gap-2 pl-6 text-left"
                              >
                                {isEpicOpen ? (
                                  <ChevronDown className="size-4 shrink-0 text-slate-500" />
                                ) : (
                                  <ChevronRight className="size-4 shrink-0 text-slate-500" />
                                )}
                                <FolderKanban className="size-4 shrink-0 text-slate-700" />
                                <span className="truncate text-[14px] font-semibold text-slate-800">
                                  {epic.icon} {epic.title}
                                </span>
                              </button>
                              <span className="text-[13px] text-slate-700">{initiative.year}</span>
                              <span className="text-[13px] text-slate-700">{quarterFromMonth(epic.planStartMonth ?? initiative.startMonth)}</span>
                              <span className="text-[13px] text-slate-700">{monthLabel(epic.planStartMonth ?? initiative.startMonth)}</span>
                              <span className="w-fit rounded bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                                {(epic.userStories ?? []).length} stories
                              </span>
                              <span className="text-[13px] text-slate-500">-</span>
                              <span className="truncate text-[13px] text-slate-700">{epic.assignee ?? "Unassigned"}</span>
                              <span className="text-[13px] text-slate-500">-</span>
                              <span className="text-[13px] text-slate-500">-</span>
                            </div>

                            {isEpicOpen ? (
                              <div>
                                {(epic.userStories ?? []).map((story) => (
                                  <button
                                    key={story.id}
                                    type="button"
                                    onClick={() => onOpenStory(story.id)}
                                    className="grid w-full grid-cols-[minmax(18rem,1fr)_5rem_4rem_6rem_9rem_8rem_10rem_8rem_8rem] items-center gap-2 px-3 py-2 text-left hover:bg-slate-50"
                                  >
                                    <span className="flex min-w-0 items-center gap-2 pl-12">
                                      <Folder className="size-3.5 shrink-0 text-slate-500" />
                                      <span className="truncate text-[14px] text-slate-800">
                                        {story.icon} {story.title}
                                      </span>
                                      <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                                        #{storyRefById[story.id] ?? story.id.slice(0, 6)}
                                      </span>
                                    </span>
                                    <span className="text-[13px] text-slate-700">{initiative.year}</span>
                                    <span className="text-[13px] text-slate-700">
                                      {quarterFromMonth(epic.planStartMonth ?? initiative.startMonth)}
                                    </span>
                                    <span className="text-[13px] text-slate-700">{monthLabel(epic.planStartMonth ?? initiative.startMonth)}</span>
                                    <span className={cn("w-fit rounded px-2 py-0.5 text-[11px] font-medium", statusChip(story.status))}>
                                      {story.status === "inProgress" ? "In progress" : story.status}
                                    </span>
                                    <span className="text-[13px] text-slate-700">{sprintLabel(story.sprint)}</span>
                                    <span className="truncate text-[13px] text-slate-700">{story.assignee?.trim() || "Unassigned"}</span>
                                    <span className="text-[13px] text-slate-700">{story.estimatedDays ?? 0}d</span>
                                    <span className="text-[13px] text-slate-700">{story.daysLeft ?? 0}d</span>
                                  </button>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
