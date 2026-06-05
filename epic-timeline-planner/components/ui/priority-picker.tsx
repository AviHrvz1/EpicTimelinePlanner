"use client";

import { AlertTriangle, ChevronsDown, ChevronsUp, Equal } from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

export type Priority = "" | "P0" | "P1" | "P2" | "P3";

export const PRIORITY_VALUES: Priority[] = ["P0", "P1", "P2", "P3"];

export const priorityTone: Record<string, string> = {
  P0: "bg-rose-100 text-rose-700",
  P1: "bg-orange-100 text-orange-700",
  P2: "bg-sky-100 text-sky-700",
  P3: "bg-slate-100 text-slate-600",
};

export function getPriorityIcon(priority: string, className = "size-3 shrink-0"): ReactNode {
  const p = priority.trim().toUpperCase();
  if (p === "P0") return <AlertTriangle className={className} aria-hidden />;
  if (p === "P1") return <ChevronsUp className={className} aria-hidden />;
  if (p === "P2") return <Equal className={className} aria-hidden />;
  if (p === "P3") return <ChevronsDown className={className} aria-hidden />;
  return null;
}

export function PriorityPill({ priority, className }: { priority: string; className?: string }) {
  const p = priority.trim().toUpperCase();
  if (!p) return <span className={cn("text-slate-400", className)}>Not set</span>;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-[0.04em]",
        priorityTone[p] ?? "bg-muted text-muted-foreground",
        className,
      )}
    >
      {getPriorityIcon(p)}
      {p}
    </span>
  );
}

// 9800 sits above every dialog overlay (StoryDetailsDialog uses
// `z-[9700]`, others use `z-[9500]`).
const POPOVER_Z = 9800;
const POPOVER_GAP = 6;
const VIEW_MARGIN = 8;

export function PriorityPopover({
  value,
  triggerRef,
  onSelect,
  onCancel,
  includeNone = true,
}: {
  value: Priority;
  triggerRef: React.RefObject<HTMLElement | null>;
  onSelect: (next: Priority) => void;
  onCancel: () => void;
  includeNone?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [style, setStyle] = useState<CSSProperties>({ position: "fixed", visibility: "hidden", zIndex: POPOVER_Z });

  const recalc = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const r = trigger.getBoundingClientRect();
    const menuH = rootRef.current?.offsetHeight ?? 220;
    const spaceBelow = window.innerHeight - r.bottom - VIEW_MARGIN;
    const spaceAbove = r.top - VIEW_MARGIN;
    const openUp = spaceBelow < Math.min(menuH, 160) && spaceAbove > spaceBelow;
    const next: CSSProperties = {
      position: "fixed",
      zIndex: POPOVER_Z,
      left: Math.round(r.left),
      visibility: "visible",
    };
    if (openUp) {
      next.bottom = Math.round(window.innerHeight - r.top + POPOVER_GAP);
      next.maxHeight = Math.max(120, spaceAbove - POPOVER_GAP);
    } else {
      next.top = Math.round(r.bottom + POPOVER_GAP);
      next.maxHeight = Math.max(120, spaceBelow - POPOVER_GAP);
    }
    setStyle(next);
  }, [triggerRef]);

  useLayoutEffect(() => {
    recalc();
  }, [recalc, value]);

  useEffect(() => {
    window.addEventListener("scroll", recalc, true);
    window.addEventListener("resize", recalc);
    return () => {
      window.removeEventListener("scroll", recalc, true);
      window.removeEventListener("resize", recalc);
    };
  }, [recalc]);

  useEffect(() => {
    function onDocMouseDown(event: globalThis.MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current && rootRef.current.contains(target)) return;
      const trigger = triggerRef.current;
      if (trigger && trigger.contains(target)) return;
      onCancel();
    }
    function onDocKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    }
    window.addEventListener("mousedown", onDocMouseDown);
    window.addEventListener("keydown", onDocKeyDown);
    return () => {
      window.removeEventListener("mousedown", onDocMouseDown);
      window.removeEventListener("keydown", onDocKeyDown);
    };
  }, [onCancel, triggerRef]);

  if (typeof document === "undefined") return null;

  const options: Array<{ value: Priority; label: string }> = [
    ...(includeNone ? [{ value: "" as Priority, label: "Not set" }] : []),
    ...PRIORITY_VALUES.map((p) => ({ value: p, label: p })),
  ];

  return createPortal(
    <div
      ref={rootRef}
      role="listbox"
      className="w-[140px] overflow-y-auto rounded-xl border border-slate-200/80 bg-white p-1 shadow-lg ring-1 ring-black/[0.04]"
      style={style}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value || "__none__"}
            type="button"
            role="option"
            aria-selected={selected}
            onClick={() => onSelect(opt.value)}
            className={cn(
              "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] outline-none transition-colors",
              selected ? "bg-indigo-50 text-indigo-700" : "text-slate-700 hover:bg-slate-50",
            )}
          >
            {opt.value ? (
              <PriorityPill priority={opt.value} />
            ) : (
              <span className="text-slate-400">Not set</span>
            )}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
