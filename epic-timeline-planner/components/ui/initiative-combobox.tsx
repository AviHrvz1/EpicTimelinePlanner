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

export type InitiativeComboboxOption = { id: string; title: string };

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
};

const MENU_Z = 8000;
const MENU_MAX_PX = 208;
const VIEW_MARGIN = 8;
const FIELD_GAP = 4;

function normalizeTitle(t: string): string {
  return t.trim().toLowerCase();
}

/**
 * Searchable initiative picker with optional inline “create new initiative” row (portaled menu).
 */
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

  const selectedTitle = useMemo(() => options.find((o) => o.id === valueId)?.title ?? "", [options, valueId]);

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
                    className="w-full px-2.5 py-1.5 text-left text-[13px] font-semibold text-slate-800 hover:bg-slate-100"
                    onMouseDown={(ev) => {
                      ev.preventDefault();
                      pick(o);
                    }}
                  >
                    {o.title}
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
                    {isCreating ? "Creating…" : `+ Create initiative “${trimmedDraft}”`}
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
      <input
        ref={inputRef}
        id={inputId}
        type="text"
        value={draft}
        title={selectedTitle || placeholder}
        onChange={(e) => {
          setDraft(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          setOpen(true);
          if (!draft && selectedTitle) setDraft(selectedTitle);
        }}
        onBlur={() => {
          resolveBlur();
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
        className={cn(className)}
      />
      {dropdown}
    </div>
  );
}
