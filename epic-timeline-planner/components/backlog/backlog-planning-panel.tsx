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

export function BacklogPlanningPanel({
  initiatives,
  storyRefById,
  onOpenStory,
}: BacklogPlanningPanelProps) {
  const [query, setQuery] = useState("");
  const [openInitiatives, setOpenInitiatives] = useState<Record<string, boolean>>({});
  const [openEpics, setOpenEpics] = useState<Record<string, boolean>>({});

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

  return (
    <section className="h-full min-h-0 overflow-hidden rounded-xl bg-card p-4 shadow-lg ring-1 ring-black/5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-semibold tracking-tight text-slate-900">Backlog</h2>
          <p className="text-[13px] text-slate-600">Accordion table view across initiatives, epics, and stories.</p>
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

      <div className="h-[calc(100%-6.2rem)] overflow-auto rounded-lg ring-1 ring-slate-200">
        <div className="sticky top-0 z-10 grid grid-cols-[minmax(18rem,1fr)_9rem_8rem_10rem_6rem_6rem] items-center gap-2 border-b border-slate-200 bg-slate-100 px-3 py-2 text-[12px] font-semibold text-slate-700">
          <span>Work item</span>
          <span>Status</span>
          <span>Sprint</span>
          <span>Assignee</span>
          <span>Est</span>
          <span>Left</span>
        </div>

        {filtered.length === 0 ? (
          <div className="p-4 text-[13px] text-slate-600">No items match your search.</div>
        ) : (
          <div className="divide-y divide-slate-100 bg-white">
            {filtered.map((initiative) => {
              const isInitOpen = openInitiatives[initiative.id] ?? true;
              return (
                <div key={initiative.id}>
                  <div className="grid grid-cols-[minmax(18rem,1fr)_9rem_8rem_10rem_6rem_6rem] items-center gap-2 px-3 py-2 hover:bg-slate-50">
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
                      <span className="truncate text-[14px] font-semibold text-slate-900">{initiative.title}</span>
                    </button>
                    <span className="w-fit rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                      {initiative.status}
                    </span>
                    <span className="text-[12px] text-slate-500">-</span>
                    <span className="truncate text-[12px] text-slate-700">{initiative.assignee ?? "Unassigned"}</span>
                    <span className="text-[12px] text-slate-500">-</span>
                    <span className="text-[12px] text-slate-500">-</span>
                  </div>

                  {isInitOpen ? (
                    <div className="bg-slate-50/50">
                      {(initiative.epics ?? []).map((epic) => {
                        const isEpicOpen = openEpics[epic.id] ?? true;
                        return (
                          <div key={epic.id}>
                            <div className="grid grid-cols-[minmax(18rem,1fr)_9rem_8rem_10rem_6rem_6rem] items-center gap-2 px-3 py-2 hover:bg-slate-50">
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
                                <span className="truncate text-[13px] font-semibold text-slate-800">
                                  {epic.icon} {epic.title}
                                </span>
                              </button>
                              <span className="w-fit rounded bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                                {(epic.userStories ?? []).length} stories
                              </span>
                              <span className="text-[12px] text-slate-500">-</span>
                              <span className="truncate text-[12px] text-slate-700">{epic.assignee ?? "Unassigned"}</span>
                              <span className="text-[12px] text-slate-500">-</span>
                              <span className="text-[12px] text-slate-500">-</span>
                            </div>

                            {isEpicOpen ? (
                              <div>
                                {(epic.userStories ?? []).map((story) => (
                                  <button
                                    key={story.id}
                                    type="button"
                                    onClick={() => onOpenStory(story.id)}
                                    className="grid w-full grid-cols-[minmax(18rem,1fr)_9rem_8rem_10rem_6rem_6rem] items-center gap-2 px-3 py-2 text-left hover:bg-slate-50"
                                  >
                                    <span className="flex min-w-0 items-center gap-2 pl-12">
                                      <Folder className="size-3.5 shrink-0 text-slate-500" />
                                      <span className="truncate text-[13px] text-slate-800">
                                        {story.icon} {story.title}
                                      </span>
                                      <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                                        #{storyRefById[story.id] ?? story.id.slice(0, 6)}
                                      </span>
                                    </span>
                                    <span className={cn("w-fit rounded px-2 py-0.5 text-[11px] font-medium", statusChip(story.status))}>
                                      {story.status === "inProgress" ? "In progress" : story.status}
                                    </span>
                                    <span className="text-[12px] text-slate-700">{sprintLabel(story.sprint)}</span>
                                    <span className="truncate text-[12px] text-slate-700">{story.assignee?.trim() || "Unassigned"}</span>
                                    <span className="text-[12px] text-slate-700">{story.estimatedDays ?? 0}d</span>
                                    <span className="text-[12px] text-slate-700">{story.daysLeft ?? 0}d</span>
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
