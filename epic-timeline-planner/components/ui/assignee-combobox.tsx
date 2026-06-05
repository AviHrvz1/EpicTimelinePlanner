"use client";

import { Check, UserRound } from "lucide-react";
import { createPortal } from "react-dom";
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { AssigneeFieldDecoration, UserAvatar, resolveAssigneeAvatar } from "@/components/ui/user-avatar";
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
  /**
   * Optional workspace directory — when provided, suggestion rows render the
   * matching user's photo (or initials fallback) instead of the generic
   * UserRound icon. Pass the same `workspaceDirectoryUsers` you already
   * feed to sprint kanban / capacity. Anything not in the directory still
   * renders cleanly with initials.
   */
  directoryUsers?: readonly { name: string; image?: string | null }[] | null;
  /**
   * When true, render the matching user's photo (or `UserRound` fallback) as
   * a leading icon inside the input. Caller is responsible for `pl-7` (or
   * similar) padding in `className` so the text doesn't overlap the icon.
   * Off by default to keep small inline-edit comboboxes flush.
   */
  showLeadingAvatar?: boolean;
  /**
   * Optional override for the icon shown next to each suggestion (and the
   * "Use 'xxx'" create row). Defaults to `UserRound` since this combobox
   * was built for assignees, but callers picking non-person values like
   * labels can pass a `<Tag />` to match the rest of their UI.
   *
   * Has no effect when a directory image renders in place of the icon
   * (i.e. for users with photos).
   */
  optionIcon?: ReactNode;
};

// 9800 sits above every dialog overlay (StoryDetailsDialog uses
// `z-[9700]`, others use `z-[9500]`), so this combobox dropdown is
// visible regardless of which form opens it.
const MENU_Z = 9800;
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
  onSuggestionPick,
  directoryUsers,
  showLeadingAvatar = false,
  optionIcon,
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

  const trimmed = value.trim();
  // Surface a "Use '<typed>'" affordance when the input doesn't match any
  // suggestion -- lets users add a brand-new assignee from inside the menu.
  const showCreateRow =
    trimmed.length > 0 &&
    !filtered.some((s) => s.toLowerCase() === trimmed.toLowerCase());
  const showMenu = open && !disabled && (filtered.length > 0 || showCreateRow);
  const dropdown =
    showMenu && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={portalRef}
            // `overflow-y-auto` on the outer popover box guarantees a
            // visible scrollbar regardless of how `max-h-full` on the
            // <ul> resolves against the parent's `max-height`.
            className="overflow-y-auto rounded-xl border border-slate-200/80 bg-white p-1 shadow-lg ring-1 ring-black/[0.04]"
            style={menuStyle}
          >
            <ul
              className="overscroll-contain [-webkit-overflow-scrolling:touch]"
              role="listbox"
            >
              {filtered.map((s) => {
                const isCurrent = s.toLowerCase() === trimmed.toLowerCase() && trimmed.length > 0;
                const resolved = resolveAssigneeAvatar(s, directoryUsers);
                return (
                  <li key={s} role="option" aria-selected={isCurrent}>
                    <button
                      type="button"
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[14px] outline-none transition-colors",
                        isCurrent
                          ? "bg-indigo-50 text-indigo-700"
                          : "text-slate-700 hover:bg-slate-50",
                      )}
                      onMouseDown={(ev) => {
                        ev.preventDefault();
                        pick(s);
                      }}
                    >
                      {resolved.image ? (
                        <UserAvatar name={resolved.name} image={resolved.image} size={20} />
                      ) : optionIcon ? (
                        optionIcon
                      ) : (
                        <UserRound
                          className={cn(
                            "size-3.5 shrink-0",
                            isCurrent ? "text-indigo-500" : "text-slate-400",
                          )}
                          aria-hidden
                        />
                      )}
                      <span className="min-w-0 flex-1 truncate font-medium leading-tight">{s}</span>
                      {isCurrent ? (
                        <Check className="size-3.5 shrink-0 text-indigo-600" aria-hidden />
                      ) : null}
                    </button>
                  </li>
                );
              })}
              {showCreateRow ? (
                <li role="option">
                  <button
                    type="button"
                    className="mt-0.5 flex w-full items-center gap-2 rounded-lg border border-dashed border-slate-300 px-2 py-1.5 text-left text-[14px] text-slate-600 outline-none transition-colors hover:bg-slate-50"
                    onMouseDown={(ev) => {
                      ev.preventDefault();
                      pick(trimmed);
                    }}
                  >
                    {optionIcon ?? <UserRound className="size-3.5 shrink-0 text-slate-400" aria-hidden />}
                    <span className="min-w-0 flex-1 truncate leading-tight">
                      Use <span className="font-medium text-slate-800">&ldquo;{trimmed}&rdquo;</span>
                    </span>
                  </button>
                </li>
              ) : null}
            </ul>
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={wrapRef} className={cn("relative min-w-0 w-full")}>
      {showLeadingAvatar ? (
        <AssigneeFieldDecoration value={value} directoryUsers={directoryUsers} />
      ) : null}
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
