"use client";

import {
  Activity,
  AreaChart as AreaChartIcon,
  Bold,
  CalendarDays,
  CheckCircle2,
  Heading2,
  Heading3,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  MoreHorizontal,
  PieChart as PieChartIcon,
  Quote,
  Save,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Underline as UnderlineIcon,
  User,
  Users,
} from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

import { BurndownChart } from "@/components/dashboard/charts/burndown-chart";
import { LinkEditorPopover, applyLinkToEditor, readLinkContext } from "@/components/ui/link-editor-popover";
import { TeamAvatar } from "@/components/ui/team-avatar";
import { CfdChart } from "@/components/dashboard/charts/cfd-chart";
import { StoryStatusChart } from "@/components/dashboard/charts/story-status-chart";
import { StoryStatusDrilldownTable } from "@/components/dashboard/charts/story-status-drilldown-table";
import { collectMonthStories } from "@/lib/sprint-analytics";
import { storyMatchesYearSprint } from "@/lib/sprint-plan";
import { X as XIcon } from "lucide-react";
import { AssigneeCombobox } from "@/components/ui/assignee-combobox";
import { Button } from "@/components/ui/button";
import type { SprintWorkspaceDirectoryUser } from "@/lib/sprint-capacity";
import type { InitiativeItem } from "@/lib/types";
import { normalizeWorkspaceUserTeam } from "@/lib/workspace-users";
import { cn } from "@/lib/utils";

// ─── Public types (persistence shape preserved) ──────────────────────────────

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
  /** Required for the sprint recap charts (story status + burndown) below the board. */
  initiatives?: InitiativeItem[];
  planYear?: number;
  yearSprint?: number | null;
  /** Opens the story details dialog when the user drills into a row. */
  onOpenStory?: (storyId: string) => void;
};

// ─── HTML <-> card helpers ───────────────────────────────────────────────────

