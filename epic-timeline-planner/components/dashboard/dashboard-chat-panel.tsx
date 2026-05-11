"use client";

import { useEffect, useRef, useState } from "react";
import { AreaChart, BarChart2, PieChart, RotateCcw, Send, TrendingDown, Users } from "lucide-react";

import { cn } from "@/lib/utils";
import { monthTeamLabelForId } from "@/lib/month-team-board";
import { ChatMessage, ChartType, DashboardChartConfig, LLMChartProposal, LLMQuestion } from "./types";
type LLMResponse = LLMQuestion | LLMChartProposal;

type WorkspaceContext = {
  teams: string[];
  users: Array<{ id: string; name: string; team: string }>;
  quarters: string[];
  sprints: string[];
  initiatives: Array<{ id: string; title: string; status: string; year: number }>;
};

type Props = {
  onAddChart: (config: DashboardChartConfig) => void;
  context: WorkspaceContext | null;
};

const CHART_META: Record<ChartType, { label: string; icon: React.ReactNode; description: string }> = {
  velocity: {
    label: "Velocity",
    icon: <BarChart2 className="size-4 text-indigo-500" />,
    description: "Stories completed per sprint across a quarter",
  },
  burndown: {
    label: "Burndown",
    icon: <TrendingDown className="size-4 text-rose-500" />,
    description: "Remaining work vs ideal line for a sprint",
  },
  cfd: {
    label: "Cumulative Flow",
    icon: <AreaChart className="size-4 text-emerald-500" />,
    description: "Story status stacked over time in a sprint",
  },
  workload: {
    label: "Workload",
    icon: <Users className="size-4 text-amber-500" />,
    description: "Days left by assignee for a sprint",
  },
  "quarter-status": {
    label: "Quarter Status",
    icon: <PieChart className="size-4 text-sky-500" />,
    description: "Story status breakdown for a whole quarter",
  },
  "story-status": {
    label: "User Stories Status",
    icon: <PieChart className="size-4 text-sky-400" />,
    description: "Pie breakdown of story statuses in a sprint",
  },
  "workload-balance": {
    label: "Workload Balance",
    icon: <BarChart2 className="size-4 text-indigo-400" />,
    description: "Stories per assignee / team grouped by status",
  },
  "sprint-load": {
    label: "Sprint Load",
    icon: <Users className="size-4 text-violet-500" />,
    description: "Days left vs estimated per assignee / team",
  },
  "sprint-burnup": {
    label: "Sprint Burnup",
    icon: <AreaChart className="size-4 text-teal-500" />,
    description: "Completed vs scope vs ideal line for a sprint",
  },
  "epic-burnup": {
    label: "Epic Scope Burnup",
    icon: <AreaChart className="size-4 text-purple-500" />,
    description: "Epic scope completed vs total scope over a sprint",
  },
};

const CHART_TYPE_VALUES: string[] = Object.keys(CHART_META);

