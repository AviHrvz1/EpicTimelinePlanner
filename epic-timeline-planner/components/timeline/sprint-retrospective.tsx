"use client";

import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  CalendarDays,
  CheckCircle2,
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
  ThumbsDown,
  ThumbsUp,
  Strikethrough,
  Trash2,
  Underline as UnderlineIcon,
  Undo,
  User,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useReducer, useState, type MouseEvent } from "react";

import { AssigneeCombobox } from "@/components/ui/assignee-combobox";
import { Button } from "@/components/ui/button";
import type { SprintWorkspaceDirectoryUser } from "@/lib/sprint-capacity";
import { normalizeWorkspaceUserTeam } from "@/lib/workspace-users";
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
  teamName?: string | null;
  teamId?: string | null;
  workspaceDirectoryUsers?: readonly SprintWorkspaceDirectoryUser[];
  initialDoc: SprintRetrospectiveDoc | null;
  updatedAt: string | null;
  onSave: (doc: SprintRetrospectiveDoc) => void;
};

function normalizeSectionHtml(raw: string | undefined | null) {
  return raw?.trim() ? raw : SECTION_TEMPLATE_HTML;
}

function toolbarPointerDown(e: MouseEvent) {
  e.preventDefault();
}

function RetroEditorToolbar({ editor, accentClass }: { editor: Editor | null; accentClass: string }) {
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
    return <div className="flex min-h-9 flex-wrap gap-1 rounded-lg bg-white/20 px-2 py-1.5" />;
  }

  const btn = (active: boolean) =>
    cn(
      "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border text-white transition-colors",
      active ? "border-white/40 bg-white/25" : "border-transparent hover:bg-white/20",
    );

  return (
    <div
      className={cn("flex flex-wrap items-center gap-0.5 rounded-t-lg p-1.5", accentClass)}
      role="toolbar"
      aria-label="Formatting"
    >
      {[
        { icon: Bold, active: editor.isActive("bold"), action: () => editor.chain().focus().toggleBold().run(), title: "Bold" },
        { icon: Italic, active: editor.isActive("italic"), action: () => editor.chain().focus().toggleItalic().run(), title: "Italic" },
        { icon: UnderlineIcon, active: editor.isActive("underline"), action: () => editor.chain().focus().toggleUnderline().run(), title: "Underline" },
        { icon: Strikethrough, active: editor.isActive("strike"), action: () => editor.chain().focus().toggleStrike().run(), title: "Strikethrough" },
      ].map(({ icon: Icon, active, action, title }) => (
        <button key={title} type="button" onMouseDown={toolbarPointerDown} onClick={action} title={title} className={btn(active)}>
          <Icon className="size-3.5" />
        </button>
      ))}

      <span className="mx-1 h-4 w-px bg-white/30" aria-hidden />

      {[
        { icon: Heading2, active: editor.isActive("heading", { level: 2 }), action: () => editor.chain().focus().toggleHeading({ level: 2 }).run(), title: "H2" },
        { icon: Heading3, active: editor.isActive("heading", { level: 3 }), action: () => editor.chain().focus().toggleHeading({ level: 3 }).run(), title: "H3" },
        { icon: List, active: editor.isActive("bulletList"), action: () => editor.chain().focus().toggleBulletList().run(), title: "Bullet list" },
        { icon: ListOrdered, active: editor.isActive("orderedList"), action: () => editor.chain().focus().toggleOrderedList().run(), title: "Numbered list" },
        { icon: Quote, active: editor.isActive("blockquote"), action: () => { const ok = editor.chain().focus().toggleBlockquote().run(); if (!ok) editor.chain().focus().clearNodes().toggleBlockquote().run(); }, title: "Quote" },
      ].map(({ icon: Icon, active, action, title }) => (
        <button key={title} type="button" onMouseDown={toolbarPointerDown} onClick={action} title={title} className={btn(active)}>
          <Icon className="size-3.5" />
        </button>
      ))}

      <span className="mx-1 h-4 w-px bg-white/30" aria-hidden />

      <button
        type="button"
        onMouseDown={toolbarPointerDown}
        onClick={() => {
          const prev = editor.getAttributes("link").href as string | undefined;
          const url = window.prompt("Link URL", prev ?? "https://");
          if (url === null) return;
          const trimmed = url.trim();
          if (trimmed === "") { editor.chain().focus().extendMarkRange("link").unsetLink().run(); return; }
          editor.chain().focus().extendMarkRange("link").setLink({ href: trimmed }).run();
        }}
        title="Link"
        className={btn(editor.isActive("link"))}
      >
        <LinkIcon className="size-3.5" />
      </button>

      <span className="mx-1 h-4 w-px bg-white/30" aria-hidden />

      <button type="button" onMouseDown={toolbarPointerDown} onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title="Undo" className={btn(false)}>
        <Undo className="size-3.5" />
      </button>
      <button type="button" onMouseDown={toolbarPointerDown} onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title="Redo" className={btn(false)}>
        <Redo className="size-3.5" />
      </button>
    </div>
  );
}

