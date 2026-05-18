"use client";

import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  Check,
  Heading2,
  Heading3,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  SquarePen,
  Quote,
  Underline as UnderlineIcon,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

type Props = {
  /** Current saved HTML body (rich text). Empty string when blank. */
  body: string;
  /** Persists the new HTML body for this card. */
  onSave: (html: string) => void;
  /** When false, the Edit button is hidden and editing-only chrome doesn't appear. The note acts as a read-only display. */
  allowEdit?: boolean;
};

/**
 * Sticky-note gadget — yellow notepad style card. Read-only by default;
 * pencil icon flips to a Tiptap rich-text editor with the same toolbar as
 * the description panels.
 */
export function StickyNoteCard({ body, onSave, allowEdit = true }: Props) {
  const [editing, setEditing] = useState(false);
  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: "text-blue-700 underline decoration-blue-700/40 underline-offset-2" },
      }),
      Placeholder.configure({ placeholder: "Write a note…" }),
    ],
    content: body || "<p></p>",
    immediatelyRender: false,
    editable: editing,
    editorProps: {
      attributes: {
        class: "outline-none px-2 py-1.5 text-[14px] text-slate-800",
      },
    },
  });

  // Keep editor content in sync when parent body changes (e.g. after save/reload).
  useEffect(() => {
    if (!editor) return;
    if (editor.getHTML() !== body) {
      editor.commands.setContent(body || "<p></p>", { emitUpdate: false });
    }
  }, [editor, body]);

  // Toggle editor's editable mode when our local flag flips.
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(editing);
  }, [editor, editing]);

  // If the dashboard leaves edit mode while we're editing, drop back to read-only without losing the saved body.
  useEffect(() => {
    if (!allowEdit && editing) setEditing(false);
  }, [allowEdit, editing]);

  function commit() {
    if (!editor) return;
    const html = editor.getHTML();
    onSave(html);
    setEditing(false);
  }
  function cancel() {
    if (!editor) return;
    editor.commands.setContent(body || "<p></p>", { emitUpdate: false });
    setEditing(false);
  }

  const tbBtn = (active: boolean, onClick: () => void, icon: React.ReactNode) => (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "inline-flex h-6 w-6 items-center justify-center rounded border text-violet-900/80 transition-colors",
        active ? "border-violet-400/60 bg-violet-100/70" : "border-transparent hover:bg-violet-100/60",
      )}
    >
      {icon}
    </button>
  );

  const isEmpty = !body || stripHtml(body).length === 0;

  // Page-curl effect: applied to the NOTEBOOK page (further down) rather than
  // the outer card, so the curl always reads as part of the paper itself even
  // when the footer action buttons (Edit / Cancel / Save) are mounted below.
  const FOLD = 22; // px — size of the curled-corner triangle
  return (
    <div
      className="relative h-full min-h-0 rounded-xl bg-white ring-1 ring-slate-200"
      style={{
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.7), 0 4px 12px -4px rgba(15,23,42,0.10)",
      }}
    >
      <div className="flex h-full min-h-0 flex-col p-3">
      {/* Header row: formatting toolbar only (shown when editing). Action buttons live in the footer below. */}
      {editing ? (
        <div className="mb-1.5 flex shrink-0 items-center">
          <div className="flex flex-wrap items-center gap-0.5 rounded-md bg-violet-100/60 p-0.5 ring-1 ring-violet-200/60">
            {tbBtn(!!editor?.isActive("bold"), () => editor?.chain().focus().toggleBold().run(), <Bold className="size-3" />)}
            {tbBtn(!!editor?.isActive("italic"), () => editor?.chain().focus().toggleItalic().run(), <Italic className="size-3" />)}
            {tbBtn(!!editor?.isActive("underline"), () => editor?.chain().focus().toggleUnderline().run(), <UnderlineIcon className="size-3" />)}
            {tbBtn(!!editor?.isActive("bulletList"), () => editor?.chain().focus().toggleBulletList().run(), <List className="size-3" />)}
            {tbBtn(!!editor?.isActive("orderedList"), () => editor?.chain().focus().toggleOrderedList().run(), <ListOrdered className="size-3" />)}
            {tbBtn(!!editor?.isActive("blockquote"), () => editor?.chain().focus().toggleBlockquote().run(), <Quote className="size-3" />)}
            {tbBtn(!!editor?.isActive("heading", { level: 2 }), () => editor?.chain().focus().toggleHeading({ level: 2 }).run(), <Heading2 className="size-3" />)}
            {tbBtn(!!editor?.isActive("heading", { level: 3 }), () => editor?.chain().focus().toggleHeading({ level: 3 }).run(), <Heading3 className="size-3" />)}
            {tbBtn(!!editor?.isActive("link"), () => {
              const prev = (editor?.getAttributes("link").href as string | undefined) ?? "";
              const url = window.prompt("Link URL", prev || "https://");
              if (!editor || url == null) return;
              const trimmed = url.trim();
              if (!trimmed) { editor.chain().focus().extendMarkRange("link").unsetLink().run(); return; }
              editor.chain().focus().extendMarkRange("link").setLink({ href: trimmed }).run();
            }, <LinkIcon className="size-3" />)}
          </div>
        </div>
      ) : null}

      {/* Body — ruled notebook page: white background with periodic
          horizontal lines + the page-curl effect cut from its bottom-right
          corner. The 24px ruling matches the editor's line-height so text
          sits on the lines. */}
      <div
        className="relative min-h-0 flex-1 overflow-y-auto rounded-md bg-white ring-1 ring-violet-200/50"
        style={{
          backgroundImage:
            "repeating-linear-gradient(to bottom, transparent 0, transparent calc(1.5rem - 1px), rgb(186 230 253 / 0.7) calc(1.5rem - 1px), rgb(186 230 253 / 0.7) 1.5rem)",
          backgroundPosition: "0 0.4rem",
          backgroundAttachment: "local",
          clipPath: `polygon(0 0, 100% 0, 100% calc(100% - ${FOLD}px), calc(100% - ${FOLD}px) 100%, 0 100%)`,
        }}
      >
        {/* Optional red "margin" line on the left, classic notebook touch */}
        <span className="pointer-events-none absolute inset-y-0 left-[1.65rem] w-px bg-rose-300/50" aria-hidden />
        {/* Underside of the page-curl fold — soft slate triangle in the
            bottom-right corner of the notebook page. Sits inside the body
            so it always tracks the paper, not the outer card. */}
        <div
          className="pointer-events-none absolute right-0 bottom-0"
          style={{
            width: `${FOLD}px`,
            height: `${FOLD}px`,
            background:
              "linear-gradient(135deg, transparent 50%, rgb(226 232 240 / 0.85) 50%, rgb(203 213 225 / 0.95) 100%)",
            filter: "drop-shadow(-1px -1px 1px rgba(15,23,42,0.12))",
          }}
          aria-hidden
        />
        {editing || !isEmpty ? (
          <EditorContent
            editor={editor}
            className={cn(
              "h-full focus-within:outline-none [&_.ProseMirror]:min-h-full [&_.ProseMirror]:outline-none",
              // Align text baseline with the 24px ruling; pl-10 keeps clear of the margin line at 1.65rem.
              "[&_.ProseMirror]:pl-10 [&_.ProseMirror_p]:leading-6 [&_.ProseMirror_p]:my-0",
              "[&_h2]:text-[16px] [&_h2]:font-semibold [&_h2]:leading-6 [&_h2]:my-0",
              "[&_h3]:text-[14px] [&_h3]:font-semibold [&_h3]:leading-6 [&_h3]:my-0",
              "[&_ul]:list-disc [&_ul]:pl-5 [&_ul_li]:leading-6",
              "[&_ol]:list-decimal [&_ol]:pl-5 [&_ol_li]:leading-6",
              "[&_blockquote]:border-l-2 [&_blockquote]:border-violet-400/60 [&_blockquote]:pl-2 [&_blockquote]:text-violet-900/80 [&_blockquote]:leading-6",
              "[&_a]:underline [&_a]:underline-offset-2",
            )}
          />
        ) : (
          <p className="pl-10 pr-2 py-1.5 text-[13px] italic leading-6 text-violet-800/60">No note yet. Click Edit to add one.</p>
        )}
      </div>

      {/* Footer — action buttons pinned to the bottom of the panel (Edit when read-only, Cancel + Save when editing). */}
      {(editing || allowEdit) ? (
        <div className="mt-2 flex shrink-0 items-center justify-end gap-1">
          {editing ? (
            <>
              <button
                type="button"
                onClick={cancel}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-violet-300/60 bg-white/70 px-2 text-[11px] font-semibold text-violet-800 hover:bg-white"
              >
                <X className="size-3" />
                Cancel
              </button>
              <button
                type="button"
                onClick={commit}
                className="inline-flex h-7 items-center gap-1 rounded-md bg-gradient-to-r from-violet-600 to-indigo-600 px-2 text-[11px] font-semibold text-white shadow-sm hover:from-violet-500 hover:to-indigo-500"
              >
                <Check className="size-3" />
                Save
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-violet-300/60 bg-white/70 px-2 text-[11px] font-semibold text-violet-800 hover:bg-white"
              aria-label="Edit note"
            >
              <SquarePen className="size-3.5" strokeWidth={2} />
              Edit
            </button>
          )}
        </div>
      ) : null}
      </div>
    </div>
  );
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}
