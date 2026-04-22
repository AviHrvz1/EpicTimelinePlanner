import type { DragEndEvent } from "@dnd-kit/core";

/** Container for Gantt lane rows; used to map pointer Y → lane insert index on month drops. */
export const TIMELINE_GANTT_ROWS_CONTAINER_ID = "timeline-gantt-rows";

export function clientYCenterFromDragEnd(event: DragEndEvent): number | undefined {
  const current = event.active.rect.current;
  const rect = current?.translated ?? current?.initial;
  if (!rect) return undefined;
  return rect.top + rect.height / 2;
}

/**
 * Maps viewport Y to a target insert index for `computeInitiativeMonthLanePlacement`
 * (0..n, where n appends after the last scheduled row). Rows must set `data-gantt-lane-index`
 * to their sort index among scheduled initiatives.
 */
export function inferGanttLaneInsertIndexFromClientY(clientY: number): number | undefined {
  const container = document.getElementById(TIMELINE_GANTT_ROWS_CONTAINER_ID);
  if (!container) return undefined;

  const cRect = container.getBoundingClientRect();
  const margin = 16;
  if (clientY < cRect.top - margin || clientY > cRect.bottom + margin) return undefined;

  const rows = [...container.querySelectorAll<HTMLElement>("[data-gantt-lane-index]")];
  if (rows.length === 0) return undefined;

  rows.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);

  let bestInsert = 0;
  let bestCost = Infinity;

  for (const el of rows) {
    const r = el.getBoundingClientRect();
    const idx = Number(el.dataset.ganttLaneIndex);
    if (!Number.isFinite(idx)) continue;

    const mid = (r.top + r.bottom) / 2;

    if (clientY < r.top) {
      const cost = r.top - clientY;
      if (cost < bestCost) {
        bestCost = cost;
        bestInsert = idx;
      }
    } else if (clientY > r.bottom) {
      const cost = clientY - r.bottom;
      if (cost < bestCost) {
        bestCost = cost;
        bestInsert = idx + 1;
      }
    } else {
      const insert = clientY < mid ? idx : idx + 1;
      const cost = Math.abs(clientY - mid) * 0.01;
      if (cost < bestCost) {
        bestCost = cost;
        bestInsert = insert;
      }
    }
  }

  const lastEl = rows[rows.length - 1];
  const lastR = lastEl.getBoundingClientRect();
  const lastIdx = Number(lastEl.dataset.ganttLaneIndex);
  if (Number.isFinite(lastIdx) && clientY > lastR.bottom) {
    const cost = clientY - lastR.bottom;
    if (cost <= bestCost) bestInsert = lastIdx + 1;
  }

  return bestInsert;
}

/** Maps viewport Y to the nearest rendered lane index (not insert slot). */
export function inferGanttLaneHoverIndexFromClientY(clientY: number): number | undefined {
  const container = document.getElementById(TIMELINE_GANTT_ROWS_CONTAINER_ID);
  if (!container) return undefined;

  const rows = [...container.querySelectorAll<HTMLElement>("[data-gantt-lane-index]")];
  if (rows.length === 0) return undefined;

  rows.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);

  let bestLane: number | undefined;
  let bestCost = Infinity;

  for (const el of rows) {
    const idx = Number(el.dataset.ganttLaneIndex);
    if (!Number.isFinite(idx)) continue;
    const r = el.getBoundingClientRect();

    let cost = 0;
    if (clientY < r.top) cost = r.top - clientY;
    else if (clientY > r.bottom) cost = clientY - r.bottom;
    else cost = 0;

    if (cost < bestCost) {
      bestCost = cost;
      bestLane = idx;
    }
  }

  return bestLane;
}

/**
 * Nearest lane’s persisted `timelineRow` (from `data-gantt-timeline-row` on row wrappers).
 * Use this when lanes are grouped so lane index ≠ initiative list index.
 */
export function inferGanttLaneHoverTimelineRowFromClientY(clientY: number): number | undefined {
  const container = document.getElementById(TIMELINE_GANTT_ROWS_CONTAINER_ID);
  if (!container) return undefined;

  const rows = [...container.querySelectorAll<HTMLElement>("[data-gantt-lane-index]")];
  if (rows.length === 0) return undefined;

  rows.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);

  let bestRow: number | undefined;
  let bestCost = Infinity;

  for (const el of rows) {
    const tr = Number(el.dataset.ganttTimelineRow);
    if (!Number.isFinite(tr)) continue;
    const r = el.getBoundingClientRect();

    let cost = 0;
    if (clientY < r.top) cost = r.top - clientY;
    else if (clientY > r.bottom) cost = clientY - r.bottom;
    else cost = 0;

    if (cost < bestCost) {
      bestCost = cost;
      bestRow = tr;
    }
  }

  return bestRow;
}
