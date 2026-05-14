"use client";

import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Heading2, Heading3, Italic, Link as LinkIcon, List, ListOrdered, Plus, Quote, Underline as UnderlineIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ActivityCommentComposerProps = {
  onSubmit: (html: string) => void | Promise<void>;
  disabled?: boolean;
};

export function ActivityCommentComposer({ onSubmit, disabled }: ActivityCommentComposerProps) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: "text-blue-600 underline decoration-blue-600/40 underline-offset-2",
        },
      }),
      Placeholder.configure({ placeholder: "Write a comment..." }),
    ],
    content: "<p></p>",
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "outline-none min-h-[5rem] px-2 py-1.5 text-[13px] text-slate-800",
      },
    },
  });

  async function handleSubmit() {
    if (!editor || editor.isEmpty) return;
    const html = editor.getHTML();
    await onSubmit(html);
    editor.commands.setContent("<p></p>", { emitUpdate: false });
  }

  return (
    <div className="mt-2 space-y-3">
      <div className="flex flex-col gap-2 rounded-xl bg-white p-3 ring-1 ring-slate-200">
      <div className="flex shrink-0 flex-wrap gap-1 rounded-md bg-[#0897d5] p-1">
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => editor?.chain().focus().toggleBold().run()}
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded border text-white",
            editor?.isActive("bold") ? "border-white/40 bg-white/20" : "border-transparent hover:bg-white/20",
          )}
        >
          <Bold className="size-3.5" />
        </button>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded border text-white",
            editor?.isActive("italic") ? "border-white/40 bg-white/20" : "border-transparent hover:bg-white/20",
          )}
        >
          <Italic className="size-3.5" />
        </button>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => editor?.chain().focus().toggleUnderline().run()}
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded border text-white",
            editor?.isActive("underline") ? "border-white/40 bg-white/20" : "border-transparent hover:bg-white/20",
          )}
        >
          <UnderlineIcon className="size-3.5" />
        </button>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded border text-white",
            editor?.isActive("bulletList") ? "border-white/40 bg-white/20" : "border-transparent hover:bg-white/20",
          )}
        >
          <List className="size-3.5" />
        </button>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded border text-white",
            editor?.isActive("orderedList") ? "border-white/40 bg-white/20" : "border-transparent hover:bg-white/20",
          )}
        >
          <ListOrdered className="size-3.5" />
        </button>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => editor?.chain().focus().toggleBlockquote().run()}
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded border text-white",
            editor?.isActive("blockquote") ? "border-white/40 bg-white/20" : "border-transparent hover:bg-white/20",
          )}
        >
          <Quote className="size-3.5" />
        </button>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded border text-white",
            editor?.isActive("heading", { level: 2 }) ? "border-white/40 bg-white/20" : "border-transparent hover:bg-white/20",
          )}
        >
          <Heading2 className="size-3.5" />
        </button>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded border text-white",
            editor?.isActive("heading", { level: 3 }) ? "border-white/40 bg-white/20" : "border-transparent hover:bg-white/20",
          )}
        >
          <Heading3 className="size-3.5" />
        </button>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            const prev = (editor?.getAttributes("link").href as string | undefined) ?? "";
            const url = window.prompt("Link URL", prev || "https://");
            if (!editor || url == null) return;
            const trimmed = url.trim();
            if (!trimmed) {
              editor.chain().focus().extendMarkRange("link").unsetLink().run();
              return;
            }
            editor.chain().focus().extendMarkRange("link").setLink({ href: trimmed }).run();
          }}
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded border text-white",
            editor?.isActive("link") ? "border-white/40 bg-white/20" : "border-transparent hover:bg-white/20",
          )}
        >
          <LinkIcon className="size-3.5" />
        </button>
      </div>
      <EditorContent editor={editor} className="focus-within:outline-none [&_.ProseMirror]:outline-none" />
      </div>
      <div className="flex justify-end">
        <Button size="sm" variant="outline" type="button" onClick={() => void handleSubmit()} disabled={disabled}>
          <Plus className="size-3.5" />
          Add
        </Button>
      </div>
    </div>
  );
}
