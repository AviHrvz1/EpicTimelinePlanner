"use client";

import { BarChart3 } from "lucide-react";

import { MonthAnalytics } from "@/components/timeline/month-analytics";
import type { InitiativeItem } from "@/lib/types";

type PortfolioInsightsViewProps = {
  initiatives: InitiativeItem[];
  quarter: 1 | 2 | 3 | 4;
  month: number;
  periodMonths: number[];
  planYear: number;
};

/**
 * Roadmap-wide insights — renders MonthAnalytics without a pre-selected
 * scope so every chart shows aggregate data across all initiatives in the
 * year. The user can still pin a single epic or initiative inside the page
 * via MonthAnalytics's own scope dropdown.
 */
export function PortfolioInsightsView({
  initiatives,
  quarter,
  month,
  periodMonths,
  planYear,
}: PortfolioInsightsViewProps) {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <div className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-8 py-4 shadow-sm">
        <BarChart3 className="size-6 shrink-0 text-indigo-600" aria-hidden />
        <h1 className="text-2xl font-bold text-slate-800">
          Portfolio Insights · Q{quarter}
          <span className="ml-2 font-normal text-slate-400">· {planYear}</span>
        </h1>
      </div>
      <div className="flex-1 overflow-y-auto px-8 pb-10 pt-6">
        <MonthAnalytics
          initiatives={initiatives}
          month={month}
          periodMonths={periodMonths}
          periodLabel={`Q${quarter}`}
          planYear={planYear}
          forceUserMode
        />
      </div>
    </div>
  );
}
