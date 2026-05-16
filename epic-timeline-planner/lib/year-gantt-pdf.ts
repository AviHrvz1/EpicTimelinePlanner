import type { InitiativeItem } from "@/lib/types";
import { MONTHS, QUARTERS } from "@/lib/timeline";

/**
 * Opens a new window with a standalone, presentation-quality rendering of the all-quarters Gantt
 * and triggers `window.print()` so the user can save it as PDF.
 *
 * The rendered chart is rebuilt from data — it is NOT a screenshot of the on-screen Gantt. That keeps
 * the print output clean (no zoom/scroll artifacts, no surrounding UI chrome) and gives us full control
 * of typography, colors, and spacing for a presentation-ready deliverable.
 */
export function exportYearGanttToPrintableWindow(args: {
  initiatives: InitiativeItem[];
  currentYear: number;
}): void {
  const { initiatives, currentYear } = args;

  // Quarter color palette — soft tints for backgrounds, deeper accents for labels/borders.
  // Picked to coexist with each initiative bar's own color without competing for attention.
  const QUARTER_STYLE: Record<string, { tint: string; accent: string; ink: string }> = {
    Q1: { tint: "#e0f2fe", accent: "#0ea5e9", ink: "#0c4a6e" },
    Q2: { tint: "#ede9fe", accent: "#8b5cf6", ink: "#4c1d95" },
    Q3: { tint: "#fef3c7", accent: "#f59e0b", ink: "#78350f" },
    Q4: { tint: "#d1fae5", accent: "#10b981", ink: "#064e3b" },
  };

  // Build the row model: one row per scheduled initiative, with its earliest start and latest end.
  // Falls back to the initiative's own startMonth/endMonth when the child epics have no plan data yet.
  type Row = {
    title: string;
    color: string;
    startMonth: number;
    endMonth: number;
    epicCount: number;
    progressPercent: number;
  };
  const rows: Row[] = [];
  for (const init of initiatives) {
    if (init.status !== "scheduled") continue;

    const epics = init.epics ?? [];
    const epicStarts = epics
      .map((e) => e.planStartMonth)
      .filter((m): m is number => typeof m === "number" && m >= 1 && m <= 12);
    const epicEnds = epics
      .map((e) => e.planEndMonth ?? e.planStartMonth)
      .filter((m): m is number => typeof m === "number" && m >= 1 && m <= 12);

    const fallbackStart = init.startMonth ?? null;
    const fallbackEnd = init.endMonth ?? fallbackStart;

    const startMonth = epicStarts.length > 0 ? Math.min(...epicStarts) : fallbackStart;
    const endMonth = epicEnds.length > 0 ? Math.max(...epicEnds) : fallbackEnd;
    if (startMonth == null || endMonth == null || endMonth < startMonth) continue;

    const stories = epics.flatMap((e) => e.userStories ?? []);
    const completed = stories.filter((s) => s.status === "done" || s.status === "approved").length;
    const progressPercent = stories.length > 0 ? Math.round((completed / stories.length) * 100) : 0;

    rows.push({
      title: init.title,
      color: init.color || "#6366f1",
      startMonth: Math.max(1, Math.min(12, startMonth)),
      endMonth: Math.max(1, Math.min(12, endMonth)),
      epicCount: epics.length,
      progressPercent,
    });
  }
  // Sort by start month then title so the chart reads chronologically.
  rows.sort((a, b) => (a.startMonth - b.startMonth) || a.title.localeCompare(b.title));

  // Today marker — only meaningful when the currently-viewed planYear is the calendar year.
  const today = new Date();
  const isCurrentYear = today.getFullYear() === currentYear;
  let todayLeftPct: number | null = null;
  if (isCurrentYear) {
    const yearStart = new Date(currentYear, 0, 1).getTime();
    const yearEnd = new Date(currentYear + 1, 0, 1).getTime();
    todayLeftPct = ((today.getTime() - yearStart) / (yearEnd - yearStart)) * 100;
    todayLeftPct = Math.max(0, Math.min(100, todayLeftPct));
  }

  const html = renderHtml({ currentYear, rows, todayLeftPct, QUARTER_STYLE });

  // Open the rendered page in a new window. Auto-print is triggered inside the page once content settles.
  const win = window.open("", "_blank");
  if (!win) {
    // Popup blocked — surface a hint so the action doesn't fail silently.
    alert("Please allow popups for this site to export the Gantt to PDF.");
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}

function renderHtml(args: {
  currentYear: number;
  rows: Array<{
    title: string;
    color: string;
    startMonth: number;
    endMonth: number;
    epicCount: number;
    progressPercent: number;
  }>;
  todayLeftPct: number | null;
  QUARTER_STYLE: Record<string, { tint: string; accent: string; ink: string }>;
}): string {
  const { currentYear, rows, todayLeftPct, QUARTER_STYLE } = args;

  // Each row's bar: left/width are percentages within the 12-month track.
  const rowsMarkup = rows
    .map((r) => {
      const left = ((r.startMonth - 1) / 12) * 100;
      const width = ((r.endMonth - r.startMonth + 1) / 12) * 100;
      const progressFillWidth = (width * r.progressPercent) / 100;
      const safeTitle = escapeHtml(r.title);
      return `
        <div class="row">
          <div class="row-label">
            <span class="row-dot" style="background:${escapeAttr(r.color)}"></span>
            <span class="row-title">${safeTitle}</span>
            <span class="row-meta">${r.epicCount} ${r.epicCount === 1 ? "epic" : "epics"} · ${r.progressPercent}%</span>
          </div>
          <div class="row-track">
            <div class="row-bar" style="left:${left.toFixed(3)}%;width:${width.toFixed(3)}%;background:${escapeAttr(r.color)}"></div>
            <div class="row-bar-progress" style="left:${left.toFixed(3)}%;width:${progressFillWidth.toFixed(3)}%;background:${escapeAttr(r.color)}"></div>
          </div>
        </div>
      `;
    })
    .join("");

  // Quarter band — 4 colored cards spanning the top, lining up with the month columns below.
  const quarterBand = QUARTERS.map((q) => {
    const style = QUARTER_STYLE[q.label];
    return `
      <div class="quarter" style="background:${style.tint};color:${style.ink};border-color:${style.accent}33">
        <div class="quarter-label" style="color:${style.ink}">${q.label}</div>
        <div class="quarter-months" style="color:${style.ink}99">${q.months.map((m) => MONTHS[m - 1]?.slice(0, 3) ?? "").join(" · ")}</div>
      </div>
    `;
  }).join("");

  // Month strip — 12 columns, lighter accent for the current month.
  const monthStrip = MONTHS.map((name, idx) => {
    const isCurrent = todayLeftPct != null && new Date().getMonth() === idx;
    return `<div class="month-cell${isCurrent ? " month-cell-current" : ""}">${name.slice(0, 3)}</div>`;
  }).join("");

  // Today line — vertical green dashed line + small "Today" label at the top.
  const todayMarker = todayLeftPct != null
    ? `
      <div class="today-line" style="left:${todayLeftPct.toFixed(3)}%"></div>
      <div class="today-label" style="left:${todayLeftPct.toFixed(3)}%">Today</div>
    `
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${currentYear} Annual Roadmap</title>
  <style>
    /* @page rules use landscape orientation so all 12 months fit comfortably across the page. */
    @page { size: A4 landscape; margin: 10mm; }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      background: #f8fafc;
      color: #0f172a;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .page {
      max-width: 1200px;
      margin: 0 auto;
      padding: 32px 24px;
    }
    .toolbar {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-bottom: 12px;
    }
    .toolbar button {
      appearance: none;
      border: 1px solid #cbd5e1;
      background: #ffffff;
      color: #0f172a;
      font: inherit;
      font-size: 13px;
      font-weight: 600;
      padding: 6px 12px;
      border-radius: 8px;
      cursor: pointer;
      transition: background-color 120ms;
    }
    .toolbar button:hover { background: #f1f5f9; }
    .toolbar button.primary {
      background: linear-gradient(180deg, #4f46e5 0%, #4338ca 100%);
      color: white;
      border-color: #4338ca;
    }
    .toolbar button.primary:hover { filter: brightness(1.05); }
    @media print { .toolbar { display: none; } }

    .title {
      font-size: 28px;
      font-weight: 700;
      letter-spacing: -0.01em;
      margin: 0 0 4px 0;
    }
    .subtitle {
      font-size: 13px;
      color: #475569;
      margin: 0 0 24px 0;
    }

    .chart {
      background: white;
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      padding: 16px 16px 12px 16px;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    }
    .quarter-band {
      display: grid;
      grid-template-columns: 240px 1fr;
      gap: 12px;
      align-items: stretch;
      margin-bottom: 8px;
    }
    .quarter-band .label-spacer { /* keeps quarters aligned with the row track below */ }
    .quarter-band .quarters {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
    }
    .quarter {
      border: 1px solid;
      border-radius: 10px;
      padding: 8px 10px;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .quarter-label { font-size: 13px; font-weight: 700; letter-spacing: 0.04em; }
    .quarter-months { font-size: 10px; font-weight: 600; letter-spacing: 0.04em; }

    .month-band {
      display: grid;
      grid-template-columns: 240px 1fr;
      gap: 12px;
      margin-bottom: 8px;
    }
    .month-band .months {
      display: grid;
      grid-template-columns: repeat(12, 1fr);
      gap: 0;
      border-bottom: 1px solid #e2e8f0;
      padding-bottom: 4px;
    }
    .month-cell {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #64748b;
      text-align: center;
      padding: 4px 0;
      border-left: 1px solid #f1f5f9;
    }
    .month-cell:first-child { border-left: 0; }
    .month-cell-current { color: #047857; font-weight: 700; }

    .rows {
      position: relative;
      padding-top: 4px;
    }
    .row {
      display: grid;
      grid-template-columns: 240px 1fr;
      gap: 12px;
      align-items: center;
      padding: 6px 0;
      border-bottom: 1px dashed #f1f5f9;
    }
    .row:last-child { border-bottom: 0; }
    .row-label {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    .row-dot {
      flex: 0 0 auto;
      width: 10px;
      height: 10px;
      border-radius: 999px;
      box-shadow: 0 0 0 2px white inset;
    }
    .row-title {
      flex: 1;
      font-size: 12.5px;
      font-weight: 600;
      color: #0f172a;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .row-meta {
      flex: 0 0 auto;
      font-size: 10px;
      font-weight: 600;
      color: #64748b;
      letter-spacing: 0.02em;
    }
    .row-track {
      position: relative;
      height: 22px;
      border-radius: 8px;
      background: linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%);
      overflow: visible;
    }
    .row-track::before {
      /* Sub-grid for month boundaries inside the track. */
      content: "";
      position: absolute;
      inset: 0;
      background-image: linear-gradient(to right, #e2e8f0 1px, transparent 1px);
      background-size: calc(100% / 12) 100%;
      pointer-events: none;
      opacity: 0.5;
    }
    .row-bar {
      position: absolute;
      top: 3px;
      bottom: 3px;
      border-radius: 6px;
      opacity: 0.28;
      box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.06);
    }
    .row-bar-progress {
      position: absolute;
      top: 3px;
      bottom: 3px;
      border-radius: 6px;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.45), 0 0 0 1px rgba(15, 23, 42, 0.08);
    }

    .today-line {
      position: absolute;
      top: -6px;
      bottom: -2px;
      width: 1px;
      background: #10b981;
      pointer-events: none;
    }
    .today-label {
      position: absolute;
      top: -22px;
      transform: translateX(-50%);
      background: #10b981;
      color: white;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.04em;
      padding: 2px 6px;
      border-radius: 4px;
      pointer-events: none;
    }

    .empty {
      padding: 48px 16px;
      text-align: center;
      color: #94a3b8;
      font-size: 13px;
    }

    .legend {
      margin-top: 12px;
      display: flex;
      gap: 18px;
      align-items: center;
      font-size: 11px;
      color: #64748b;
    }
    .legend-swatch {
      display: inline-block;
      width: 12px;
      height: 8px;
      border-radius: 4px;
      margin-right: 4px;
      vertical-align: middle;
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="toolbar">
      <button type="button" onclick="window.close()">Close</button>
      <button type="button" class="primary" onclick="window.print()">Print / Save as PDF</button>
    </div>

    <h1 class="title">${currentYear} Annual Roadmap</h1>
    <p class="subtitle">All scheduled initiatives across the year — Q1 to Q4. ${rows.length} ${rows.length === 1 ? "initiative" : "initiatives"} shown.</p>

    <div class="chart">
      <div class="quarter-band">
        <div class="label-spacer"></div>
        <div class="quarters">${quarterBand}</div>
      </div>
      <div class="month-band">
        <div></div>
        <div class="months">${monthStrip}</div>
      </div>
      <div class="rows">
        ${rows.length === 0
          ? '<div class="empty">No scheduled initiatives to display.</div>'
          : rowsMarkup
        }
        ${todayMarker
          ? `<div style="position:absolute;left:252px;right:0;top:0;bottom:0;pointer-events:none;">
              <div style="position:relative;width:100%;height:100%;">${todayMarker}</div>
            </div>`
          : ""
        }
      </div>

      <div class="legend">
        <span><span class="legend-swatch" style="background:#6366f1;opacity:0.28"></span>Planned range</span>
        <span><span class="legend-swatch" style="background:#6366f1"></span>Completed (done + approved stories)</span>
        ${todayLeftPct != null ? '<span><span class="legend-swatch" style="background:#10b981"></span>Today</span>' : ""}
      </div>
    </div>
  </div>

  <script>
    // Wait one frame after load so layout settles, then open the print dialog automatically.
    window.addEventListener("load", function () {
      requestAnimationFrame(function () { setTimeout(function () { window.print(); }, 120); });
    });
  </script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
