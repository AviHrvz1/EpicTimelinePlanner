"use client";

import { createPortal } from "react-dom";
import {
  type CSSProperties,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Check, Link as LinkIcon, X } from "lucide-react";

import { cn } from "@/lib/utils";

type Props = {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  initialText: string;
  initialHref: string;
  onSave: (text: string, href: string) => void;
  onUnlink: () => void;
  onClose: () => void;
};

const Z = 9800;
const GAP = 6;
const VIEW_MARGIN = 8;
const POPOVER_WIDTH = 320;

/**
 * Two-field popover for editing a Tiptap link: display text + URL. Replaces the
 * old window.prompt() flow. Anchored under the toolbar button that triggered it
 * and portaled to body so it escapes dialog overflow clipping.
 */
export function LinkEditorPopover({
  anchorRef,
  open,
  initialText,
  initialHref,
  onSave,
  onUnlink,
  onClose,
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const textInputRef = useRef<HTMLInputElement | null>(null);
  const [text, setText] = useState(initialText);
  const [href, setHref] = useState(initialHref);
  const [style, setStyle] = useState<CSSProperties>({ position: "fixed", visibility: "hidden", zIndex: Z });

  useEffect(() => {
    if (!open) return;
    setText(initialText);
    setHref(initialHref || "https://");
  }, [open, initialText, initialHref]);

  const recalc = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom - VIEW_MARGIN;
    const spaceAbove = r.top - VIEW_MARGIN;
    const measuredHeight = rootRef.current?.offsetHeight ?? 0;
    const popoverHeight = measuredHeight > 0 ? measuredHeight : 180;
    const openUp = spaceBelow < popoverHeight + GAP && spaceAbove > spaceBelow;
    const desiredLeft = Math.min(window.innerWidth - POPOVER_WIDTH - VIEW_MARGIN, Math.max(VIEW_MARGIN, r.left));
    const next: CSSProperties = {
      position: "fixed",
      zIndex: Z,
      left: Math.round(desiredLeft),
      width: POPOVER_WIDTH,
      visibility: "visible",
    };
    if (openUp) {
      next.bottom = Math.round(window.innerHeight - r.top + GAP);
    } else {
      next.top = Math.round(r.bottom + GAP);
    }
    setStyle(next);
  }, [anchorRef]);

  useLayoutEffect(() => {
    if (!open) return;
    recalc();
    const id = window.setTimeout(() => {
      textInputRef.current?.focus();
      textInputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(id);
  }, [open, recalc]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener("scroll", recalc, true);
    window.addEventListener("resize", recalc);
    return () => {
      window.removeEventListener("scroll", recalc, true);
      window.removeEventListener("resize", recalc);
    };
  }, [open, recalc]);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(event: MouseEvent) {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    }
    function onDocKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener("mousedown", onDocMouseDown);
    window.addEventListener("keydown", onDocKeyDown);
    return () => {
      window.removeEventListener("mousedown", onDocMouseDown);
      window.removeEventListener("keydown", onDocKeyDown);
    };
  }, [open, anchorRef, onClose]);

  const trimmedHref = href.trim();
  const trimmedText = text.trim();
  const canSave = useMemo(() => {
    if (!trimmedHref || trimmedHref === "https://" || trimmedHref === "http://") return false;
    return /^https?:\/\/.+/i.test(trimmedHref) || /^mailto:.+/i.test(trimmedHref) || /^\//.test(trimmedHref);
  }, [trimmedHref]);

  function handleSave() {
    if (!canSave) return;
    onSave(trimmedText || trimmedHref, trimmedHref);
  }

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-label="Edit link"
      className="rounded-xl border border-slate-200 bg-white p-3 shadow-[0_24px_60px_-10px_rgba(15,23,42,0.35),0_8px_20px_-8px_rgba(15,23,42,0.25)] ring-1 ring-black/[0.04]"
      style={style}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-slate-500">
        <LinkIcon className="size-3.5" aria-hidden />
        {initialHref ? "Edit link" : "Add link"}
      </div>
      <label className="block">
        <span className="mb-0.5 block text-[11px] font-medium text-slate-600">Text</span>
        <input
          ref={textInputRef}
          type="text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Link label"
          className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-[13px] text-slate-800 outline-none transition-colors focus:border-sky-400 focus:ring-2 focus:ring-sky-200/70"
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              handleSave();
            }
          }}
        />
      </label>
      <label className="mt-2 block">
        <span className="mb-0.5 block text-[11px] font-medium text-slate-600">URL</span>
        <input
          type="url"
          value={href}
          onChange={(event) => setHref(event.target.value)}
          placeholder="https://example.com"
          className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-[13px] text-slate-800 outline-none transition-colors focus:border-sky-400 focus:ring-2 focus:ring-sky-200/70"
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              handleSave();
            }
          }}
        />
      </label>
      <div className="mt-3 flex items-center justify-between gap-2">
        {initialHref ? (
          <button
            type="button"
            onClick={onUnlink}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-rose-600 transition-colors hover:bg-rose-50"
          >
            <X className="size-3.5" aria-hidden />
            Remove
          </button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-[12px] font-medium text-slate-600 transition-colors hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSave}
            onClick={handleSave}
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[12px] font-semibold transition-colors",
              canSave
                ? "bg-indigo-600 text-white hover:bg-indigo-500"
                : "cursor-not-allowed bg-slate-100 text-slate-400",
            )}
          >
            <Check className="size-3.5" aria-hidden />
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Loose `any`-ish editor type — we accept the full Tiptap `Editor` at call
// sites but don't take a build-time dependency on its type here, so adding
// new chain commands in Tiptap doesn't break this signature.
type EditorLike = {
  chain: () => unknown;
  state: { selection: { from: number; to: number }; doc: { textBetween: (a: number, b: number, sep?: string) => string } };
  getAttributes: (name: string) => Record<string, unknown>;
};

type ChainStep = {
  focus: () => ChainStep;
  extendMarkRange: (name: string) => ChainStep;
  deleteSelection: () => ChainStep;
  insertContent: (content: unknown) => ChainStep;
  unsetLink: () => ChainStep;
  run: () => boolean;
};

/**
 * Apply the popover's (text, href) result to a Tiptap editor. Handles three
 * cases: editing an existing link (replaces text + href), wrapping a current
 * selection (replaces selected text), and inserting fresh at the cursor.
 */
export function applyLinkToEditor(editor: EditorLike, text: string, href: string) {
  const existingHref = editor.getAttributes("link").href as string | undefined;
  const { from, to } = editor.state.selection;
  const node = { type: "text", text, marks: [{ type: "link", attrs: { href } }] };
  const chain = editor.chain() as ChainStep;
  if (existingHref) {
    chain.focus().extendMarkRange("link").insertContent(node).run();
  } else if (from !== to) {
    chain.focus().deleteSelection().insertContent(node).run();
  } else {
    chain.focus().insertContent(node).run();
  }
}

/** Reads (text, href) from the current selection for opening the popover. */
export function readLinkContext(editor: EditorLike | null): { text: string; href: string } {
  if (!editor) return { text: "", href: "" };
  const href = (editor.getAttributes("link").href as string | undefined) ?? "";
  const { from, to } = editor.state.selection;
  const text = from !== to ? editor.state.doc.textBetween(from, to, " ") : "";
  return { text, href };
}
