"use client";

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
import { Zap } from "lucide-react";

import { cn } from "@/lib/utils";

export type InitiativeComboboxOption = {
  id: string;
  title: string;
  /** Optional muted secondary line shown under the title (e.g. parent initiative). */
  subtitle?: string;
  /** Leading icon for this option row. Falls back to the global default. */
  icon?: ReactNode;
};

type InitiativeComboboxProps = {
  valueId: string;
  onValueChange: (id: string) => void;
  options: readonly InitiativeComboboxOption[];
  /** When the typed title is new, create an initiative and return its id. */
  onCreateNew?: (title: string) => Promise<string>;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  id?: string;
  "aria-label"?: string;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  /** Default icon used both as the field overlay and for option rows that
   *  don't carry their own `icon`. Defaults to a Zap glyph. */
  defaultIcon?: ReactNode;
  /** Wording inside the inline create row (e.g. `epic`, `initiative`). */
  createLabel?: string;
};

// 9800 sits above every dialog overlay (StoryDetailsDialog uses
// `z-[9700]`, others use `z-[9500]`).
const MENU_Z = 9800;
const MENU_MAX_PX = 208;
const VIEW_MARGIN = 8;
const FIELD_GAP = 4;
/** Minimum menu width — gives the popup enough room to show option titles
 *  + the initiative-name subtitle on a single line. The field itself is
 *  often narrower (it just shows the selected title), so we override its
 *  width when the popup opens and clamp the `left` so we don't run off
 *  the right edge of the viewport. */
const MENU_MIN_WIDTH = 320;

function normalizeTitle(t: string): string {
  return t.trim().toLowerCase();
}

/**
 * Searchable initiative picker with optional inline “create new initiative” row (portaled menu).
 */
const DEFAULT_ICON: ReactNode = (
  <Zap className="size-3.5 shrink-0 text-amber-500" strokeWidth={2} aria-hidden />
);

