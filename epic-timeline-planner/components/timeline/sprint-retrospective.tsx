"use client";

import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  CalendarDays,
  Heading2,
  Heading3,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Plus,
  Quote,
  Redo,
  Save,
  Strikethrough,
  Trash2,
  Underline as UnderlineIcon,
  Undo,
  User,
} from "lucide-react";
import { useEffect, useMemo, useReducer, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const SECTION_TEMPLATE_HTML = "<p></p>";

export type SprintRetroActionItem = {
  id: string;
  title: string;
  owner: string;
  dueDate: string;
};

export type SprintRetrospectiveDoc = {
  wentWellHtml: string;
  improveHtml: string;
  actionItems: SprintRetroActionItem[];
};

type SprintRetrospectiveEditorProps = {
  sprintLabel: string;
  initialDoc: SprintRetrospectiveDoc | null;
  updatedAt: string | null;
  onSave: (doc: SprintRetrospectiveDoc) => void;
};

function normalizeSectionHtml(raw: string | undefined | null) {
  return raw?.trim() ? raw : SECTION_TEMPLATE_HTML;
}

function RetroEditorToolbar({ editor }: { editor: Editor | null }) {
  const [, bump] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (!editor) return;
    const onChange = () => bump();
    editor.on("selectionUpdate", onChange);
    editor.on("transaction", onChange);
    return () => {
      editor.off("selectionUpdate", onChange);
      editor.off("transaction", onChange);
    };
  }, [editor]);

  if (!editor) {
    return (
      <div className="flex min-h-10 flex-wrap gap-1 rounded-lg border border-slate-200 bg-white p-2">
        <span className="text-xs text-slate-400">Loading editor…</span>
      </div>
    );
  }

  const mkToggle = (isOn: boolean) =>
    cn(
      "h-8 w-8 shrink-0 rounded-md p-0",
      isOn ? "border-slate-900 bg-slate-900 text-white hover:bg-slate-800 hover:text-white" : "border-slate-200 text-slate-700",
    );

  return (
    <div
      className="flex flex-wrap items-center gap-0.5 rounded-lg border border-slate-200 bg-white p-1.5 shadow-sm"
      role="toolbar"
      aria-label="Formatting"
    >
      <Button
        type="button"
        size="sm"
        variant="outline"
        className={mkToggle(editor.isActive("bold"))}
        disabled={!editor.can().chain().focus().toggleBold().run()}
        onClick={() => editor.chain().focus().toggleBold().run()}
        aria-pressed={editor.isActive("bold")}
        title="Bold"
      >
        <Bold className="size-4" />
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className={mkToggle(editor.isActive("italic"))}
        disabled={!editor.can().chain().focus().toggleItalic().run()}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        aria-pressed={editor.isActive("italic")}
        title="Italic"
      >
        <Italic className="size-4" />
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className={mkToggle(editor.isActive("underline"))}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        aria-pressed={editor.isActive("underline")}
        title="Underline"
      >
        <UnderlineIcon className="size-4" />
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className={mkToggle(editor.isActive("strike"))}
        onClick={() => editor.chain().focus().toggleStrike().run()}
        aria-pressed={editor.isActive("strike")}
        title="Strikethrough"
      >
        <Strikethrough className="size-4" />
      </Button>

      <span className="mx-1 hidden h-6 w-px bg-slate-200 sm:inline" aria-hidden />

      <Button
        type="button"
        size="sm"
        variant="outline"
        className={mkToggle(editor.isActive("heading", { level: 2 }))}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        aria-pressed={editor.isActive("heading", { level: 2 })}
        title="Heading 2"
      >
        <Heading2 className="size-4" />
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className={mkToggle(editor.isActive("heading", { level: 3 }))}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        aria-pressed={editor.isActive("heading", { level: 3 })}
        title="Heading 3"
      >
        <Heading3 className="size-4" />
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className={mkToggle(editor.isActive("bulletList"))}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        aria-pressed={editor.isActive("bulletList")}
        title="Bullet list"
      >
        <List className="size-4" />
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className={mkToggle(editor.isActive("orderedList"))}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        aria-pressed={editor.isActive("orderedList")}
        title="Numbered list"
      >
        <ListOrdered className="size-4" />
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className={mkToggle(editor.isActive("blockquote"))}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        aria-pressed={editor.isActive("blockquote")}
        title="Quote"
      >
        <Quote className="size-4" />
      </Button>

      <span className="mx-1 hidden h-6 w-px bg-slate-200 sm:inline" aria-hidden />

      <Button
        type="button"
        size="sm"
        variant="outline"
        className={mkToggle(editor.isActive("link"))}
        onClick={() => {
          const prev = editor.getAttributes("link").href as string | undefined;
          const url = window.prompt("Link URL", prev ?? "https://");
          if (url === null) return;
          const trimmed = url.trim();
          if (trimmed === "") {
            editor.chain().focus().extendMarkRange("link").unsetLink().run();
            return;
          }
          editor.chain().focus().extendMarkRange("link").setLink({ href: trimmed }).run();
        }}
        aria-pressed={editor.isActive("link")}
        title="Link"
      >
        <LinkIcon className="size-4" />
      </Button>

      <span className="mx-1 hidden h-6 w-px bg-slate-200 sm:inline" aria-hidden />

      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-8 w-8 shrink-0 rounded-md p-0"
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().chain().focus().undo().run()}
        title="Undo"
      >
        <Undo className="size-4" />
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-8 w-8 shrink-0 rounded-md p-0"
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().chain().focus().redo().run()}
        title="Redo"
      >
        <Redo className="size-4" />
      </Button>
    </div>
  );
}

