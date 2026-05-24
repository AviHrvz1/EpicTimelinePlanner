"use client";

import { useEffect, useId, useMemo, type Dispatch, type RefObject, type SetStateAction } from "react";
import { Check, Users, X } from "lucide-react";

import {
  capacityPlanTeamCatalogFromDirectory,
  teamLabelForWorkspaceUser,
  type WorkspaceDirectoryTeamSource,
} from "@/lib/workspace-users";

type CapacityPlanTeamComboboxProps = {
  directoryUsers: readonly WorkspaceDirectoryTeamSource[];
  selectedIds: string[];
  onSelectedIdsChange: Dispatch<SetStateAction<string[]>>;
  search: string;
  onSearchChange: (value: string) => void;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  comboboxRef: RefObject<HTMLDivElement | null>;
  ariaLabel: string;
};

export function CapacityPlanTeamCombobox({
  directoryUsers,
  selectedIds,
  onSelectedIdsChange,
  search,
  onSearchChange,
  menuOpen,
  onMenuOpenChange,
  comboboxRef,
  ariaLabel,
}: CapacityPlanTeamComboboxProps) {
  const listId = useId();
  const catalog = useMemo(() => capacityPlanTeamCatalogFromDirectory(directoryUsers), [directoryUsers]);
  const catalogById = useMemo(() => new Map(catalog.map((t) => [t.id, t.label] as const)), [catalog]);

  const filteredOptions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter(
      (t) => t.label.toLowerCase().includes(q) || t.id.toLowerCase().includes(q),
    );
  }, [catalog, search]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onMenuOpenChange(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [menuOpen, onMenuOpenChange]);

  const labelForId = (id: string) => catalogById.get(id) ?? teamLabelForWorkspaceUser(id);

  return (
    <div ref={comboboxRef} className="relative inline-flex min-w-[13rem] max-w-[22rem] align-middle">
      <div
        className="flex min-h-7 w-full flex-wrap items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[12px] font-semibold text-slate-800 shadow-sm shadow-slate-900/[0.03]"
        onClick={() => onMenuOpenChange(true)}
      >
        {selectedIds.map((id) => (
          <button
            key={id}
            type="button"
            className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700"
            onClick={(event) => {
              event.stopPropagation();
              onSelectedIdsChange((prev) => prev.filter((teamId) => teamId !== id));
            }}
          >
            <Users className="size-3 shrink-0 opacity-70" aria-hidden />
            {labelForId(id)}
            <X className="size-3" aria-hidden />
          </button>
        ))}
        <input
          value={search}
          onChange={(event) => {
            onSearchChange(event.target.value);
            onMenuOpenChange(true);
          }}
          onFocus={() => onMenuOpenChange(true)}
          placeholder={selectedIds.length === 0 ? "Search teams…" : "Add team…"}
          aria-label={ariaLabel}
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? listId : undefined}
          aria-autocomplete="list"
          autoComplete="off"
          className="h-6 min-w-[6rem] flex-1 border-0 bg-transparent p-0 text-[12px] font-semibold text-slate-800 outline-none placeholder:text-slate-400"
        />
      </div>
      {menuOpen ? (
        <div
          id={listId}
          role="listbox"
          aria-multiselectable
          className="absolute left-0 top-[calc(100%+0.25rem)] z-40 max-h-52 w-full overflow-auto rounded-md border border-slate-200 bg-white p-1 shadow-lg"
        >
          <button
            type="button"
            role="option"
            aria-selected={selectedIds.length === 0}
            className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-[12px] font-semibold text-slate-700 hover:bg-slate-100"
            onClick={() => {
              onSelectedIdsChange([]);
              onSearchChange("");
              onMenuOpenChange(false);
            }}
          >
            <span className="inline-flex items-center gap-1.5">
              <Users className="size-3.5 shrink-0 opacity-70" aria-hidden />
              All teams
            </span>
            {selectedIds.length === 0 ? <Check className="size-3.5" aria-hidden /> : null}
          </button>
          {filteredOptions.map((team) => {
            const selected = selectedIds.includes(team.id);
            return (
              <button
                key={team.id}
                type="button"
                role="option"
                aria-selected={selected}
                className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-[12px] font-semibold text-slate-700 hover:bg-slate-100"
                onClick={() => {
                  onSelectedIdsChange((prev) =>
                    prev.includes(team.id) ? prev.filter((id) => id !== team.id) : [...prev, team.id],
                  );
                  onSearchChange("");
                }}
              >
                <span className="inline-flex items-center gap-1.5">
                  <Users className="size-3.5 shrink-0 opacity-70" aria-hidden />
                  {team.label}
                </span>
                {selected ? <Check className="size-3.5 text-sky-700" aria-hidden /> : null}
              </button>
            );
          })}
          {filteredOptions.length === 0 ? (
            <p className="px-2 py-1.5 text-[12px] text-slate-500">No matching teams</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