type RetroRichSectionProps = {
  title: string;
  subtitle: string;
  titleIcon: LucideIcon;
  accentClass: string;
  toolbarAccentClass: string;
  editorBgClass: string;
  badgeClass: string;
  placeholder: string;
  field: "wentWell" | "improve";
  initialDoc: SprintRetrospectiveDoc | null;
  html: string;
  onHtmlChange: (next: string) => void;
};

function RetroRichSection({
  title,
  subtitle,
  titleIcon: TitleIcon,
  accentClass,
  toolbarAccentClass,
  editorBgClass,
  badgeClass,
  placeholder,
  field,
  initialDoc,
  html,
  onHtmlChange,
}: RetroRichSectionProps) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] }, link: false, underline: false }),
      Underline,
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { class: "font-medium underline underline-offset-2" },
      }),
      Placeholder.configure({ placeholder }),
    ],
    content: normalizeSectionHtml(html),
    editorProps: {
      attributes: {
        class: cn(
          "prose max-w-none min-h-[13rem] px-4 py-3 text-sm outline-none",
          "prose-headings:font-semibold prose-p:my-1 prose-li:my-0.5",
          "[&_h2]:my-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:leading-snug",
          "[&_h3]:my-1.5 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:leading-snug",
          "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5",
          "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5",
          "[&_blockquote]:my-2 [&_blockquote]:border-l-4 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:opacity-70",
          "focus:outline-none [&_.ProseMirror]:outline-none",
        ),
      },
    },
    onUpdate: ({ editor: ed }) => { onHtmlChange(ed.getHTML()); },
  });

  useEffect(() => {
    if (!editor) return;
    const raw = field === "wentWell" ? initialDoc?.wentWellHtml : initialDoc?.improveHtml;
    const next = normalizeSectionHtml(raw);
    if (editor.getHTML() === next) return;
    editor.commands.setContent(next, { emitUpdate: false });
  }, [editor, initialDoc, field]);

  return (
    <div className={cn("flex flex-col overflow-hidden rounded-2xl border shadow-sm transition-shadow hover:shadow-md", accentClass, editor?.isFocused && "ring-1 ring-offset-1")}>
      <div className="flex items-start gap-3 px-4 pt-4 pb-3">
        <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", badgeClass)}>
          <TitleIcon className="size-4.5" aria-hidden />
        </div>
        <div className="min-w-0 pt-0.5">
          <p className="text-[18px] font-semibold leading-snug text-slate-800">{title}</p>
          <p className="mt-0.5 text-[13px] text-slate-500">{subtitle}</p>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <RetroEditorToolbar editor={editor} accentClass={toolbarAccentClass} />
        <div className={cn("min-h-0 flex-1", editorBgClass)}>
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}

