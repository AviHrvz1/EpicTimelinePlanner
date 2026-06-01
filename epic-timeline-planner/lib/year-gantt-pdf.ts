import type { InitiativeItem } from "@/lib/types";
import { MONTHS, QUARTERS } from "@/lib/timeline";

export type YearGanttPdfFilter =
  | { type: "initiative"; id: string; label: string }
  | { type: "epic"; id: string; label: string }
  | null;

/**
 * Opens a new window with a standalone, presentation-quality rendering of the all-quarters Gantt.
 *
 * The window does NOT auto-print. The user sees the rendered preview first and triggers the print
 * dialog explicitly via the "Print / Save as PDF" button in the toolbar (or browser shortcut).
 *
 * The rendered chart is rebuilt from data — it is NOT a screenshot of the on-screen Gantt. That keeps
 * the print output clean (no zoom/scroll artifacts, no surrounding UI chrome) and gives us full control
 * of typography, colors, and spacing for a presentation-ready deliverable.
 *
 * Mirrors the on-screen view's filters:
 *   - `roadmapBarMode` — selects per-initiative or per-epic rows, matching the on-screen Initiatives/Epics chip.
 *   - `showProgress` — when true (Roadmap "Progress" chip on), the completed-stories overlay is drawn.
 *   - `teamLabels` — when non-empty, restricts rows to epics whose team matches and adds a team chip to the header.
 *   - `searchFilter` — when present, scopes the export to the picked initiative or epic (matches the chart's search filter).
 */
