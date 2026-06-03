"use client";

import { Copy, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/**
 * Captures `console.log` calls whose first argument starts with the
 * `[gantt-drop]` prefix and surfaces them in a floating popup with a
 * one-click copy button. Mounted in the planner shell while we're
 * actively debugging drag-and-drop placement issues — the planner
 * already emits structured logs, this just lifts them out of devtools
 * and into a copyable surface the user can share.
 */
export function GanttDropDebugger() {
  const [logs, setLogs] = useState<Array<{ ts: number; line: string }>>([]);
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const original = console.log;
    console.log = (...args: unknown[]) => {
      original.apply(console, args);
      try {
        const first = args[0];
        if (typeof first !== "string") return;
        if (!first.startsWith("[gantt-drop]") && !first.startsWith("[onMonthEpicDayRangeChange]")) return;
        const ts = Date.now();
        const line = args
          .map((arg) => {
            if (typeof arg === "string") return arg;
            try {
              return JSON.stringify(arg, replacer, 2);
            } catch {
              return String(arg);
            }
          })
          .join(" ");
        setLogs((prev) => [...prev.slice(-99), { ts, line }]);
      } catch {
        // Never let the debugger break console.log.
      }
    };
    return () => {
      console.log = original;
    };
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs.length]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-3 left-3 z-[9999] inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-2 py-1 text-[11px] font-semibold text-white shadow-lg hover:bg-indigo-700"
        title="Show gantt-drop debug log"
      >
        Drop log ({logs.length})
      </button>
    );
  }

  const text = logs.map((l) => l.line).join("\n\n");

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback — select the textarea content for manual copy.
      const ta = document.getElementById("gantt-drop-debug-text") as HTMLTextAreaElement | null;
      ta?.select();
    }
  }

  return (
    <div className="fixed bottom-3 left-3 z-[9999] flex w-[420px] max-w-[calc(100vw-2rem)] flex-col rounded-lg border border-slate-200 bg-white shadow-xl">
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <span className="text-[12px] font-semibold text-slate-700">
          Gantt drop log — {logs.length} entr{logs.length === 1 ? "y" : "ies"}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setLogs([])}
            className="rounded-md px-2 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-slate-200/70"
            disabled={logs.length === 0}
            title="Clear logs"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            disabled={logs.length === 0}
            title="Copy all logs"
          >
            <Copy className="size-3" />
            {copied ? "Copied!" : "Copy"}
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-md p-0.5 text-slate-500 hover:bg-slate-200/70 hover:text-slate-800"
            title="Hide"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>
      <div
        ref={scrollRef}
        className="max-h-[260px] overflow-y-auto bg-slate-900 px-3 py-2 font-mono text-[10.5px] leading-snug text-slate-50"
      >
        {logs.length === 0 ? (
          <div className="text-slate-400">
            Drag an epic onto the gantt — captured logs will appear here.
          </div>
        ) : (
          logs.map((l, i) => (
            <div key={`${l.ts}-${i}`} className="mb-2 whitespace-pre-wrap break-words">
              <span className="text-emerald-300">[{new Date(l.ts).toLocaleTimeString()}]</span>{" "}
              {l.line}
            </div>
          ))
        )}
      </div>
      <textarea
        id="gantt-drop-debug-text"
        readOnly
        value={text}
        className="hidden"
        aria-hidden
      />
    </div>
  );
}

function replacer(_key: string, value: unknown) {
  if (value instanceof Date) return value.toISOString();
  return value;
}
