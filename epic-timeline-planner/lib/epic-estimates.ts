import { StoryStatus } from "@/lib/generated/prisma";
import { EpicItem, UserStoryItem } from "@/lib/types";

export type EstimateSource = "auto" | "original" | "stories";

export function storyEstimateDaysSum(stories: Array<Pick<UserStoryItem, "estimatedDays">>): number {
  return stories.reduce((sum, story) => sum + Math.max(0, Number(story.estimatedDays ?? 0)), 0);
}

export function epicStoryEstimateDaysSum(epic: Pick<EpicItem, "userStories">): number {
  return storyEstimateDaysSum(epic.userStories ?? []);
}

/**
 * Applies a new combined story-estimate total by updating each story's `estimatedDays`.
 * Single story: assigns the full total. Multiple: proportional split from prior weights, or even split when prior sum is 0.
 */
export function distributeChildEstimatesAcrossStories(
  stories: Array<Pick<UserStoryItem, "id" | "estimatedDays">>,
  newTotalRounded: number,
): Array<{ id: string; estimatedDays: number }> {
  const n = stories.length;
  if (n === 0) return [];
  const total = Math.max(0, Math.round(Number(newTotalRounded) || 0));
  if (n === 1) {
    return [{ id: stories[0]!.id, estimatedDays: total }];
  }
  const oldWeights = stories.map((s) => Math.max(0, Number(s.estimatedDays ?? 0)));
  const oldSum = oldWeights.reduce((a, b) => a + b, 0);
  if (oldSum === 0) {
    const base = Math.floor(total / n);
    const rem = total - base * n;
    return stories.map((s, i) => ({
      id: s.id,
      estimatedDays: base + (i < rem ? 1 : 0),
    }));
  }
  const raw = oldWeights.map((w) => (w / oldSum) * total);
  const floors = raw.map((x) => Math.floor(x));
  const assigned = floors.reduce((a, b) => a + b, 0);
  let deficit = total - assigned;
  const order = raw
    .map((x, i) => ({ i, frac: x - floors[i]! }))
    .sort((a, b) => b.frac - a.frac);
  const bump = new Set<number>();
  for (let k = 0; k < deficit; k++) {
    const idx = order[k]?.i;
    if (idx !== undefined) bump.add(idx);
  }
  return stories.map((s, i) => ({
    id: s.id,
    estimatedDays: floors[i]! + (bump.has(i) ? 1 : 0),
  }));
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
              labels: null,
              priority: null,
              roadmapId: epic.roadmapId ?? null,
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
