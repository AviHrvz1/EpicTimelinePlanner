import { StoryStatus } from "@/lib/generated/prisma";
import { EpicItem, UserStoryItem } from "@/lib/types";

export type EstimateSource = "auto" | "original" | "stories";

export function storyEstimateDaysSum(stories: Array<Pick<UserStoryItem, "estimatedDays">>): number {
  return stories.reduce((sum, story) => sum + Math.max(0, Number(story.estimatedDays ?? 0)), 0);
}

export function epicStoryEstimateDaysSum(epic: Pick<EpicItem, "userStories">): number {
  return storyEstimateDaysSum(epic.userStories ?? []);
}

export function epicOriginalEstimateDays(epic: Pick<EpicItem, "originalEstimateDays">): number {
  return Math.max(0, Number(epic.originalEstimateDays ?? 0));
}

export function epicEffectiveEstimateDays(
  epic: Pick<EpicItem, "userStories" | "originalEstimateDays">,
  source: EstimateSource,
): number {
  const storySum = epicStoryEstimateDaysSum(epic);
  const original = epicOriginalEstimateDays(epic);
  if (source === "stories") return storySum;
  if (source === "original") return original;
  return storySum > 0 ? storySum : original;
}

export function epicForBurndown(epic: EpicItem, source: EstimateSource): EpicItem {
  if (source === "stories") return epic;
  if (source === "auto" && epicStoryEstimateDaysSum(epic) > 0) return epic;
  const estimate = epicOriginalEstimateDays(epic);
  return {
    ...epic,
    userStories:
      estimate > 0
        ? [
            {
              id: `${epic.id}::orig-est`,
              title: `${epic.title} (original estimate)`,
              icon: "📄",
              description: null,
              assignee: epic.assignee ?? null,
              planYear: epic.planYear ?? null,
              planQuarter: epic.planQuarter ?? null,
              sprint: null,
              estimatedDays: estimate,
              daysLeft: estimate,
              status: StoryStatus.todo,
              epicId: epic.id,
              comments: [],
              history: [],
              createdAt: epic.createdAt,
              updatedAt: epic.updatedAt,
            },
          ]
        : [],
  };
}