type RetroCard = { id: string; text: string };

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function unescapeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripTags(html: string): string {
  return unescapeHtml(html.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

/** Minimal HTML escaper for inline text we paste into editor `<li>` bodies. */
function escapeHtmlText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function htmlToCards(html: string | undefined | null): RetroCard[] {
  const raw = (html ?? "").trim();
  if (!raw) return [];
  // Split on top-level block separators: outer <p>, <li>, or <div>. Inner HTML (b/i/u/links) is preserved.
  const matches = [...raw.matchAll(/<(p|li|div)[^>]*>([\s\S]*?)<\/\1>/gi)];
  const innerHtmls =
    matches.length > 0
      ? matches.map((m) => (m[2] ?? "").trim())
      : [raw];
  return innerHtmls
    .filter((s) => stripTags(s).length > 0)
    .map((text) => ({ id: cryptoRandomId(), text }));
}

function cardsToHtml(cards: RetroCard[]): string {
  if (cards.length === 0) return "<p></p>";
  // text is rich HTML; wrap each as a paragraph block so it round-trips through htmlToCards.
  return cards.map((c) => `<p>${c.text}</p>`).join("");
}

function cryptoRandomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `r-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function initialsFor(name: string | undefined | null, fallback = "A"): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return fallback;
  const parts = trimmed.split(/\s+/);
  const a = parts[0]?.[0] ?? "";
  const b = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (a + b).toUpperCase() || fallback;
}

// ─── Column composer (rich-text input only — commit handled by the top Save) ─

type CardComposerHandle = {
  /** Returns the trimmed inline HTML, or empty string when the editor has no
   *  real text. Mirrors what the old "Add" button used to push into a list. */
  getHtml: () => string;
  clear: () => void;
};

const CardComposer = forwardRef<
  CardComposerHandle,
  {
    placeholder: string;
    /** Optional initial HTML to seed the editor with — used by retros that
     *  have persisted notebook content (or by the demo-builder seed) so the
     *  notebook page reads as "already filled in" on first open. */
    initialContent?: string;
    /** Called whenever the editor's emptiness changes — parent uses this to
     *  decide whether the top-right Save button should be enabled. */
    onEmptyChange?: (empty: boolean) => void;
    trailing?: React.ReactNode;
  }
>(function CardComposer({ placeholder, initialContent, onEmptyChange, trailing }, ref) {
  const linkButtonRef = useRef<HTMLButtonElement | null>(null);
  const [linkEditorOpen, setLinkEditorOpen] = useState(false);
  const [linkEditorCtx, setLinkEditorCtx] = useState<{ text: string; href: string }>({ text: "", href: "" });
  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: "text-blue-600 underline decoration-blue-600/40 underline-offset-2" },
      }),
      Placeholder.configure({ placeholder }),
    ],
    content: initialContent && initialContent.trim().length > 0 ? initialContent : "<p></p>",
    immediatelyRender: false,
    editorProps: {
      attributes: {
        // pt-[6px] places the first text baseline at ~23px, matching the first ruling line of the 24px-period notebook.
        class: "outline-none min-h-[12rem] px-2 pt-[6px] pb-2 text-[14px] text-slate-700",
      },
    },
  });

  // Push empty-state changes up to the parent so the top-right Save button
  // can light up the moment the user types in any composer.
  useEffect(() => {
    if (!editor || !onEmptyChange) return;
    const fire = () => onEmptyChange(editor.isEmpty);
    fire();
    editor.on("update", fire);
    return () => {
      editor.off("update", fire);
    };
  }, [editor, onEmptyChange]);

  // Sync external `initialContent` changes — fires when the parent swaps
  // sprints / teams (each retro doc has its own notebook content). Only
  // applies when the editor is currently EMPTY so we don't blow away
  // mid-edit work just because the parent re-rendered.
  useEffect(() => {
    if (!editor) return;
    if (initialContent == null) return;
    if (!editor.isEmpty) return;
    if (initialContent.trim().length === 0) return;
    editor.commands.setContent(initialContent, { emitUpdate: false });
    onEmptyChange?.(editor.isEmpty);
  }, [editor, initialContent, onEmptyChange]);

  useImperativeHandle(ref, () => ({
    getHtml: () => {
      if (!editor || editor.isEmpty) return "";
      // Return the FULL editor HTML — this is now the notebook page's content
      // (no card splitting), so we preserve all block-level structure.
      const html = editor.getHTML().trim();
      return stripTags(html) ? html : "";
    },
    clear: () => {
      editor?.commands.setContent("<p></p>", { emitUpdate: false });
      onEmptyChange?.(true);
    },
  }), [editor, onEmptyChange]);

  function tbBtn(active: boolean, onClick: () => void, icon: React.ReactNode) {
    return (
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClick}
        className={cn(
          "inline-flex h-7 w-7 items-center justify-center rounded border text-white",
          active ? "border-white/40 bg-white/20" : "border-transparent hover:bg-white/20",
        )}
      >
        {icon}
      </button>
    );
  }

  return (
    <div className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200/70">
      {/* Toolbar — same style as Description panel */}
      <div className="mb-2 flex flex-wrap gap-1 rounded-md bg-[#0897d5] p-1">
        {tbBtn(!!editor?.isActive("bold"), () => editor?.chain().focus().toggleBold().run(), <Bold className="size-3.5" />)}
        {tbBtn(!!editor?.isActive("italic"), () => editor?.chain().focus().toggleItalic().run(), <Italic className="size-3.5" />)}
        {tbBtn(!!editor?.isActive("underline"), () => editor?.chain().focus().toggleUnderline().run(), <UnderlineIcon className="size-3.5" />)}
        {tbBtn(!!editor?.isActive("bulletList"), () => editor?.chain().focus().toggleBulletList().run(), <List className="size-3.5" />)}
        {tbBtn(!!editor?.isActive("orderedList"), () => editor?.chain().focus().toggleOrderedList().run(), <ListOrdered className="size-3.5" />)}
        {tbBtn(!!editor?.isActive("blockquote"), () => editor?.chain().focus().toggleBlockquote().run(), <Quote className="size-3.5" />)}
        {tbBtn(!!editor?.isActive("heading", { level: 2 }), () => editor?.chain().focus().toggleHeading({ level: 2 }).run(), <Heading2 className="size-3.5" />)}
        {tbBtn(!!editor?.isActive("heading", { level: 3 }), () => editor?.chain().focus().toggleHeading({ level: 3 }).run(), <Heading3 className="size-3.5" />)}
        <button
          ref={linkButtonRef}
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            if (!editor) return;
            setLinkEditorCtx(readLinkContext(editor));
            setLinkEditorOpen(true);
          }}
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded border text-white",
            editor?.isActive("link") ? "border-white/40 bg-white/20" : "border-transparent hover:bg-white/20",
          )}
        >
          <LinkIcon className="size-3.5" />
        </button>
        <LinkEditorPopover
          anchorRef={linkButtonRef}
          open={linkEditorOpen}
          initialText={linkEditorCtx.text}
          initialHref={linkEditorCtx.href}
          onClose={() => setLinkEditorOpen(false)}
          onSave={(text, href) => {
            if (editor) applyLinkToEditor(editor, text, href);
            setLinkEditorOpen(false);
          }}
          onUnlink={() => {
            editor?.chain().focus().extendMarkRange("link").unsetLink().run();
            setLinkEditorOpen(false);
          }}
        />
      </div>
      {/* Ruled notebook page — white background with periodic horizontal lines. 24px ruling matches editor line-height.
          Background offset matches the editor's top padding so each rule lands just under a text baseline. */}
      <div
        className="relative rounded-md bg-white ring-1 ring-slate-200"
        style={{
          backgroundImage:
            "repeating-linear-gradient(to bottom, transparent 0, transparent calc(1.5rem - 1px), rgb(186 230 253 / 0.7) calc(1.5rem - 1px), rgb(186 230 250 / 0.7) 1.5rem)",
          backgroundPosition: "0 1.5rem",
          backgroundAttachment: "local",
        }}
      >
        {/* Classic red "margin" line on the left, shifted right to match the bumped text indent */}
        <span className="pointer-events-none absolute inset-y-0 left-[2.1rem] w-px bg-rose-300/50" aria-hidden />
        <EditorContent
          editor={editor}
          className={cn(
            "focus-within:outline-none [&_.ProseMirror]:outline-none",
            // Text starts well clear of the margin line (pl-12 = 48px vs margin line at 33.6px → ~14px gap).
            "[&_.ProseMirror]:pl-12 [&_.ProseMirror_p]:leading-6 [&_.ProseMirror_p]:my-0",
            "[&_h2]:leading-6 [&_h2]:my-0 [&_h3]:leading-6 [&_h3]:my-0",
            "[&_ul_li]:leading-6 [&_ol_li]:leading-6 [&_blockquote]:leading-6",
          )}
        />
      </div>
      {trailing ? (
        <div className="mt-3 flex items-center gap-1.5">{trailing}</div>
      ) : null}
    </div>
  );
});

// ─── Sticky-note card ────────────────────────────────────────────────────────

function StickyCard({
  text,
  bgClass,
  avatarClass,
  authorInitials,
  detail,
  onEdit,
  onRemove,
}: {
  text: string;
  bgClass: string;
  avatarClass: string;
  authorInitials: string;
  detail?: React.ReactNode;
  onEdit?: () => void;
  onRemove: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      className={cn(
        "group relative rounded-2xl px-3.5 pt-3 pb-2.5 text-[14px] leading-snug text-white shadow-sm ring-1 ring-black/5",
        bgClass,
      )}
    >
      <div
        className="whitespace-pre-wrap break-words [&_a]:underline [&_a]:underline-offset-2 [&_blockquote]:border-l-2 [&_blockquote]:border-white/40 [&_blockquote]:pl-2 [&_h2]:text-[16px] [&_h2]:font-semibold [&_h3]:text-[15px] [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4"
        dangerouslySetInnerHTML={{ __html: text }}
      />
      {detail ? <div className="mt-2 text-[12px] text-white/80">{detail}</div> : null}
      <div className="mt-2 flex items-center justify-between">
        <span
          className={cn(
            "inline-flex size-5 items-center justify-center rounded-full text-[10px] font-semibold ring-1 ring-white/40",
            avatarClass,
          )}
          aria-hidden
        >
          {authorInitials}
        </span>
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="inline-flex size-6 items-center justify-center rounded text-white/80 transition hover:bg-white/15"
            aria-label="Card actions"
          >
            <MoreHorizontal className="size-3.5" />
          </button>
          {menuOpen ? (
            <div className="absolute right-0 top-full z-20 mt-1 w-32 overflow-hidden rounded-lg bg-white text-slate-700 shadow-lg ring-1 ring-slate-200">
              {onEdit ? (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onEdit();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-slate-50"
                >
                  Edit details
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onRemove();
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-rose-600 hover:bg-rose-50"
              >
                <Trash2 className="size-3" />
                Delete
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ─── Main editor ─────────────────────────────────────────────────────────────

export function SprintRetrospectiveEditor({
  sprintLabel,
  teamName,
  teamId,
  workspaceDirectoryUsers = [],
  initialDoc,
  updatedAt,
  onSave,
  initiatives,
  planYear,
  yearSprint,
  onOpenStory,
}: SprintRetrospectiveEditorProps) {
  const [savedAtText, setSavedAtText] = useState<string | null>(null);
  const [storyStatusDrilldown, setStoryStatusDrilldown] = useState<string | null>(null);
  // Composer refs + per-composer "has pending edits" flags. Each column's
  // notebook is now the single source of truth for its content — no more
  // sticky-card list below. On Save we pull each notebook's HTML and persist
  // it to the corresponding field of the retro doc.
  const wentWellComposerRef = useRef<CardComposerHandle>(null);
  const improveComposerRef = useRef<CardComposerHandle>(null);
  const actionComposerRef = useRef<CardComposerHandle>(null);
  const [wentWellPending, setWentWellPending] = useState(false);
  const [improvePending, setImprovePending] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const anyComposerPending = wentWellPending || improvePending || actionPending;
  /** When the parent swaps sprints/teams, force the composers to remount so
   *  each picks up its new `initialContent`. The TipTap editor's `content`
   *  arg is only read on construction — without a key bump, the previous
   *  sprint's content would stick around. */
  const composerKey = `${yearSprint ?? "x"}:${teamId ?? "all"}`;

  /** Convert `actionItems[]` into HTML for the Take Action notebook.
   *
   *  Two cases the consumer cares about:
   *  - **Structured rows** (legacy schema, demo seed): every item has plain
   *    text in `title` and possibly `owner` / `dueDate`. We render them as
   *    a bulleted "title — owner, due …" list, escaping the plain text.
   *  - **Notebook placeholder** (post-save shape): a single item with HTML
   *    in `title` and empty `owner` + `dueDate`. We return that HTML as-is
   *    so the editor re-opens with the user's prose intact (round-trip).
   */
  const initialActionHtml = useMemo(() => {
    const items = initialDoc?.actionItems ?? [];
    if (items.length === 0) return "";
    if (
      items.length === 1 &&
      !items[0]!.owner?.trim() &&
      !items[0]!.dueDate?.trim() &&
      /<[a-z][^>]*>/i.test(items[0]!.title)
    ) {
      return items[0]!.title;
    }
    const bullets = items
      .map((item) => {
        const titleText = item.title.trim();
        if (!titleText) return "";
        const meta: string[] = [];
        if (item.owner?.trim()) meta.push(item.owner.trim());
        if (item.dueDate?.trim()) meta.push(`due ${item.dueDate.trim()}`);
        const tail = meta.length > 0 ? ` — ${meta.join(", ")}` : "";
        return `<li>${escapeHtmlText(titleText)}${escapeHtmlText(tail)}</li>`;
      })
      .filter(Boolean)
      .join("");
    return bullets.length > 0 ? `<ul>${bullets}</ul>` : "";
  }, [initialDoc]);

  useEffect(() => {
    if (!updatedAt) {
      setSavedAtText(null);
      return;
    }
    setSavedAtText(new Date(updatedAt).toLocaleString());
  }, [updatedAt]);

  function handleSave() {
    // Notebook-as-source-of-truth: each Save captures the current HTML of
    // each column's editor and replaces the doc. No more "append pending
    // text as a new card" mechanic.
    const wentHtml = wentWellComposerRef.current?.getHtml() ?? "";
    const impHtml = improveComposerRef.current?.getHtml() ?? "";
    const actionHtml = actionComposerRef.current?.getHtml() ?? "";
    // Take Action's notebook HTML lives inside a single placeholder
    // `actionItems[0]` row so the doc shape stays compatible with consumers
    // that still read `actionItems[]` (e.g. legacy chart-aside summaries).
    const actionItems: SprintRetroActionItem[] = actionHtml
      ? [{ id: cryptoRandomId(), title: actionHtml, owner: "", dueDate: "" }]
      : [];
    onSave({
      wentWellHtml: wentHtml,
      improveHtml: impHtml,
      actionItems,
    });
    setWentWellPending(false);
    setImprovePending(false);
    setActionPending(false);
    setSavedAtText(new Date().toLocaleString());
  }

  return (
    <section
      className="flex min-h-0 min-w-0 flex-col"
      style={{
        backgroundImage:
          "linear-gradient(135deg, #eff6ff 0%, #f5f3ff 50%, #fdf2f8 100%)",
      }}
    >
      <div>
        {/* Header */}
        <div className="px-6 pt-6 pb-3 sm:px-8 sm:pt-7">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <h2 className="flex flex-wrap items-center gap-2 text-2xl font-bold tracking-tight text-slate-800 sm:text-[28px]">
                {sprintLabel}
                {teamName ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-100 px-2.5 py-0.5 text-sm font-semibold text-indigo-700 ring-1 ring-indigo-200">
                    <TeamAvatar slug={teamId} sizePx={14} fallback={<Users className="size-3.5 shrink-0" aria-hidden />} />
                    {teamName}
                  </span>
                ) : null}
              </h2>
              <p className="mt-1 text-sm text-slate-500">Reflect · Learn · Improve</p>
            </div>
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              disabled={!anyComposerPending}
              className="h-8 min-w-[100px] shrink-0 gap-1.5 border-0 bg-gradient-to-r from-violet-600 to-indigo-600 px-5 text-sm font-semibold text-white shadow-sm shadow-violet-500/25 hover:from-violet-500 hover:to-indigo-500 disabled:opacity-40"
            >
              <Save className="size-3.5" />
              Save
            </Button>
          </div>
        </div>

        {/* Three-column board — each column is a single notebook editor;
            content lives in the editor body, no sticky-card list below. */}
        <div className="grid gap-5 px-5 pb-6 sm:px-7 lg:grid-cols-3">
          <RetroColumn
            title={
              <span className="inline-flex items-center gap-2">
                <ThumbsUp className="size-4 text-emerald-500" aria-hidden />
                Went Well
              </span>
            }
            columnTint="bg-white/55 ring-emerald-100"
          >
            <CardComposer
              key={`${composerKey}:went`}
              ref={wentWellComposerRef}
              placeholder="What worked well this sprint?"
              initialContent={initialDoc?.wentWellHtml ?? ""}
              onEmptyChange={(empty) => setWentWellPending(!empty)}
            />
          </RetroColumn>

          <RetroColumn
            title={
              <span className="inline-flex items-center gap-2">
                <ThumbsDown className="size-4 text-violet-500" aria-hidden />
                To Improve
              </span>
            }
            columnTint="bg-white/55 ring-violet-100"
          >
            <CardComposer
              key={`${composerKey}:imp`}
              ref={improveComposerRef}
              placeholder="What should we change next time?"
              initialContent={initialDoc?.improveHtml ?? ""}
              onEmptyChange={(empty) => setImprovePending(!empty)}
            />
          </RetroColumn>

          <RetroColumn
            title={
              <span className="inline-flex items-center gap-2">
                <CheckCircle2 className="size-4 text-sky-500" aria-hidden />
                Take Action
              </span>
            }
            columnTint="bg-white/55 ring-sky-100"
          >
            <CardComposer
              key={`${composerKey}:act`}
              ref={actionComposerRef}
              placeholder="What concrete steps will we take?"
              initialContent={initialActionHtml}
              onEmptyChange={(empty) => setActionPending(!empty)}
            />
          </RetroColumn>
        </div>

        {/* Sprint recap charts (filtered by current sprint + team) */}
        {initiatives && planYear != null && yearSprint != null ? (
          <div className="grid gap-5 px-5 pb-6 sm:px-7 lg:grid-cols-3">
            <article className="flex min-h-[300px] flex-col rounded-xl border border-slate-200 bg-white p-3 shadow-sm ring-1 ring-slate-100">
              <h3 className="mb-2 inline-flex items-center gap-1.5 text-[15px] font-semibold text-slate-800">
                <PieChartIcon className="size-4 text-slate-600" aria-hidden />
                User Stories Status
              </h3>
              <div className="min-h-0 flex-1 overflow-hidden">
                <StoryStatusChart
                  initiatives={initiatives}
                  year={planYear}
                  quarter={Math.ceil(yearSprint / 6)}
                  sprint={yearSprint}
                  team={teamId ?? null}
                  onSliceClick={(statusLabel) => setStoryStatusDrilldown(statusLabel)}
                />
              </div>
            </article>
            <article className="flex min-h-[300px] flex-col rounded-xl border border-slate-200 bg-white p-3 shadow-sm ring-1 ring-slate-100">
              <h3 className="mb-2 inline-flex items-center gap-1.5 text-[15px] font-semibold text-slate-800">
                <AreaChartIcon className="size-4 text-slate-600" aria-hidden />
                Cumulative Flow
              </h3>
              <div className="min-h-0 flex-1 overflow-hidden">
                <CfdChart
                  initiatives={initiatives}
                  year={planYear}
                  quarter={Math.ceil(yearSprint / 6)}
                  sprint={yearSprint}
                  team={teamId ?? null}
                />
              </div>
            </article>
            <article className="flex min-h-[300px] flex-col rounded-xl border border-slate-200 bg-white p-3 shadow-sm ring-1 ring-slate-100">
              <h3 className="mb-2 inline-flex items-center gap-1.5 text-[15px] font-semibold text-slate-800">
                <Activity className="size-4 text-slate-600" aria-hidden />
                Burndown
              </h3>
              <div className="min-h-0 flex-1 overflow-hidden">
                <BurndownChart
                  initiatives={initiatives}
                  year={planYear}
                  quarter={Math.ceil(yearSprint / 6)}
                  sprint={yearSprint}
                  team={teamId ?? null}
                />
              </div>
            </article>
          </div>
        ) : null}
      </div>

      {/* Footer — Save lives in the header now; just the last-saved breadcrumb. */}
      <footer className="shrink-0 border-t border-slate-200/80 bg-white/80 backdrop-blur px-5 py-3.5 sm:px-7">
        <p className="text-xs text-slate-400">
          {savedAtText ? (
            <span>
              Last saved: <span className="font-medium text-slate-600">{savedAtText}</span>
            </span>
          ) : (
            "Not saved yet for this sprint."
          )}
        </p>
      </footer>
      {storyStatusDrilldown && initiatives && planYear != null && yearSprint != null
        ? (() => {
            const month = Math.ceil(yearSprint / 2);
            const scoped = collectMonthStories(initiatives, month, teamId ? [teamId] : null).filter((story) =>
              storyMatchesYearSprint(story, month, yearSprint),
            );
            return (
              <div
                className="fixed inset-0 z-[65] flex items-center justify-center bg-slate-900/20 backdrop-blur-[2px] p-4"
                onClick={() => setStoryStatusDrilldown(null)}
              >
                <div
                  className="relative flex h-[70vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-sky-200 bg-white shadow-2xl ring-4 ring-sky-100/70 animate-in fade-in zoom-in-95 duration-150"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
                    <div className="flex min-w-0 items-center gap-2">
                      <PieChartIcon className="size-4 shrink-0 text-slate-600" aria-hidden />
                      <h3 className="truncate text-[15px] font-semibold text-slate-800">
                        User Stories · {storyStatusDrilldown}
                      </h3>
                      <span className="shrink-0 text-[12px] text-slate-500">
                        {sprintLabel}
                        {teamName ? ` · ${teamName}` : ""}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setStoryStatusDrilldown(null)}
                      aria-label="Close drilldown"
                      className="shrink-0 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                    >
                      <XIcon className="size-4" />
                    </button>
                  </div>
                  <div className="min-h-0 flex-1 overflow-hidden px-6 py-4">
                    <div className="h-full overflow-hidden rounded-lg ring-1 ring-slate-200">
                      <StoryStatusDrilldownTable
                        stories={scoped}
                        initialStatus={storyStatusDrilldown}
                        workspaceDirectoryUsers={workspaceDirectoryUsers}
                        onOpenStory={(id) => {
                          setStoryStatusDrilldown(null);
                          onOpenStory?.(id);
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            );
          })()
        : null}
    </section>
  );
}

// ─── Column wrapper ──────────────────────────────────────────────────────────

function RetroColumn({
  title,
  columnTint,
  children,
}: {
  title: React.ReactNode;
  columnTint: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex min-h-[14rem] flex-col rounded-3xl p-4 ring-1 backdrop-blur-sm sm:p-5", columnTint)}>
      <div className="mb-4 flex items-center justify-center gap-2">
        <h3 className="text-center text-[16px] font-semibold text-slate-700">{title}</h3>
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}

// ─── Action card with inline edit panel ──────────────────────────────────────

function ActionCard({
  item,
  isEditing,
  ownerSuggestions,
  onToggleEdit,
  onChange,
  onRemove,
}: {
  item: SprintRetroActionItem;
  isEditing: boolean;
  ownerSuggestions: string[];
  onToggleEdit: () => void;
  onChange: (patch: Partial<SprintRetroActionItem>) => void;
  onRemove: () => void;
}) {
  const initials = initialsFor(item.owner, "T");
  return (
    <div className="rounded-2xl bg-sky-500 px-3.5 pt-3 pb-2.5 text-[14px] leading-snug text-white shadow-sm ring-1 ring-black/5">
      {isEditing ? (
        <input
          autoFocus
          value={item.title}
          onChange={(e) => onChange({ title: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") onToggleEdit();
            if (e.key === "Escape") onToggleEdit();
          }}
          className="block w-full rounded-md border-0 bg-white/15 px-2 py-1 text-[14px] text-white placeholder-white/70 outline-none ring-1 ring-white/30 focus:ring-2 focus:ring-white"
          placeholder="Action…"
        />
      ) : (
        <p className="whitespace-pre-wrap break-words">{item.title || <span className="italic text-white/75">Untitled action</span>}</p>
      )}

      {isEditing ? (
        <div className="mt-2 space-y-2">
          <div className="flex items-center gap-1.5 rounded-md bg-white/10 px-2 py-1 ring-1 ring-white/20">
            <User className="size-3.5 shrink-0 text-white/80" aria-hidden />
            <AssigneeCombobox
              value={item.owner}
              onChange={(v) => onChange({ owner: v })}
              suggestions={ownerSuggestions}
              placeholder="Owner"
              className="h-6 min-w-0 flex-1 border-0 bg-transparent p-0 text-[13px] text-white placeholder:text-white/70 shadow-none focus:ring-0"
              aria-label="Owner"
            />
          </div>
          <label className="flex items-center gap-1.5 rounded-md bg-white/10 px-2 py-1 ring-1 ring-white/20">
            <CalendarDays className="size-3.5 shrink-0 text-white/80" aria-hidden />
            <input
              type="date"
              value={item.dueDate}
              onChange={(e) => onChange({ dueDate: e.target.value })}
              className="h-6 min-w-0 flex-1 bg-transparent text-[13px] text-white outline-none [color-scheme:dark]"
            />
          </label>
        </div>
      ) : (item.owner || item.dueDate) ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-white/85">
          {item.owner ? (
            <span className="inline-flex items-center gap-1">
              <User className="size-3" /> {item.owner}
            </span>
          ) : null}
          {item.dueDate ? (
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="size-3" /> {item.dueDate}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="mt-2 flex items-center justify-between">
        <span
          className="inline-flex size-5 items-center justify-center rounded-full bg-sky-200 text-[10px] font-semibold text-sky-800 ring-1 ring-white/40"
          aria-hidden
        >
          {initials}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onToggleEdit}
            className="rounded px-2 py-0.5 text-[11px] font-medium text-white/85 transition hover:bg-white/15"
          >
            {isEditing ? "Done" : "Edit"}
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex size-6 items-center justify-center rounded text-white/80 transition hover:bg-rose-500/40"
            aria-label="Remove action"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
