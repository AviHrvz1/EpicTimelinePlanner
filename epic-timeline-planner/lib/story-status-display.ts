import { StoryStatus } from "@/lib/generated/prisma";

/**
 * Display strings + visual metadata for the four `StoryStatus` values.
 * Owns the user-facing names so renames don't have to thread through
 * every chart, badge, and dropdown one by one.
 *
 * Lifecycle:
 *   - `todo`       — backlog, not yet started
 *   - `inProgress` — actively being worked
 *   - `review`     — code review / testing / QA — engineering work is
 *                    complete but hasn't been shipped/accepted yet
 *   - `done`       — accepted; terminal state; stays on closed sprint
 *                    board after a manual move
 */
export const STORY_STATUS_LABELS: Record<StoryStatus, string> = {
  todo: "To Do",
  inProgress: "In Progress",
  review: "Review / Testing",
  done: "Done",
};

/** Left-to-right kanban column order — `todo` at the left, terminal at the right. */
export const STORY_STATUS_ORDERED: readonly StoryStatus[] = [
  StoryStatus.todo,
  StoryStatus.inProgress,
  StoryStatus.review,
  StoryStatus.done,
];

/** Hex palette for analytics charts (pie, CFD, workload bar). Emerald is
 *  reserved for the terminal `done` column so green keeps the "actually
 *  shipped" meaning planners expect. */
export const STORY_STATUS_COLOR_HEX: Record<StoryStatus, string> = {
  todo: "#f59e0b",       // amber-500
  inProgress: "#3b82f6", // blue-500
  review: "#8b5cf6",     // violet-500
  done: "#10b981",       // emerald-500
};

/** Tailwind border/background/text classes for status pills. Matches the
 *  hex palette above. */
export const STORY_STATUS_BADGE_CLASS: Record<StoryStatus, string> = {
  todo: "border-amber-200/80 bg-amber-50 text-amber-800",
  inProgress: "border-blue-200/80 bg-blue-50 text-blue-800",
  review: "border-violet-200/80 bg-violet-50 text-violet-800",
  done: "border-emerald-200/80 bg-emerald-50 text-emerald-800",
};

export function storyStatusLabel(status: StoryStatus): string {
  return STORY_STATUS_LABELS[status];
}
