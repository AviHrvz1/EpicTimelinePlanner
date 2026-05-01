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
  Heading2,
  Heading3,
  Italic,
  Link as LinkIcon,
  List,
  ListChecks,
  ListOrdered,
  NotebookPen,
  Plus,
  Quote,
  Redo,
  Save,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
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
      <div className="flex min-h-10 flex-wrap gap-1 rounded-lg bg-muted/20 px-2 py-1.5">
        <span className="text-xs text-black">Loading editor…</span>
      </div>
    );
  }

  const mkToggle = (isOn: boolean) =>
    cn(
      "h-8 w-8 shrink-0 rounded-md border-0 p-0 shadow-none",
      isOn
        ? "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
        : "bg-slate-100 text-black hover:bg-slate-200/80",
    );

  return (
    <div
      className="flex flex-wrap items-center gap-0.5 rounded-lg bg-slate-100/80 p-1"
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

      <span className="mx-1 hidden h-6 w-px bg-slate-200 sm:inline" aria-hidden />

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
        onClick={() => {
          let ok = editor.chain().focus().toggleBlockquote().run();
          if (!ok) {
            // Fallback when current node context (e.g. inside list) blocks direct quote toggle.
            ok = editor.chain().focus().clearNodes().toggleBlockquote().run();
          }
        }}
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

      <span className="mx-1 hidden h-6 w-px bg-slate-200 sm:inline" aria-hidden />

      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-8 w-8 shrink-0 rounded-md border-0 bg-slate-100 p-0 text-black shadow-none hover:bg-slate-200/80"
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
        className="h-8 w-8 shrink-0 rounded-md border-0 bg-slate-100 p-0 text-black shadow-none hover:bg-slate-200/80"
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
  /** Overrides default `text-base` on the section header title row. */
  headerTitleClassName?: string;
  titleIconClassName?: string;
  /** Background for the editor surface (gradient). */
  editorSurfaceClassName?: string;
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
  headerTitleClassName,
  titleIconClassName,
  editorSurfaceClassName = "bg-gradient-to-b from-slate-50/90 via-white to-indigo-50/55",
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
        link: false,
        underline: false,
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: {
          class: "font-medium text-black underline decoration-black/40 underline-offset-2",
        },
      }),
      Placeholder.configure({ placeholder }),
    ],
    content: normalizeSectionHtml(html),
    editorProps: {
      attributes: {
        class: cn(
          "prose max-w-none min-h-[14rem] px-3 py-2.5 text-sm text-black outline-none",
          "prose-headings:font-normal prose-headings:text-black prose-p:my-1 prose-p:text-black prose-li:text-black prose-ul:my-1 prose-ol:my-1",
          // Make toolbar block formats visibly distinct in the retrospective editor.
          "[&_h2]:my-2 [&_h2]:text-xl [&_h2]:font-normal [&_h2]:leading-snug",
          "[&_h3]:my-1.5 [&_h3]:text-lg [&_h3]:font-normal [&_h3]:leading-snug",
          "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6",
          "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6",
          "[&_li]:my-0.5",
          "[&_blockquote]:my-2 [&_blockquote]:border-l-4 [&_blockquote]:border-slate-300 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-black",
          "focus:outline-none [&_.ProseMirror]:min-h-[14rem] [&_.ProseMirror]:outline-none",
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
        "rounded-xl bg-transparent p-3 transition-[box-shadow]",
        editor?.isFocused && "ring-2 ring-ring/30 ring-offset-2 ring-offset-transparent",
      )}
    >
      <div
        className={cn(
          "mb-2.5 flex items-center gap-2 rounded-lg px-3 py-2 font-normal",
          headerTitleClassName ?? "text-base",
          titleAccentClass,
        )}
      >
        <TitleIcon className={cn("size-4 shrink-0 opacity-90", titleIconClassName)} aria-hidden />
        <span>{title}</span>
      </div>
      <RetroEditorToolbar editor={editor} />
      <div
        className={cn(
          "mt-2 overflow-hidden rounded-lg border border-slate-200",
          editorSurfaceClassName,
        )}
      >
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
    <section className="font-sans min-w-0 py-5 pr-5 pb-5 pl-2 sm:py-7 sm:pr-7 sm:pb-7 sm:pl-3 md:py-8 md:pr-8 md:pb-8 md:pl-3">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4 pb-4">
        <div className="min-w-0 space-y-3">
          <h3 className="flex items-center gap-2.5 font-sans text-xl font-normal tracking-tight text-black md:text-[1.3125rem] md:leading-snug">
            <NotebookPen className="size-7 shrink-0 text-black md:size-8" aria-hidden />
            <span>Retrospective</span>
          </h3>
          <p className="text-sm leading-relaxed text-slate-700">
            {sprintLabel} - capture wins, improvements, and concrete next actions.
          </p>
        </div>
        <Button
          type="button"
          variant="default"
          size="default"
          onClick={handleSave}
          disabled={!dirty}
          className="h-9 shrink-0 gap-2 px-4 font-semibold"
        >
          <Save className="size-4" data-icon="inline-start" />
          Save
        </Button>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <RetroRichSection
          title="What went well?"
          titleIcon={ThumbsUp}
          titleAccentClass="bg-transparent text-black"
          headerTitleClassName="text-[18px] md:text-[19px] md:leading-snug"
          titleIconClassName="size-5 md:size-6"
          editorSurfaceClassName="bg-transparent"
          placeholder="Highlights, wins, and practices to repeat…"
          field="wentWell"
          initialDoc={initialDoc}
          html={wentWellHtml}
          onHtmlChange={setWentWellHtml}
        />
        <RetroRichSection
          title="What did not go well?"
          titleIcon={ThumbsDown}
          titleAccentClass="bg-transparent text-black"
          headerTitleClassName="text-[18px] md:text-[19px] md:leading-snug"
          titleIconClassName="size-5 md:size-6"
          editorSurfaceClassName="bg-transparent"
          placeholder="Friction, misses, and risks to address…"
          field="improve"
          initialDoc={initialDoc}
          html={improveHtml}
          onHtmlChange={setImproveHtml}
        />
      </div>

      <section className="mt-4 rounded-xl bg-transparent p-3">
        <div className="mb-2.5 rounded-lg bg-white px-3 py-2 text-lg font-normal text-black sm:text-xl">
          <span className="inline-flex items-center gap-2">
            <ListChecks className="size-4 shrink-0 text-black sm:size-5" aria-hidden />
            What's next?
          </span>
        </div>

        <div className="space-y-2">
          {actionItems.length === 0 ? (
            <p className="rounded-lg bg-slate-50 px-3 py-2.5 text-sm text-black">
              No action items yet. Add one to assign owner and due date.
            </p>
          ) : (
            actionItems.map((item) => (
              <div
                key={item.id}
                className="flex flex-col gap-2 rounded-lg bg-slate-50 p-2"
              >
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    value={item.title}
                    onChange={(e) => updateActionItem(item.id, { title: e.target.value })}
                    placeholder="Action item"
                    className="h-9 min-w-0 flex-[4.2] rounded-md border-0 bg-white px-2.5 text-sm text-black shadow-none outline-none transition-[color,box-shadow] focus-visible:ring-[3px] focus-visible:ring-slate-400/50"
                  />
                  <label className="flex h-9 min-w-0 flex-[0.55] items-center gap-2 rounded-md border-0 bg-white px-2.5">
                    <User className="size-4 shrink-0 text-black" aria-hidden />
                    <input
                      value={item.owner}
                      onChange={(e) => updateActionItem(item.id, { owner: e.target.value })}
                      placeholder="Owner"
                      className="h-full min-w-0 flex-1 bg-transparent text-sm text-black outline-none placeholder:text-black/45"
                    />
                  </label>
                  <label className="flex h-9 min-w-0 flex-[0.5] items-center gap-2 rounded-md border-0 bg-white px-2.5">
                    <CalendarDays className="size-4 shrink-0 text-black" aria-hidden />
                    <input
                      type="date"
                      value={item.dueDate}
                      onChange={(e) => updateActionItem(item.id, { dueDate: e.target.value })}
                      className="h-full min-w-0 flex-1 bg-transparent text-sm text-black outline-none"
                    />
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeActionItem(item.id)}
                    className="h-9 w-9 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    title="Remove action item"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="mt-3 flex justify-start pl-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={addActionItem}
            className="h-8 shrink-0 gap-1.5 border-black/20 bg-white px-3 text-sm font-semibold text-black shadow-none hover:border-black/40 hover:bg-slate-50 active:bg-slate-100"
          >
            <Plus className="size-4" strokeWidth={2.25} aria-hidden />
            Add
          </Button>
        </div>
      </section>

      <p className="mt-3 text-xs text-black">
        {savedAtText ? `Last saved: ${savedAtText}` : "Not saved yet for this sprint."}
      </p>
    </section>
  );
}
