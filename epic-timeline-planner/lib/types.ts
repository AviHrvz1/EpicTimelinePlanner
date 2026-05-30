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
  userStories: UserStoryItem[];
  comments: EpicCommentItem[];
  history: EpicHistoryItem[];
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
  epics: EpicItem[];
  comments: InitiativeCommentItem[];
  history: InitiativeHistoryItem[];
  createdAt: string | Date;
  updatedAt: string | Date;
};