export function SprintRetrospectiveEditor({
  sprintLabel,
  teamName,
  teamId,
  workspaceDirectoryUsers = [],
  initialDoc,
  updatedAt,
  onSave,
}: SprintRetrospectiveEditorProps) {
  const [wentWellHtml, setWentWellHtml] = useState(() => normalizeSectionHtml(initialDoc?.wentWellHtml));
  const [improveHtml, setImproveHtml] = useState(() => normalizeSectionHtml(initialDoc?.improveHtml));
  const [actionItems, setActionItems] = useState<SprintRetroActionItem[]>(initialDoc?.actionItems ?? []);
  const [savedAtText, setSavedAtText] = useState<string | null>(null);

  const ownerSuggestions = useMemo(() => {
    if (workspaceDirectoryUsers.length === 0) return [];
    const members = teamId
      ? workspaceDirectoryUsers.filter((u) => normalizeWorkspaceUserTeam(u.team) === teamId)
      : workspaceDirectoryUsers;
    return members.map((u) => u.name.trim()).filter(Boolean).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [workspaceDirectoryUsers, teamId]);

  useEffect(() => {
    setWentWellHtml(normalizeSectionHtml(initialDoc?.wentWellHtml));
    setImproveHtml(normalizeSectionHtml(initialDoc?.improveHtml));
    setActionItems(initialDoc?.actionItems ?? []);
  }, [initialDoc]);

  useEffect(() => {
    if (!updatedAt) { setSavedAtText(null); return; }
    setSavedAtText(new Date(updatedAt).toLocaleString());
  }, [updatedAt]);

  const dirty = useMemo(() => {
    const baseWentWell = normalizeSectionHtml(initialDoc?.wentWellHtml);
    const baseImprove = normalizeSectionHtml(initialDoc?.improveHtml);
    const baseActionItems = initialDoc?.actionItems ?? [];
    return baseWentWell !== wentWellHtml || baseImprove !== improveHtml || JSON.stringify(baseActionItems) !== JSON.stringify(actionItems);
  }, [initialDoc, wentWellHtml, improveHtml, actionItems]);

  function handleSave() {
    onSave({ wentWellHtml, improveHtml, actionItems });
    setSavedAtText(new Date().toLocaleString());
  }

  function addActionItem() {
    setActionItems((prev) => [...prev, { id: crypto.randomUUID(), title: "", owner: "", dueDate: "" }]);
  }

  function updateActionItem(id: string, patch: Partial<SprintRetroActionItem>) {
    setActionItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function removeActionItem(id: string) {
    setActionItems((prev) => prev.filter((item) => item.id !== id));
  }

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-slate-50 font-sans">
      <div className="min-h-0 flex-1 overflow-y-auto">

        {/* Hero header */}
        <div className="relative overflow-hidden bg-gradient-to-br from-slate-100 via-slate-50 to-white px-6 py-7 sm:px-8 sm:py-8 border-b border-slate-200 shadow-[0_2px_12px_0_rgba(0,0,0,0.07)]">
          <div className="relative flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-slate-200/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                <NotebookPen className="size-3" aria-hidden />
                Sprint Retrospective
              </div>
              <h2 className="flex flex-wrap items-center gap-2.5 text-2xl font-bold tracking-tight text-slate-800 sm:text-3xl">
                {sprintLabel}
                {teamName ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2.5 py-0.5 text-sm font-semibold text-indigo-700 ring-1 ring-indigo-200">
                    <Users className="size-3.5 shrink-0" aria-hidden />
                    {teamName}
                  </span>
                ) : null}
              </h2>
              <p className="mt-1.5 text-sm text-slate-400">Reflect · Learn · Improve</p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              <div className="flex gap-2">
                <div className="flex flex-col items-center rounded-xl bg-emerald-50 px-5 py-3 text-center ring-1 ring-emerald-200 shadow-sm">
                  <ThumbsUp className="mb-1 size-5 text-emerald-500" />
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Wins</span>
                </div>
                <div className="flex flex-col items-center rounded-xl bg-rose-50 px-5 py-3 text-center ring-1 ring-rose-200 shadow-sm">
                  <ThumbsDown className="mb-1 size-5 text-rose-500" />
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-rose-700">Improve</span>
                </div>
                <div className="flex flex-col items-center rounded-xl bg-sky-50 px-5 py-3 text-center ring-1 ring-sky-200 shadow-sm">
                  <CheckCircle2 className="mb-1 size-5 text-sky-500" />
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-sky-700">Actions</span>
                  <span className="text-sm font-bold text-sky-800">{actionItems.length || "—"}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="px-5 py-6 sm:px-7 sm:py-7">

          {/* Two-column retro sections */}
          <div className="grid gap-5 lg:grid-cols-2">
            <RetroRichSection
              title="What went well?"
              subtitle="Highlights, wins, and practices to repeat"
              titleIcon={ThumbsUp}
              accentClass="border-emerald-200 bg-white"
              toolbarAccentClass="bg-emerald-600"
              editorBgClass="bg-white"
              badgeClass="bg-emerald-100 text-emerald-700"
              placeholder="Describe what went well this sprint…"
              field="wentWell"
              initialDoc={initialDoc}
              html={wentWellHtml}
              onHtmlChange={setWentWellHtml}
            />
            <RetroRichSection
              title="What could be improved?"
              subtitle="Friction, misses, and risks to address"
              titleIcon={ThumbsDown}
              accentClass="border-rose-200 bg-white"
              toolbarAccentClass="bg-rose-500"
              editorBgClass="bg-white"
              badgeClass="bg-rose-100 text-rose-600"
              placeholder="Describe what needs improvement…"
              field="improve"
              initialDoc={initialDoc}
              html={improveHtml}
              onHtmlChange={setImproveHtml}
            />
          </div>

          {/* Action items */}
          <div className="mt-5 overflow-hidden rounded-2xl border border-violet-200 bg-white shadow-sm">
            <div className="flex items-center gap-3 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white px-5 py-3.5">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-violet-100 ring-1 ring-violet-200">
                <ListChecks className="size-4 text-violet-600" aria-hidden />
              </div>
              <div>
                <p className="text-[17px] font-semibold text-slate-800">Action Items</p>
                <p className="text-[13px] text-slate-400">Assign owners and due dates to follow through</p>
              </div>
              {actionItems.length > 0 && (
                <span className="ml-auto inline-flex size-6 items-center justify-center rounded-full bg-violet-100 text-[11px] font-bold text-violet-700 ring-1 ring-violet-200">
                  {actionItems.length}
                </span>
              )}
            </div>

            <div className="p-4">
              {actionItems.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-200 py-8 text-center">
                  <ListChecks className="size-8 text-slate-300" />
                  <p className="text-sm font-medium text-slate-500">No action items yet</p>
                  <p className="text-xs text-slate-400">Add one to track owners and due dates</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {actionItems.map((item, idx) => (
                    <div
                      key={item.id}
                      className="group flex items-center gap-2.5 rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2 transition-colors hover:border-violet-200 hover:bg-violet-50/30"
                    >
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-violet-100 text-[11px] font-bold text-violet-600">
                        {idx + 1}
                      </span>
                      <input
                        value={item.title}
                        onChange={(e) => updateActionItem(item.id, { title: e.target.value })}
                        placeholder="Describe the action…"
                        className="h-8 min-w-0 flex-[3] rounded-lg border border-transparent bg-white px-2.5 text-sm text-slate-800 shadow-sm outline-none placeholder:text-slate-400 focus:border-violet-300 focus:ring-1 focus:ring-violet-200/60"
                      />
                      <div className="relative flex h-8 min-w-[7rem] flex-1 items-center gap-1.5 rounded-lg border border-transparent bg-white px-2.5 shadow-sm focus-within:border-violet-300 focus-within:ring-1 focus-within:ring-violet-200/60">
                        <User className="size-3.5 shrink-0 text-slate-400" aria-hidden />
                        <AssigneeCombobox
                          value={item.owner}
                          onChange={(v) => updateActionItem(item.id, { owner: v })}
                          suggestions={ownerSuggestions}
                          placeholder="Owner"
                          className="h-full min-w-0 flex-1 bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400 border-0 shadow-none focus:ring-0 p-0"
                          aria-label="Owner"
                        />
                      </div>
                      <label className="flex h-8 min-w-[8rem] items-center gap-1.5 rounded-lg border border-transparent bg-white px-2.5 shadow-sm focus-within:border-violet-300 focus-within:ring-1 focus-within:ring-violet-200/60">
                        <CalendarDays className="size-3.5 shrink-0 text-slate-400" aria-hidden />
                        <input
                          type="date"
                          value={item.dueDate}
                          onChange={(e) => updateActionItem(item.id, { dueDate: e.target.value })}
                          className="h-full min-w-0 flex-1 bg-transparent text-sm text-slate-700 outline-none"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => removeActionItem(item.id)}
                        className="flex size-7 shrink-0 items-center justify-center rounded-lg text-slate-300 opacity-0 transition-all hover:bg-rose-50 hover:text-rose-500 group-hover:opacity-100"
                        title="Remove"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <button
                type="button"
                onClick={addActionItem}
                className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-violet-200 text-sm font-medium text-violet-500 transition-colors hover:border-violet-400 hover:bg-violet-50 hover:text-violet-700"
              >
                <Plus className="size-4" strokeWidth={2.25} />
                Add action item
              </button>
            </div>
          </div>

        </div>
      </div>

      {/* Footer */}
      <footer className="shrink-0 border-t border-slate-200/80 bg-white px-5 py-3.5 sm:px-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-slate-400">
            {savedAtText ? (
              <span>Last saved: <span className="font-medium text-slate-600">{savedAtText}</span></span>
            ) : (
              "Not saved yet for this sprint."
            )}
          </p>
          <Button
            type="button"
            size="sm"
            onClick={handleSave}
            disabled={!dirty}
            className="h-8 min-w-[100px] shrink-0 gap-1.5 border-0 bg-gradient-to-r from-violet-600 to-indigo-600 px-5 text-sm font-semibold text-white shadow-sm shadow-violet-500/25 hover:from-violet-500 hover:to-indigo-500 disabled:opacity-40"
          >
            <Save className="size-3.5" />
            Save
          </Button>
        </div>
      </footer>
    </section>
  );
}