type RetroRichSectionProps = {
  title: string;
  titleAccentClass: string;
  placeholder: string;
  field: "wentWell" | "improve";
  initialDoc: SprintRetrospectiveDoc | null;
  html: string;
  onHtmlChange: (next: string) => void;
};

function RetroRichSection({
  title,
  titleAccentClass,
  placeholder,
  field,
  initialDoc,
  html,
  onHtmlChange,
}: RetroRichSectionProps) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: {
          class: "text-indigo-700 underline decoration-indigo-300 underline-offset-2",
        },
      }),
      Placeholder.configure({ placeholder }),
    ],
    content: normalizeSectionHtml(html),
    editorProps: {
      attributes: {
        class: cn(
          "prose prose-slate max-w-none min-h-[10rem] px-3 py-2 text-sm outline-none",
          "prose-headings:font-semibold prose-p:my-1 prose-ul:my-1 prose-ol:my-1",
          "focus:outline-none [&_.ProseMirror]:min-h-[10rem] [&_.ProseMirror]:outline-none",
        ),
      },
    },
    onUpdate: ({ editor: ed }) => {
      onHtmlChange(ed.getHTML());
    },
  });

  useEffect(() => {
    if (!editor) return;
    const raw = field === "wentWell" ? initialDoc?.wentWellHtml : initialDoc?.improveHtml;
    const next = normalizeSectionHtml(raw);
    const cur = editor.getHTML();
    if (cur === next) return;
    editor.commands.setContent(next, { emitUpdate: false });
  }, [editor, initialDoc, field]);

  return (
    <section
      className={cn(
        "rounded-xl border border-slate-200 bg-white p-3 transition-shadow",
        editor?.isFocused && "ring-2 ring-indigo-200 border-indigo-300",
      )}
    >
      <h4 className={cn("mb-2 text-sm font-semibold uppercase tracking-[0.08em]", titleAccentClass)}>{title}</h4>
      <RetroEditorToolbar editor={editor} />
      <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50/30">
        <EditorContent editor={editor} />
      </div>
    </section>
  );
}

