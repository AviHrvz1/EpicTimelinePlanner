import { NextRequest, NextResponse } from "next/server";

import type { ChartType } from "@/components/dashboard/types";

type CollectedParams = {
  chartType?: string;
  metric?: "daysLeft" | "storyCount";
  metricAsked?: boolean;
  year?: number;
  quarter?: number;   // 1–4
  quarterStr?: string; // "YYYY-QN"
  sprint?: number;    // year-sprint index
  team?: string;
  teamAsked?: boolean;
};

const CHART_TYPES: ChartType[] = ["velocity", "burndown", "epic-burndown", "cfd", "workload", "quarter-status", "story-status", "workload-balance", "sprint-load", "sprint-burnup", "epic-burnup"];
const NEEDS_SPRINT = new Set(["burndown", "epic-burndown", "cfd", "workload", "story-status", "workload-balance", "sprint-load", "sprint-burnup", "epic-burnup"]);
const NEEDS_METRIC = new Set(["burndown", "workload"]);

function nextStep(p: CollectedParams): Record<string, unknown> {
  if (!p.chartType) {
    return {
      type: "question",
      field: "chartType",
      text: "Which type of chart would you like to create?",
      widget: { kind: "options", choices: CHART_TYPES },
    };
  }

  // Ask metric (days left vs story count) for sprint-level charts
  if (NEEDS_METRIC.has(p.chartType) && !p.metricAsked) {
    return {
      type: "question",
      field: "metric",
      text: "What should the chart measure?",
      widget: { kind: "options", choices: ["Days left", "Story count"] },
    };
  }

  // velocity derives year from the quarter string — skip dedicated year step
  if (p.chartType !== "velocity" && p.year == null) {
    return {
      type: "question",
      field: "year",
      text: "Which year?",
      widget: { kind: "year_picker" },
    };
  }

  if (!p.quarterStr) {
    return {
      type: "question",
      field: "quarter",
      text: p.year ? `Which quarter of ${p.year}?` : "Which quarter?",
      widget: { kind: "quarter_picker" },
    };
  }

  if (NEEDS_SPRINT.has(p.chartType) && p.sprint == null) {
    return {
      type: "question",
      field: "sprint",
      text: `Which sprint of ${p.quarterStr}?`,
      widget: { kind: "sprint_picker", quarter: p.quarterStr },
    };
  }

  if (!p.teamAsked) {
    return {
      type: "question",
      field: "team",
      text: "Filter by a specific team? (optional)",
      widget: { kind: "team_picker" },
    };
  }

  return buildChart(p);
}

function buildChart(p: CollectedParams): Record<string, unknown> {
  const teamSuffix = p.team ? ` · ${p.team}` : "";
  let title = "";
  let params: Record<string, unknown> = {};

  switch (p.chartType) {
    case "velocity":
      title = `${p.quarterStr} Velocity${teamSuffix}`;
      params = { quarter: p.quarterStr, ...(p.team ? { team: p.team } : {}) };
      break;
    case "burndown": {
      const metricLabel = p.metric === "storyCount" ? "Story count" : "Days left";
      title = `${p.quarterStr} Sprint ${p.sprint} Burndown · ${metricLabel}${teamSuffix}`;
      params = { year: p.year, quarter: p.quarter, sprint: p.sprint, metric: p.metric ?? "daysLeft", ...(p.team ? { team: p.team } : {}) };
      break;
    }
    case "epic-burndown": {
      const metricLabel = p.metric === "storyCount" ? "Story count" : "Days left";
      title = `${p.quarterStr} Sprint ${p.sprint} Epic Burndown · ${metricLabel}${teamSuffix}`;
      params = { year: p.year, quarter: p.quarter, sprint: p.sprint, metric: p.metric ?? "storyCount", ...(p.team ? { team: p.team } : {}) };
      break;
    }
    case "cfd":
      title = `${p.quarterStr} Sprint ${p.sprint} Flow${teamSuffix}`;
      params = { year: p.year, quarter: p.quarter, sprint: p.sprint, ...(p.team ? { team: p.team } : {}) };
      break;
    case "workload":
      title = `${p.quarterStr} Sprint ${p.sprint} Workload${teamSuffix}`;
      params = { year: p.year, quarter: p.quarter, sprint: p.sprint, metric: p.metric ?? "daysLeft", ...(p.team ? { team: p.team } : {}) };
      break;
    case "quarter-status":
      title = `${p.quarterStr} Status${teamSuffix}`;
      params = { year: p.year, quarter: p.quarter, ...(p.team ? { team: p.team } : {}) };
      break;
    case "story-status":
      title = `Sprint ${p.sprint} User Stories Status${teamSuffix}`;
      params = { year: p.year, quarter: p.quarter, sprint: p.sprint, ...(p.team ? { team: p.team } : {}) };
      break;
    case "workload-balance":
      title = `Sprint ${p.sprint} Workload Balance${teamSuffix}`;
      params = { year: p.year, quarter: p.quarter, sprint: p.sprint, ...(p.team ? { team: p.team } : {}) };
      break;
    case "sprint-load":
      title = `Sprint ${p.sprint} Load${teamSuffix}`;
      params = { year: p.year, quarter: p.quarter, sprint: p.sprint, ...(p.team ? { team: p.team } : {}) };
      break;
    case "sprint-burnup":
      title = `Sprint ${p.sprint} Burnup${teamSuffix}`;
      params = { year: p.year, quarter: p.quarter, sprint: p.sprint, ...(p.team ? { team: p.team } : {}) };
      break;
    case "epic-burnup":
      title = `Sprint ${p.sprint} Epic Scope Burnup${teamSuffix}`;
      params = { year: p.year, quarter: p.quarter, sprint: p.sprint, ...(p.team ? { team: p.team } : {}) };
      break;
    default:
      title = "Chart";
  }

  return {
    type: "chart",
    chartType: p.chartType,
    title,
    params,
    summary: `Showing ${title}`,
  };
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const params: CollectedParams = body.params ?? {};
  return NextResponse.json(nextStep(params));
}
