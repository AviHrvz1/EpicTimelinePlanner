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

import { MONTH_TEAM_COLUMNS, MONTH_TEAM_IDS } from "@/lib/month-team-board";
import { cn } from "@/lib/utils";

type TeamRow = { id: string; label: string };

const MENU_Z = 8000;

function labelForTeamId(teamId: string): string {
  if (!teamId || !MONTH_TEAM_IDS.includes(teamId)) return "";
  return MONTH_TEAM_COLUMNS.find((t) => t.id === teamId)?.label ?? "";
}

/** Map free-text to a team id; prefix / substring match on label and id. */
function resolveTeamIdFromQuery(query: string): string {
  const t = query.trim().toLowerCase();
  if (!t) return "";
  const rows: TeamRow[] = MONTH_TEAM_COLUMNS.map((c) => ({ id: c.id, label: c.label }));
  const exact = rows.find((r) => r.label.toLowerCase() === t);
  if (exact) return exact.id;
  const byId = rows.find((r) => r.id.toLowerCase() === t);
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
}: TeamIdComboboxProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const portalRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState("");
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});

  const displayValue = focused ? draft : labelForTeamId(teamId);

  const allRows: TeamRow[] = useMemo(
    () => [{ id: "", label: "Not set" }, ...MONTH_TEAM_COLUMNS.map((c) => ({ id: c.id, label: c.label }))],
    [],
  );

  const filtered = useMemo(() => {
    const q = displayValue.trim().toLowerCase();
    if (!q) return allRows;
    return allRows.filter(
      (r) => r.label.toLowerCase().includes(q) || (r.id && r.id.toLowerCase().includes(q)),
    );
  }, [allRows, displayValue]);

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
  }, [open, displayValue, recalcMenu]);

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
    onTeamIdChange(id);
    setDraft(labelForTeamId(id));
    setOpen(false);
    setFocused(false);
    inputRef.current?.blur();
  };

  const flushFromDraft = () => {
    const id = resolveTeamIdFromQuery(draft);
    onTeamIdChange(id);
    setDraft(labelForTeamId(id));
  };

  const showMenu = open && !disabled && filtered.length > 0;
  const dropdown =
    showMenu && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={portalRef}
            className="rounded-md border border-slate-200 bg-white py-1 shadow-lg"
            style={menuStyle}
          >
            <ul className="max-h-52 overflow-y-auto py-0.5" role="listbox">
              {filtered.map((r) => (
                <li key={r.id || "none"} role="option">
                  <button
                    type="button"
                    className={cn(
                      "w-full px-2.5 py-1.5 text-left text-[13px] font-semibold hover:bg-slate-100",
                      r.id ? "text-slate-800" : "text-slate-500",
                    )}
                    onMouseDown={(ev) => {
                      ev.preventDefault();
                      commitPick(r.id);
                    }}
                  >
                    {r.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={wrapRef} className="relative min-w-0">
      <input
        ref={inputRef}
        id={inputIdProp}
        type="text"
        value={displayValue}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        aria-label="Delivery team"
        aria-expanded={showMenu}
        onChange={(e) => {
          setDraft(e.target.value);
          setFocused(true);
          setOpen(true);
        }}
        onFocus={() => {
          setFocused(true);
          setDraft(labelForTeamId(teamId));
          setOpen(true);
        }}
        onBlur={() => {
          setFocused(false);
          flushFromDraft();
          setOpen(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        className={cn(className)}
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
