"use client";

import { BarChart3 } from "lucide-react";
import { MonthAnalytics } from "@/components/timeline/month-analytics";
import type { InitiativeItem } from "@/lib/types";

type EpicInsightsViewProps = {
  epicId: string;
  epicDisplayId?: string;
  epicTitle: string;
  epicTeam: string | null;
  /** When set, the view renders in Initiative mode — default scope is the
   * initiative, all of its child epics are summarised, and the header label
   * switches to "Initiative Insights". */
  initiativeId?: string;
  initiativeDisplayId?: string;
  initiativeTitle?: string;
  quarter: 1 | 2 | 3 | 4;
  month: number;
  periodMonths: number[];
  planYear: number;
  initiatives: InitiativeItem[];
};

export function EpicInsightsView({
  epicId,
  epicDisplayId,
  epicTitle,
  epicTeam,
  initiativeId,
  initiativeDisplayId,
  initiativeTitle,
  quarter,
  month,
  periodMonths,
  planYear,
  initiatives,
}: EpicInsightsViewProps) {
  const isInitiativeScope = Boolean(initiativeId);
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <div className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-8 py-4 shadow-sm">
        <BarChart3 className="size-6 shrink-0 text-indigo-600" aria-hidden />
        <h1 className="text-2xl font-bold text-slate-800">
          {isInitiativeScope ? "Initiative Insights" : "Epic Insights"} · Q{quarter}
          {isInitiativeScope ? (
            <>
              {initiativeDisplayId ? <span className="ml-2 text-indigo-500">{initiativeDisplayId}</span> : null}
              {initiativeTitle ? <span className="ml-2 font-normal text-slate-400">· {initiativeTitle}</span> : null}
            </>
          ) : (
            <>
              {epicDisplayId ? <span className="ml-2 text-indigo-500">{epicDisplayId}</span> : null}
              {epicTitle ? <span className="ml-2 font-normal text-slate-400">· {epicTitle}</span> : null}
            </>
          )}
        </h1>
      </div>
      <div className="flex-1 overflow-y-auto px-8 pb-10 pt-6">
        <MonthAnalytics
          initiatives={initiatives}
          month={month}
          periodMonths={periodMonths}
          periodLabel={`Q${quarter}`}
          planYear={planYear}
          filterEpicTeamIds={epicTeam ? [epicTeam] : undefined}
          forceUserMode
          initialSelectedEpicId={isInitiativeScope ? undefined : epicId}
          initialSelectedInitiativeId={isInitiativeScope ? initiativeId : undefined}
        />
      </div>
    </div>
  );
}
