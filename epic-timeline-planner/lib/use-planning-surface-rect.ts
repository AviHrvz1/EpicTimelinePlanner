"use client";

import { type CSSProperties, type RefObject, useLayoutEffect, useState } from "react";

export type PlanningSurfaceRect = { top: number; left: number; width: number; height: number };

export function isUsablePlanningSurfaceRect(r: PlanningSurfaceRect | null): r is PlanningSurfaceRect {
  return r != null && r.width >= 64 && r.height >= 64;
}

/** Detail dialogs: ~49% of planning column width (30% narrower again vs prior 70%). */
export const PLANNING_DETAIL_PANEL_WIDTH_RATIO = 0.49;

export function planningDetailPanelAnchorStyle(rect: PlanningSurfaceRect): CSSProperties {
  const width = rect.width * PLANNING_DETAIL_PANEL_WIDTH_RATIO;
  return {
    top: rect.top,
    left: rect.left + rect.width - width,
    width,
    height: rect.height,
  };
}

/**
 * Tracks the planning surface (right column) viewport box for anchoring detail overlays.
 */
export function usePlanningSurfaceRect(
  anchorRef: RefObject<HTMLElement | null> | undefined,
  active: boolean,
): PlanningSurfaceRect | null {
  const [rect, setRect] = useState<PlanningSurfaceRect | null>(null);

  useLayoutEffect(() => {
    if (!active) {
      setRect(null);
      return;
    }

    const el = anchorRef?.current;
    if (!el) {
      setRect(null);
      return;
    }

    function sync() {
      const node = anchorRef?.current;
      if (!node) return;
      const r = node.getBoundingClientRect();
      setRect({
        top: r.top,
        left: r.left,
        width: r.width,
        height: r.height,
      });
    }

    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    window.addEventListener("resize", sync);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, [active, anchorRef]);

  return rect;
}
