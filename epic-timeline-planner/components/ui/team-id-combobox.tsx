"use client";

import { createPortal } from "react-dom";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Pencil, X } from "lucide-react";
import { MONTH_TEAM_COLUMNS } from "@/lib/month-team-board";
import { normalizeWorkspaceUserTeam, teamLabelForWorkspaceUser } from "@/lib/workspace-users";
import { TeamAvatar } from "@/components/ui/team-avatar";
import { cn } from "@/lib/utils";

type TeamRow = { id: string; label: string };

// 9800 sits above every dialog overlay (StoryDetailsDialog uses
// `z-[9700]`, others use `z-[9500]`).
const MENU_Z = 9800;

function labelForTeamId(teamId: string): string {
  if (!teamId) return "";
  const col = MONTH_TEAM_COLUMNS.find((t) => t.id === teamId);
  if (col) return col.label;
  return teamLabelForWorkspaceUser(teamId);
}

/** Map free-text to a team id using the current option list (label / id / prefix on label). */
function resolveTeamPickFromQuery(query: string, rows: TeamRow[]): string {
  const t = query.trim().toLowerCase();
  if (!t) return "";
  const exact = rows.find((r) => r.label.toLowerCase() === t);
  if (exact) return exact.id;
  const byId = rows.find((r) => r.id && r.id.toLowerCase() === t);
  if (byId) return byId.id;
  const prefix = rows.find((r) => r.label.toLowerCase().startsWith(t));
  if (prefix) return prefix.id;
  return "";
}

type TeamIdComboboxProps = {
  teamId: string;
  onTeamIdChange: (nextId: string) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  id?: string;
  /** When true, free text can create a slugified team id (Users directory). Delivery-only flows should omit this. */
  allowCustomTeam?: boolean;
  /** Extra team ids to list (e.g. distinct teams from the user directory). */
  extraTeamIds?: readonly string[];
};

/**
 * Search delivery teams by label (e.g. "Plat" → Platform). Menu is portaled with fixed position so it aligns under the field in dialogs.
 */
