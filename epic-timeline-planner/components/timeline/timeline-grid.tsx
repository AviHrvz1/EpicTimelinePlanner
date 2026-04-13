"use client";

import { useDraggable, useDroppable } from "@dnd-kit/core";
import { StoryStatus } from "@prisma/client";
import { BadgeCheck, CheckCircle2, ChevronLeft, ChevronRight, CircleDashed, Flag, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { InitiativeTimelineBar } from "@/components/timeline/epic-timeline-bar";
import { Button } from "@/components/ui/button";
import { MONTHS, QUARTERS } from "@/lib/timeline";
import { InitiativeItem } from "@/lib/types";
import { cn } from "@/lib/utils";

type TimelineGridProps = {
  initiatives: InitiativeItem[];
  zoom: number;
  focusedQuarterLabel: string | null;
  onFocusedQuarterChange: (quarterLabel: string | null) => void;
  onSprintModeChange: (active: boolean, activeMonth: number | null) => void;
  onOpenStory: (storyId: string) => void;
  onOpenInitiative: (initiativeId: string) => void;
  onResizeInitiativeRange?: (initiativeId: string, startMonth: number, endMonth: number) => void;
};

const QUARTER_YEAR_FRACTION: Record<string, number> = {
  Q1: 0.25,
  Q2: 0.5,
  Q3: 0.75,
  Q4: 1,
};

function quarterWedgePath(frac: number): string | null {
  if (frac >= 1 - 1e-6) return null;
  const cx = 12;
  const cy = 12;
  const r = 8;
  const start = -Math.PI / 2;
  const end = start + frac * 2 * Math.PI;
  const x1 = cx + r * Math.cos(start);
  const y1 = cy + r * Math.sin(start);
  const x2 = cx + r * Math.cos(end);
  const y2 = cy + r * Math.sin(end);
  const largeArc = frac > 0.5 ? 1 : 0;
  return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
}

function QuarterYearProgressIcon({
  quarterLabel,
  className,
}: {
  quarterLabel: string;
  className?: string;
}) {
  const frac = QUARTER_YEAR_FRACTION[quarterLabel] ?? 0.25;
  const wedge = quarterWedgePath(frac);

  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("size-[18px] shrink-0", className)}
      aria-hidden
    >
      <circle
        cx={12}
        cy={12}
        r={8}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.25}
        className="opacity-40"
      />
      {frac >= 1 - 1e-6 ? (
        <circle cx={12} cy={12} r={7} fill="currentColor" className="opacity-95" />
      ) : wedge ? (
        <path d={wedge} fill="currentColor" className="opacity-95" />
      ) : null}
    </svg>
  );
}

