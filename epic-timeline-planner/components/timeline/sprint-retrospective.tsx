"use client";

import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  AlertCircle,
  Bold,
  CalendarDays,
  ClipboardList,
  Heading2,
  Heading3,
  Italic,
  Link as LinkIcon,
  List,
  ListChecks,
  ListOrdered,
  Plus,
  Quote,
  Redo,
  Save,
  Sparkles,
  Strikethrough,
  Trash2,
  Underline as UnderlineIcon,
  Undo,
  User,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useReducer, useState, type MouseEvent } from "react";

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

/** Keeps ProseMirror focused so block commands (headings, lists, quote) apply to the selection. */
function toolbarPointerDown(e: MouseEvent) {
  e.preventDefault();
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
      <div className="flex min-h-10 flex-wrap gap-1 rounded-lg border border-border bg-muted/20 px-2 py-1.5">
        <span className="text-xs text-muted-foreground">Loading editor…</span>
      </div>
    );
  }

  const mkToggle = (isOn: boolean) =>
    cn(
      "h-8 w-8 shrink-0 rounded-md border p-0 shadow-none",
      isOn
        ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
        : "border-border bg-background text-foreground hover:bg-muted",
    );

  return (
    <div
      className="flex flex-wrap items-center gap-0.5 rounded-lg border border-border bg-muted/15 p-1"
      role="toolbar"
      aria-label="Formatting"
    >
      <Button
        type="button"
        size="sm"
        variant="outline"
        className={mkToggle(editor.isActive("bold"))}
        disabled={!editor.can().toggleBold()}
        onMouseDown={toolbarPointerDown}
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
        disabled={!editor.can().toggleItalic()}
        onMouseDown={toolbarPointerDown}
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
        onMouseDown={toolbarPointerDown}
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
        onMouseDown={toolbarPointerDown}
        onClick={() => editor.chain().focus().toggleStrike().run()}
        aria-pressed={editor.isActive("strike")}
        title="Strikethrough"
      >
        <Strikethrough className="size-4" />
      </Button>

      <span className="mx-1 hidden h-6 w-px bg-border sm:inline" aria-hidden />

      <Button
        type="button"
        size="sm"
        variant="outline"
        className={mkToggle(editor.isActive("heading", { level: 2 }))}
        onMouseDown={toolbarPointerDown}
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
        onMouseDown={toolbarPointerDown}
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
        onMouseDown={toolbarPointerDown}
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
        onMouseDown={toolbarPointerDown}
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
        onMouseDown={toolbarPointerDown}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        aria-pressed={editor.isActive("blockquote")}
        title="Quote"
      >
        <Quote className="size-4" />
      </Button>

      <span className="mx-1 hidden h-6 w-px bg-border sm:inline" aria-hidden />

      <Button
        type="button"
        size="sm"
        variant="outline"
        className={mkToggle(editor.isActive("link"))}
        onMouseDown={toolbarPointerDown}
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

      <span className="mx-1 hidden h-6 w-px bg-border sm:inline" aria-hidden />

      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-8 w-8 shrink-0 rounded-md border-border bg-background p-0 shadow-none hover:bg-muted"
        onMouseDown={toolbarPointerDown}
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
        title="Undo"
      >
        <Undo className="size-4" />
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-8 w-8 shrink-0 rounded-md border-border bg-background p-0 shadow-none hover:bg-muted"
        onMouseDown={toolbarPointerDown}
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
        title="Redo"
      >
        <Redo className="size-4" />
      </Button>
    </div>
  );
}

type RetroRichSectionProps = {
  title: string;
  titleIcon: LucideIcon;
  titleAccentClass: string;
  placeholder: string;
  field: "wentWell" | "improve";
  initialDoc: SprintRetrospectiveDoc | null;
  html: string;
  onHtmlChange: (next: string) => void;
};