export function exportYearGanttToPrintableWindow(args: {
  initiatives: InitiativeItem[];
  currentYear: number;
  /** Mirror the on-screen Roadmap chip: "initiatives" → one row per initiative; "epics" → one row per planned epic. */
  roadmapBarMode: "initiatives" | "epics";
  showProgress: boolean;
  teamIds: string[];
  teamLabels: string[];
  searchFilter: YearGanttPdfFilter;
  /**
   * When set (single-quarter Gantt view), scopes the PDF to that quarter:
   *   - chart spans only those months
   *   - title reads "Q2 Roadmap" instead of "Annual Roadmap"
   *   - rows are filtered to those whose plan range intersects the quarter
   */
  focusedQuarter?: { label: string; months: number[] } | null;
}): void {
  const { initiatives, currentYear, roadmapBarMode, showProgress, teamIds, teamLabels, searchFilter } = args;
  const focusedQuarter = args.focusedQuarter ?? null;

  // Quarter color palette — soft tints for backgrounds, deeper accents for labels/borders.
  // Picked to coexist with each initiative bar's own color without competing for attention.
  const QUARTER_STYLE: Record<string, { tint: string; accent: string; ink: string }> = {
    Q1: { tint: "#e0f2fe", accent: "#0ea5e9", ink: "#0c4a6e" },
    Q2: { tint: "#ede9fe", accent: "#8b5cf6", ink: "#4c1d95" },
    Q3: { tint: "#fef3c7", accent: "#f59e0b", ink: "#78350f" },
    Q4: { tint: "#d1fae5", accent: "#10b981", ink: "#064e3b" },
  };

  const hasTeamFilter = teamIds.length > 0;
  const isEpicSearchFilter = searchFilter?.type === "epic";
  const isInitiativeSearchFilter = searchFilter?.type === "initiative";

  // Build the row model. Matches the on-screen all-quarters Gantt's eligibility rule:
  // include initiatives/epics that have at least one *fully-planned* epic (both planStartMonth and planEndMonth set).
  //
  // `meta` is the small right-aligned tag in the row label column. In initiative mode it counts child epics;
  // in epic mode it shows the parent initiative title so the reader knows which initiative the epic belongs to.
  type Row = {
    title: string;
    color: string;
    startMonth: number;
    endMonth: number;
    meta: string;
    progressPercent: number;
    /** Sort key — mirrors the on-screen Gantt's lane order so the PDF lists rows in the same order. */
    sortKey: number;
  };
  const rows: Row[] = [];

  // Build epic rows (used for the epics roadmapBarMode AND for an epic-scoped search filter regardless of mode).
  const buildEpicRows = (): Row[] => {
    const out: Row[] = [];
    for (const init of initiatives) {
      for (const epic of init.epics ?? []) {
        if (isEpicSearchFilter && epic.id !== searchFilter!.id) continue;
        if (isInitiativeSearchFilter && init.id !== searchFilter!.id) continue;
        if (hasTeamFilter && (!epic.team || !teamIds.includes(epic.team))) continue;
        if (
          typeof epic.planStartMonth !== "number" ||
          typeof epic.planEndMonth !== "number" ||
          epic.planEndMonth < epic.planStartMonth
        ) continue;
        const stories = epic.userStories ?? [];
        const done = stories.filter((s) => s.status === "done").length;
        out.push({
          title: epic.title,
          color: epic.color || init.color || "#6366f1",
          startMonth: clampMonth(epic.planStartMonth),
          endMonth: clampMonth(epic.planEndMonth),
          // Epic rows intentionally don't echo the parent initiative title — keeps the print clean.
          meta: "",
          progressPercent: stories.length > 0 ? Math.round((done / stories.length) * 100) : 0,
          sortKey: typeof epic.timelineRow === "number" ? epic.timelineRow : Number.MAX_SAFE_INTEGER,
        });
      }
    }
    return out;
  };

  // Build initiative rows (used for the initiatives roadmapBarMode).
  const buildInitiativeRows = (): Row[] => {
    const out: Row[] = [];
    for (const init of initiatives) {
      if (isInitiativeSearchFilter && init.id !== searchFilter!.id) continue;

      const scopedEpics = hasTeamFilter
        ? (init.epics ?? []).filter((e) => e.team && teamIds.includes(e.team))
        : (init.epics ?? []);
      if (hasTeamFilter && scopedEpics.length === 0) continue;

      const plannedEpics = scopedEpics.filter(
        (e) =>
          typeof e.planStartMonth === "number" && e.planStartMonth >= 1 && e.planStartMonth <= 12 &&
          typeof e.planEndMonth === "number" && e.planEndMonth >= 1 && e.planEndMonth <= 12,
      );
      if (plannedEpics.length === 0) continue;

      const startMonth = Math.min(...plannedEpics.map((e) => e.planStartMonth as number));
      const endMonth = Math.max(...plannedEpics.map((e) => e.planEndMonth as number));
      if (endMonth < startMonth) continue;

      const stories = plannedEpics.flatMap((e) => e.userStories ?? []);
      const completed = stories.filter((s) => s.status === "done").length;
      const progressPercent = stories.length > 0 ? Math.round((completed / stories.length) * 100) : 0;

      out.push({
        title: init.title,
        color: init.color || "#6366f1",
        startMonth: clampMonth(startMonth),
        endMonth: clampMonth(endMonth),
        // Initiative rows skip the "N epics" tag in print — the bar already conveys planned range, no need to clutter.
        meta: "",
        progressPercent,
        sortKey: typeof init.timelineRow === "number" ? init.timelineRow : Number.MAX_SAFE_INTEGER,
      });
    }
    return out;
  };

  // Epic-scoped search always forces epic-row output (matches the on-screen filter behavior).
  // Otherwise honor the user's Roadmap chip choice.
  const useEpicRows = isEpicSearchFilter || roadmapBarMode === "epics";
  rows.push(...(useEpicRows ? buildEpicRows() : buildInitiativeRows()));

  // Sort by the same key the on-screen Gantt uses (initiative/epic `timelineRow`), falling back to title
  // so the PDF lists rows in the exact same order the user arranged them on the timeline.
  rows.sort((a, b) => (a.sortKey - b.sortKey) || a.title.localeCompare(b.title));

  // Quarter-scoped exports: keep only rows whose plan range intersects the focused quarter's months.
  const visibleRows = focusedQuarter
    ? rows.filter((r) => {
        const qStart = focusedQuarter.months[0];
        const qEnd = focusedQuarter.months[focusedQuarter.months.length - 1];
        return !(r.endMonth < qStart || r.startMonth > qEnd);
      })
    : rows;

  const html = renderHtml({
    currentYear,
    rows: visibleRows,
    rowKind: useEpicRows ? "epic" : "initiative",
    showProgress,
    teamLabels,
    initiativeFilterLabel: isInitiativeSearchFilter ? searchFilter!.label : null,
    epicFilterLabel: isEpicSearchFilter ? searchFilter!.label : null,
    focusedQuarter,
    QUARTER_STYLE,
  });

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

function clampMonth(m: number): number {
  return Math.max(1, Math.min(12, m));
}

function renderHtml(args: {
  currentYear: number;
  rows: Array<{
    title: string;
    color: string;
    startMonth: number;
    endMonth: number;
    meta: string;
    progressPercent: number;
    sortKey: number;
  }>;
  rowKind: "initiative" | "epic";
  showProgress: boolean;
  teamLabels: string[];
  initiativeFilterLabel: string | null;
  epicFilterLabel: string | null;
  focusedQuarter: { label: string; months: number[] } | null;
  QUARTER_STYLE: Record<string, { tint: string; accent: string; ink: string }>;
}): string {
  const { currentYear, rows, rowKind, showProgress, teamLabels, initiativeFilterLabel, epicFilterLabel, focusedQuarter, QUARTER_STYLE } = args;

  // Choose the chart's time axis. Full-year view shows all 12 months and all 4 quarter pills;
  // single-quarter view collapses to just that quarter's 3 months and a single pill.
  const visibleMonths: number[] = focusedQuarter ? focusedQuarter.months : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const monthCount = visibleMonths.length;
  const visibleQuarters = focusedQuarter
    ? QUARTERS.filter((q) => q.label === focusedQuarter.label)
    : [...QUARTERS];

  // Map a 1-12 calendar month onto the visible axis (0-based fraction). Used for bar left/width.
  const monthAxisIndex = (m: number): number => {
    const idx = visibleMonths.indexOf(m);
    if (idx >= 0) return idx;
    if (m < visibleMonths[0]) return 0;
    return visibleMonths.length - 1;
  };

  // Chunk rows into per-print-page slices. Each `.gantt-page` is sized exactly like the printable A4 landscape
  // area (277mm × 190mm), so the on-screen preview shows the same paginated layout that will print.
  // Page 1 is slightly tighter because the title block lives there; the rest of the pages can fit a bit more
  // — but using a single value keeps the look consistent across the doc.
  const ROWS_PER_PAGE = 14;
  const pages: Array<typeof rows> = rows.length === 0
    ? [[]]
    : (() => {
        const chunks: Array<typeof rows> = [];
        for (let i = 0; i < rows.length; i += ROWS_PER_PAGE) {
          chunks.push(rows.slice(i, i + ROWS_PER_PAGE));
        }
        return chunks;
      })();
  const totalPages = pages.length;

  // Renderer for a single row inside a page chunk. Progress overlay is only emitted when the Roadmap "Progress"
  // toggle is on AND the row has work to show.
  // Bar positioning maps the row's months to the visible axis: full-year view uses all 12 months,
  // single-quarter view collapses to that quarter's 3 months (so a bar spanning Apr-Jun fills the whole Q2 track).
  const renderRow = (r: (typeof rows)[number]): string => {
    const startIdx = monthAxisIndex(Math.max(r.startMonth, visibleMonths[0]));
    const endIdx = monthAxisIndex(Math.min(r.endMonth, visibleMonths[visibleMonths.length - 1]));
    const left = (startIdx / monthCount) * 100;
    const width = ((endIdx - startIdx + 1) / monthCount) * 100;
    const safeTitle = escapeHtml(r.title);
    const progressFillWidth = (width * r.progressPercent) / 100;
    const showRowProgress = showProgress && r.progressPercent > 0;
    // `meta` carries the row context ("3 epics" in initiative mode). Epic-mode rows leave it blank
    // so the printed view shows only the epic title and no parent initiative echo.
    // When the Roadmap "Progress" chip is on we still surface the %, with or without leading meta text.
    const safeMeta = escapeHtml(r.meta);
    const metaText = showProgress
      ? safeMeta ? `${safeMeta} · ${r.progressPercent}%` : `${r.progressPercent}%`
      : safeMeta;
    return `
      <div class="row">
        <div class="row-label">
          <span class="row-dot" style="background:${escapeAttr(r.color)}"></span>
          <span class="row-title">${safeTitle}</span>
          <span class="row-meta">${metaText}</span>
        </div>
        <div class="row-track">
          <div class="row-bar${showRowProgress ? " row-bar-faded" : ""}" style="left:${left.toFixed(3)}%;width:${width.toFixed(3)}%;background:${escapeAttr(r.color)}"></div>
          ${showRowProgress
            ? `<div class="row-bar-progress" style="left:${left.toFixed(3)}%;width:${progressFillWidth.toFixed(3)}%;background:${escapeAttr(r.color)}"></div>`
            : ""
          }
        </div>
      </div>
    `;
  };

  // Quarter band — colored cards spanning the top, lining up with the month columns below.
  // In quarter-scoped mode just one pill is rendered (the focused quarter's).
  // Months for each quarter are already shown in the strip directly underneath, so the pill stays clean
  // and uses the ordinal name ("1st Quarter") instead of the compact "Q1" form. The ordinal suffix
  // (st / nd / rd / th) is rendered as a small superscript to match the on-screen quarter chips.
  const QUARTER_ORDINAL_HTML: Record<string, string> = {
    Q1: '1<sup>st</sup> Quarter',
    Q2: '2<sup>nd</sup> Quarter',
    Q3: '3<sup>rd</sup> Quarter',
    Q4: '4<sup>th</sup> Quarter',
  };
  const quarterBand = visibleQuarters.map((q) => {
    const style = QUARTER_STYLE[q.label];
    return `
      <div class="quarter" style="background:${style.tint};color:${style.ink};border-color:${style.accent}33">
        <div class="quarter-label" style="color:${style.ink}">${QUARTER_ORDINAL_HTML[q.label] ?? q.label}</div>
      </div>
    `;
  }).join("");

  // Month strip — 12 columns in full-year view, 3 columns in single-quarter view.
  const monthStrip = visibleMonths.map((m) => `<div class="month-cell">${MONTHS[m - 1]?.slice(0, 3) ?? ""}</div>`).join("");

  // Header chips show the active scope (team filter, initiative/epic filter) so the printed page is self-explanatory.
  const headerChips: string[] = [];
  if (teamLabels.length > 0) {
    headerChips.push(
      `<span class="chip chip-team">Team: ${teamLabels.map(escapeHtml).join(", ")}</span>`,
    );
  }
  if (initiativeFilterLabel) {
    headerChips.push(`<span class="chip chip-initiative">Initiative: ${escapeHtml(initiativeFilterLabel)}</span>`);
  }
  if (epicFilterLabel) {
    headerChips.push(`<span class="chip chip-epic">Epic: ${escapeHtml(epicFilterLabel)}</span>`);
  }

  const noun = rowKind === "epic" ? "epic" : "initiative";
  const subtitleParts: string[] = [
    `${rows.length} ${rows.length === 1 ? noun : `${noun}s`} shown`,
  ];
  if (teamLabels.length > 0) subtitleParts.push(`team: ${teamLabels.join(", ")}`);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${currentYear} ${focusedQuarter ? `${focusedQuarter.label} Roadmap` : "Annual Roadmap"}</title>
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
      /* Constrain the page wrapper to the same width as a single .gantt-page (A4 landscape printable area)
         so the toolbar (Close / Print buttons) never overflows past the right edge of the paper preview. */
      max-width: 277mm;
      margin: 0 auto;
      padding: 32px 0;
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
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.01em;
      margin: 0 0 2px 0;
    }
    .title-mode {
      font-size: 15px;
      font-weight: 600;
      color: #64748b;
      letter-spacing: -0.005em;
      margin-left: 2px;
    }
    .subtitle {
      font-size: 12px;
      color: #475569;
      margin: 0 0 8px 0;
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin: 0 0 12px 0;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      font-weight: 600;
      padding: 4px 10px;
      border-radius: 999px;
      border: 1px solid;
    }
    .chip-team { background: #eef2ff; color: #3730a3; border-color: #c7d2fe; }
    .chip-initiative { background: #f5f3ff; color: #5b21b6; border-color: #ddd6fe; }
    .chip-epic { background: #ecfeff; color: #155e75; border-color: #a5f3fc; }

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
    .quarter-band .quarters {
      display: grid;
      grid-template-columns: repeat(${visibleQuarters.length}, 1fr);
      gap: 8px;
    }
    .quarter {
      border: 1px solid;
      border-radius: 10px;
      padding: 8px 10px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      text-align: center;
    }
    .quarter-label { font-size: 13px; font-weight: 700; letter-spacing: 0.04em; }
    /* Ordinal suffix (st/nd/rd/th) renders as small superscript to match the on-screen quarter chips. */
    .quarter-label sup {
      font-size: 0.6em;
      font-weight: 600;
      vertical-align: super;
      line-height: 0;
      margin-left: 1px;
    }

    .month-band {
      display: grid;
      grid-template-columns: 240px 1fr;
      gap: 12px;
      margin-bottom: 8px;
    }
    .month-band .months {
      display: grid;
      grid-template-columns: repeat(${monthCount}, 1fr);
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

    .rows {
      position: relative;
      padding-top: 4px;
    }
    .row {
      display: grid;
      grid-template-columns: 240px 1fr;
      gap: 12px;
      align-items: center;
      /* Tighter row padding so 14 rows + header + legend fit inside the A4 landscape printable area. */
      padding: 4px 0;
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
      content: "";
      position: absolute;
      inset: 0;
      background-image: linear-gradient(to right, #e2e8f0 1px, transparent 1px);
      background-size: calc(100% / ${monthCount}) 100%;
      pointer-events: none;
      opacity: 0.5;
    }
    .row-bar {
      position: absolute;
      top: 3px;
      bottom: 3px;
      border-radius: 6px;
      /* Full-color planned range — used when no progress overlay sits on top. */
      opacity: 0.95;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35), inset 0 0 0 1px rgba(15, 23, 42, 0.08);
    }
    /* Faded variant — applied only when the progress overlay is drawn over it, so the completed portion stands out. */
    .row-bar-faded {
      opacity: 0.32;
      box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.06);
    }
    .row-bar-progress {
      position: absolute;
      top: 3px;
      bottom: 3px;
      border-radius: 6px;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.45), 0 0 0 1px rgba(15, 23, 42, 0.08);
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

    /* Each chunked page renders as its own <section.gantt-page>, sized to the printable A4 landscape area
       (277mm × 190mm = the paper minus the @page 10mm margins). On screen they stack like sheets of paper
       with a shadow + border so the user previews exactly what will print. */
    .gantt-page {
      box-sizing: border-box;
      width: 277mm;
      min-height: 190mm;
      padding: 12mm 12mm 10mm 12mm;
      background: white;
      border: 1px solid #e2e8f0;
      border-radius: 4px;
      box-shadow: 0 8px 24px -8px rgba(15, 23, 42, 0.18), 0 2px 4px rgba(15, 23, 42, 0.05);
      display: flex;
      flex-direction: column;
      gap: 0;
      overflow: hidden;
    }
    .gantt-page + .gantt-page {
      margin-top: 28px;
    }
    .gantt-page .chart {
      flex: 1;
      border: 0;
      border-radius: 0;
      padding: 0;
      box-shadow: none;
    }
    .page-footer {
      margin-top: auto;
      padding-top: 6px;
      text-align: right;
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.04em;
      color: #94a3b8;
    }
    @media print {
      html, body { background: white; }
      .page { padding: 0 !important; max-width: none !important; }
      .gantt-page {
        width: auto;
        min-height: 0;
        padding: 0;
        margin: 0;
        border: 0;
        border-radius: 0;
        box-shadow: none;
        page-break-after: always;
        break-after: page;
      }
      .gantt-page-last,
      .gantt-page:last-of-type {
        page-break-after: auto;
        break-after: auto;
      }
      .gantt-page + .gantt-page { margin-top: 0; }
      /* Rows shouldn't split mid-bar; chunk size already keeps the page under one printed page. */
      .row { page-break-inside: avoid; break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="toolbar">
      <button type="button" onclick="window.close()">Close</button>
      <button type="button" class="primary" onclick="window.print()">Print / Save as PDF</button>
    </div>

    ${pages
      .map((chunk, pageIdx) => {
        const isFirst = pageIdx === 0;
        const isLast = pageIdx === totalPages - 1;
        const pageNumber = pageIdx + 1;
        return `
    <section class="gantt-page${isLast ? " gantt-page-last" : ""}">
      ${isFirst
        ? `
        <h1 class="title">${currentYear} ${focusedQuarter ? `${focusedQuarter.label} Roadmap` : "Annual Roadmap"} <span class="title-mode">· ${rowKind === "epic" ? "Epics" : "Initiatives"}</span></h1>
        <p class="subtitle">${subtitleParts.map(escapeHtml).join(" · ")}</p>
        ${headerChips.length > 0 ? `<div class="chips">${headerChips.join("")}</div>` : ""}
      `
        : ""
      }
      <div class="chart">
        <div class="quarter-band">
          <div></div>
          <div class="quarters">${quarterBand}</div>
        </div>
        <div class="month-band">
          <div></div>
          <div class="months">${monthStrip}</div>
        </div>
        <div class="rows">
          ${chunk.length === 0
            ? `<div class="empty">No planned ${rowKind === "epic" ? "epics" : "initiatives"} match the current filters.</div>`
            : chunk.map(renderRow).join("")
          }
        </div>

        <div class="legend">
          <span><span class="legend-swatch" style="background:#6366f1;opacity:${showProgress ? "0.32" : "0.95"}"></span>Planned range</span>
          ${showProgress ? '<span><span class="legend-swatch" style="background:#6366f1"></span>Completed (review + done stories)</span>' : ""}
        </div>
      </div>
      ${totalPages > 1
        ? `<div class="page-footer">Page ${pageNumber} of ${totalPages}</div>`
        : ""
      }
    </section>`;
      })
      .join("")}
  </div>

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
