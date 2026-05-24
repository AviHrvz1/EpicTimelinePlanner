"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Copy, Trash2, X } from "lucide-react";

/**
 * In-app capture for the diagnostic `console.log` lines that the gantt
 * placement and epic-row persistence code emit. Mirrors them into a floating
 * card so we can reproduce the "epics scattered across the gantt" bug
 * without having to keep DevTools open.
 *
 * Watched tags must match the prefixes used by the call sites:
 *   - `[create-epic]`
 *   - `[epic-placement]`
 *   - `[gantt-drop][epic]`
 *   - `[epic-row-persist]`
 *
 * Wraps `console.log` exactly once per mount. The original `console.log` is
 * called first so normal devtools / dev-server forwarding still happens.
 */
const WATCHED_PREFIXES = [
  "[create-epic]",
  "[epic-placement]",
  "[gantt-drop][epic]",
  "[epic-row-persist]",
  "[team-filter]",
];

type LogEntry = {
  id: string;
  prefix: string;
  message: string;
  payload: unknown;
  at: Date;
};

/**
 * Hidden by default — flip on via:
 *   - `localStorage.setItem("ganttDebug", "1")` in DevTools, OR
 *   - append `?debug=gantt` to the URL
 * Disable by clearing the key (or `?debug=off`). When disabled, the hook
 * never patches `console.log`, so there's zero runtime cost.
 */
function useGanttDebugEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const fromUrl = new URLSearchParams(window.location.search).get("debug");
    if (fromUrl === "gantt") {
      window.localStorage.setItem("ganttDebug", "1");
      setEnabled(true);
      return;
    }
    if (fromUrl === "off") {
      window.localStorage.removeItem("ganttDebug");
      setEnabled(false);
      return;
    }
    setEnabled(window.localStorage.getItem("ganttDebug") === "1");
  }, []);
  return enabled;
}

export function GanttDebugOverlay() {
  const enabled = useGanttDebugEnabled();
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [open, setOpen] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const installed = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!enabled) return;
    if (installed.current) return;
    installed.current = true;
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      originalLog(...args);
      const first = args[0];
      if (typeof first !== "string") return;
      const matched = WATCHED_PREFIXES.find((p) => first.startsWith(p));
      if (!matched) return;
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const message = first.slice(matched.length).trim();
      const payload = args.length > 1 ? (args.length === 2 ? args[1] : args.slice(1)) : null;
      setEntries((prev) => {
        const next = [...prev, { id, prefix: matched, message, payload, at: new Date() }];
        return next.length > 200 ? next.slice(next.length - 200) : next;
      });
      setOpen(true);
      setCollapsed(false);
    };
    return () => {
      console.log = originalLog;
    };
  }, [enabled]);

  if (!enabled) return null;

  // Auto-scroll to bottom when new entries come in (unless user is reading
  // older entries — we approximate "is at bottom" by element scrollTop).
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [entries]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-[10000] rounded-full bg-slate-900 px-3 py-2 text-[11px] font-semibold text-white shadow-lg shadow-slate-900/30 hover:bg-slate-800"
      >
        Debug · {entries.length}
      </button>
    );
  }

  const handleCopy = () => {
    const text = entries
      .map((e) => `${e.at.toISOString()} ${e.prefix} ${e.message}\n${JSON.stringify(e.payload, null, 2)}`)
      .join("\n\n");
    void navigator.clipboard.writeText(text);
  };

  const handleClear = () => {
    setEntries([]);
    setExpandedIds(new Set());
  };

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="fixed bottom-4 right-4 z-[10000] flex w-[460px] max-w-[92vw] flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900/95 text-[11px] text-slate-100 shadow-2xl shadow-slate-900/40 backdrop-blur">
      <header className="flex items-center justify-between gap-2 border-b border-slate-700/80 bg-slate-800/70 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(74,222,128,0.7)]" />
          <span className="font-bold tracking-wide">Gantt placement debug</span>
          <span className="rounded-full bg-slate-700/70 px-2 py-0.5 text-[10px] font-semibold text-slate-300">
            {entries.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex h-6 items-center gap-1 rounded-md border border-slate-700 bg-slate-800/80 px-2 text-[10px] font-semibold text-slate-200 hover:bg-slate-700"
            title="Copy all entries as text"
          >
            <Copy className="size-3" aria-hidden /> Copy
          </button>
          <button
            type="button"
            onClick={handleClear}
            className="inline-flex h-6 items-center gap-1 rounded-md border border-slate-700 bg-slate-800/80 px-2 text-[10px] font-semibold text-slate-200 hover:bg-slate-700"
            title="Clear entries"
          >
            <Trash2 className="size-3" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-slate-700 bg-slate-800/80 text-slate-200 hover:bg-slate-700"
            title={collapsed ? "Expand" : "Collapse"}
          >
            {collapsed ? <ChevronUp className="size-3" aria-hidden /> : <ChevronDown className="size-3" aria-hidden />}
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-slate-700 bg-slate-800/80 text-slate-200 hover:bg-slate-700"
            title="Hide"
          >
            <X className="size-3" aria-hidden />
          </button>
        </div>
      </header>
      {!collapsed ? (
        <div
          ref={listRef}
          className="max-h-[60vh] overflow-y-auto px-2 py-2"
          style={{ scrollbarWidth: "thin" }}
        >
          {entries.length === 0 ? (
            <p className="px-2 py-6 text-center text-slate-400">
              Drop / create / move an epic on the Gantt — log entries will appear here.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {entries.map((entry) => {
                const isOpen = expandedIds.has(entry.id);
                const hasPayload = entry.payload !== null && entry.payload !== undefined;
                return (
                  <li
                    key={entry.id}
                    className="overflow-hidden rounded-md border border-slate-700/70 bg-slate-800/40"
                  >
                    <button
                      type="button"
                      onClick={() => (hasPayload ? toggleExpand(entry.id) : undefined)}
                      className={`flex w-full items-start gap-2 px-2 py-1.5 text-left ${
                        hasPayload ? "hover:bg-slate-700/40" : "cursor-default"
                      }`}
                    >
                      <span className="shrink-0 font-mono text-[10px] text-slate-400">
                        {entry.at.toTimeString().slice(0, 8)}
                      </span>
                      <span className="shrink-0 rounded bg-slate-700/70 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-amber-200">
                        {entry.prefix}
                      </span>
                      <span className="min-w-0 flex-1 break-words text-slate-100">{entry.message}</span>
                      {hasPayload ? (
                        <span className="shrink-0 text-[10px] text-slate-400">
                          {isOpen ? "−" : "+"}
                        </span>
                      ) : null}
                    </button>
                    {isOpen && hasPayload ? (
                      <pre className="max-h-[260px] overflow-auto border-t border-slate-700/70 bg-slate-950/60 px-2 py-1.5 font-mono text-[10px] text-slate-200">
                        {JSON.stringify(entry.payload, null, 2)}
                      </pre>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