function ChartTypeList({ choices, onSelect }: { choices: string[]; onSelect: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-1.5 pt-1">
      {choices.map((c) => {
        const meta = CHART_META[c as ChartType];
        if (!meta) return null;
        return (
          <button
            key={c}
            onClick={() => onSelect(c)}
            className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left shadow-sm transition-colors hover:border-indigo-300 hover:bg-indigo-50"
          >
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-slate-50 ring-1 ring-slate-200">
              {meta.icon}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-800">{meta.label}</p>
              <p className="text-[11px] leading-snug text-slate-400">{meta.description}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function OptionChips({
  choices,
  onSelect,
  context,
}: {
  choices: string[];
  onSelect: (v: string) => void;
  context?: WorkspaceContext | null;
}) {
  // Rich cards for chart types
  if (choices.length > 0 && choices.every((c) => CHART_TYPE_VALUES.includes(c))) {
    return <ChartTypeList choices={choices} onSelect={onSelect} />;
  }
  // Searchable select for years
  if (choices.length > 0 && choices.every((c) => /^\d{4}$/.test(c))) {
    const currentYear = String(new Date().getFullYear());
    return <SearchableSelect options={choices} activeMark={currentYear} onSelect={onSelect} />;
  }
  return (
    <div className="flex flex-wrap gap-1.5 pt-1">
      {choices.map((c) => (
        <button
          key={c}
          onClick={() => onSelect(c)}
          className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 shadow-sm hover:bg-indigo-50 hover:border-indigo-300 hover:text-indigo-700 transition-colors"
        >
          {c}
        </button>
      ))}
    </div>
  );
}

/** Derive the active sprint key from today's date: "YYYY-QN-SN" */
function activeSprintKey(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1-12
  const day = now.getDate();
  const half = day <= 15 ? 1 : 2;
  const quarter = Math.ceil(month / 3);
  const yearSprint = (month - 1) * 2 + half;
  return `${year}-Q${quarter}-S${yearSprint}`;
}

function SearchableSelect({
  options,
  activeMark,
  onSelect,
}: {
  options: string[];
  activeMark?: string;
  onSelect: (v: string) => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = query.trim()
    ? options.filter((o) => o.toLowerCase().includes(query.toLowerCase()))
    : options;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="flex flex-col gap-1 pt-1">
      <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 shadow-sm focus-within:border-indigo-400 focus-within:ring-1 focus-within:ring-indigo-200">
        <svg className="size-3.5 shrink-0 text-slate-400" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" />
        </svg>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          className="flex-1 bg-transparent text-xs text-slate-700 placeholder:text-slate-400 outline-none"
        />
      </div>
      <div className="max-h-44 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        {filtered.length === 0 ? (
          <p className="px-3 py-2 text-xs text-slate-400">No results</p>
        ) : (
          filtered.map((o) => {
            const isActive = o === activeMark;
            return (
              <button
                key={o}
                onClick={() => onSelect(o)}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-indigo-50",
                  isActive ? "bg-indigo-50 font-semibold text-indigo-700" : "text-slate-700",
                )}
              >
                {isActive && (
                  <span className="shrink-0 rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold text-indigo-600 leading-none">
                    Active
                  </span>
                )}
                {o}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function YearPicker({ context, onSelect }: { context: WorkspaceContext | null; onSelect: (v: string) => void }) {
  const currentYear = new Date().getFullYear();
  // Derive years from context initiatives, fallback to a sensible range
  const contextYears = context?.initiatives
    ? [...new Set(context.initiatives.map((i) => String(i.year)))].sort((a, b) => b.localeCompare(a))
    : [];
  const years = contextYears.length > 0
    ? contextYears
    : [String(currentYear), String(currentYear - 1), String(currentYear + 1)].sort((a, b) => b.localeCompare(a));
  return <SearchableSelect options={years} activeMark={String(currentYear)} onSelect={onSelect} />;
}

const QUARTER_MONTH_RANGES: Record<number, string> = { 1: "Jan–Mar", 2: "Apr–Jun", 3: "Jul–Sep", 4: "Oct–Dec" };

function QuarterPicker({ context, onSelect }: { context: WorkspaceContext | null; onSelect: (v: string) => void }) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const now = new Date();
  const activeQ = `${now.getFullYear()}-Q${Math.ceil((now.getMonth() + 1) / 3)}`;
  const raw = context?.quarters.length ? context.quarters : [activeQ];
  const deduped = [...new Set([activeQ, ...raw])].sort((a, b) => b.localeCompare(a));

  const toLabel = (q: string) => {
    const m = q.match(/(\d{4})-Q(\d)/);
    if (!m) return q;
    const range = QUARTER_MONTH_RANGES[parseInt(m[2]!)] ?? "";
    return `Q${m[2]} ${m[1]} · ${range}`;
  };

  const filtered = deduped.filter((q) =>
    !query.trim() || toLabel(q).toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="flex flex-col gap-1 pt-1">
      <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 shadow-sm focus-within:border-indigo-400 focus-within:ring-1 focus-within:ring-indigo-200">
        <svg className="size-3.5 shrink-0 text-slate-400" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" />
        </svg>
        <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search quarter…"
          className="flex-1 bg-transparent text-xs text-slate-700 placeholder:text-slate-400 outline-none" />
      </div>
      <div className="max-h-44 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        {filtered.map((q) => {
          const isActive = q === activeQ;
          return (
            <button key={q} onClick={() => onSelect(q)}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-indigo-50",
                isActive ? "bg-indigo-50 font-semibold text-indigo-700" : "text-slate-700",
              )}>
              {isActive && (
                <span className="shrink-0 rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold text-indigo-600 leading-none">Active</span>
              )}
              {toLabel(q)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const QUARTER_MONTHS: Record<number, number[]> = { 1:[1,2,3], 2:[4,5,6], 3:[7,8,9], 4:[10,11,12] };

function sprintsForQuarter(year: number, quarter: number): Array<{ value: string; label: string; isActive: boolean }> {
  const months = QUARTER_MONTHS[quarter] ?? [];
  const now = new Date();
  const todayYear = now.getFullYear();
  const todayMonth = now.getMonth() + 1;
  const todayHalf = now.getDate() <= 15 ? 1 : 2;
  const results = [];
  for (const month of months) {
    for (const half of [1, 2]) {
      const yearSprint = (month - 1) * 2 + half;
      const value = `${year}-Q${quarter}-S${yearSprint}`;
      const mon = MONTH_NAMES[month - 1] ?? "";
      const dateRange = half === 1 ? `${mon} 1–15` : `${mon} 16–end`;
      const label = `Sprint ${yearSprint} · ${dateRange}`;
      const isActive = year === todayYear && month === todayMonth && half === todayHalf;
      results.push({ value, label, isActive });
    }
  }
  return results;
}

function SprintPicker({
  quarter,
  onSelect,
}: {
  context: WorkspaceContext | null;
  quarter?: string;   // "YYYY-QN" from the LLM widget
  onSelect: (v: string) => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  // Derive year+quarter from widget or fall back to current
  const now = new Date();
  let year = now.getFullYear();
  let q = Math.ceil((now.getMonth() + 1) / 3);
  if (quarter) {
    const m = quarter.match(/(\d{4})-Q(\d)/);
    if (m) { year = parseInt(m[1]!); q = parseInt(m[2]!); }
  }

  const allSprints = sprintsForQuarter(year, q);
  const activeSprint = allSprints.find((s) => s.isActive);
  const rest = allSprints.filter((s) => !s.isActive);
  const sprints = activeSprint ? [activeSprint, ...rest] : allSprints;
  const filtered = query.trim()
    ? sprints.filter((s) => s.label.toLowerCase().includes(query.toLowerCase()))
    : sprints;

  return (
    <div className="flex flex-col gap-1 pt-1">
      <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 shadow-sm focus-within:border-indigo-400 focus-within:ring-1 focus-within:ring-indigo-200">
        <svg className="size-3.5 shrink-0 text-slate-400" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" />
        </svg>
        <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search sprint…"
          className="flex-1 bg-transparent text-xs text-slate-700 placeholder:text-slate-400 outline-none" />
      </div>
      <div className="max-h-44 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        {filtered.map((s) => (
          <button key={s.value} onClick={() => onSelect(s.value)}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-indigo-50",
              s.isActive ? "bg-indigo-50 font-semibold text-indigo-700" : "text-slate-700",
            )}>
            {s.isActive && (
              <span className="shrink-0 rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold text-indigo-600 leading-none">Active</span>
            )}
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function TeamPicker({ context, onSelect }: { context: WorkspaceContext | null; onSelect: (v: string) => void }) {
  const teams = context?.teams ?? ["platform", "experience", "data", "mobile", "growth"];
  const options = ["All teams", ...teams];
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = query.trim()
    ? options.filter((o) => o.toLowerCase().includes(query.toLowerCase()))
    : options;

  useEffect(() => { inputRef.current?.focus(); }, []);

  return (
    <div className="flex flex-col gap-1 pt-1">
      <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 shadow-sm focus-within:border-indigo-400 focus-within:ring-1 focus-within:ring-indigo-200">
        <Users className="size-3.5 shrink-0 text-slate-400" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search team…"
          className="flex-1 bg-transparent text-xs text-slate-700 placeholder:text-slate-400 outline-none"
        />
      </div>
      <div className="max-h-44 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        {filtered.length === 0 ? (
          <p className="px-3 py-2 text-xs text-slate-400">No results</p>
        ) : (
          filtered.map((t) => (
            <button
              key={t}
              onClick={() => onSelect(t)}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors hover:bg-indigo-50"
            >
              <Users className="size-3.5 shrink-0 text-slate-400" />
              <span className="font-medium text-slate-700 capitalize">
                {monthTeamLabelForId(t) ?? t}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function UserPicker({ context, onSelect }: { context: WorkspaceContext | null; onSelect: (v: string) => void }) {
  const users = (context?.users ?? []).map((u) => u.name);
  return <OptionChips choices={["All", ...users]} onSelect={onSelect} />;
}

type WidgetProps = {
  widget: LLMQuestion["widget"];
  context: WorkspaceContext | null;
  onSelect: (v: string) => void;
};

function QuestionWidget({ widget, context, onSelect }: WidgetProps) {
  switch (widget.kind) {
    case "options":
      return <OptionChips choices={widget.choices} onSelect={onSelect} context={context} />;
    case "year_picker":
      return <YearPicker context={context} onSelect={onSelect} />;
    case "quarter_picker":
      return <QuarterPicker context={context} onSelect={onSelect} />;
    case "sprint_picker":
      return <SprintPicker context={context} quarter={"quarter" in widget ? (widget as {quarter?: string}).quarter : undefined} onSelect={onSelect} />;
    case "team_picker":
      return <TeamPicker context={context} onSelect={onSelect} />;
    case "user_picker":
      return <UserPicker context={context} onSelect={onSelect} />;
    default:
      return null;
  }
}

type ChatBubbleProps = {
  msg: ChatMessage;
};

function ChatBubble({ msg }: ChatBubbleProps) {
  const isUser = msg.role === "user";
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-snug shadow-sm",
          isUser
            ? "rounded-tr-sm bg-indigo-600 text-white"
            : "rounded-tl-sm bg-slate-100 text-slate-800",
        )}
      >
        {msg.content}
      </div>
    </div>
  );
}

type CollectedParams = {
  chartType?: string;
  year?: number;
  quarter?: number;
  quarterStr?: string;
  sprint?: number;
  team?: string;
  teamAsked?: boolean;
};

function formatAnswerForDisplay(field: string, raw: string): string {
  switch (field) {
    case "chartType": return CHART_META[raw as ChartType]?.label ?? raw;
    case "year": return raw;
    case "quarter": {
      const m = raw.match(/(\d{4})-Q(\d)/);
      if (!m) return raw;
      const range = QUARTER_MONTH_RANGES[parseInt(m[2]!)] ?? "";
      return `Q${m[2]} ${m[1]} · ${range}`;
    }
    case "sprint": {
      const sm = raw.match(/-S(\d+)$/);
      if (!sm) return raw;
      const sprintNum = parseInt(sm[1]!);
      const month = Math.ceil(sprintNum / 2);
      const half = sprintNum % 2 === 1 ? 1 : 2;
      const mon = MONTH_NAMES[month - 1] ?? "";
      return `Sprint ${sprintNum} · ${mon} ${half === 1 ? "1–15" : "16–end"}`;
    }
    case "team": return monthTeamLabelForId(raw) ?? raw;
    default: return raw;
  }
}

function parseAnswer(field: string, raw: string): Partial<CollectedParams> {
  switch (field) {
    case "chartType": return { chartType: raw };
    case "metric": return {
      metric: raw === "Story count" ? "storyCount" : "daysLeft",
      metricAsked: true,
    };
    case "year": return { year: parseInt(raw, 10) };
    case "quarter": {
      const m = raw.match(/(\d{4})-Q(\d)/);
      if (!m) return {};
      return { year: parseInt(m[1]!), quarter: parseInt(m[2]!), quarterStr: raw };
    }
    case "sprint": {
      const m = raw.match(/-S(\d+)$/);
      if (!m) return {};
      return { sprint: parseInt(m[1]!) };
    }
    case "team":
      return { team: raw === "All teams" ? undefined : raw, teamAsked: true };
    default: return {};
  }
}

export function DashboardChatPanel({ onAddChart, context }: Props) {
  const [params, setParams] = useState<CollectedParams>({});
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState<LLMQuestion | null>(null);
  const [pendingProposal, setPendingProposal] = useState<LLMChartProposal | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, currentQuestion, pendingProposal]);

  async function fetchNextStep(currentParams: CollectedParams) {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ params: currentParams }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: LLMResponse = await res.json();
      if (data.type === "question") {
        setCurrentQuestion(data);
        setPendingProposal(null);
        setMessages((prev) => [...prev, { role: "assistant", content: data.text }]);
      } else if (data.type === "chart") {
        setCurrentQuestion(null);
        setPendingProposal(data);
        setMessages((prev) => [...prev, { role: "assistant", content: `Ready: **${data.title}**` }]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setIsLoading(false);
    }
  }

  function handleStart() {
    setStarted(true);
    setParams({});
    setMessages([]);
    fetchNextStep({});
  }

  function handleAnswer(rawValue: string) {
    if (!currentQuestion) return;
    const display = formatAnswerForDisplay(currentQuestion.field, rawValue);
    setMessages((prev) => [...prev, { role: "user", content: display }]);
    setCurrentQuestion(null);
    const newParams = { ...params, ...parseAnswer(currentQuestion.field, rawValue) };
    setParams(newParams);
    fetchNextStep(newParams);
  }

  function handleConfirmChart() {
    if (!pendingProposal) return;
    onAddChart({ chartType: pendingProposal.chartType, title: pendingProposal.title, params: pendingProposal.params });
    setPendingProposal(null);
    setMessages((prev) => [...prev, { role: "user", content: "Add to dashboard" }, { role: "assistant", content: "Chart added! Create another?" }]);
    const fresh: CollectedParams = {};
    setParams(fresh);
    fetchNextStep(fresh);
  }

  function handleTryDifferent() {
    setPendingProposal(null);
    setMessages((prev) => [...prev, { role: "user", content: "Try a different chart" }]);
    const fresh: CollectedParams = {};
    setParams(fresh);
    fetchNextStep(fresh);
  }

  function handleReset() {
    setParams({});
    setMessages([]);
    setCurrentQuestion(null);
    setPendingProposal(null);
    setError(null);
    setStarted(false);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-slate-800">Chart builder</p>
          <p className="text-xs text-slate-400">Answer questions to create a chart</p>
        </div>
        {started && (
          <button onClick={handleReset} className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <RotateCcw className="size-3" />
            Start over
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {!started ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <div className="rounded-full bg-indigo-50 p-4">
              <Send className="size-6 text-indigo-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-700">Build a chart</p>
              <p className="mt-1 text-xs text-slate-400">Answer a few questions to pick the right view</p>
            </div>
            <button onClick={handleStart} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 active:bg-indigo-800 transition-colors">
              Get started
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map((msg, i) => <ChatBubble key={i} msg={msg} />)}

            {isLoading && (
              <div className="flex justify-start">
                <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-sm bg-slate-100 px-4 py-2.5">
                  <span className="size-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:0ms]" />
                  <span className="size-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:150ms]" />
                  <span className="size-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:300ms]" />
                </div>
              </div>
            )}

            {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>}

            {currentQuestion && !isLoading && (
              <div className="rounded-xl bg-indigo-50 p-3">
                <QuestionWidget widget={currentQuestion.widget} context={context} onSelect={handleAnswer} />
              </div>
            )}

            {pendingProposal && !isLoading && (
              <div className="flex flex-col gap-2 rounded-xl border border-indigo-200 bg-indigo-50 p-3">
                <p className="text-xs font-semibold text-indigo-700">Add this chart?</p>
                <div className="flex gap-2">
                  <button onClick={handleConfirmChart} className="flex-1 rounded-lg bg-indigo-600 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 transition-colors">
                    Add to dashboard
                  </button>
                  <button onClick={handleTryDifferent} className="flex-1 rounded-lg border border-slate-200 bg-white py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors">
                    Try different
                  </button>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        )}
      </div>
    </div>
  );
}
