"use client";

import { EpicPlanBar } from "@/components/timeline/epic-plan-bar";
import { EpicItem } from "@/lib/types";
import { cn } from "@/lib/utils";

type EpicPlanBlockProps = {
  epic: EpicItem;
  onOpenEpic: () => void;
  onOpenStory?: (storyId: string) => void;
  /** Month sprint-plan view keeps the Gantt clean; chips are off unless explicitly enabled. */
  showUnscheduledStories?: boolean;
};

/** Epic bar on the sprint plan; optional unscheduled story chips below when enabled. */
export function EpicPlanBlock({
  epic,
  onOpenEpic,
  onOpenStory,
  showUnscheduledStories = false,
}: EpicPlanBlockProps) {
  const unscheduled = (epic.userStories ?? []).filter((s) => s.sprint == null);
  const showChips = showUnscheduledStories && unscheduled.length > 0;

  return (
    <div
      className={cn(
        "rounded-lg border border-slate-200/90 bg-white/70 p-1.5 shadow-sm ring-1 ring-black/[0.04]",
        showChips && "pb-2",
      )}
    >
      <EpicPlanBar id={epic.id} title={epic.title} icon={epic.icon} color={epic.color} onClick={onOpenEpic} />
      {showChips ? (
        <div className="mt-1.5 border-t border-dashed border-slate-200/90 pt-1.5">
          <p className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-slate-500">Unscheduled</p>
          <div className="flex flex-wrap gap-1">
            {unscheduled.map((story) => (
              <button
                key={story.id}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenStory?.(story.id);
                }}
                className="max-w-[10rem] truncate rounded-full border border-amber-200/80 bg-amber-50 px-2 py-0.5 text-left text-[9px] font-medium leading-tight text-amber-950 transition hover:bg-amber-100"
                title={story.title}
              >
                {story.icon ? <span className="mr-0.5">{story.icon}</span> : null}
                {story.title}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
