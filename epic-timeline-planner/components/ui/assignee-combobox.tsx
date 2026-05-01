"use client";

import { createPortal } from "react-dom";
import {
  type CSSProperties,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { cn } from "@/lib/utils";

type AssigneeComboboxProps = {
  value: string;
  onChange: (next: string) => void;
  suggestions: readonly string[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  id?: string;
  /** aria-label for the text field */
  "aria-label"?: string;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  /** Fires when the text field loses focus (current `value` is passed). */
  onInputBlur?: (value: string) => void;
  /** Fires when a list option is chosen (after `onChange`); use when blur may not run. */
  onSuggestionPick?: (value: string) => void;
};

const MENU_Z = 8000;
/** ~max-h-52; menu flips above the field when there isn’t room below. */
const MENU_MAX_PX = 208;
const VIEW_MARGIN = 8;
const FIELD_GAP = 4;

/**
 * Autocomplete with a portaled, fixed-position list so the menu stays under the field inside dialogs / transformed layouts (native datalist is often misplaced).
 */
export function AssigneeCombobox({
  value,
  onChange,
  suggestions,
  placeholder = "Search or pick assignee",
  className,
  disabled,
  id: idProp,
  "aria-label": ariaLabel,
  onKeyDown,
  onInputBlur,
}: AssigneeComboboxProps) {
  const uid = useId().replace(/:/g, "");
  const inputId = idProp ?? `assignee-input-${uid}`;
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const portalRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    const list = [...new Set(suggestions)];
    if (!q) return list.slice(0, 80);
    return list.filter((s) => s.toLowerCase().includes(q)).slice(0, 80);
  }, [value, suggestions]);

  const recalcMenu = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom - VIEW_MARGIN;
    const spaceAbove = r.top - VIEW_MARGIN;
    const openUp = spaceBelow < 120 && spaceAbove > spaceBelow;
    const cap = Math.min(MENU_MAX_PX, Math.max(96, openUp ? spaceAbove - FIELD_GAP : spaceBelow - FIELD_GAP));

    if (openUp) {
      setMenuStyle({
        position: "fixed",
        left: r.left,
        width: r.width,
        zIndex: MENU_Z,
        top: "auto",
        bottom: window.innerHeight - r.top + FIELD_GAP,
        maxHeight: cap,
        overflow: "hidden",
      });
    } else {
      setMenuStyle({
        position: "fixed",
        top: r.bottom + FIELD_GAP,
        left: r.left,
        width: r.width,
        zIndex: MENU_Z,
        bottom: "auto",
        maxHeight: cap,
        overflow: "hidden",
      });
    }
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    recalcMenu();
  }, [open, value, filtered.length, recalcMenu]);

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

  const pick = (s: string) => {
    onChange(s);
    onSuggestionPick?.(s);
    setOpen(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setOpen(false);
    }
    onKeyDown?.(e);
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
            <ul
              className="max-h-full overflow-y-auto overscroll-contain py-0.5 [-webkit-overflow-scrolling:touch]"
              role="listbox"
            >
              {filtered.map((s) => (
                <li key={s} role="option">
                  <button
                    type="button"
                    className="w-full px-2.5 py-1.5 text-left text-[13px] font-semibold text-slate-800 hover:bg-slate-100"
                    onMouseDown={(ev) => {
                      ev.preventDefault();
                      pick(s);
                    }}
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={wrapRef} className={cn("relative min-w-0")}>
      <input
        ref={inputRef}
        id={inputId}
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => onInputBlur?.(value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        aria-label={ariaLabel ?? "Assignee"}
        aria-expanded={showMenu}
        role="combobox"
        className={cn(className)}
      />
      {dropdown}
    </div>
  );
}
