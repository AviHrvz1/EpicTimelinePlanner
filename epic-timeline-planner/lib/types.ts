import { InitiativeStatus, StoryStatus } from "@/lib/generated/prisma";

export type RoadmapItem = {
  id: string;
  name: string;
  years: number[];
  initiativeCount?: number;
  createdAt: string | Date;
  updatedAt: string | Date;
};

export type StoryCommentItem = {
  id: string;
  body: string;
  author: string | null;
  storyId: string;
  createdAt: string | Date;
};

export type StoryHistoryItem = {
  id: string;
  entry: string;
  userName: string | null;
  storyId: string;
  createdAt: string | Date;
};

export type StoryDailySnapshotItem = {
  id: string;
  storyId: string;
  snapshotDate: string | Date;
  status: StoryStatus;
  sprint: number | null;
  estimatedDays: number | null;
  daysLeft: number | null;
  assignee: string | null;
  /** Phase B: captured so closed-period views render with the original
   *  title / description / priority / labels even after later edits. All
   *  nullable for pre-migration rows; projection falls back to live story
   *  field when null. */
  title?: string | null;
  description?: string | null;
  priority?: string | null;
  labels?: string | null;
  createdAt: string | Date;
};

/**
 * Phase C: per-day snapshot of editable epic fields. Mirrors
 * {@link StoryDailySnapshotItem}. Closed-period views (sprint kanban,
 * sprint capacity, month/quarter team capacity, year insights) read from
 * here so renaming an epic or changing its estimate in the present doesn't
 * leak into the past. The projection helper falls back to the live
 * `epic.field` when a column is null (graceful for pre-migration rows).
 */
export type EpicDailySnapshotItem = {
  id: string;
  epicId: string;
  snapshotDate: string | Date;
  title: string | null;
  description: string | null;
  icon: string | null;
  color: string | null;
  originalEstimateDays: number | null;
  priority: string | null;
  labels: string | null;
  team: string | null;
  planStartMonth: number | null;
  planEndMonth: number | null;
  planSprint: number | null;
  planEndSprint: number | null;
  planStartDay: number | null;
  planEndDay: number | null;
  createdAt: string | Date;
};

export type EpicCommentItem = {
  id: string;
  body: string;
  author: string | null;
  epicId: string;
  createdAt: string | Date;
};

export type EpicHistoryItem = {
  id: string;
  entry: string;
  userName: string | null;
  epicId: string;
  createdAt: string | Date;
};

export type InitiativeCommentItem = {
  id: string;
  body: string;
  author: string | null;
  initiativeId: string;
  createdAt: string | Date;
};

export type InitiativeHistoryItem = {
  id: string;
  entry: string;
  userName: string | null;
  initiativeId: string;
  createdAt: string | Date;
};

export type UserStoryItem = {
  id: string;
  title: string;
  icon: string;
  description: string | null;
  assignee: string | null;
  labels: string | null;
  priority: string | null;
  roadmapId: string | null;
  planYear: number | null;
  planQuarter: number | null;
  sprint: number | null;
  estimatedDays: number | null;
  daysLeft: number | null;
  status: StoryStatus;
  /** Order within a sprint Kanban column (per status). */
  backlogOrder?: number;
  epicId: string;
  comments: StoryCommentItem[];
  history: StoryHistoryItem[];
  snapshots?: StoryDailySnapshotItem[];
  /** Phase D: soft-delete timestamp. NULL on active rows; non-null when the
   *  story has been removed from live views but its snapshots stay so
   *  closed-period kanban / capacity / charts still render the card. */
  deletedAt?: string | Date | null;
  createdAt: string | Date;
  updatedAt: string | Date;
};

export type EpicItem = {
  id: string;
  title: string;
  icon: string;
  description: string | null;
  assignee: string | null;
  /** Planner-entered estimate used before story estimates are available. */
  originalEstimateDays: number | null;
  color: string;
  initiativeId: string;
  roadmapId: string | null;
  planYear: number | null;
  planQuarter: number | null;
  planSprint: number | null;
  planStartMonth: number | null;
  planEndMonth: number | null;
  planEndSprint: number | null;
  planStartDay: number | null;
  planEndDay: number | null;
  timelineRow: number;
  /** Order in initiative backlog / epic list. */
  backlogOrder?: number;
  /** Month team board lane id, when assigned. */
  team: string | null;
  /** Free-form labels (comma-separated). */
  labels: string | null;
  /** Optional priority (P0..P3). */
  priority: string | null;
  /** Year-end continuation lineage — non-null when this epic was auto-created
   *  from an unfinished epic in a prior plan year. The continuation pill on
   *  cards reads this. */
  parentEpicId?: string | null;
  userStories: UserStoryItem[];
  comments: EpicCommentItem[];
  history: EpicHistoryItem[];
  /** Phase C: per-day snapshots of this epic's editable fields. Only
   *  populated when the loader explicitly includes them (closed-period
   *  views). Live views can leave this `undefined`. */
  epicSnapshots?: EpicDailySnapshotItem[];
  /** Phase D: soft-delete timestamp. NULL on active rows; non-null when the
   *  epic has been removed from live views but its history remains for
   *  closed-period rendering. */
  deletedAt?: string | Date | null;
  createdAt: string | Date;
  updatedAt: string | Date;
};

export type InitiativeItem = {
  id: string;
  title: string;
  icon: string;
  description: string | null;
  assignee: string | null;
  color: string;
  status: InitiativeStatus;
  startMonth: number | null;
  endMonth: number | null;
  startYearSprint: number | null;
  endYearSprint: number | null;
  timelineRow: number;
  year: number;
  roadmapId: string | null;
  /** Delivery team id; mirrors aggregate of epic.team. */
  team: string | null;
  /** Free-form labels (comma-separated). */
  labels: string | null;
  /** Year-end continuation lineage — non-null when this initiative was
   *  auto-created from an unfinished initiative in a prior plan year. */
  parentInitiativeId?: string | null;
  epics: EpicItem[];
  comments: InitiativeCommentItem[];
  history: InitiativeHistoryItem[];
  createdAt: string | Date;
  updatedAt: string | Date;
};
