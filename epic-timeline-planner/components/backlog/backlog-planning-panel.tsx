"use client";

import { ChevronDown, ChevronRight, FileText, FolderKanban, Plus, Search, Target, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { InitiativeItem } from "@/lib/types";
import { cn } from "@/lib/utils";

type BacklogPlanningPanelProps = {
  initiatives: InitiativeItem[];
  storyRefById: Record<string, string>;
  onOpenStory: (storyId: string) => void;
  onCreateInitiativeQuick: (title: string) => Promise<void>;
  onCreateEpicQuick: (initiativeId: string, title: string) => Promise<void>;
  onCreateStoryQuick: (epicId: string, title: string) => Promise<void>;
};

type OptionItem = { id: string; label: string };
type CreateKind = "initiative" | "epic" | "story";
type CreateScope = "initiative" | "epic" | "story";

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

function MultiCheckboxFilter({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: OptionItem[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const allSelected = selected.length === 0;
  const selectedLabel =
    allSelected
      ? "All"
      : selected.length === 1
        ? options.find((option) => option.id === selected[0])?.label ?? "1 selected"
        : `${selected.length} selected`;
  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  function scheduleClose() {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => setIsOpen(false), 180);
  }

  function cancelScheduledClose() {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }

  return (
    <div className="group relative" onMouseEnter={cancelScheduledClose} onMouseLeave={scheduleClose}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex h-10 min-w-[10.5rem] cursor-pointer items-center justify-between rounded-md bg-white px-3 text-[15px] ring-1 ring-slate-200 outline-none"
      >
        <span className="font-medium text-slate-700">{label}: </span>
        <span className="ml-1 truncate text-slate-600">{selectedLabel}</span>
      </button>
      {isOpen ? (
        <div className="absolute z-30 mt-1 w-56 rounded-md border border-slate-200 bg-white p-2 shadow-lg">
        <label className="mb-1 flex items-center gap-2 text-[14px] text-slate-700">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={() => onChange([])}
            className="h-3.5 w-3.5 rounded border-slate-300"
          />
          All
        </label>
        <div className="max-h-44 space-y-1 overflow-auto pr-1">
          {options.map((option) => (
            <label key={option.id} className="flex items-center gap-2 text-[14px] text-slate-700">
              <input
                type="checkbox"
                checked={allSelected || selected.includes(option.id)}
                onChange={() => {
                  const next = allSelected
                    ? [option.id]
                    : selected.includes(option.id)
                      ? selected.filter((x) => x !== option.id)
                      : [...selected, option.id];
                  onChange(next);
                }}
                className="h-3.5 w-3.5 rounded border-slate-300"
              />
              {option.label}
            </label>
          ))}
        </div>
        </div>
      ) : null}
    </div>
  );
}

export function BacklogPlanningPanel({
  initiatives,
  storyRefById,
  onOpenStory,
  onCreateInitiativeQuick,
  onCreateEpicQuick,
  onCreateStoryQuick,
}: BacklogPlanningPanelProps) {
  const [query, setQuery] = useState("");
  const [openInitiatives, setOpenInitiatives] = useState<Record<string, boolean>>({});
  const [openEpics, setOpenEpics] = useState<Record<string, boolean>>({});
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [sprintFilter, setSprintFilter] = useState<string[]>([]);
  const [yearFilter, setYearFilter] = useState<string[]>([]);
  const [quarterFilter, setQuarterFilter] = useState<string[]>([]);
  const [assigneeFilter, setAssigneeFilter] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<"titleAsc" | "titleDesc" | "assigneeAsc" | "estDesc" | "leftDesc" | "status">(
    "titleAsc",
  );
  const [openCreateMenuKey, setOpenCreateMenuKey] = useState<string | null>(null);
  const [createDraftTitle, setCreateDraftTitle] = useState("");
  const [createSelection, setCreateSelection] = useState<{
    anchorKey: string;
    scope: CreateScope;
    kind: CreateKind;
    initiativeId?: string;
    epicId?: string;
  } | null>(null);
  const [storyTargetEpicId, setStoryTargetEpicId] = useState("");
  const [submittingKey, setSubmittingKey] = useState<string | null>(null);
  const createMenuCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
                if (statusFilter.length > 0 && !statusFilter.includes(story.status)) return false;
                const sprintKey = story.sprint == null ? "unscheduled" : String(story.sprint);
                if (sprintFilter.length > 0 && !sprintFilter.includes(sprintKey)) return false;
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
          .filter((epic) => (epic.userStories ?? []).length > 0 || (statusFilter.length === 0 && sprintFilter.length === 0)),
      }))
      .filter((initiative) => (initiative.epics ?? []).length > 0 || (statusFilter.length === 0 && sprintFilter.length === 0));
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
    return Array.from(new Set(initiatives.map((initiative) => String(initiative.year))))
      .sort()
      .map((year) => ({ id: year, label: year }));
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
    return Array.from(names)
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ id: name, label: name }));
  }, [initiatives]);

  const statusOptions: OptionItem[] = [
    { id: "todo", label: "To do" },
    { id: "inProgress", label: "In progress" },
    { id: "done", label: "Done" },
    { id: "approved", label: "Approved" },
  ];
  const sprintOptions: OptionItem[] = [
    { id: "unscheduled", label: "Unscheduled" },
    { id: "1", label: "Sprint 1" },
    { id: "2", label: "Sprint 2" },
  ];
  const quarterOptions: OptionItem[] = [
    { id: "Q1", label: "Q1" },
    { id: "Q2", label: "Q2" },
    { id: "Q3", label: "Q3" },
    { id: "Q4", label: "Q4" },
  ];

  const fullyFiltered = useMemo(() => {
    return filteredWithControls
      .map((initiative) => {
        if (yearFilter.length > 0 && !yearFilter.includes(String(initiative.year))) return null;
        const initiativeQuarter = quarterFromMonth(initiative.startMonth);
        if (quarterFilter.length > 0 && !quarterFilter.includes(initiativeQuarter)) return null;
        const initAssignee = initiative.assignee?.trim() || "Unassigned";
        const epics = (initiative.epics ?? [])
          .map((epic) => {
            const epicQuarter = quarterFromMonth(epic.planStartMonth ?? initiative.startMonth);
            if (quarterFilter.length > 0 && !quarterFilter.includes(epicQuarter)) return null;
            const epicAssignee = epic.assignee?.trim() || "Unassigned";
            const stories = (epic.userStories ?? []).filter((story) => {
              if (assigneeFilter.length === 0) return true;
              const storyAssignee = story.assignee?.trim() || "Unassigned";
              return (
                assigneeFilter.includes(storyAssignee) ||
                assigneeFilter.includes(epicAssignee) ||
                assigneeFilter.includes(initAssignee)
              );
            });
            if (assigneeFilter.length > 0 && stories.length === 0 && !assigneeFilter.includes(epicAssignee)) return null;
            return { ...epic, userStories: stories };
          })
          .filter(Boolean) as typeof initiative.epics;

        if (assigneeFilter.length > 0 && epics.length === 0 && !assigneeFilter.includes(initAssignee)) return null;
        if (epics.length === 0 && (yearFilter.length > 0 || quarterFilter.length > 0 || assigneeFilter.length > 0))
          return null;
        return { ...initiative, epics };
      })
      .filter(Boolean) as typeof filteredWithControls;
  }, [filteredWithControls, yearFilter, quarterFilter, assigneeFilter]);

  function openCreateComposer(selection: {
    anchorKey: string;
    scope: CreateScope;
    kind: CreateKind;
    initiativeId?: string;
    epicId?: string;
  }) {
    setOpenCreateMenuKey(null);
    setCreateSelection(selection);
    setCreateDraftTitle("");
    if (selection.kind === "story" && selection.scope === "initiative" && selection.initiativeId) {
      const initiative = initiatives.find((item) => item.id === selection.initiativeId);
      setStoryTargetEpicId(initiative?.epics?.[0]?.id ?? "");
    } else {
      setStoryTargetEpicId(selection.epicId ?? "");
    }
  }

  async function handleCreateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!createSelection) return;
    const title = createDraftTitle.trim();
    if (title.length < 2) return;
    setSubmittingKey("create");
    try {
      if (createSelection.kind === "initiative") {
        await onCreateInitiativeQuick(title);
      } else if (createSelection.kind === "epic") {
        if (!createSelection.initiativeId) return;
        await onCreateEpicQuick(createSelection.initiativeId, title);
        setOpenInitiatives((prev) => ({ ...prev, [createSelection.initiativeId!]: true }));
      } else {
        const epicId = createSelection.scope === "initiative" ? storyTargetEpicId : createSelection.epicId;
        if (!epicId) return;
        await onCreateStoryQuick(epicId, title);
        setOpenEpics((prev) => ({ ...prev, [epicId!]: true }));
      }
      setCreateDraftTitle("");
      setCreateSelection(null);
    } finally {
      setSubmittingKey(null);
    }
  }

  function closeInlineCreator() {
    setCreateSelection(null);
    setCreateDraftTitle("");
    setStoryTargetEpicId("");
  }

  useEffect(() => {
    return () => {
      if (createMenuCloseTimerRef.current) clearTimeout(createMenuCloseTimerRef.current);
    };
  }, []);

  function scheduleCreateMenuClose() {
    if (createMenuCloseTimerRef.current) clearTimeout(createMenuCloseTimerRef.current);
    createMenuCloseTimerRef.current = setTimeout(() => setOpenCreateMenuKey(null), 160);
  }

  function cancelCreateMenuClose() {
    if (createMenuCloseTimerRef.current) {
      clearTimeout(createMenuCloseTimerRef.current);
      createMenuCloseTimerRef.current = null;
    }
  }

  return (
    <section className="h-full min-h-0 overflow-hidden rounded-xl bg-card p-4 shadow-lg ring-1 ring-black/5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[24px] font-semibold tracking-tight text-slate-900">Backlog</h2>
        </div>
      </div>

      <div className="mb-3 flex items-center gap-2 rounded-lg bg-slate-50 p-2 ring-1 ring-slate-200">
        <Search className="size-4 text-slate-500" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          list="backlog-search-suggestions"
          placeholder="Search work items..."
          className="h-10 w-full rounded-md bg-white px-3 text-[15px] outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-ring/40"
        />
        <datalist id="backlog-search-suggestions">
          {suggestions.map((item) => (
            <option key={item} value={item} />
          ))}
        </datalist>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-2 ring-1 ring-slate-200">
        <MultiCheckboxFilter label="Status" options={statusOptions} selected={statusFilter} onChange={setStatusFilter} />
        <MultiCheckboxFilter label="Sprint" options={sprintOptions} selected={sprintFilter} onChange={setSprintFilter} />
        <MultiCheckboxFilter label="Year" options={yearOptions} selected={yearFilter} onChange={setYearFilter} />
        <MultiCheckboxFilter label="Quarter" options={quarterOptions} selected={quarterFilter} onChange={setQuarterFilter} />
        <MultiCheckboxFilter
          label="Assignee"
          options={assigneeOptions}
          selected={assigneeFilter}
          onChange={setAssigneeFilter}
        />
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
          className="h-10 rounded-md bg-white px-3 text-[15px] ring-1 ring-slate-200 outline-none"
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
        <div className="sticky top-0 z-10 grid grid-cols-[minmax(18rem,1fr)_5rem_4rem_6rem_9rem_8rem_10rem_8rem_8rem] items-center gap-2 border-b border-slate-200 bg-slate-100 px-3 py-2.5 text-[16px] font-semibold text-slate-700">
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
          <div className="p-4 text-[16px] text-slate-600">No items match your search/filter settings.</div>
        ) : (
          <div className="divide-y divide-slate-100 bg-white">
            {fullyFiltered.map((initiative) => {
              const isInitOpen = openInitiatives[initiative.id] ?? true;
              return (
                <div key={initiative.id}>
                  <div className="group grid grid-cols-[minmax(18rem,1fr)_5rem_4rem_6rem_9rem_8rem_10rem_8rem_8rem] items-center gap-2 px-3 py-2 hover:bg-slate-50">
                    <div
                      className="relative flex min-w-0 items-center gap-2"
                      onMouseEnter={cancelCreateMenuClose}
                      onMouseLeave={scheduleCreateMenuClose}
                    >
                      <button
                        type="button"
                        onClick={() => setOpenInitiatives((prev) => ({ ...prev, [initiative.id]: !isInitOpen }))}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        {isInitOpen ? (
                          <ChevronDown className="size-4 shrink-0 text-slate-500" />
                        ) : (
                          <ChevronRight className="size-4 shrink-0 text-slate-500" />
                        )}
                        <Target className="size-4 shrink-0 text-slate-700" />
                        <span className="truncate text-[17px] font-medium text-slate-900">{initiative.title}</span>
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setOpenCreateMenuKey((prev) => (prev === `initiative:${initiative.id}` ? null : `initiative:${initiative.id}`));
                        }}
                        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded opacity-0 ring-1 ring-slate-200 transition hover:bg-white hover:text-slate-900 group-hover:opacity-100"
                        title="Add from this row"
                      >
                        <Plus className="size-3.5 text-slate-600" />
                      </button>
                      {openCreateMenuKey === `initiative:${initiative.id}` ? (
                        <div className="absolute left-full top-1/2 z-30 ml-2 w-52 -translate-y-1/2 rounded-xl border border-slate-200/90 bg-white/95 p-2 shadow-xl backdrop-blur-sm">
                          <button
                            type="button"
                            onClick={() =>
                              openCreateComposer({
                                anchorKey: `initiative:${initiative.id}`,
                                scope: "initiative",
                                kind: "initiative",
                                initiativeId: initiative.id,
                              })
                            }
                            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[14px] font-medium text-slate-700 hover:bg-slate-50"
                          >
                            <Target className="size-3.5 text-slate-500" />
                            Add initiative
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              openCreateComposer({
                                anchorKey: `initiative:${initiative.id}`,
                                scope: "initiative",
                                kind: "epic",
                                initiativeId: initiative.id,
                              })
                            }
                            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[14px] font-medium text-slate-700 hover:bg-slate-50"
                          >
                            <FolderKanban className="size-3.5 text-slate-500" />
                            Add epic
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              openCreateComposer({
                                anchorKey: `initiative:${initiative.id}`,
                                scope: "initiative",
                                kind: "story",
                                initiativeId: initiative.id,
                              })
                            }
                            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[14px] font-medium text-slate-700 hover:bg-slate-50"
                          >
                            <FileText className="size-3.5 text-slate-500" />
                            Add user story
                          </button>
                        </div>
                      ) : null}
                    </div>
                    <span className="text-[15px] text-slate-700">{initiative.year}</span>
                    <span className="text-[15px] text-slate-700">{quarterFromMonth(initiative.startMonth)}</span>
                    <span className="text-[15px] text-slate-700">{monthLabel(initiative.startMonth)}</span>
                    <span className="w-fit rounded bg-slate-100 px-2 py-0.5 text-[13px] font-medium text-slate-700">
                      {initiative.status}
                    </span>
                    <span className="text-[15px] text-slate-500">-</span>
                    <span className="truncate text-[15px] text-slate-700">{initiative.assignee ?? "Unassigned"}</span>
                    <span className="text-[15px] text-slate-500">-</span>
                    <span className="text-[15px] text-slate-500">-</span>
                  </div>
                  {createSelection?.anchorKey === `initiative:${initiative.id}` && createSelection.kind === "initiative" ? (
                    <form
                      onSubmit={handleCreateSubmit}
                      className="grid grid-cols-[minmax(18rem,1fr)_5rem_4rem_6rem_9rem_8rem_10rem_8rem_8rem] items-center gap-2 bg-slate-50 px-3 py-2"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <input
                          value={createDraftTitle}
                          onChange={(event) => setCreateDraftTitle(event.target.value)}
                          placeholder="Type initiative title and press Enter..."
                          autoComplete="off"
                          autoCorrect="off"
                          autoCapitalize="none"
                          spellCheck={false}
                          data-1p-ignore="true"
                          data-lpignore="true"
                          data-bwignore="true"
                          data-form-type="other"
                          data-protonpass-ignore="true"
                          className="h-9 w-full rounded-md bg-white px-2.5 text-[14px] outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-ring/40"
                          autoFocus
                        />
                      </div>
                      <div className="col-span-8 flex items-center gap-2">
                        <button
                          type="submit"
                          disabled={createDraftTitle.trim().length < 2 || submittingKey === "create"}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-slate-900 text-white disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          <Plus className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={closeInlineCreator}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-white text-slate-600 ring-1 ring-slate-200"
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                    </form>
                  ) : null}

                  {isInitOpen ? (
                    <div className="bg-slate-50/50">
                      {createSelection?.anchorKey === `initiative:${initiative.id}` && createSelection.kind !== "initiative" ? (
                        <form
                          onSubmit={handleCreateSubmit}
                          className="grid grid-cols-[minmax(18rem,1fr)_5rem_4rem_6rem_9rem_8rem_10rem_8rem_8rem] items-center gap-2 px-3 py-2"
                        >
                          <div className="flex min-w-0 items-center gap-2 pl-6">
                            <input
                              value={createDraftTitle}
                              onChange={(event) => setCreateDraftTitle(event.target.value)}
                              placeholder={
                                createSelection.kind === "epic"
                                  ? "Type epic title and press Enter..."
                                  : "Type user story title and press Enter..."
                              }
                              autoComplete="off"
                              autoCorrect="off"
                              autoCapitalize="none"
                              spellCheck={false}
                              data-1p-ignore="true"
                              data-lpignore="true"
                              data-bwignore="true"
                              data-form-type="other"
                              data-protonpass-ignore="true"
                              className="h-9 w-full rounded-md bg-white px-2.5 text-[14px] outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-ring/40"
                              autoFocus
                            />
                          </div>
                          <div className="col-span-8 flex items-center gap-2">
                            {createSelection.kind === "story" ? (
                              <select
                                value={storyTargetEpicId}
                                onChange={(event) => setStoryTargetEpicId(event.target.value)}
                                className="h-9 rounded-md bg-white px-2 text-[14px] ring-1 ring-slate-200 outline-none"
                              >
                                <option value="">Select epic</option>
                                {(initiative.epics ?? []).map((epic) => (
                                  <option key={epic.id} value={epic.id}>
                                    {epic.icon} {epic.title}
                                  </option>
                                ))}
                              </select>
                            ) : null}
                            <button
                              type="submit"
                              disabled={
                                createDraftTitle.trim().length < 2 ||
                                submittingKey === "create" ||
                                (createSelection.kind === "story" && !storyTargetEpicId)
                              }
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-slate-900 text-white disabled:cursor-not-allowed disabled:opacity-45"
                            >
                              <Plus className="size-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={closeInlineCreator}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-white text-slate-600 ring-1 ring-slate-200"
                            >
                              <X className="size-3.5" />
                            </button>
                          </div>
                        </form>
                      ) : null}
                      {(initiative.epics ?? []).map((epic) => {
                        const isEpicOpen = openEpics[epic.id] ?? true;
                        return (
                          <div key={epic.id}>
                            <div className="group grid grid-cols-[minmax(18rem,1fr)_5rem_4rem_6rem_9rem_8rem_10rem_8rem_8rem] items-center gap-2 px-3 py-2 hover:bg-slate-50">
                              <div
                                className="relative flex min-w-0 items-center gap-2 pl-6"
                                onMouseEnter={cancelCreateMenuClose}
                                onMouseLeave={scheduleCreateMenuClose}
                              >
                                <button
                                  type="button"
                                  onClick={() => setOpenEpics((prev) => ({ ...prev, [epic.id]: !isEpicOpen }))}
                                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                                >
                                  {isEpicOpen ? (
                                    <ChevronDown className="size-4 shrink-0 text-slate-500" />
                                  ) : (
                                    <ChevronRight className="size-4 shrink-0 text-slate-500" />
                                  )}
                                  <span className="inline-block size-4 shrink-0" aria-hidden />
                                  <span className="truncate text-[16px] font-medium text-slate-800">
                                    {epic.icon} {epic.title}
                                  </span>
                                </button>
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setOpenCreateMenuKey((prev) => (prev === `epic:${epic.id}` ? null : `epic:${epic.id}`));
                                  }}
                                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded opacity-0 ring-1 ring-slate-200 transition hover:bg-white hover:text-slate-900 group-hover:opacity-100"
                                  title="Add from this row"
                                >
                                  <Plus className="size-3.5 text-slate-600" />
                                </button>
                                {openCreateMenuKey === `epic:${epic.id}` ? (
                                  <div className="absolute left-full top-1/2 z-30 ml-2 w-52 -translate-y-1/2 rounded-xl border border-slate-200/90 bg-white/95 p-2 shadow-xl backdrop-blur-sm">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        openCreateComposer({
                                          anchorKey: `epic:${epic.id}`,
                                          scope: "epic",
                                          kind: "epic",
                                          initiativeId: initiative.id,
                                        })
                                      }
                                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[14px] font-medium text-slate-700 hover:bg-slate-50"
                                    >
                                      <FolderKanban className="size-3.5 text-slate-500" />
                                      Add epic
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        openCreateComposer({
                                          anchorKey: `epic:${epic.id}`,
                                          scope: "epic",
                                          kind: "story",
                                          epicId: epic.id,
                                        })
                                      }
                                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[14px] font-medium text-slate-700 hover:bg-slate-50"
                                    >
                                      <FileText className="size-3.5 text-slate-500" />
                                      Add user story
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                              <span className="text-[15px] text-slate-700">{initiative.year}</span>
                              <span className="text-[15px] text-slate-700">{quarterFromMonth(epic.planStartMonth ?? initiative.startMonth)}</span>
                              <span className="text-[15px] text-slate-700">{monthLabel(epic.planStartMonth ?? initiative.startMonth)}</span>
                              <span className="w-fit rounded bg-amber-100 px-2 py-0.5 text-[13px] font-medium text-amber-700">
                                {(epic.userStories ?? []).length} stories
                              </span>
                              <span className="text-[15px] text-slate-500">-</span>
                              <span className="truncate text-[15px] text-slate-700">{epic.assignee ?? "Unassigned"}</span>
                              <span className="text-[15px] text-slate-500">-</span>
                              <span className="text-[15px] text-slate-500">-</span>
                            </div>
                            {createSelection?.anchorKey === `epic:${epic.id}` ? (
                              <form
                                onSubmit={handleCreateSubmit}
                                className="grid grid-cols-[minmax(18rem,1fr)_5rem_4rem_6rem_9rem_8rem_10rem_8rem_8rem] items-center gap-2 px-3 py-2"
                              >
                                <div className="flex min-w-0 items-center gap-2 pl-12">
                                  <input
                                    value={createDraftTitle}
                                    onChange={(event) => setCreateDraftTitle(event.target.value)}
                                    placeholder={
                                      createSelection.kind === "epic"
                                        ? "Type epic title and press Enter..."
                                        : "Type user story title and press Enter..."
                                    }
                                    autoComplete="off"
                                    autoCorrect="off"
                                    autoCapitalize="none"
                                    spellCheck={false}
                                    data-1p-ignore="true"
                                    data-lpignore="true"
                                    data-bwignore="true"
                                    data-form-type="other"
                                    data-protonpass-ignore="true"
                                    className="h-9 w-full rounded-md bg-white px-2.5 text-[14px] outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-ring/40"
                                    autoFocus
                                  />
                                </div>
                                <div className="col-span-8 flex items-center gap-2">
                                  <button
                                    type="submit"
                                    disabled={createDraftTitle.trim().length < 2 || submittingKey === "create"}
                                    className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-slate-900 text-white disabled:cursor-not-allowed disabled:opacity-45"
                                  >
                                    <Plus className="size-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={closeInlineCreator}
                                    className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-white text-slate-600 ring-1 ring-slate-200"
                                  >
                                    <X className="size-3.5" />
                                  </button>
                                </div>
                              </form>
                            ) : null}

                            {isEpicOpen ? (
                              <div>
                                {(epic.userStories ?? []).map((story) => (
                                  <div key={story.id}>
                                    <div
                                    className="group grid w-full grid-cols-[minmax(18rem,1fr)_5rem_4rem_6rem_9rem_8rem_10rem_8rem_8rem] items-center gap-2 px-3 py-2 text-left hover:bg-slate-50"
                                  >
                                    <div
                                      className="relative flex min-w-0 items-center gap-2 pl-16"
                                      onMouseEnter={cancelCreateMenuClose}
                                      onMouseLeave={scheduleCreateMenuClose}
                                    >
                                      <button
                                        type="button"
                                        onClick={() => onOpenStory(story.id)}
                                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                                      >
                                        <span className="inline-block size-3.5 shrink-0" aria-hidden />
                                        <span className="truncate text-[15px] text-slate-800">
                                          {story.icon} {story.title}
                                        </span>
                                        <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[12px] font-semibold text-slate-600">
                                          #{storyRefById[story.id] ?? story.id.slice(0, 6)}
                                        </span>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          setOpenCreateMenuKey((prev) => (prev === `story:${story.id}` ? null : `story:${story.id}`));
                                        }}
                                        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded opacity-0 ring-1 ring-slate-200 transition hover:bg-white hover:text-slate-900 group-hover:opacity-100"
                                        title="Add from this row"
                                      >
                                        <Plus className="size-3.5 text-slate-600" />
                                      </button>
                                      {openCreateMenuKey === `story:${story.id}` ? (
                                        <div className="absolute left-full top-1/2 z-30 ml-2 w-52 -translate-y-1/2 rounded-xl border border-slate-200/90 bg-white/95 p-2 shadow-xl backdrop-blur-sm">
                                          <button
                                            type="button"
                                            onClick={() =>
                                              openCreateComposer({
                                                anchorKey: `story:${story.id}`,
                                                scope: "story",
                                                kind: "story",
                                                epicId: epic.id,
                                              })
                                            }
                                            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[14px] font-medium text-slate-700 hover:bg-slate-50"
                                          >
                                            <FileText className="size-3.5 text-slate-500" />
                                            Add user story
                                          </button>
                                        </div>
                                      ) : null}
                                    </div>
                                    <span className="text-[15px] text-slate-700">{initiative.year}</span>
                                    <span className="text-[15px] text-slate-700">
                                      {quarterFromMonth(epic.planStartMonth ?? initiative.startMonth)}
                                    </span>
                                    <span className="text-[15px] text-slate-700">{monthLabel(epic.planStartMonth ?? initiative.startMonth)}</span>
                                    <span className={cn("w-fit rounded px-2 py-0.5 text-[13px] font-medium", statusChip(story.status))}>
                                      {story.status === "inProgress" ? "In progress" : story.status}
                                    </span>
                                    <span className="text-[15px] text-slate-700">{sprintLabel(story.sprint)}</span>
                                    <span className="truncate text-[15px] text-slate-700">{story.assignee?.trim() || "Unassigned"}</span>
                                    <span className="text-[15px] text-slate-700">{story.estimatedDays ?? 0}d</span>
                                    <span className="text-[15px] text-slate-700">{story.daysLeft ?? 0}d</span>
                                    </div>
                                  {createSelection?.anchorKey === `story:${story.id}` ? (
                                    <form
                                      onSubmit={handleCreateSubmit}
                                      className="grid grid-cols-[minmax(18rem,1fr)_5rem_4rem_6rem_9rem_8rem_10rem_8rem_8rem] items-center gap-2 bg-slate-50 px-3 py-2"
                                    >
                                      <div className="flex min-w-0 items-center gap-2 pl-16">
                                        <input
                                          value={createDraftTitle}
                                          onChange={(event) => setCreateDraftTitle(event.target.value)}
                                          placeholder="Type user story title and press Enter..."
                                          autoComplete="off"
                                          autoCorrect="off"
                                          autoCapitalize="none"
                                          spellCheck={false}
                                          data-1p-ignore="true"
                                          data-lpignore="true"
                                          data-bwignore="true"
                                          data-form-type="other"
                                          data-protonpass-ignore="true"
                                          className="h-9 w-full rounded-md bg-white px-2.5 text-[14px] outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-ring/40"
                                          autoFocus
                                        />
                                      </div>
                                      <div className="col-span-8 flex items-center gap-2">
                                        <button
                                          type="submit"
                                          disabled={createDraftTitle.trim().length < 2 || submittingKey === "create"}
                                          className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-slate-900 text-white disabled:cursor-not-allowed disabled:opacity-45"
                                        >
                                          <Plus className="size-3.5" />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={closeInlineCreator}
                                          className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-white text-slate-600 ring-1 ring-slate-200"
                                        >
                                          <X className="size-3.5" />
                                        </button>
                                      </div>
                                    </form>
                                  ) : null}
                                  </div>
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