function SprintKanbanColumn({
  label,
  status,
  stories,
  onOpenStory,
}: {
  label: string;
  status: StoryStatus;
  stories: Array<{ id: string; icon: string; title: string; epicTitle: string }>;
  onOpenStory: (storyId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `kanban:${status}` });
  const statusTone: Record<StoryStatus, { column: string; chip: string; title: string }> = {
    [StoryStatus.todo]: {
      column: "bg-slate-50/80",
      chip: "bg-slate-100 text-slate-700",
      title: "text-slate-700",
    },
    [StoryStatus.inProgress]: {
      column: "bg-blue-50/75",
      chip: "bg-blue-100 text-blue-700",
      title: "text-blue-700",
    },
    [StoryStatus.done]: {
      column: "bg-emerald-50/75",
      chip: "bg-emerald-100 text-emerald-700",
      title: "text-emerald-700",
    },
    [StoryStatus.approved]: {
      column: "bg-violet-50/75",
      chip: "bg-violet-100 text-violet-700",
      title: "text-violet-700",
    },
  };
  const statusIcon: Record<StoryStatus, React.ComponentType<{ className?: string }>> = {
    [StoryStatus.todo]: CircleDashed,
    [StoryStatus.inProgress]: LoaderCircle,
    [StoryStatus.done]: CheckCircle2,
    [StoryStatus.approved]: BadgeCheck,
  };
  const StatusIcon = statusIcon[status];

  function DraggableKanbanStoryCard({
    story,
  }: {
    story: { id: string; icon: string; title: string; epicTitle: string };
  }) {
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
      id: `story:kanban:${story.id}`,
    });

    return (
      <div
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        className={cn(
          "cursor-grab rounded-md bg-white px-3 py-2 active:cursor-grabbing",
          isDragging && "opacity-60",
        )}
        style={{
          transform: transform
            ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
            : undefined,
          zIndex: isDragging ? 20 : undefined,
        }}
      >
        <p className="text-xs font-medium">
          <span className="mr-1">{story.icon === "🧩" ? "📄" : (story.icon || "📄")}</span>
          {story.title}
        </p>
        <div className="mt-1 flex items-center justify-between gap-2">
          <p className="text-[10px] text-muted-foreground">{story.epicTitle}</p>
          <Button
            size="xs"
            variant="ghost"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onOpenStory(story.id);
            }}
          >
            Edit
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex h-full min-h-[320px] flex-col rounded-xl p-3 transition",
        statusTone[status].column,
        isOver && "bg-white/80 shadow-sm",
      )}
    >
      <div className="mb-3 flex items-center justify-between">
        <p className={cn("inline-flex items-center gap-1.5 text-[12px] font-semibold tracking-[0.01em]", statusTone[status].title)}>
          <StatusIcon className="size-3.5" />
          {label}
        </p>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-semibold shadow-sm",
            statusTone[status].chip,
          )}
        >
          {stories.length}
        </span>
      </div>
      <div className="flex-1 space-y-2 rounded-lg bg-white/70 p-2">
        {stories.length === 0 ? (
          <p className="p-1 text-xs text-muted-foreground">Drop story here</p>
        ) : (
          stories.map((story) => <DraggableKanbanStoryCard key={story.id} story={story} />)
        )}
      </div>
    </div>
  );
}

function MonthDropCell({ month, idSuffix }: { month: number; idSuffix?: string }) {
  const droppableId = idSuffix ? `month:${month}:${idSuffix}` : `month:${month}`;
  const { setNodeRef, isOver } = useDroppable({ id: droppableId });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "h-12 rounded-md border border-dashed border-border bg-muted/30 transition",
        isOver && "border-primary bg-primary/10",
      )}
    />
  );
}