function RetroRichSection({
  title,
  titleIcon: TitleIcon,
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
          class: "text-primary underline decoration-primary/40 underline-offset-2 font-medium",
        },
      }),
      Placeholder.configure({ placeholder }),
    ],
    content: normalizeSectionHtml(html),
    editorProps: {
      attributes: {
        class: cn(
          "prose prose-slate dark:prose-invert max-w-none min-h-[10rem] px-3 py-2.5 text-sm text-foreground outline-none",
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
        "rounded-xl border border-border bg-card p-4 shadow-sm transition-[box-shadow,border-color]",
        editor?.isFocused && "border-primary/35 ring-2 ring-ring/40",
      )}
    >
      <h4
        className={cn(
          "mb-3 flex items-center gap-2.5 font-sans text-base font-normal leading-snug tracking-tight md:text-lg",
          titleAccentClass,
        )}
      >
        <TitleIcon className="size-[1.125rem] shrink-0 opacity-90 md:size-5" aria-hidden />
        <span>{title}</span>
      </h4>
      <RetroEditorToolbar editor={editor} />
      <div className="mt-2 overflow-hidden rounded-lg border border-border bg-muted/25">
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
    <section className="font-sans rounded-xl border border-border bg-card p-5 shadow-sm ring-1 ring-black/[0.03] dark:ring-white/[0.06]">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
        <div className="min-w-0 space-y-1">
          <h3 className="flex items-center gap-2.5 font-sans text-base font-semibold tracking-tight text-foreground md:text-lg">
            <span
              className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
              aria-hidden
            >
              <ClipboardList className="size-[1.125rem]" />
            </span>
            <span>{sprintLabel} Retrospective</span>
          </h3>
          <p className="text-sm text-muted-foreground">
            Capture learnings, decisions, and follow-up actions for this sprint.
          </p>
        </div>
        <Button
          type="button"
          variant="default"
          size="default"
          onClick={handleSave}
          disabled={!dirty}
          className="h-9 shrink-0 gap-2 px-4"
        >
          <Save className="size-4" data-icon="inline-start" />
          Save
        </Button>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <RetroRichSection
          title="What went well?"
          titleIcon={Sparkles}
          titleAccentClass="text-emerald-700 dark:text-emerald-400"
          placeholder="Highlights, wins, and practices to repeat…"
          field="wentWell"
          initialDoc={initialDoc}
          html={wentWellHtml}
          onHtmlChange={setWentWellHtml}
        />
        <RetroRichSection
          title="What did not go well?"
          titleIcon={AlertCircle}
          titleAccentClass="text-rose-700 dark:text-rose-400"
          placeholder="Friction, misses, and risks to address…"
          field="improve"
          initialDoc={initialDoc}
          html={improveHtml}
          onHtmlChange={setImproveHtml}
        />
      </div>

      <section className="mt-5 rounded-xl border border-border bg-muted/10 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary">
            <ListChecks className="size-4 shrink-0 text-primary" aria-hidden />
            Action items
          </h4>
          <Button type="button" size="sm" variant="outline" onClick={addActionItem} className="gap-1.5 border-border shadow-none">
            <Plus className="size-3.5" />
            Add item
          </Button>
        </div>

        <div className="space-y-2">
          {actionItems.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border bg-background/80 px-3 py-2.5 text-sm text-muted-foreground">
              No action items yet. Add one to assign owner and due date.
            </p>
          ) : (
            actionItems.map((item) => (
              <div
                key={item.id}
                className="flex flex-col gap-2 rounded-lg border border-border bg-card p-2 sm:flex-row sm:items-center"
              >
                <input
                  value={item.title}
                  onChange={(e) => updateActionItem(item.id, { title: e.target.value })}
                  placeholder="Action item"
                  className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-none outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
                <label className="flex h-10 shrink-0 items-center gap-2 rounded-md border border-input bg-background px-2.5 sm:w-[10.5rem]">
                  <User className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <input
                    value={item.owner}
                    onChange={(e) => updateActionItem(item.id, { owner: e.target.value })}
                    placeholder="Owner"
                    className="h-full min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                  />
                </label>
                <label className="flex h-10 shrink-0 items-center gap-2 rounded-md border border-input bg-background px-2.5 sm:w-[9.5rem]">
                  <CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <input
                    type="date"
                    value={item.dueDate}
                    onChange={(e) => updateActionItem(item.id, { dueDate: e.target.value })}
                    className="h-full min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none"
                  />
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeActionItem(item.id)}
                  className="h-10 w-10 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  title="Remove action item"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))
          )}
        </div>
      </section>

      <p className="mt-3 text-xs text-muted-foreground">
        {savedAtText ? `Last saved: ${savedAtText}` : "Not saved yet for this sprint."}
      </p>
    </section>
  );
}
