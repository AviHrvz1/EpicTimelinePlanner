"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

type LogLevel = "log" | "info" | "warn" | "error";

interface LogEntry {
  id: number;
  ts: string;
  level: LogLevel;
  args: string;
}

let _counter = 0;
function nextId() {
  return ++_counter;
}

function serialize(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === "string") return a;
      try {
        return JSON.stringify(a, null, 0);
      } catch {
        return String(a);
      }
    })
    .join(" ");
}

const MAX_ENTRIES = 300;

export function DebugLogPanel() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const originals = useRef<Partial<Record<LogLevel, (...args: unknown[]) => void>>>({});

  const push = useCallback((level: LogLevel, args: unknown[]) => {
    const entry: LogEntry = {
      id: nextId(),
      ts: new Date().toISOString().slice(11, 23),
      level,
      args: serialize(args),
    };
    setEntries((prev) => {
      const next = [...prev, entry];
      return next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next;
    });
  }, []);

  useEffect(() => {
    const levels: LogLevel[] = ["log", "info", "warn", "error"];
    for (const level of levels) {
      const orig = console[level].bind(console) as (...args: unknown[]) => void;
      originals.current[level] = orig;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (console as any)[level] = (...args: unknown[]) => {
        orig(...args);
        queueMicrotask(() => push(level, args));
      };
    }
    return () => {
      for (const level of levels) {
        if (originals.current[level]) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (console as any)[level] = originals.current[level];
        }
      }
    };
  }, [push]);

  // Auto-scroll to bottom when new entries arrive and panel is open
  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries, open]);

  const filtered = filter
    ? entries.filter((e) => e.args.toLowerCase().includes(filter.toLowerCase()))
    : entries;

  const levelClass: Record<LogLevel, string> = {
    log: "text-slate-300",
    info: "text-sky-300",
    warn: "text-amber-300",
    error: "text-rose-400",
  };

  const copyLogs = () => {
    const text = filtered
      .map((e) => `[${e.ts}] [${e.level.toUpperCase()}] ${e.args}`)
      .join("\n");
    navigator.clipboard.writeText(text).catch(() => {});
  };

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <>
      {/* Toggle button */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "fixed bottom-4 right-4 z-[9999] flex h-9 w-9 items-center justify-center rounded-full shadow-lg ring-1 text-[11px] font-bold transition",
          entries.some((e) => e.level === "error")
            ? "bg-rose-600 text-white ring-rose-400"
            : "bg-slate-800 text-slate-200 ring-slate-600 hover:bg-slate-700",
        )}
        title="Toggle debug log panel"
      >
        {entries.some((e) => e.level === "error") ? "!" : "⌥"}
      </button>

      {/* Panel */}
      {open && (
        <div className="fixed bottom-16 right-4 z-[9998] flex w-[min(96vw,680px)] flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl ring-1 ring-black/40"
          style={{ maxHeight: "55vh" }}
        >
          {/* Header */}
          <div className="flex shrink-0 items-center gap-2 border-b border-slate-700 px-3 py-2">
            <span className="text-[12px] font-semibold text-slate-200">Debug Logs</span>
            <span className="ml-1 rounded bg-slate-700 px-1.5 py-0.5 text-[10px] text-slate-400">
              {filtered.length}/{entries.length}
            </span>
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter…"
              className="ml-1 flex-1 rounded bg-slate-800 px-2 py-0.5 text-[11px] text-slate-200 placeholder:text-slate-500 outline-none ring-1 ring-slate-600 focus:ring-sky-500"
            />
            <button
              type="button"
              onClick={copyLogs}
              className="rounded bg-slate-700 px-2 py-0.5 text-[11px] text-slate-300 hover:bg-slate-600"
              title="Copy all visible logs to clipboard"
            >
              Copy
            </button>
            <button
              type="button"
              onClick={() => setEntries([])}
              className="rounded bg-slate-700 px-2 py-0.5 text-[11px] text-slate-300 hover:bg-slate-600"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="ml-1 text-slate-400 hover:text-slate-200 text-[14px] leading-none"
            >
              ✕
            </button>
          </div>

          {/* Log lines */}
          <div
            ref={scrollRef}
            className="min-h-0 flex-1 overflow-y-auto p-2 font-mono text-[10.5px] leading-relaxed"
            style={{ scrollbarWidth: "thin" }}
          >
            {filtered.length === 0 ? (
              <p className="text-slate-500 text-[11px] p-2">No logs yet. Reproduce the issue and check here.</p>
            ) : (
              filtered.map((e) => (
                <div key={e.id} className="flex min-w-0 gap-2">
                  <span className="shrink-0 text-slate-500">{e.ts}</span>
                  <span className={cn("shrink-0 uppercase font-bold w-[2.8rem]", levelClass[e.level])}>{e.level}</span>
                  <span className="min-w-0 break-all text-slate-200">{e.args}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </>,
    document.body,
  );
}
