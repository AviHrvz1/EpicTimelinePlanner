"use client";

import { useMemo, useState } from "react";
import { Bot, Search } from "lucide-react";

import { resolveAssigneeAvatar, UserAvatar } from "@/components/ui/user-avatar";
import { cn } from "@/lib/utils";

export type ActivityHistoryEntry = {
  id: string;
  entry: string;
  userName: string | null;
  createdAt: string | Date;
};

type DirectoryUser = { name: string; image?: string | null };

type Props = {
  entries: readonly ActivityHistoryEntry[];
  /** Workspace users used to resolve avatars from `userName` to image. */
  directoryUsers?: readonly DirectoryUser[] | null;
  emptyText?: string;
  className?: string;
};

/**
 * Searchable activity history feed shared by every dialog (initiative / epic / story).
 * Each row shows the responsible user's avatar + name on the left, the change entry,
 * and a relative timestamp. Search filters across entry text AND user name simultaneously.
 *
 * System-generated entries (those whose text starts with "system auto-move:" or whose
 * userName is null) are rendered with a Bot glyph and labeled "System" instead of an
 * avatar, so automation events stay visually distinct from user actions.
 */
export function ActivityHistoryList({
  entries,
  directoryUsers,
  emptyText = "No history yet.",
  className,
}: Props) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((row) => {
      if (row.entry.toLowerCase().includes(q)) return true;
      const name = (row.userName ?? "").toLowerCase();
      if (name && name.includes(q)) return true;
      return false;
    });
  }, [entries, query]);

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col gap-2", className)}>
      <div className="relative shrink-0">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search changes or users…"
          className="h-7 w-full rounded-md border border-slate-300 bg-white pl-7 pr-2 text-[13px] text-slate-800 outline-none transition-colors focus:border-sky-400 focus:ring-2 focus:ring-sky-200/70"
        />
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="text-sm text-slate-500">
            {entries.length === 0 ? emptyText : "No matches."}
          </p>
        ) : (
          filtered.map((row) => <HistoryRow key={row.id} row={row} directoryUsers={directoryUsers} />)
        )}
      </div>
    </div>
  );
}

function HistoryRow({
  row,
  directoryUsers,
}: {
  row: ActivityHistoryEntry;
  directoryUsers?: readonly DirectoryUser[] | null;
}) {
  const system = isSystemHistoryEntry(row.entry) || !row.userName;
  const resolved = resolveAssigneeAvatar(row.userName ?? "", directoryUsers);
  const displayName = system ? "System" : resolved.name || row.userName || "System";
  return (
    <div className="flex items-start gap-2 rounded-md bg-white p-2 text-sm ring-1 ring-slate-200">
      <div className="shrink-0">
        {system ? (
          <span
            title="System"
            className="inline-flex size-6 items-center justify-center rounded-full bg-sky-50 text-sky-700 ring-1 ring-sky-200"
          >
            <Bot className="size-3.5" aria-hidden />
          </span>
        ) : (
          <UserAvatar name={resolved.name} image={resolved.image} size={24} />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] text-slate-500">
          <span className="font-medium text-slate-700">{displayName}</span>
          {" - "}
          {new Date(row.createdAt).toLocaleString()}
        </p>
        <p className="mt-0.5 text-slate-800">{row.entry}</p>
      </div>
    </div>
  );
}

function isSystemHistoryEntry(entry: string): boolean {
  return entry.toLowerCase().startsWith("system auto-move:");
}