export function TeamIdCombobox({
  teamId,
  onTeamIdChange,
  disabled,
  className,
  placeholder = "Type or pick a team",
  id: inputIdProp,
  allowCustomTeam = false,
  extraTeamIds,
}: TeamIdComboboxProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const portalRef = useRef<HTMLDivElement>(null);
  /** Suppress blur flush when we just committed from the portaled menu (avoids stale draft clearing the pick). */
  const skipNextBlurCloseRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState("");
  const [inlineNewTeamName, setInlineNewTeamName] = useState("");
  const [inlineCreateExpanded, setInlineCreateExpanded] = useState(false);
  const inlineCreateInputRef = useRef<HTMLInputElement>(null);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});

  const displayValue = focused ? draft : labelForTeamId(teamId);

  const allRows: TeamRow[] = useMemo(() => {
    const base: TeamRow[] = [
      { id: "", label: "Not set" },
      ...MONTH_TEAM_COLUMNS.map((c) => ({ id: c.id, label: c.label })),
    ];
    const seen = new Set(base.map((r) => r.id));
    for (const id of extraTeamIds ?? []) {
      if (!id || seen.has(id)) continue;
      seen.add(id);
      base.push({ id, label: labelForTeamId(id) });
    }
    return base;
  }, [extraTeamIds]);

  const filtered = useMemo(() => {
    const q = (open ? draft : displayValue).trim().toLowerCase();
    if (!q) return allRows;
    return allRows.filter(
      (r) => r.label.toLowerCase().includes(q) || (r.id && r.id.toLowerCase().includes(q)),
    );
  }, [allRows, displayValue, open, draft]);

  const inlineNewSlug = useMemo(() => {
    if (!allowCustomTeam || inlineNewTeamName.trim().length < 2) return "";
    return normalizeWorkspaceUserTeam(inlineNewTeamName);
  }, [allowCustomTeam, inlineNewTeamName]);

  const canAddInlineNewTeam =
    allowCustomTeam &&
    inlineNewSlug !== "" &&
    !allRows.some((r) => r.id === inlineNewSlug);

  useEffect(() => {
    if (!open) {
      setInlineNewTeamName("");
      setInlineCreateExpanded(false);
    }
  }, [open]);

  // After the inline create form expands, move focus into its input so the
  // user can start typing immediately. Doing this in an effect (rather than
  // relying on `autoFocus`) keeps focus inside the portal and prevents the
  // brief "focus is on nothing" moment that the popup-close logic would
  // otherwise treat as a click-outside.
  useEffect(() => {
    if (!open || !inlineCreateExpanded) return;
    const id = window.setTimeout(() => {
      inlineCreateInputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(id);
  }, [open, inlineCreateExpanded]);

  const recalcMenu = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setMenuStyle({
      position: "fixed",
      top: r.bottom + 4,
      left: r.left,
      width: r.width,
      zIndex: MENU_Z,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    recalcMenu();
  }, [open, displayValue, recalcMenu, canAddInlineNewTeam, inlineNewTeamName]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener("scroll", recalcMenu, true);
    window.addEventListener("resize", recalcMenu);
    return () => {
      window.removeEventListener("scroll", recalcMenu, true);
      window.removeEventListener("resize", recalcMenu);
    };
  }, [open, recalcMenu]);

  useEffect(() => {
    if (!open) return;
    const fn = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t)) return;
      if (portalRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, [open]);

  const commitPick = (id: string) => {
    skipNextBlurCloseRef.current = true;
    onTeamIdChange(id);
    setDraft(labelForTeamId(id));
    setInlineNewTeamName("");
    setOpen(false);
    setFocused(false);
    inputRef.current?.blur();
    window.setTimeout(() => {
      skipNextBlurCloseRef.current = false;
    }, 50);
  };

  const commitInlineNewTeam = () => {
    if (!canAddInlineNewTeam) return;
    commitPick(inlineNewSlug);
  };

  const flushFromDraft = () => {
    const resolved = resolveTeamPickFromQuery(draft, allRows);
    const next = resolved || (allowCustomTeam ? normalizeWorkspaceUserTeam(draft) : "");
    onTeamIdChange(next);
    setDraft(labelForTeamId(next));
  };

  const showMenu = open && !disabled && (filtered.length > 0 || allowCustomTeam);
  const dropdown =
    showMenu && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={portalRef}
            className="rounded-md border border-slate-200 bg-white py-1 shadow-lg"
            style={menuStyle}
          >
            {/* Search input lives inside the popup since the field is
              * read-only. Filters the option list as the user types. */}
            <div className="px-1.5 pt-1 pb-1.5">
              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Search teams…"
                autoFocus
                onMouseDown={(e) => e.stopPropagation()}
                className="w-full rounded border border-slate-300 px-2 py-1 text-[13px] text-slate-800 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-200/70"
              />
            </div>
            <ul className="max-h-52 overflow-y-auto py-0.5" role="listbox">
              {allowCustomTeam ? (
                <li key="__create_team__" className="border-b border-slate-100 px-2 py-2" role="presentation">
                  {inlineCreateExpanded ? (
                    <>
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          Create new team
                        </p>
                        <button
                          type="button"
                          aria-label="Cancel new team"
                          title="Cancel"
                          onMouseDown={(ev) => {
                            ev.preventDefault();
                            ev.stopPropagation();
                            skipNextBlurCloseRef.current = true;
                            setInlineCreateExpanded(false);
                            setInlineNewTeamName("");
                            inputRef.current?.focus();
                          }}
                          className="inline-flex size-4 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                        >
                          <X className="size-3" aria-hidden />
                        </button>
                      </div>
                      <div className="flex min-w-0 gap-1.5">
                        <input
                          ref={inlineCreateInputRef}
                          type="text"
                          value={inlineNewTeamName}
                          onChange={(e) => setInlineNewTeamName(e.target.value)}
                          placeholder="Team name"
                          autoComplete="off"
                          aria-label="New team name"
                          className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[13px] font-medium text-slate-900 outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-200/80"
                          onMouseDown={(e) => e.stopPropagation()}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              commitInlineNewTeam();
                            }
                            if (e.key === "Escape") {
                              e.preventDefault();
                              setInlineCreateExpanded(false);
                              setInlineNewTeamName("");
                            }
                          }}
                        />
                        <button
                          type="button"
                          disabled={!canAddInlineNewTeam}
                          className={cn(
                            "shrink-0 rounded-md px-2.5 py-1.5 text-[12px] font-semibold transition",
                            canAddInlineNewTeam
                              ? "bg-violet-600 text-white hover:bg-violet-500"
                              : "cursor-not-allowed bg-slate-100 text-slate-400",
                          )}
                          onMouseDown={(ev) => {
                            ev.preventDefault();
                            commitInlineNewTeam();
                          }}
                        >
                          Add
                        </button>
                      </div>
                      <p className="mt-1.5 text-[11px] leading-snug text-slate-500">
                        {inlineNewSlug && !canAddInlineNewTeam ? (
                          <span className="text-amber-700">That team already exists in the list.</span>
                        ) : (
                          <>At least 2 characters. Saves as a team id (e.g. &quot;Team Super&quot; → team-super).</>
                        )}
                      </p>
                    </>
                  ) : (
                    <button
                      type="button"
                      onMouseDown={(ev) => {
                        ev.preventDefault();
                        ev.stopPropagation();
                        skipNextBlurCloseRef.current = true;
                        setInlineCreateExpanded(true);
                      }}
                      className="flex w-full items-center justify-between gap-2 rounded-md px-1 py-1 text-left text-[12px] font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <Pencil className="size-3 text-slate-500" strokeWidth={2.2} aria-hidden />
                        Add new team
                      </span>
                      <span className="text-[10px] text-slate-400">Edit</span>
                    </button>
                  )}
                </li>
              ) : null}
              {filtered.map((r) => (
                <li key={r.id || "none"} role="option">
                  <button
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[13px] font-semibold hover:bg-slate-100",
                      r.id ? "text-slate-800" : "text-slate-500",
                    )}
                    onMouseDown={(ev) => {
                      ev.preventDefault();
                      commitPick(r.id);
                    }}
                  >
                    {r.id ? <TeamAvatar slug={r.id} sizePx={16} /> : null}
                    {r.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>,
          document.body,
        )
      : null;

  // Show the selected team's logo (or default team icon) inside the input
  // so the picker reads like a chip even when collapsed. Mirrors what
  // `AssigneeFieldDecoration` does for user avatars. Hidden while focused so
  // it doesn't cover the user's typing.
  const showSelectedDecoration = Boolean(teamId) && !focused;
  return (
    <div ref={wrapRef} className="relative min-w-0 w-full">
      {showSelectedDecoration ? (
        <TeamAvatar
          slug={teamId}
          sizePx={16}
          className="pointer-events-none absolute left-2 top-1/2 z-10 -translate-y-1/2"
        />
      ) : null}
      <input
        ref={inputRef}
        id={inputIdProp}
        type="text"
        value={labelForTeamId(teamId)}
        readOnly
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        aria-label={allowCustomTeam ? "Team" : "Delivery team"}
        aria-expanded={showMenu}
        onMouseDown={(e) => {
          e.preventDefault();
          if (disabled) return;
          setOpen((v) => !v);
          if (!open) inputRef.current?.focus();
        }}
        onChange={() => { /* readOnly — no-op */ }}
        onFocus={() => {
          setFocused(true);
          setOpen(true);
        }}
        onBlur={(e) => {
          setFocused(false);
          const nextTarget = e.relatedTarget as Node | null;
          // Keep menu open when focus moves into the portaled list (blur fires before option mousedown in some browsers).
          if (nextTarget && portalRef.current?.contains(nextTarget)) return;
          if (nextTarget && wrapRef.current?.contains(nextTarget)) return;
          // Always defer flush so menu mousedown can set skipNextBlurCloseRef before we apply draft (avoids double-apply / duplicate toasts).
          window.setTimeout(() => {
            if (skipNextBlurCloseRef.current) return;
            if (portalRef.current?.contains(document.activeElement)) return;
            flushFromDraft();
            setOpen(false);
          }, 0);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        className={cn(className, showSelectedDecoration && "pl-8")}
      />
      {dropdown}
    </div>
  );
}

/** Call before reading `teamId` from parent state if the team field may still be focused (applies pending blur). */
export function blurActiveField(): void {
  if (typeof document === "undefined") return;
  const el = document.activeElement;
  if (el instanceof HTMLElement) el.blur();
}
