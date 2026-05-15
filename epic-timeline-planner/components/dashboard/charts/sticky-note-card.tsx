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
  Pencil,
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
};

/**
 * Sticky-note gadget — yellow notepad style card. Read-only by default;
 * pencil icon flips to a Tiptap rich-text editor with the same toolbar as
 * the description panels.
 */
export function StickyNoteCard({ body, onSave }: Props) {
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
        "inline-flex h-6 w-6 items-center justify-center rounded border text-amber-900/80 transition-colors",
        active ? "border-amber-400/60 bg-amber-100/60" : "border-transparent hover:bg-amber-100/60",
      )}
    >
      {icon}
    </button>
  );

  const isEmpty = !body || stripHtml(body).length === 0;

  // Page-curl effect: the paper has a chunk cut from its bottom-right corner via a -45deg gradient,
  // and a small triangle below paints the underside of the fold (lighter + shadow on the diagonal).
  const FOLD = 22; // px — size of the curled-corner triangle
  return (
    <div
      className="relative h-full min-h-0 ring-1 ring-amber-200/80"
      style={{
        // Solid paper color, with the bottom-right corner clipped via gradient so the underside triangle peeks through.
        background:
          "linear-gradient(135deg, rgb(254 243 199 / 0.95) 0%, rgb(254 249 195 / 0.92) 60%, rgb(254 249 195 / 0.85) 100%)",
        // Clip the actual paper shape so its corner is missing
        clipPath: `polygon(0 0, 100% 0, 100% calc(100% - ${FOLD}px), calc(100% - ${FOLD}px) 100%, 0 100%)`,
        borderRadius: "12px",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.6), 0 4px 12px -4px rgba(15,23,42,0.08)",
      }}
    >
      {/* Underside of the fold — the small triangle in the bottom-right corner */}
      <div
        className="pointer-events-none absolute right-0 bottom-0"
        style={{
          width: `${FOLD}px`,
          height: `${FOLD}px`,
          // Inner of the fold appears as a lighter cream with a soft shadow along its hypotenuse.
          background:
            "linear-gradient(135deg, transparent 50%, rgb(252 211 77 / 0.55) 50%, rgb(252 211 77 / 0.85) 100%)",
          // Slight shadow on the diagonal edge to give the curl depth.
          filter: "drop-shadow(-1px -1px 1px rgba(15,23,42,0.10))",
        }}
        aria-hidden
      />

      <div className="flex h-full min-h-0 flex-col p-3">
      {/* Header row: edit toggle */}
      <div className="mb-1.5 flex shrink-0 items-center justify-between gap-2">
        {editing ? (
          <div className="flex flex-wrap items-center gap-0.5 rounded-md bg-amber-100/60 p-0.5 ring-1 ring-amber-200/60">
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
        ) : <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-700/70">Note</span>}
        <div className="flex items-center gap-1">
          {editing ? (
            <>
              <button
                type="button"
                onClick={cancel}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-amber-300/60 bg-white/60 px-2 text-[11px] font-semibold text-amber-800 hover:bg-white"
              >
                <X className="size-3" />
                Cancel
              </button>
              <button
                type="button"
                onClick={commit}
                className="inline-flex h-7 items-center gap-1 rounded-md bg-gradient-to-r from-amber-500 to-orange-500 px-2 text-[11px] font-semibold text-white shadow-sm hover:from-amber-400 hover:to-orange-400"
              >
                <Check className="size-3" />
                Save
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-amber-300/60 bg-white/60 px-2 text-[11px] font-semibold text-amber-800 hover:bg-white"
              aria-label="Edit note"
            >
              <Pencil className="size-3" />
              Edit
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto rounded-md bg-white/40 ring-1 ring-amber-200/40">
        {editing || !isEmpty ? (
          <EditorContent
            editor={editor}
            className={cn(
              "h-full focus-within:outline-none [&_.ProseMirror]:min-h-full [&_.ProseMirror]:outline-none",
              "[&_h2]:text-[16px] [&_h2]:font-semibold [&_h2]:my-1",
              "[&_h3]:text-[14px] [&_h3]:font-semibold [&_h3]:my-1",
              "[&_ul]:list-disc [&_ul]:pl-5",
              "[&_ol]:list-decimal [&_ol]:pl-5",
              "[&_blockquote]:border-l-2 [&_blockquote]:border-amber-400/60 [&_blockquote]:pl-2 [&_blockquote]:text-amber-900/80",
              "[&_a]:underline [&_a]:underline-offset-2",
            )}
          />
        ) : (
          <p className="px-2 py-1.5 text-[13px] italic text-amber-800/60">No note yet. Click Edit to add one.</p>
        )}
      </div>
      </div>
    </div>
  );
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}
