export type ChartType =
  | "velocity"
  | "burndown"
  | "epic-burndown"
  | "cfd"
  | "workload"
  | "quarter-status"
  | "story-status"
  | "workload-balance"
  | "sprint-load"
  | "sprint-burnup"
  | "epic-burnup";

export type DashboardChartConfig = {
  chartType: ChartType;
  title: string;
  /** Serialised filter/config for the chart (JSON string or object). */
  params: Record<string, unknown>;
};

export type DashboardChartItem = {
  id: string;
  dashboardId: string;
  chartType: ChartType;
  title: string;
  /** JSON-serialised DashboardChartConfig["params"] */
  config: string;
  position: number;
  colSpan: 1 | 2;
  createdAt: string;
};

export type DashboardItem = {
  id: string;
  name: string;
  charts: DashboardChartItem[];
  createdAt: string;
  updatedAt: string;
};

// ─── LLM response shapes ────────────────────────────────────────────────────

export type LLMQuestion = {
  type: "question";
  /** Which params field this answer will fill. */
  field: string;
  /** Human-readable prompt shown above the widget. */
  text: string;
  widget:
    | { kind: "options"; choices: string[] }
    | { kind: "sprint_picker"; quarter?: string }
    | { kind: "team_picker" }
    | { kind: "user_picker" }
    | { kind: "quarter_picker" }
    | { kind: "year_picker" };
};

export type LLMChartProposal = {
  type: "chart";
  chartType: ChartType;
  title: string;
  params: Record<string, unknown>;
  /** Confirmation message shown below the proposed chart preview. */
  summary: string;
};

export type LLMResponse = LLMQuestion | LLMChartProposal;

// ─── Chat message shapes ─────────────────────────────────────────────────────

export type ChatMessage = {
  role: "assistant" | "user";
  /** Plain-text content of the message (user answer or assistant question text). */
  content: string;
};