export function TimelineGrid({
  initiatives,
  zoom,
  focusedQuarterLabel,
  onFocusedQuarterChange,
  onSprintModeChange,
  onOpenStory,
  onOpenInitiative,
  onResizeInitiativeRange,
}: TimelineGridProps) {
  const [focusedMonth, setFocusedMonth] = useState<number | null>(null);
  const [focusedSprint, setFocusedSprint] = useState<number | null>(null);
  const barElsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const [resizePreview, setResizePreview] = useState<{
    initiativeId: string;
    side: "left" | "right";
    deltaMonths: number;
  } | null>(null);

  const handleResizePointerDown = useCallback(
    (initiativeId: string, side: "left" | "right", event: React.PointerEvent<HTMLDivElement>) => {
      if (!onResizeInitiativeRange) return;
      const commitResize = onResizeInitiativeRange;
      const barEl = barElsRef.current.get(initiativeId);
      if (!barEl) return;

      event.preventDefault();
      event.stopPropagation();

      const initiative = initiatives.find((i) => i.id === initiativeId);
      if (!initiative || initiative.startMonth == null || initiative.endMonth == null) return;

      const handle = event.currentTarget;
      const pointerId = event.pointerId;
      handle.setPointerCapture(pointerId);

      const startX = event.clientX;
      const barWidth = barEl.getBoundingClientRect().width;
      const span = Math.max(initiative.endMonth - initiative.startMonth + 1, 1);
      const monthWidthPx = barWidth / span;
      const startMonth = initiative.startMonth;
      const endMonth = initiative.endMonth;

      setResizePreview({ initiativeId, side, deltaMonths: 0 });

      function onPointerMove(e: PointerEvent) {
        if (e.pointerId !== pointerId) return;
        e.preventDefault();
        const deltaPx = e.clientX - startX;
        const snapped = Math.round(deltaPx / monthWidthPx);
        setResizePreview((prev) => {
          if (prev && prev.deltaMonths === snapped) return prev;
          return { initiativeId, side, deltaMonths: snapped };
        });
      }

      function onPointerUp(e: PointerEvent) {
        if (e.pointerId !== pointerId) return;
        handle.removeEventListener("pointermove", onPointerMove);
        handle.removeEventListener("pointerup", onPointerUp);
        handle.removeEventListener("pointercancel", onPointerUp);

        const deltaPx = e.clientX - startX;
        const deltaMonths = Math.round(deltaPx / monthWidthPx);

        if (deltaMonths !== 0) {
          if (side === "right") {
            const nextEnd = Math.min(12, Math.max(startMonth, endMonth + deltaMonths));
            if (nextEnd !== endMonth) {
              commitResize(initiativeId, startMonth, nextEnd);
            }
          } else {
            const nextStart = Math.max(1, Math.min(endMonth, startMonth + deltaMonths));
            if (nextStart !== startMonth) {
              commitResize(initiativeId, nextStart, endMonth);
            }
          }
        }

        setResizePreview(null);
      }

      handle.addEventListener("pointermove", onPointerMove);
      handle.addEventListener("pointerup", onPointerUp);
      handle.addEventListener("pointercancel", onPointerUp);
    },
    [initiatives, onResizeInitiativeRange],
  );

  const scheduledInitiatives = initiatives.filter(
    (i) => i.status === "scheduled" && i.startMonth && i.endMonth,
  );
  const focusedQuarter = useMemo(
    () => QUARTERS.find((quarter) => quarter.label === focusedQuarterLabel) ?? null,
    [focusedQuarterLabel],
  );
  const visibleMonths = focusedQuarter
    ? [...focusedQuarter.months]
    : Array.from({ length: 12 }, (_, index) => index + 1);
  const visibleQuarterHeaders = focusedQuarter ? [focusedQuarter] : QUARTERS;
  const monthWidth = Math.round(90 * zoom);
  const sprintLabels = ["Sprint 1 (Weeks 1-2)", "Sprint 2 (Weeks 3-4)"];
  const visibleSprints = focusedSprint
    ? [{ label: sprintLabels[focusedSprint - 1], sprint: focusedSprint }]
    : sprintLabels.map((label, index) => ({ label, sprint: index + 1 }));
  const sprintKanbanColumns: Array<{ label: string; status: StoryStatus }> = [
    { label: "To Do", status: StoryStatus.todo },
    { label: "In Progress", status: StoryStatus.inProgress },
    { label: "Done", status: StoryStatus.done },
    { label: "Approved", status: StoryStatus.approved },
  ];
  const focusedMonthIsVisible = focusedMonth ? visibleMonths.includes(focusedMonth) : false;
  const activeMonth = focusedMonthIsVisible ? focusedMonth : null;
  const activeSprintLabel = focusedSprint ? sprintLabels[focusedSprint - 1] : null;
  const quarterLabelByMonth = new Map<number, string>(
    QUARTERS.flatMap((quarter) => quarter.months.map((month) => [month, quarter.label] as const)),
  );
  const quarterTone: Record<string, { active: string; idle: string }> = {
    Q1: {
      active:
        "border-blue-400 bg-gradient-to-r from-blue-500 to-sky-500 text-white shadow-md ring-2 ring-blue-200",
      idle:
        "border-blue-200 bg-gradient-to-r from-blue-50 to-sky-50 text-blue-800 shadow-sm hover:from-blue-100 hover:to-sky-100",
    },
    Q2: {
      active:
        "border-cyan-400 bg-gradient-to-r from-cyan-500 to-teal-500 text-white shadow-md ring-2 ring-cyan-200",
      idle:
        "border-cyan-200 bg-gradient-to-r from-cyan-50 to-teal-50 text-cyan-800 shadow-sm hover:from-cyan-100 hover:to-teal-100",
    },
    Q3: {
      active:
        "border-emerald-400 bg-gradient-to-r from-emerald-500 to-lime-500 text-white shadow-md ring-2 ring-emerald-200",
      idle:
        "border-emerald-200 bg-gradient-to-r from-emerald-50 to-lime-50 text-emerald-800 shadow-sm hover:from-emerald-100 hover:to-lime-100",
    },
    Q4: {
      active:
        "border-violet-400 bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-md ring-2 ring-violet-200",
      idle:
        "border-violet-200 bg-gradient-to-r from-violet-50 to-fuchsia-50 text-violet-800 shadow-sm hover:from-violet-100 hover:to-fuchsia-100",
    },
  };
  const monthToneByQuarter: Record<string, string> = {
    Q1: "bg-blue-50 text-blue-800 hover:bg-blue-100",
    Q2: "bg-cyan-50 text-cyan-800 hover:bg-cyan-100",
    Q3: "bg-emerald-50 text-emerald-800 hover:bg-emerald-100",
    Q4: "bg-violet-50 text-violet-800 hover:bg-violet-100",
  };
  const monthViewStyle: CSSProperties = {
    gridTemplateColumns: `repeat(${visibleSprints.length}, minmax(0, 1fr))`,
  };
  const gridStyle: CSSProperties = {
    gridTemplateColumns: activeMonth
      ? `repeat(1, minmax(0, 1fr))`
      : focusedQuarter
      ? `repeat(${visibleMonths.length}, minmax(0, 1fr))`
      : `repeat(12, minmax(${monthWidth}px, 1fr))`,
  };

  const viewStartMonth = focusedQuarter?.months[0] ?? activeMonth ?? 1;
  const viewEndMonth =
    focusedQuarter?.months[focusedQuarter.months.length - 1] ?? activeMonth ?? 12;
  const sprintStories = initiatives
    .filter((initiative) => {
      if (initiative.status !== "scheduled") return false;
      if (!initiative.startMonth || !initiative.endMonth) return false;
      return initiative.endMonth >= viewStartMonth && initiative.startMonth <= viewEndMonth;
    })
    .flatMap((initiative) =>
      (initiative.epics ?? []).flatMap((epic) =>
        (epic.userStories ?? []).map((story) => ({
          ...story,
          epicTitle: epic.title,
        })),
      ),
    );
  const visibleKanbanSprints = focusedSprint ? [focusedSprint] : [1, 2];

  useEffect(() => {
    onSprintModeChange(Boolean(focusedSprint), activeMonth);
  }, [focusedSprint, activeMonth, onSprintModeChange]);

  const breadcrumbItems: Array<{
    label: string;
    onClick: (() => void) | null;
  }> = [];

  if (focusedQuarter) {
    breadcrumbItems.push({
      label: focusedQuarter.label,
      onClick: () => {
        setFocusedMonth(null);
        setFocusedSprint(null);
      },
    });
  } else if (activeMonth) {
    breadcrumbItems.push({
      label: "All Quarters",
      onClick: () => {
        setFocusedMonth(null);
        setFocusedSprint(null);
      },
    });
  } else {
    breadcrumbItems.push({ label: "All Quarters", onClick: null });
  }

  if (activeMonth) {
    breadcrumbItems.push({
      label: MONTHS[activeMonth - 1],
      onClick: () => {
        setFocusedSprint(null);
      },
    });
  }

  if (activeSprintLabel) {
    breadcrumbItems.push({
      label: activeSprintLabel,
      onClick: null,
    });
  } else if (activeMonth) {
    breadcrumbItems.push({
      label: "All Sprints",
      onClick: null,
    });
  }

  return (
    <div className="h-[72vh] w-full overflow-auto rounded-xl bg-card p-4 shadow-lg ring-1 ring-black/5">
      <div className="mb-3 flex items-center justify-between gap-3 rounded-lg bg-slate-100 px-3 py-2">
        <div className="flex items-center gap-1.5 text-[12px] font-medium tracking-[0.01em] text-slate-700">
          {breadcrumbItems.map((item, index) => (
            <div key={`${item.label}-${index}`} className="flex items-center gap-1.5">
              {item.onClick ? (
                <button
                  type="button"
                  onClick={item.onClick}
                  className="cursor-pointer rounded-md bg-white px-2 py-0.5 text-sky-700 shadow-sm ring-1 ring-sky-200 transition hover:bg-sky-50 hover:text-sky-800 hover:ring-sky-300 active:scale-[0.98]"
                >
                  {item.label}
                </button>
              ) : (
                <span className="rounded-md bg-white px-2 py-0.5 text-slate-700 shadow-sm ring-1 ring-black/5">
                  {item.label}
                </span>
              )}
              {index < breadcrumbItems.length - 1 ? (
                <span className="text-slate-400">/</span>
              ) : null}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {(focusedQuarter || focusedMonth || focusedSprint) ? (
            <button
              type="button"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-white text-slate-700 shadow-sm ring-1 ring-black/5"
              onClick={() => {
                if (focusedSprint) {
                  setFocusedSprint(null);
                  return;
                }
                if (focusedMonth) {
                  setFocusedMonth(null);
                  return;
                }
                onFocusedQuarterChange(null);
              }}
              aria-label="Go back"
            >
              <ChevronLeft className="size-4" />
            </button>
          ) : null}
          {focusedQuarter ? (
            <button
              type="button"
              className="rounded-md bg-white px-2 py-1 text-[12px] font-medium shadow-sm ring-1 ring-black/5"
              onClick={() => {
                setFocusedMonth(null);
                setFocusedSprint(null);
                onFocusedQuarterChange(null);
              }}
            >
              ⌂ Roadmap
            </button>
          ) : null}
          {(focusedMonth || focusedSprint) ? (
            <button
              type="button"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-white text-slate-700 shadow-sm ring-1 ring-black/5"
              onClick={() => {
                if (focusedMonth && !focusedSprint) {
                  setFocusedSprint(1);
                }
              }}
              aria-label="Go forward"
              disabled={Boolean(focusedSprint)}
            >
              <ChevronRight className="size-4" />
            </button>
          ) : null}
        </div>
      </div>
      {!activeMonth ? (
        <div className={cn("mb-4 grid gap-2", !focusedQuarter && "min-w-max")} style={gridStyle}>
          {visibleQuarterHeaders.map((quarter) => (
            <button
              key={quarter.label}
              type="button"
              onClick={() => {
                setFocusedMonth(null);
                setFocusedSprint(null);
                onFocusedQuarterChange(focusedQuarterLabel === quarter.label ? null : quarter.label);
              }}
              className={cn(
                "flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-center text-[12px] font-semibold tracking-[0.02em] transition duration-200",
                focusedQuarterLabel === quarter.label
                  ? quarterTone[quarter.label]?.active ?? "border-primary/30 bg-primary/10 text-primary"
                  : quarterTone[quarter.label]?.idle ?? "border-border/40 bg-muted text-muted-foreground",
              )}
              style={{ gridColumn: `span ${quarter.months.length} / span ${quarter.months.length}` }}
            >
              <QuarterYearProgressIcon quarterLabel={quarter.label} />
              <span>{`Quarter ${quarter.label.replace("Q", "")}`}</span>
            </button>
          ))}
        </div>
      ) : null}
      {activeMonth ? (
        <div className="mb-4 space-y-3 rounded-xl bg-slate-50/70 p-3">
          <div className="grid gap-2" style={monthViewStyle}>
            {visibleSprints.map(({ label, sprint }) => (
              <div key={label} className="space-y-2 rounded-lg bg-white p-2.5 shadow-sm">
                <button
                  type="button"
                  className={cn(
                    "w-full rounded-lg border py-1.5 text-center text-[12px] font-semibold tracking-[0.01em] transition",
                    focusedSprint === sprint
                      ? sprint === 1
                        ? "border-blue-300 bg-blue-100 text-blue-800 ring-1 ring-blue-200"
                        : "border-violet-300 bg-violet-100 text-violet-800 ring-1 ring-violet-200"
                      : sprint === 1
                        ? "border-blue-200 bg-blue-50 text-blue-700 hover:border-blue-300 hover:bg-blue-100"
                        : "border-violet-200 bg-violet-50 text-violet-700 hover:border-violet-300 hover:bg-violet-100",
                  )}
                  onClick={() => setFocusedSprint((current) => (current === sprint ? null : sprint))}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Flag className="size-3.5" />
                    {label}
                  </span>
                </button>
              </div>
            ))}
          </div>
          <div className="space-y-3 rounded-xl bg-slate-50/70 p-3.5 shadow-sm">
            <div className={cn("grid gap-4", focusedSprint ? "grid-cols-1" : "grid-cols-1 xl:grid-cols-2")}>
              {visibleKanbanSprints.map((sprintNumber) => (
                <div key={`kanban-sprint-${sprintNumber}`} className="space-y-2 rounded-lg bg-white p-3 shadow-sm">
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    {sprintKanbanColumns.map((column) => (
                      <SprintKanbanColumn
                        key={`${sprintNumber}-${column.status}`}
                        label={column.label}
                        status={column.status}
                        stories={sprintStories.filter(
                          (story) => story.sprint === sprintNumber && story.status === column.status,
                        )}
                        onOpenStory={onOpenStory}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className={cn("mb-4 grid gap-2", !focusedQuarter && "min-w-max")} style={gridStyle}>
          {visibleMonths.map((month) => (
            <div
              key={month}
              className={cn(
                "space-y-2",
                !focusedQuarter && [4, 7, 10].includes(month) && "border-l-2 border-slate-300/80 pl-2",
              )}
            >
              <button
                type="button"
                className={cn(
                  "w-full rounded-lg py-1.5 text-center text-[12px] font-medium transition",
                  activeMonth === month
                    ? "bg-blue-100 text-blue-800 shadow-sm ring-1 ring-blue-200"
                    : monthToneByQuarter[quarterLabelByMonth.get(month) ?? ""] ??
                        "bg-slate-100 text-slate-700 hover:bg-slate-200",
                )}
                onClick={() => {
                  setFocusedSprint(null);
                  setFocusedMonth(month);
                }}
              >
                {MONTHS[month - 1]}
              </button>
              <MonthDropCell month={month} />
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2">
        {activeMonth ? null : scheduledInitiatives.length === 0 ? (
          <p className="rounded-md bg-muted/40 p-3 text-[13px] leading-5 text-slate-600">
            Drag initiatives from the left panel to any month to schedule them.
          </p>
        ) : (
          scheduledInitiatives.map((initiative) => {
            const start = initiative.startMonth ?? 1;
            const end = initiative.endMonth ?? start;
            const quarterStart = focusedQuarter?.months[0] ?? 1;
            const quarterEnd = focusedQuarter?.months[focusedQuarter.months.length - 1] ?? 12;

            if (focusedQuarter && (end < quarterStart || start > quarterEnd)) {
              return null;
            }

            const visibleStart = Math.max(start, quarterStart);
            const visibleEnd = Math.min(end, quarterEnd);
            const span = Math.max(visibleEnd - visibleStart + 1, 1);
            const columnStart = focusedQuarter ? visibleStart - quarterStart + 1 : visibleStart;

            const rz = resizePreview?.initiativeId === initiative.id ? resizePreview : null;

            let previewColumnStart = columnStart;
            let previewSpan = span;
            if (rz) {
              if (rz.side === "right") {
                const newEnd = Math.min(12, Math.max(start, end + rz.deltaMonths));
                previewSpan = Math.max(newEnd - start + 1, 1);
                if (focusedQuarter) {
                  const qStart = focusedQuarter.months[0];
                  const qEnd = focusedQuarter.months[focusedQuarter.months.length - 1];
                  const visEnd = Math.min(newEnd, qEnd);
                  const visStart = Math.max(start, qStart);
                  previewSpan = Math.max(visEnd - visStart + 1, 1);
                }
              } else {
                const newStart = Math.max(1, Math.min(end, start + rz.deltaMonths));
                if (focusedQuarter) {
                  const qStart = focusedQuarter.months[0];
                  const qEnd = focusedQuarter.months[focusedQuarter.months.length - 1];
                  const visStart = Math.max(newStart, qStart);
                  const visEnd = Math.min(end, qEnd);
                  previewColumnStart = visStart - qStart + 1;
                  previewSpan = Math.max(visEnd - visStart + 1, 1);
                } else {
                  previewColumnStart = newStart;
                  previewSpan = Math.max(end - newStart + 1, 1);
                }
              }
            }

            const chevronClass =
              "z-30 flex size-6 shrink-0 cursor-ew-resize touch-none items-center justify-center rounded-md border border-slate-200/90 bg-white/95 text-slate-600 shadow-sm select-none hover:bg-white hover:text-slate-900";

            return (
              <div
                key={initiative.id}
                className={cn("relative grid gap-2", !focusedQuarter && "min-w-max")}
                style={gridStyle}
              >
                {!focusedQuarter
                  ? [4, 7, 10].map((monthStart) => (
                      <div
                        key={`quarter-separator-${initiative.id}-${monthStart}`}
                        className="pointer-events-none border-l-2 border-slate-300/70"
                        style={{ gridColumn: `${monthStart} / span 1`, gridRow: 1 }}
                      />
                    ))
                  : null}
                {onResizeInitiativeRange ? (
                  <div
                    className={chevronClass}
                    style={{
                      gridColumn: previewColumnStart,
                      gridRow: 1,
                      justifySelf: "start",
                      alignSelf: "center",
                      transform: "translateX(calc(-100% - 4px))",
                    }}
                    onPointerDown={(e) => handleResizePointerDown(initiative.id, "left", e)}
                  >
                    <ChevronLeft className="pointer-events-none size-3.5" strokeWidth={2.5} />
                  </div>
                ) : null}
                <div
                  ref={(node) => {
                    if (node) barElsRef.current.set(initiative.id, node);
                    else barElsRef.current.delete(initiative.id);
                  }}
                  className="relative min-w-0 py-0.5"
                  style={{ gridColumn: `${previewColumnStart} / span ${previewSpan}`, gridRow: 1 }}
                >
                  <InitiativeTimelineBar
                    id={initiative.id}
                    title={initiative.title}
                    color={initiative.color}
                    isResizing={Boolean(rz)}
                    onClick={() => onOpenInitiative(initiative.id)}
                  />
                </div>
                {onResizeInitiativeRange ? (
                  <div
                    className={chevronClass}
                    style={{
                      gridColumn: previewColumnStart + previewSpan - 1,
                      gridRow: 1,
                      justifySelf: "end",
                      alignSelf: "center",
                      transform: "translateX(calc(100% + 4px))",
                    }}
                    onPointerDown={(e) => handleResizePointerDown(initiative.id, "right", e)}
                  >
                    <ChevronRight className="pointer-events-none size-3.5" strokeWidth={2.5} />
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