export function InitiativeCombobox({
  valueId,
  onValueChange,
  options,
  onCreateNew,
  disabled,
  placeholder = "Search or pick an initiative",
  className,
  id: idProp,
  "aria-label": ariaLabel,
  onKeyDown,
  defaultIcon = DEFAULT_ICON,
  createLabel = "initiative",
}: InitiativeComboboxProps) {
  const uid = useId().replace(/:/g, "");
  const inputId = idProp ?? `initiative-input-${uid}`;
  const listboxId = `${inputId}-listbox`;
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const portalRef = useRef<HTMLDivElement>(null);
  const skipBlurResolveRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const [draft, setDraft] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const selectedOption = useMemo(() => options.find((o) => o.id === valueId), [options, valueId]);
  const selectedTitle = selectedOption?.title ?? "";

  useEffect(() => {
    if (!open) {
      setDraft(selectedTitle);
    }
  }, [selectedTitle, open]);

  const filtered = useMemo(() => {
    const q = draft.trim().toLowerCase();
    const list = [...options].sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
    if (!q) return list.slice(0, 80);
    return list
      .filter((o) => o.title.toLowerCase().includes(q))
      .sort((a, b) => {
        const as = a.title.toLowerCase().startsWith(q) ? 0 : 1;
        const bs = b.title.toLowerCase().startsWith(q) ? 0 : 1;
        if (as !== bs) return as - bs;
        return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
      })
      .slice(0, 80);
  }, [draft, options]);

  const trimmedDraft = draft.trim();
  const canOfferCreate =
    Boolean(onCreateNew) &&
    trimmedDraft.length >= 2 &&
    !options.some((o) => normalizeTitle(o.title) === normalizeTitle(trimmedDraft));

  const recalcMenu = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom - VIEW_MARGIN;
    const spaceAbove = r.top - VIEW_MARGIN;
    const openUp = spaceBelow < 120 && spaceAbove > spaceBelow;
    const cap = Math.min(MENU_MAX_PX, Math.max(96, openUp ? spaceAbove - FIELD_GAP : spaceBelow - FIELD_GAP));

    // Widen the menu beyond the field so titles + subtitles fit on one line.
    // Then clamp `left` so we don't overflow the right edge — if the field
    // is near the right viewport edge, shift the menu leftward instead.
    const desiredWidth = Math.max(MENU_MIN_WIDTH, r.width);
    const maxLeft = window.innerWidth - desiredWidth - VIEW_MARGIN;
    const clampedLeft = Math.max(VIEW_MARGIN, Math.min(r.left, maxLeft));

    if (openUp) {
      setMenuStyle({
        position: "fixed",
        left: clampedLeft,
        width: desiredWidth,
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
        left: clampedLeft,
        width: desiredWidth,
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
  }, [open, draft, filtered.length, canOfferCreate, recalcMenu]);

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

  const pick = (opt: InitiativeComboboxOption) => {
    skipBlurResolveRef.current = true;
    onValueChange(opt.id);
    setDraft(opt.title);
    setOpen(false);
    inputRef.current?.focus();
  };

  const resolveBlur = useCallback(() => {
    if (skipBlurResolveRef.current) {
      skipBlurResolveRef.current = false;
      return;
    }
    const q = draft.trim();
    if (!q) {
      setDraft(selectedTitle);
      return;
    }
    const exact = options.find((o) => normalizeTitle(o.title) === normalizeTitle(q));
    if (exact) {
      onValueChange(exact.id);
      setDraft(exact.title);
      return;
    }
    setDraft(selectedTitle);
  }, [draft, options, onValueChange, selectedTitle]);

  const handleCreate = async () => {
    if (!onCreateNew || !canOfferCreate || isCreating) return;
    skipBlurResolveRef.current = true;
    setIsCreating(true);
    try {
      const id = await onCreateNew(trimmedDraft);
      if (id) {
        onValueChange(id);
        setDraft(trimmedDraft);
      }
      setOpen(false);
    } finally {
      setIsCreating(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setOpen(false);
      setDraft(selectedTitle);
    }
    if (e.key === "Enter" && open && canOfferCreate && filtered.length === 0) {
      e.preventDefault();
      void handleCreate();
    }
    onKeyDown?.(e);
  };

  const showMenu =
    open && !disabled && (filtered.length > 0 || canOfferCreate);
  const dropdown =
    showMenu && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={portalRef}
            className="rounded-md border border-slate-200 bg-white py-1 shadow-lg"
            style={menuStyle}
          >
            <ul
              id={listboxId}
              className="max-h-full overflow-y-auto overscroll-contain py-0.5 [-webkit-overflow-scrolling:touch]"
              role="listbox"
            >
              {filtered.map((o) => (
                <li key={o.id} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={valueId === o.id}
                    className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13px] font-semibold text-slate-800 hover:bg-slate-100"
                    onMouseDown={(ev) => {
                      ev.preventDefault();
                      pick(o);
                    }}
                  >
                    {o.icon ?? defaultIcon}
                    <span className="flex min-w-0 flex-col">
                      <span className="min-w-0 truncate">{o.title}</span>
                      {o.subtitle ? (
                        <span className="min-w-0 truncate text-[11px] font-normal text-slate-500">{o.subtitle}</span>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
              {canOfferCreate ? (
                <li role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    disabled={isCreating}
                    className="w-full border-t border-slate-100 px-2.5 py-1.5 text-left text-[13px] font-semibold text-sky-700 hover:bg-sky-50 disabled:opacity-60"
                    onMouseDown={(ev) => {
                      ev.preventDefault();
                      void handleCreate();
                    }}
                  >
                    {isCreating ? "Creating…" : `+ Create ${createLabel} “${trimmedDraft}”`}
                  </button>
                </li>
              ) : null}
            </ul>
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={wrapRef} className={cn("relative min-w-0")}>
      {/* Autocomplete: the field is freely editable; typing filters
        * the option list. The leading overlay reflects the currently
        * selected option's icon (or the global default). */}
      <span className="pointer-events-none absolute left-2 top-1/2 z-10 -translate-y-1/2">
        {selectedOption?.icon ?? defaultIcon}
      </span>
      <input
        ref={inputRef}
        id={inputId}
        type="text"
        value={draft}
        title={selectedTitle || placeholder}
        onChange={(e) => {
          setDraft(e.target.value);
          if (!open) setOpen(true);
        }}
        onFocus={() => {
          if (disabled) return;
          setOpen(true);
        }}
        onBlur={() => {
          resolveBlur();
          setOpen(false);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        aria-label={ariaLabel ?? "Initiative"}
        aria-controls={showMenu ? listboxId : undefined}
        aria-expanded={showMenu}
        aria-autocomplete="list"
        role="combobox"
        // `!pl-7` leaves room for the Zap icon overlay on the left
        // (overrides any `px-*` from the caller's className).
        className={cn(className, "!pl-7")}
      />
      {dropdown}
    </div>
  );
}
