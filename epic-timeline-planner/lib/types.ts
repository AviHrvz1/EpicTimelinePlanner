import { InitiativeStatus, StoryStatus } from "@/lib/generated/prisma";

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
  sprint: number | null;
  estimatedDays: number | null;
  daysLeft: number | null;
  status: StoryStatus;
  epicId: string;
  comments: StoryCommentItem[];
  history: StoryHistoryItem[];
  createdAt: string | Date;
  updatedAt: string | Date;
};

export type EpicItem = {
  id: string;
  title: string;
  icon: string;
  description: string | null;
  assignee: string | null;
  color: string;
  initiativeId: string;
  planSprint: number | null;
  planStartMonth: number | null;
  planEndMonth: number | null;
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
  timelineRow: number;
  year: number;
  epics: EpicItem[];
  comments: InitiativeCommentItem[];
  history: InitiativeHistoryItem[];
  createdAt: string | Date;
  updatedAt: string | Date;
};
