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
    <div className="mt-2 space-y-1.5">
      <div className="flex flex-wrap gap-1 rounded-md border border-slate-200 bg-slate-50 p-1">
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => editor?.chain().focus().toggleBold().run()}
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded border text-slate-700",
            editor?.isActive("bold") ? "border-slate-400 bg-white" : "border-transparent hover:bg-white",
          )}
        >
          <Bold className="size-3.5" />
        </button>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded border text-slate-700",
            editor?.isActive("italic") ? "border-slate-400 bg-white" : "border-transparent hover:bg-white",
          )}
        >
          <Italic className="size-3.5" />
        </button>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => editor?.chain().focus().toggleUnderline().run()}
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded border text-slate-700",
            editor?.isActive("underline") ? "border-slate-400 bg-white" : "border-transparent hover:bg-white",
          )}
        >
          <UnderlineIcon className="size-3.5" />
        </button>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded border text-slate-700",
            editor?.isActive("bulletList") ? "border-slate-400 bg-white" : "border-transparent hover:bg-white",
          )}
        >
          <List className="size-3.5" />
        </button>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded border text-slate-700",
            editor?.isActive("orderedList") ? "border-slate-400 bg-white" : "border-transparent hover:bg-white",
          )}
        >
          <ListOrdered className="size-3.5" />
        </button>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => editor?.chain().focus().toggleBlockquote().run()}
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded border text-slate-700",
            editor?.isActive("blockquote") ? "border-slate-400 bg-white" : "border-transparent hover:bg-white",
          )}
        >
          <Quote className="size-3.5" />
        </button>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded border text-slate-700",
            editor?.isActive("heading", { level: 2 }) ? "border-slate-400 bg-white" : "border-transparent hover:bg-white",
          )}
        >
          <Heading2 className="size-3.5" />
        </button>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded border text-slate-700",
            editor?.isActive("heading", { level: 3 }) ? "border-slate-400 bg-white" : "border-transparent hover:bg-white",
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
            "inline-flex h-7 w-7 items-center justify-center rounded border text-slate-700",
            editor?.isActive("link") ? "border-slate-400 bg-white" : "border-transparent hover:bg-white",
          )}
        >
          <LinkIcon className="size-3.5" />
        </button>
      </div>
      <div className="rounded-md border border-slate-200 bg-background">
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
