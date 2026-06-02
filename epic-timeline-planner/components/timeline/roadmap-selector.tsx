"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Map as MapIcon,
  Plus,
  SquarePen,
  Trash2,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { RoadmapItem } from "@/lib/types";

/**
 * Modal confirmation for deleting a roadmap — shows what will be lost
 * (counts of initiatives / epics / stories / snapshots) and requires the
 * user to type the roadmap name back before the Delete button enables.
 */
export function RoadmapDeleteConfirm({
  roadmapName,
  counts,
  onConfirm,
  onCancel,
}: {
  roadmapName: string;
  counts: { initiativeCount: number; epicCount: number; storyCount: number; snapshotCount: number };
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [confirmName, setConfirmName] = useState("");
  const [visible, setVisible] = useState(false);
  useEffect(() => { requestAnimationFrame(() => setVisible(true)); }, []);
  const cancel = () => { setVisible(false); setTimeout(onCancel, 150); };
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") cancel(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });
  return createPortal(
    <div
      className={cn("fixed inset-0 z-[9990] flex items-center justify-center p-4 transition-all duration-150", visible ? "opacity-100" : "opacity-0 pointer-events-none")}
      onClick={cancel}
    >
      <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-[2px]" />
      <div
        className={cn("relative z-10 w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl transition-all duration-150", visible ? "scale-100 translate-y-0" : "scale-[0.97] translate-y-1")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
          <div className="flex size-10 items-center justify-center rounded-xl bg-red-50 ring-1 ring-red-100">
            <Trash2 className="size-5 text-red-600" />
          </div>
          <div>
            <p className="text-[15px] font-bold text-slate-800">Delete &ldquo;{roadmapName}&rdquo;?</p>
            <p className="text-[12px] text-slate-400">This action cannot be undone.</p>
          </div>
          <button type="button" onClick={cancel} className="ml-auto flex size-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-950">
            <X className="size-4" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="rounded-xl bg-red-50 border border-red-100 p-3 text-[13px] text-red-700 space-y-1">
            <p className="font-semibold flex items-center gap-1.5"><AlertTriangle className="size-4" /> Permanently deletes:</p>
            <ul className="ml-5 list-disc space-y-0.5 text-red-600">
              <li>{counts.initiativeCount} initiative{counts.initiativeCount !== 1 ? "s" : ""}</li>
              <li>{counts.epicCount} epic{counts.epicCount !== 1 ? "s" : ""}</li>
              <li>{counts.storyCount} user stor{counts.storyCount !== 1 ? "ies" : "y"}</li>
              <li>{counts.snapshotCount} retrospective snapshot{counts.snapshotCount !== 1 ? "s" : ""}</li>
            </ul>
          </div>
          <div>
            <p className="mb-1.5 text-[12px] font-medium text-slate-600">Type <span className="font-bold text-slate-800">{roadmapName}</span> to confirm</p>
            <input
              autoFocus
              type="text"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && confirmName === roadmapName) onConfirm(); }}
              placeholder={roadmapName}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-red-400/40"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button type="button" onClick={cancel} className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
          <button
            type="button"
            disabled={confirmName !== roadmapName}
            onClick={onConfirm}
            className="rounded-lg bg-red-600 px-3 py-1.5 text-[13px] font-semibold text-white transition hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >Delete roadmap</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Roadmap picker — combo of (1) a roadmap autocomplete + create form, (2) a
 * manage popover (rename / add+remove years / delete), and (3) an inline
 * year sub-picker.
 *
 * Two visual modes via `appearance`:
 *   - `"chip"` (default): the indigo gradient pill the legacy toolbar used.
 *   - `"subtitle"`: plain slate-text trigger styled to read as a clickable
 *     hero subtitle (`Default roadmap · 2026 · 50 epics in scope ▾`). The
 *     dropdown bodies and manage popover are identical between modes.
 *
 * `extraSuffix` (subtitle mode only) appends a trailing `· {text}` after
 * the year, so the hero can show its epics-in-scope tail.
 */
export function RoadmapSelector({
  roadmaps,
  selectedRoadmap,
  year,
  onYearChange,
  onSelectRoadmap,
  onCreateRoadmap,
  onRenameRoadmap,
  onAddYearToRoadmap,
  onRemoveYearFromRoadmap,
  onGetRoadmapCounts,
  onDeleteRoadmap,
  appearance = "chip",
  extraSuffix,
}: {
  roadmaps: RoadmapItem[];
  selectedRoadmap: RoadmapItem | null;
  year: number;
  onYearChange: (nextYear: number) => void | Promise<void>;
  onSelectRoadmap?: (id: string, year?: number) => void;
  onCreateRoadmap?: (name: string, years: number[]) => Promise<void>;
  onRenameRoadmap?: (id: string, name: string) => Promise<void>;
  onAddYearToRoadmap?: (id: string, year: number) => Promise<void>;
  onRemoveYearFromRoadmap?: (id: string, year: number) => Promise<{ error?: string }>;
  onGetRoadmapCounts?: (id: string) => Promise<{ initiativeCount: number; epicCount: number; storyCount: number; snapshotCount: number } | null>;
  onDeleteRoadmap?: (id: string) => Promise<void>;
  appearance?: "chip" | "subtitle";
  extraSuffix?: string;
}) {
  const currentCalYear = new Date().getFullYear();
  const isSubtitle = appearance === "subtitle";

  // Autocomplete state
  const [query, setQuery] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Hidden mirror span used to measure the actual rendered width of the
  // current input text (font + weight + variable-char widths accounted for).
  // The character-count formula was too approximate — empty spaces, capitals,
  // and digits all render at different widths. Measuring is the only way to
  // size the input precisely.
  const widthMeasureRef = useRef<HTMLSpanElement>(null);
  const [measuredTextWidth, setMeasuredTextWidth] = useState(0);

  // Create form state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newYears, setNewYears] = useState<number[]>([currentCalYear]);
  const [newCustomYearInput, setNewCustomYearInput] = useState("");
  const [creating, setCreating] = useState(false);

  // `roadmap.years` is `number[]` per `RoadmapItem`, but a stale data path can
  // still serve the raw JSON string from the database. Normalising here means
  // the manage popover's add/remove diff always compares number arrays.
  function normalizeYears(input: number[] | string | null | undefined): number[] {
    if (Array.isArray(input)) return input.filter((y): y is number => typeof y === "number");
    if (typeof input === "string") {
      try {
        const parsed = JSON.parse(input) as unknown;
        if (Array.isArray(parsed)) return parsed.filter((y): y is number => typeof y === "number");
      } catch {
        // ignore — return []
      }
    }
    return [];
  }

  // Manage popover state. Edits stay LOCAL until the user clicks Save: pending
  // years are tracked as `pendingYears` and diffed against the persisted
  // `selectedRoadmap.years` at submit time, so one Save commits rename + adds
  // + removals in a single action.
  const [manageOpen, setManageOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(selectedRoadmap?.name ?? "");
  const [yearError, setYearError] = useState<string | null>(null);
  const [manageCustomYearInput, setManageCustomYearInput] = useState("");
  const [pendingYears, setPendingYears] = useState<number[]>(() => normalizeYears(selectedRoadmap?.years));
  const [savingManage, setSavingManage] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ counts: { initiativeCount: number; epicCount: number; storyCount: number; snapshotCount: number } } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const manageRef = useRef<HTMLDivElement>(null);

  // Sync rename field when roadmap changes
  useEffect(() => { setRenameValue(selectedRoadmap?.name ?? ""); }, [selectedRoadmap?.id, selectedRoadmap?.name]);

  // Close autocomplete on outside click
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setDropdownOpen(false);
    }
    if (dropdownOpen) document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [dropdownOpen]);

  // Measure the rendered text width every time the visible text changes.
  useEffect(() => {
    if (widthMeasureRef.current) {
      setMeasuredTextWidth(widthMeasureRef.current.offsetWidth);
    }
  }, [dropdownOpen, query, selectedRoadmap?.name, roadmaps.length]);

  // Close manage popover on outside click
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (manageRef.current && !manageRef.current.contains(e.target as Node)) setManageOpen(false);
    }
    if (manageOpen) document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [manageOpen]);

  // Reset pending edits when popover (re)opens or roadmap changes.
  useEffect(() => {
    if (!manageOpen) return;
    setRenameValue(selectedRoadmap?.name ?? "");
    setPendingYears(normalizeYears(selectedRoadmap?.years));
    setManageCustomYearInput("");
    setYearError(null);
  }, [manageOpen, selectedRoadmap?.id, selectedRoadmap?.name, selectedRoadmap?.years]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return roadmaps;
    return roadmaps.filter((r) => r.name.toLowerCase().includes(q));
  }, [roadmaps, query]);

  const years: number[] = selectedRoadmap?.years ?? [year];

  async function submitCreate() {
    if (!newName.trim() || newYears.length === 0 || !onCreateRoadmap) return;
    setCreating(true);
    await onCreateRoadmap(newName.trim(), newYears);
    setCreating(false);
    setShowCreateForm(false);
    setNewName("");
    setNewYears([currentCalYear]);
    setDropdownOpen(false);
    setQuery("");
  }

  async function handleDeleteRequest() {
    if (!selectedRoadmap || !onGetRoadmapCounts) return;
    const counts = await onGetRoadmapCounts(selectedRoadmap.id);
    if (!counts) return;
    setDeleteConfirm({ counts });
  }

  async function handleDeleteConfirmed() {
    if (!selectedRoadmap || !onDeleteRoadmap) return;
    setDeleting(true);
    await onDeleteRoadmap(selectedRoadmap.id);
    setDeleting(false);
    setDeleteConfirm(null);
    setManageOpen(false);
  }

  /* ----- Styling derived from appearance ----- */

  const outerClass = isSubtitle
    ? "relative inline-flex shrink-0 items-center gap-2 whitespace-nowrap text-[13px] font-normal leading-none text-slate-500 outline-none select-none"
    : "relative inline-flex h-[28px] shrink-0 cursor-pointer items-stretch box-border whitespace-nowrap rounded-full bg-gradient-to-r from-sky-100 via-indigo-100 to-violet-100 text-[12px] font-semibold text-indigo-900 ring-1 ring-indigo-200/80 outline-none transition hover:from-sky-200/80 hover:via-indigo-200/80 hover:to-violet-200/80 select-none [&_svg]:opacity-60";

  return (
    <div className={outerClass}>
      {/* Roadmap label + autocomplete trigger */}
      <div ref={containerRef} className={cn("relative flex", isSubtitle ? "items-center" : "items-stretch")}>
        {!isSubtitle ? (
          <span className="flex shrink-0 items-center gap-1 border-r border-indigo-300/60 pl-3 pr-2 text-[12px] font-semibold text-indigo-900">
            <MapIcon className="size-3.5 shrink-0" aria-hidden />
            Roadmap
          </span>
        ) : null}
        <div
          className={cn(
            "relative flex items-center",
            isSubtitle
              ? cn(
                  "gap-1 rounded-md border bg-white px-2 py-1 shadow-sm transition",
                  dropdownOpen
                    ? "border-indigo-400 ring-2 ring-indigo-200/60"
                    : "border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/40",
                )
              : null,
          )}
          onClick={isSubtitle ? () => { setDropdownOpen(true); inputRef.current?.focus(); } : undefined}
        >
          {(() => {
            const visibleText = dropdownOpen ? query : (selectedRoadmap?.name ?? "");
            const placeholder = roadmaps.length === 0 ? "Create roadmap…" : "Select…";
            const textForMeasurement = visibleText || placeholder;
            // Measured text width + horizontal padding + safety margin.
            const width = Math.max(40, Math.min(288, measuredTextWidth + (isSubtitle ? 10 : 26)));
            return (
              <>
                <span
                  ref={widthMeasureRef}
                  aria-hidden
                  className={cn(
                    "invisible pointer-events-none absolute whitespace-pre",
                    isSubtitle ? "text-[13px] font-medium" : "text-[12px] font-semibold",
                  )}
                  style={{ left: -9999, top: 0 }}
                >
                  {textForMeasurement}
                </span>
                <input
                  ref={inputRef}
                  type="text"
                  value={visibleText}
                  placeholder={placeholder}
                  onChange={(e) => { setQuery(e.target.value); setDropdownOpen(true); setShowCreateForm(false); }}
                  onFocus={() => { setDropdownOpen(true); setQuery(""); }}
                  onClick={() => { if (!dropdownOpen) { setDropdownOpen(true); setQuery(""); } }}
                  onKeyDown={(e) => { if (e.key === "Escape") { setDropdownOpen(false); inputRef.current?.blur(); } }}
                  className={cn(
                    "cursor-pointer bg-transparent py-0 outline-none",
                    isSubtitle
                      ? "h-5 pl-0 pr-0 text-[13px] font-medium text-slate-800 placeholder:text-slate-400 hover:text-indigo-700"
                      : "h-[28px] pl-1.5 pr-4 text-[12px] font-semibold text-indigo-900 placeholder:text-indigo-900/55",
                  )}
                  style={{ width: `${width}px` }}
                  aria-label="Select roadmap"
                />
              </>
            );
          })()}
          <ChevronDown
            className={cn(
              "pointer-events-none transition",
              isSubtitle
                ? cn("size-3 shrink-0", dropdownOpen ? "rotate-180 text-indigo-600" : "text-slate-500")
                : cn("absolute right-0.5 top-1/2 size-3 -translate-y-1/2 text-indigo-950", dropdownOpen && "rotate-180"),
            )}
            aria-hidden
          />
        </div>

        {/* Roadmap dropdown */}
        {dropdownOpen && (
          <div className="absolute top-full left-0 z-50 mt-1 min-w-[22rem] rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
            <div className="mb-1 border-b border-slate-100 pb-1">
              {!showCreateForm ? (
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setShowCreateForm(true)}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium text-indigo-600 hover:bg-indigo-50"
                >
                  <Plus className="size-3.5" /> New roadmap
                </button>
              ) : (
                <div className="px-2 py-2 space-y-2">
                  <input
                    autoFocus
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void submitCreate(); if (e.key === "Escape") setShowCreateForm(false); }}
                    placeholder="Roadmap name…"
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-[13px] outline-none focus:ring-2 focus:ring-blue-400/40"
                  />
                  <div className="flex flex-wrap items-center gap-1">
                    {Array.from(new Set([...newYears, currentCalYear, currentCalYear + 1, currentCalYear + 2, currentCalYear + 3])).sort((a, b) => a - b).map((y) => {
                      const checked = newYears.includes(y);
                      return (
                        <button
                          key={y}
                          type="button"
                          onClick={() => setNewYears((prev) => checked ? prev.filter((x) => x !== y) : [...prev, y].sort())}
                          className={cn("rounded-md border px-2 py-0.5 text-[12px] font-medium transition", checked ? "border-blue-400 bg-blue-50 text-blue-950" : "border-slate-200 text-slate-500 hover:bg-slate-50")}
                        >{y}</button>
                      );
                    })}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min={2000}
                      max={2100}
                      inputMode="numeric"
                      placeholder="Add year…"
                      value={newCustomYearInput}
                      onChange={(e) => setNewCustomYearInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter") return;
                        e.preventDefault();
                        const y = Number(newCustomYearInput);
                        if (!Number.isInteger(y) || y < 2000 || y > 2100) return;
                        setNewYears((prev) => prev.includes(y) ? prev : [...prev, y].sort());
                        setNewCustomYearInput("");
                      }}
                      className="h-7 w-[5.5rem] rounded-md border border-slate-200 px-2 text-[12px] tabular-nums text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/30"
                    />
                    <button
                      type="button"
                      disabled={!newCustomYearInput.trim()}
                      onClick={() => {
                        const y = Number(newCustomYearInput);
                        if (!Number.isInteger(y) || y < 2000 || y > 2100) return;
                        setNewYears((prev) => prev.includes(y) ? prev : [...prev, y].sort());
                        setNewCustomYearInput("");
                      }}
                      className="inline-flex h-7 items-center gap-1 rounded-md bg-slate-800 px-2 text-[12px] font-semibold text-white hover:bg-slate-700 disabled:opacity-40"
                    >
                      <Plus className="size-3" /> Add
                    </button>
                  </div>
                  <div className="flex gap-1.5">
                    <button type="button" onClick={() => setShowCreateForm(false)} className="flex-1 rounded-lg border border-slate-200 py-1 text-[12px] font-medium text-slate-500 hover:bg-slate-50">Cancel</button>
                    <button
                      type="button"
                      disabled={!newName.trim() || newYears.length === 0 || creating}
                      onClick={() => void submitCreate()}
                      className="flex-1 rounded-lg bg-blue-600 py-1 text-[12px] font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
                    >{creating ? "Creating…" : "Create"}</button>
                  </div>
                </div>
              )}
            </div>
            {filtered.map((r) => (
              <div
                key={r.id}
                className={cn(
                  "group/roadmap relative flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-medium text-slate-950 hover:bg-slate-100",
                  r.id === selectedRoadmap?.id && "bg-blue-50 text-blue-950",
                )}
              >
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onSelectRoadmap?.(r.id);
                    setDropdownOpen(false);
                    setQuery("");
                    setShowCreateForm(false);
                    inputRef.current?.blur();
                  }}
                  className="flex flex-1 items-center gap-2 text-left"
                >
                  <MapIcon className="size-3.5 shrink-0 text-slate-400" />
                  <span className="flex-1 truncate">{r.name}</span>
                  <span className="shrink-0 text-[11px] text-slate-400">{normalizeYears(r.years).join(", ")}</span>
                  {r.id === selectedRoadmap?.id && <Check className="size-3.5 shrink-0 text-blue-600" />}
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectRoadmap?.(r.id);
                    setDropdownOpen(false);
                    setQuery("");
                    setShowCreateForm(false);
                    setManageOpen(true);
                  }}
                  title="Manage roadmap"
                  aria-label={`Manage ${r.name}`}
                  className="shrink-0 rounded-md p-1 text-slate-400 opacity-0 transition hover:bg-slate-200 hover:text-indigo-700 group-hover/roadmap:opacity-100 focus-visible:opacity-100"
                >
                  <SquarePen className="size-3.5" strokeWidth={2} aria-hidden />
                </button>
              </div>
            ))}
            {filtered.length === 0 && (
              <p className="px-3 py-2 text-[12px] text-slate-400">No roadmaps found</p>
            )}
          </div>
        )}
      </div>

      {/* Manage popover */}
      {selectedRoadmap && manageOpen && (
        <div ref={manageRef} className="absolute top-full right-0 z-50 mt-1">
          {(() => {
            const persistedYears = normalizeYears(selectedRoadmap.years);
            const persistedSet = new Set(persistedYears);
            const pendingSet = new Set(pendingYears);
            const addableQuickYears = [0, 1, 2, 3]
              .map((i) => currentCalYear + i)
              .filter((y) => !pendingSet.has(y));
            const yearsToAdd = pendingYears.filter((y) => !persistedSet.has(y));
            const yearsToRemove = persistedYears.filter((y) => !pendingSet.has(y));
            const nameDirty = renameValue.trim().length > 0 && renameValue.trim() !== selectedRoadmap.name;
            const yearsDirty = yearsToAdd.length > 0 || yearsToRemove.length > 0;
            const canSave = (nameDirty || yearsDirty) && pendingYears.length > 0 && !savingManage;
            const togglePendingYear = (y: number) => {
              setYearError(null);
              setPendingYears((prev) =>
                prev.includes(y) ? prev.filter((x) => x !== y) : [...prev, y].sort((a, b) => a - b),
              );
            };
            const submitCustomYear = () => {
              const y = Number(manageCustomYearInput);
              if (!Number.isInteger(y) || y < 2000 || y > 2100) {
                setYearError("Year must be between 2000 and 2100");
                return;
              }
              if (pendingYears.includes(y)) {
                setYearError(`${y} is already added`);
                return;
              }
              setYearError(null);
              setPendingYears((prev) => [...prev, y].sort((a, b) => a - b));
              setManageCustomYearInput("");
            };
            const saveAll = async () => {
              setSavingManage(true);
              setYearError(null);
              try {
                if (nameDirty && onRenameRoadmap) {
                  await onRenameRoadmap(selectedRoadmap.id, renameValue.trim());
                }
                for (const y of yearsToAdd) {
                  await onAddYearToRoadmap?.(selectedRoadmap.id, y);
                }
                for (const y of yearsToRemove) {
                  const result = await onRemoveYearFromRoadmap?.(selectedRoadmap.id, y);
                  if (result?.error) {
                    setYearError(result.error);
                    return;
                  }
                }
                setManageOpen(false);
              } finally {
                setSavingManage(false);
              }
            };
            return (
              <div className="w-72 rounded-2xl border border-indigo-100 bg-white p-3.5 shadow-2xl ring-1 ring-indigo-100/70 space-y-3">
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-indigo-500/80">Rename</p>
                  <input
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    placeholder="Roadmap name"
                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[13px] text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/30"
                  />
                </div>

                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-indigo-500/80">Years in scope</p>
                  <div className="flex flex-wrap gap-1.5">
                    {pendingYears.map((y) => (
                      <div
                        key={y}
                        className="inline-flex items-center gap-1 rounded-full border border-indigo-200/80 bg-indigo-50 px-2.5 py-0.5 text-[12px] font-semibold tabular-nums text-indigo-800"
                      >
                        {y}
                        <button
                          type="button"
                          title={`Remove ${y}`}
                          onClick={() => togglePendingYear(y)}
                          className="-mr-0.5 ml-0.5 inline-flex size-3.5 items-center justify-center rounded-full text-indigo-400 transition hover:bg-rose-100 hover:text-rose-600"
                        ><X className="size-2.5" strokeWidth={2.5} /></button>
                      </div>
                    ))}
                    {addableQuickYears.map((y) => (
                      <button
                        key={y}
                        type="button"
                        onClick={() => togglePendingYear(y)}
                        className="inline-flex items-center gap-0.5 rounded-full border border-dashed border-indigo-300/70 bg-white px-2.5 py-0.5 text-[12px] font-medium tabular-nums text-indigo-400 transition hover:border-indigo-500 hover:bg-indigo-50 hover:text-indigo-700"
                      ><Plus className="size-2.5" strokeWidth={2.5} />{y}</button>
                    ))}
                  </div>
                  <div className="flex items-center gap-1.5 pt-0.5">
                    <input
                      type="number"
                      min={2000}
                      max={2100}
                      inputMode="numeric"
                      placeholder="Add year…"
                      value={manageCustomYearInput}
                      onChange={(e) => { setYearError(null); setManageCustomYearInput(e.target.value); }}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter") return;
                        e.preventDefault();
                        submitCustomYear();
                      }}
                      className="h-7 w-[6.5rem] rounded-md border border-slate-200 bg-white px-2 text-[12px] tabular-nums text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/30"
                    />
                    <button
                      type="button"
                      disabled={!manageCustomYearInput.trim()}
                      onClick={submitCustomYear}
                      className="inline-flex h-7 items-center gap-1 rounded-md border border-indigo-200 bg-white px-2 text-[12px] font-semibold text-indigo-700 transition hover:border-indigo-400 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Plus className="size-3" /> Add
                    </button>
                  </div>
                  {yearError && <p className="text-[11px] text-rose-600">{yearError}</p>}
                </div>

                <div className="flex gap-1.5 border-t border-indigo-100 pt-2.5">
                  <button
                    type="button"
                    onClick={() => setManageOpen(false)}
                    className="flex-1 rounded-lg border border-slate-200 bg-white py-1.5 text-[12.5px] font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
                  >Cancel</button>
                  <button
                    type="button"
                    disabled={!canSave}
                    onClick={() => void saveAll()}
                    className="flex-1 rounded-lg bg-indigo-600 py-1.5 text-[12.5px] font-semibold text-white shadow-sm shadow-indigo-300/40 transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
                  >{savingManage ? "Saving…" : "Save"}</button>
                </div>

                <div className="border-t border-slate-100 pt-2">
                  <button
                    type="button"
                    onClick={() => void handleDeleteRequest()}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] font-medium text-rose-600 transition hover:bg-rose-50"
                  >
                    <Trash2 className="size-3.5" /> Delete roadmap
                  </button>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Year sub-picker */}
      {years.length > 0 && (
        isSubtitle ? (
          <>
            <div className="relative inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 shadow-sm transition hover:border-indigo-300 hover:bg-indigo-50/40 focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-200/60">
              <select
                value={year}
                onChange={(e) => void onYearChange(Number(e.target.value))}
                title="Switch year"
                aria-label="Switch year"
                className="appearance-none h-5 cursor-pointer bg-transparent py-0 pl-0 pr-3.5 text-[13px] font-medium tabular-nums text-slate-800 outline-none transition hover:text-indigo-700"
              >
                {years.map((y) => (
                  <option key={y} value={y} className="text-slate-900">{y}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-1 top-1/2 size-3 -translate-y-1/2 text-slate-500" aria-hidden />
            </div>
          </>
        ) : (
          <div className="flex items-center border-l border-indigo-300/60 pl-1.5 pr-1.5">
            <div className="relative inline-flex items-center">
              <select
                value={year}
                onChange={(e) => void onYearChange(Number(e.target.value))}
                title="Switch year"
                aria-label="Switch year"
                className="appearance-none h-[22px] cursor-pointer rounded-md border border-indigo-300/70 bg-white/40 py-0 pl-2 pr-6 text-[12px] font-semibold tabular-nums text-indigo-900 outline-none transition hover:bg-white/70 focus-visible:ring-2 focus-visible:ring-indigo-300/60"
              >
                {years.map((y) => (
                  <option key={y} value={y} className="text-slate-900">{y}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-1 top-1/2 size-3 -translate-y-1/2 text-indigo-700" aria-hidden />
            </div>
          </div>
        )
      )}

      {/* Subtitle: optional trailing text like "50 epics in scope" */}
      {isSubtitle && extraSuffix ? (
        <span className="text-[13px] font-normal text-slate-500">{extraSuffix}</span>
      ) : null}

      {/* Delete confirmation modal */}
      {deleteConfirm && selectedRoadmap && (
        <RoadmapDeleteConfirm
          roadmapName={selectedRoadmap.name}
          counts={deleteConfirm.counts}
          onConfirm={() => void handleDeleteConfirmed()}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}
      {deleting && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-white/60 backdrop-blur-sm">
          <p className="text-[14px] font-semibold text-slate-600">Deleting roadmap…</p>
        </div>,
        document.body,
      )}
    </div>
  );
}