export function SprintRetrospectiveEditor({
  sprintLabel,
  initialDoc,
  updatedAt,
  onSave,
}: SprintRetrospectiveEditorProps) {
  const [wentWellHtml, setWentWellHtml] = useState(() => normalizeSectionHtml(initialDoc?.wentWellHtml));
  const [improveHtml, setImproveHtml] = useState(() => normalizeSectionHtml(initialDoc?.improveHtml));
  const [actionItems, setActionItems] = useState<SprintRetroActionItem[]>(initialDoc?.actionItems ?? []);
  const [savedAtText, setSavedAtText] = useState<string | null>(null);

  useEffect(() => {
    setWentWellHtml(normalizeSectionHtml(initialDoc?.wentWellHtml));
    setImproveHtml(normalizeSectionHtml(initialDoc?.improveHtml));
    setActionItems(initialDoc?.actionItems ?? []);
  }, [initialDoc]);

  useEffect(() => {
    if (!updatedAt) {
      setSavedAtText(null);
      return;
    }
    setSavedAtText(new Date(updatedAt).toLocaleString());
  }, [updatedAt]);

  const dirty = useMemo(() => {
    const baseWentWell = normalizeSectionHtml(initialDoc?.wentWellHtml);
    const baseImprove = normalizeSectionHtml(initialDoc?.improveHtml);
    const baseActionItems = initialDoc?.actionItems ?? [];
    return (
      baseWentWell !== wentWellHtml ||
      baseImprove !== improveHtml ||
      JSON.stringify(baseActionItems) !== JSON.stringify(actionItems)
    );
  }, [initialDoc, wentWellHtml, improveHtml, actionItems]);

  function handleSave() {
    onSave({
      wentWellHtml,
      improveHtml,
      actionItems,
    });
    setSavedAtText(new Date().toLocaleString());
  }

  function addActionItem() {
    setActionItems((prev) => [
      ...prev,
      { id: crypto.randomUUID(), title: "", owner: "", dueDate: "" },
    ]);
  }

  function updateActionItem(id: string, patch: Partial<SprintRetroActionItem>) {
    setActionItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function removeActionItem(id: string) {
    setActionItems((prev) => prev.filter((item) => item.id !== id));
  }

  return (
    <section className="rounded-2xl border border-slate-200/90 bg-gradient-to-br from-white via-slate-50/35 to-slate-50 p-5 shadow-md ring-1 ring-slate-100/90">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold tracking-tight text-slate-900">{sprintLabel} retrospective</h3>
          <p className="text-sm text-slate-500">
            Capture learnings, decisions, and follow-up actions for this sprint.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            type="button"
            size="sm"
            onClick={handleSave}
            disabled={!dirty}
            className="h-10 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            <Save className="size-4" />
            Save
          </Button>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <RetroRichSection
          title="What went well"
          titleAccentClass="text-emerald-700"
          placeholder="Highlights, wins, and practices to repeat…"
          field="wentWell"
          initialDoc={initialDoc}
          html={wentWellHtml}
          onHtmlChange={setWentWellHtml}
        />
        <RetroRichSection
          title="What did not go well"
          titleAccentClass="text-rose-700"
          placeholder="Friction, misses, and risks to address…"
          field="improve"
          initialDoc={initialDoc}
          html={improveHtml}
          onHtmlChange={setImproveHtml}
        />
      </div>

      <section className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-sm font-semibold uppercase tracking-[0.08em] text-indigo-700">Action items</h4>
          <Button type="button" size="sm" variant="outline" onClick={addActionItem}>
            <Plus className="size-4" />
            Add item
          </Button>
        </div>

        <div className="space-y-2">
          {actionItems.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50/70 px-3 py-2 text-sm text-slate-500">
              No action items yet. Add one to assign owner and due date.
            </p>
          ) : (
            actionItems.map((item) => (
              <div key={item.id} className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50/60 p-2 lg:grid-cols-[1fr_10rem_9rem_auto]">
                <input
                  value={item.title}
                  onChange={(e) => updateActionItem(item.id, { title: e.target.value })}
                  placeholder="Action item"
                  className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-200"
                />
                <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2">
                  <User className="size-4 text-slate-400" />
                  <input
                    value={item.owner}
                    onChange={(e) => updateActionItem(item.id, { owner: e.target.value })}
                    placeholder="Owner"
                    className="h-9 w-full bg-transparent text-sm text-slate-800 outline-none"
                  />
                </label>
                <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2">
                  <CalendarDays className="size-4 text-slate-400" />
                  <input
                    type="date"
                    value={item.dueDate}
                    onChange={(e) => updateActionItem(item.id, { dueDate: e.target.value })}
                    className="h-9 w-full bg-transparent text-sm text-slate-800 outline-none"
                  />
                </label>
                <Button type="button" size="sm" variant="ghost" onClick={() => removeActionItem(item.id)}>
                  <Trash2 className="size-4 text-rose-600" />
                </Button>
              </div>
            ))
          )}
        </div>
      </section>

      <p className="mt-2 text-xs text-slate-500">
        {savedAtText ? `Last saved: ${savedAtText}` : "Not saved yet for this sprint."}
      </p>
    </section>
  );
}
