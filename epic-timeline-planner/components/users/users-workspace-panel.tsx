"use client";

import { closestCenter, DndContext, type DragEndEvent, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, horizontalListSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronRight,
  Filter,
  Layers3,
  ListFilter,
  Plus,
  Search,
  Tag,
  UploadCloud,
  User,
  UserPen,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import type { CSSProperties, FocusEvent, KeyboardEvent, ReactNode } from "react";
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { AssigneeCombobox } from "@/components/ui/assignee-combobox";
import { Button } from "@/components/ui/button";
import { EditRowIconButton } from "@/components/ui/edit-row-icon-button";
import { PermissionFolderIcon } from "@/components/ui/permission-folder-icon";
import { TableColumnDragGrip } from "@/components/ui/table-column-drag-grip";
import { TeamIdCombobox, blurActiveField } from "@/components/ui/team-id-combobox";
import {
  EditImageDialog,
  readImageFileAsDataUrl,
  useImageFilePicker,
} from "@/components/users/edit-image-dialog";
import { refreshTeamImages } from "@/lib/use-team-images";
import { MONTH_TEAM_COLUMNS, MONTH_TEAM_IDS } from "@/lib/month-team-board";
import { TABLE_ZEBRA_BASE_BG, TABLE_ZEBRA_STRIPE_BG } from "@/lib/table-zebra";
import {
  WORKSPACE_USER_PERMISSIONS,
  normalizeWorkspaceUserPermission,
  normalizeWorkspaceUserTeam,
  teamLabelForWorkspaceUser,
} from "@/lib/workspace-users";
import { cn } from "@/lib/utils";

export type WorkspaceUserRow = {
  id: string;
  name: string;
  email: string;
  team: string;
  permission: string;
  /** Lowercase in DB; displayed capitalized in UI. Omitted on older API payloads until migrate. */
  status?: string;
  /** Avatar URL (e.g. `/uploads/avatars/<uuid>.jpg`) or null when no upload. */
  image?: string | null;
  createdAt: string;
  updatedAt: string;
};

type PermissionFilter = "all" | "Admin" | "Editor" | "Viewer";
type SortKey = "name" | "email" | "team" | "permission" | "status";
type SortState = { key: SortKey; dir: "asc" | "desc" };
type UserEditField = "name" | "email" | "team" | "permission";

/** Lets roadmap sprint views refetch unfiltered directory users after directory edits. */
const WORKSPACE_USERS_CHANGED_EVENT = "epic-planner-workspace-users-changed";

function notifyWorkspaceUsersChangedForSprint(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(WORKSPACE_USERS_CHANGED_EVENT));
}

const USER_DIRECTORY_DEFAULT_COLUMN_ORDER: SortKey[] = ["name", "email", "team", "permission", "status"];
const USERS_DIRECTORY_COLUMN_ORDER_STORAGE_KEY = "epic-planner.users-directory.column-order.v1";
/** Custom team slugs registered from “Add team” (no server entity; merged into combobox + filter hints). */
const USERS_DIRECTORY_EXTRA_TEAMS_STORAGE_KEY = "epic-planner.users-directory.extra-teams.v1";
const USERS_DIRECTORY_GROUP_LEVELS_STORAGE_KEY = "epic-planner.users-directory.group-levels.v1";

type UserDirectoryGroupLevel = "team" | "permission" | "status";
const USER_DIRECTORY_GROUP_LEVEL_ORDER: UserDirectoryGroupLevel[] = ["team", "permission", "status"];
const USER_DIRECTORY_GROUP_LEVEL_LABELS: Record<UserDirectoryGroupLevel, string> = {
  team: "Team",
  permission: "Permission",
  status: "Status",
};

function userDirectoryGroupLevelIcon(level: UserDirectoryGroupLevel, size: "tree" | "menu" = "tree"): ReactNode {
  const cls = size === "menu" ? "size-3.5 shrink-0 text-slate-500" : "size-4 shrink-0 text-slate-500";
  switch (level) {
    case "team":
      return <Users className={cls} strokeWidth={2} aria-hidden />;
    case "permission":
      return <PermissionFolderIcon className={cls} />;
    case "status":
      return <ListFilter className={cls} strokeWidth={2} aria-hidden />;
  }
}

/** Horizontal shift per tree depth for group folder rows and grouped user name cells (px). */
const USER_DIRECTORY_TREE_LEVEL_STEP_PX = 40;

/** When the viewport is narrower than this, the directory keeps this layout width and scrolls horizontally (aligned with roadmap right-panel floor). */
const USER_DIRECTORY_MIN_LAYOUT_WIDTH_PX = 1100;

const USER_DIRECTORY_COLUMN_LABELS: Record<SortKey, string> = {
  name: "User name",
  email: "Email",
  team: "Team",
  permission: "Permission",
  status: "Status",
};

/** With `table-fixed`, share of row width — name column gets most of the table. */
const USER_DIRECTORY_COL_WIDTH_CLASS: Record<SortKey, string> = {
  name: "w-[48%]",
  email: "w-[22%]",
  team: "w-[10%]",
  permission: "w-[12%]",
  status: "w-[8%]",
};

const USER_DIR_TH_CLASS =
  "relative w-full min-w-0 whitespace-nowrap px-3 py-1.5 text-left align-middle";

const USER_DIR_TD_BASE = "min-w-0 px-2 py-2 align-middle";

/**
 * Per-column filter popover for the user directory — same UX pattern as
 * the backlog table: small Filter icon trigger in the column header,
 * polished popover on click with the column-specific filter UI.
 */
function UserDirColumnFilterDropdown({
  title,
  isActive,
  onClear,
  children,
  align = "right",
  width = 240,
}: {
  title: string;
  isActive: boolean;
  onClear?: () => void;
  children: ReactNode;
  align?: "left" | "right";
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey as never);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey as never);
    };
  }, [open]);
  return (
    <div ref={wrapRef} className="relative inline-flex">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
        aria-label={`${title} — open filter`}
        aria-expanded={open}
        title={title}
        className={cn(
          "relative inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/60",
          isActive
            ? "border-amber-300/70 bg-amber-300/15 text-amber-200 hover:bg-amber-300/25"
            : "border-white/20 bg-white/10 text-white/80 hover:border-white/40 hover:bg-white/25 hover:text-white",
          open && "ring-2 ring-amber-300/60",
        )}
      >
        <Filter className="size-3.5" strokeWidth={2.2} aria-hidden />
        {isActive ? (
          <span
            className="pointer-events-none absolute -right-0.5 -top-0.5 inline-flex h-2 w-2 rounded-full bg-amber-300 shadow-[0_0_0_2px_rgba(8,151,213,0.95)]"
            aria-hidden
          />
        ) : null}
      </button>
      {open ? (
        <div
          className={cn(
            "absolute z-50 mt-1 top-full overflow-hidden rounded-xl border border-slate-200/90 bg-white text-left text-slate-700 shadow-[0_20px_45px_-15px_rgba(15,23,42,0.35),0_8px_18px_-8px_rgba(15,23,42,0.15)] ring-1 ring-black/[0.04]",
            align === "right" ? "right-0" : "left-0",
          )}
          style={{ width: `${width}px` }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-gradient-to-b from-slate-50/70 to-white px-3 py-2">
            <span className="truncate text-[12px] font-semibold uppercase tracking-[0.06em] text-slate-500">
              {title}
            </span>
            {isActive && onClear ? (
              <button
                type="button"
                onClick={onClear}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-rose-600 transition hover:bg-rose-50"
              >
                <X className="size-3" aria-hidden />
                Clear
              </button>
            ) : null}
          </div>
          <div className="max-h-[24rem] overflow-y-auto p-2">{children}</div>
        </div>
      ) : null}
    </div>
  );
}

function UserDirCheckList({
  options,
  selected,
  onChange,
  emptyHint = "All",
}: {
  options: { id: string; label: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
  emptyHint?: string;
}) {
  const allSelected = selected.length === 0;
  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  }
  return (
    <div className="space-y-0.5">
      <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] transition hover:bg-slate-50">
        <input
          type="checkbox"
          checked={allSelected}
          onChange={() => onChange([])}
          className="size-3.5 accent-indigo-600"
        />
        <span className="font-medium text-slate-700">{emptyHint}</span>
      </label>
      <div className="h-px bg-slate-100" />
      {options.map((option) => {
        const checked = selected.includes(option.id);
        return (
          <label
            key={option.id}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] transition hover:bg-slate-50",
              checked && "bg-indigo-50/60",
            )}
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => toggle(option.id)}
              className="size-3.5 accent-indigo-600"
            />
            <span className={cn("flex-1 truncate", checked ? "text-indigo-700" : "text-slate-700")}>
              {option.label}
            </span>
          </label>
        );
      })}
    </div>
  );
}

/** Drawer field captions — larger than inputs (`cellInputCn` keeps control heights unchanged). */
const USER_DRAWER_FIELD_LABEL_CLASS = "mb-1.5 block text-[15px] font-semibold text-slate-800";

/**
 * Avatar slot at the top of the Add User / Edit User drawer. Renders the
 * current image (or initials placeholder) and acts as a drag-and-drop target
 * for new uploads. Click also opens the file picker for keyboard/mobile
 * users. Actual file processing + crop dialog live one level up.
 *
 * Drop behavior: only accepts the first file when multiple are dropped, and
 * only image/* MIME types — anything else is silently ignored so the drop
 * zone never crashes on a stray document.
 */
function AvatarField({
  name,
  image,
  onPick,
  onClear,
  onDropFile,
  disabled,
}: {
  name: string;
  image: string | null;
  onPick: () => void;
  onClear: () => void;
  onDropFile?: (file: File) => void;
  disabled?: boolean;
}) {
  const hasImage = Boolean(image);
  const initials = avatarInitialsFromName(name);
  const [dragOver, setDragOver] = useState(false);

  const handleDragEnter = (e: React.DragEvent) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes("Files")) setDragOver(true);
  };
  const handleDragOver = (e: React.DragEvent) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only clear when leaving the drop zone entirely (not a child element).
    if (e.currentTarget === e.target) setDragOver(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith("image/"));
    if (file && onDropFile) onDropFile(file);
  };

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        "flex items-center gap-4 rounded-xl border border-dashed p-3 transition-colors",
        dragOver
          ? "border-violet-400 bg-violet-50/70"
          : "border-slate-200 bg-slate-50/40 hover:border-violet-200 hover:bg-violet-50/30",
      )}
    >
      <button
        type="button"
        onClick={onPick}
        disabled={disabled}
        title={hasImage ? "Change photo" : "Add photo"}
        className="group relative inline-flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white ring-2 ring-white shadow-md transition hover:shadow-lg disabled:opacity-60"
      >
        {hasImage ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={image as string} alt="" className="size-full object-cover" />
        ) : (
          <span className="flex size-full items-center justify-center bg-gradient-to-br from-violet-100 via-indigo-100 to-sky-100 text-[22px] font-bold text-violet-700">
            {initials || <UserPlus className="size-8" />}
          </span>
        )}
        <span className="absolute inset-x-0 bottom-0 hidden bg-slate-900/55 py-1 text-center text-[10px] font-semibold uppercase tracking-wide text-white group-hover:block">
          {hasImage ? "Change" : "Upload"}
        </span>
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-[13px] font-semibold text-slate-800">
          {hasImage ? "Profile photo" : "Add a profile photo"}
        </p>
        <p className="text-[11.5px] leading-snug text-slate-500">
          {dragOver
            ? "Drop your image to upload"
            : hasImage
              ? "Drag a new image here or click to replace."
              : "Drag an image here, or click the circle to choose a file."}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 px-2.5 text-[12px]"
            onClick={onPick}
            disabled={disabled}
          >
            <UploadCloud className="size-3.5" aria-hidden />
            {hasImage ? "Change" : "Choose file"}
          </Button>
          {hasImage ? (
            <button
              type="button"
              onClick={onClear}
              disabled={disabled}
              className="text-left text-[11.5px] font-semibold text-slate-500 underline-offset-2 hover:text-rose-600 hover:underline disabled:opacity-60"
            >
              Remove
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function avatarInitialsFromName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "";
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  const p = parts[0];
  return (p.length >= 2 ? p.slice(0, 2) : p[0] + p[0]).toUpperCase();
}

/**
 * Team logo dropzone — sibling of `AvatarField` with team-specific copy and
 * a slightly more "logo" feel (rounded square instead of round). Reuses the
 * same drag/drop + click-to-pick mechanics.
 */
function TeamLogoField({
  name,
  image,
  onPick,
  onClear,
  onDropFile,
  disabled,
}: {
  name: string;
  image: string | null;
  onPick: () => void;
  onClear: () => void;
  onDropFile?: (file: File) => void;
  disabled?: boolean;
}) {
  const hasImage = Boolean(image);
  const initials = avatarInitialsFromName(name);
  const [dragOver, setDragOver] = useState(false);

  const handleDragEnter = (e: React.DragEvent) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes("Files")) setDragOver(true);
  };
  const handleDragOver = (e: React.DragEvent) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget === e.target) setDragOver(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith("image/"));
    if (file && onDropFile) onDropFile(file);
  };

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        "flex items-center gap-4 rounded-xl border border-dashed p-3 transition-colors",
        dragOver
          ? "border-emerald-400 bg-emerald-50/70"
          : "border-slate-200 bg-slate-50/40 hover:border-emerald-200 hover:bg-emerald-50/30",
      )}
    >
      <button
        type="button"
        onClick={onPick}
        disabled={disabled}
        title={hasImage ? "Change logo" : "Add logo"}
        className="group relative inline-flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white ring-2 ring-white shadow-md transition hover:shadow-lg disabled:opacity-60"
      >
        {hasImage ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={image as string} alt="" className="size-full object-cover" />
        ) : (
          <span className="flex size-full items-center justify-center bg-gradient-to-br from-emerald-100 via-sky-100 to-indigo-100 text-[22px] font-bold text-emerald-700">
            {initials || <Users className="size-8" />}
          </span>
        )}
        <span className="absolute inset-x-0 bottom-0 hidden bg-slate-900/55 py-1 text-center text-[10px] font-semibold uppercase tracking-wide text-white group-hover:block">
          {hasImage ? "Change" : "Upload"}
        </span>
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-[13px] font-semibold text-slate-800">
          {hasImage ? "Team logo" : "Add a team logo"}
        </p>
        <p className="text-[11.5px] leading-snug text-slate-500">
          {dragOver
            ? "Drop your image to upload"
            : hasImage
              ? "Drag a new image here or click to replace."
              : "Drag an image here, or click the square to choose a file."}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 px-2.5 text-[12px]"
            onClick={onPick}
            disabled={disabled}
          >
            <UploadCloud className="size-3.5" aria-hidden />
            {hasImage ? "Replace" : "Upload"}
          </Button>
          {hasImage ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-[12px] text-slate-500 hover:text-slate-700"
              onClick={onClear}
              disabled={disabled}
            >
              <X className="size-3" aria-hidden />
              Remove
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Single-user picker for the team-lead slot. Displays a chip when something
 * is selected; otherwise an inline search input that filters by name/email
 * and exposes a small dropdown of matches.
 */
function TeamUserSinglePicker({
  users,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  users: WorkspaceUserRow[];
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const selected = value ? users.find((u) => u.id === value) ?? null : null;
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users
      .filter((u) => (q ? `${u.name} ${u.email}`.toLowerCase().includes(q) : true))
      .slice(0, 8);
  }, [users, query]);
  if (selected) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50/60 px-2.5 py-1.5">
        <span className="inline-flex min-w-0 items-center gap-2">
          <UserDirectoryAvatar image={selected.image ?? null} name={selected.name} />
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-semibold text-slate-800">{selected.name}</span>
            <span className="block truncate text-[11px] text-slate-500">{selected.email}</span>
          </span>
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-[12px] text-slate-500 hover:text-slate-700"
          onClick={() => onChange(null)}
          disabled={disabled}
        >
          <X className="size-3" aria-hidden />
          Clear
        </Button>
      </div>
    );
  }
  return (
    <div className="relative">
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        placeholder={placeholder ?? "Search the directory"}
        disabled={disabled}
        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-200/80"
      />
      {open && matches.length > 0 ? (
        <ul className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 max-h-60 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg ring-1 ring-black/5">
          {matches.map((u) => (
            <li key={u.id}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(u.id);
                  setQuery("");
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-emerald-50/60"
              >
                <UserDirectoryAvatar image={u.image ?? null} name={u.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-slate-800">{u.name}</span>
                  <span className="block truncate text-[11px] text-slate-500">{u.email}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Multi-pick member list — already-picked users render as removable chips,
 * the input opens a small search dropdown. `alwaysIncludedId` is the lead's
 * ID; it renders as a non-removable chip ("Lead" badge) so the UI mirrors
 * the contract `saveNewTeam` enforces.
 */
function TeamMembersPicker({
  users,
  selectedIds,
  onChange,
  alwaysIncludedId,
  disabled,
}: {
  users: WorkspaceUserRow[];
  selectedIds: string[];
  onChange: (next: string[]) => void;
  alwaysIncludedId?: string | null;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const pickedSet = useMemo(() => {
    const s = new Set(selectedIds);
    if (alwaysIncludedId) s.add(alwaysIncludedId);
    return s;
  }, [selectedIds, alwaysIncludedId]);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users
      .filter((u) => !pickedSet.has(u.id))
      .filter((u) => (q ? `${u.name} ${u.email}`.toLowerCase().includes(q) : true))
      .slice(0, 8);
  }, [users, pickedSet, query]);
  const pickedUsers = useMemo(
    () =>
      [...pickedSet]
        .map((id) => users.find((u) => u.id === id))
        .filter((u): u is WorkspaceUserRow => Boolean(u)),
    [pickedSet, users],
  );
  return (
    <div className="space-y-2">
      <div className="relative">
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          placeholder="Add a member from the directory"
          disabled={disabled}
          className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-200/80"
        />
        {open && matches.length > 0 ? (
          <ul className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 max-h-60 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg ring-1 ring-black/5">
            {matches.map((u) => (
              <li key={u.id}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onChange([...selectedIds, u.id]);
                    setQuery("");
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-emerald-50/60"
                >
                  <UserDirectoryAvatar image={u.image ?? null} name={u.name} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-slate-800">{u.name}</span>
                    <span className="block truncate text-[11px] text-slate-500">{u.email}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {pickedUsers.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {pickedUsers.map((u) => {
            const isLead = u.id === alwaysIncludedId;
            return (
              <li
                key={u.id}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[12px] font-semibold",
                  isLead
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : "border-slate-200 bg-white text-slate-700",
                )}
              >
                <UserDirectoryAvatar image={u.image ?? null} name={u.name} />
                <span className="max-w-[140px] truncate">{u.name}</span>
                {isLead ? (
                  <span className="rounded bg-emerald-100 px-1.5 py-px text-[10px] uppercase tracking-wide text-emerald-800">
                    Lead
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onChange(selectedIds.filter((id) => id !== u.id))}
                    disabled={disabled}
                    className="ml-0.5 inline-flex size-4 items-center justify-center rounded-full text-slate-500 hover:bg-slate-200/70 hover:text-slate-800"
                    aria-label={`Remove ${u.name}`}
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-[11.5px] leading-snug text-slate-500">
          No members yet. Add people from the directory to put them on this team.
        </p>
      )}
    </div>
  );
}

/**
 * Small row-avatar used in the directory's Name cell. Falls back to a Lucide
 * User icon when the user has no uploaded image so old rows look unchanged
 * until someone gives them a photo.
 */
function UserDirectoryAvatar({ image, name }: { image: string | null; name: string }) {
  if (image) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img
        src={image}
        alt=""
        className="size-5 shrink-0 rounded-full object-cover ring-1 ring-slate-200"
        draggable={false}
      />
    );
  }
  const initials = avatarInitialsFromName(name);
  if (!initials) {
    return <User className="size-4 shrink-0 text-slate-500" strokeWidth={2} aria-hidden />;
  }
  return (
    <span
      className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-violet-100 text-[9px] font-bold text-violet-700 ring-1 ring-violet-200/80"
      aria-hidden
    >
      {initials}
    </span>
  );
}

function workspaceUserRequiredFieldsMessage(nameTrimmed: string, emailTrimmed: string): string | null {
  const needName = !nameTrimmed;
  const needEmail = !emailTrimmed;
  if (!needName && !needEmail) return null;
  if (needName && needEmail) return "Name and email are required.";
  if (needName) return "Name is required.";
  return "Email is required.";
}

function isSortKey(v: string): v is SortKey {
  return v === "name" || v === "email" || v === "team" || v === "permission" || v === "status";
}

function normalizeUserDirectoryColumnOrder(order: SortKey[]): SortKey[] {
  const seen = new Set<SortKey>();
  const next: SortKey[] = [];
  for (const k of order) {
    if (!seen.has(k)) {
      seen.add(k);
      next.push(k);
    }
  }
  for (const k of USER_DIRECTORY_DEFAULT_COLUMN_ORDER) {
    if (!seen.has(k)) next.push(k);
  }
  const nameIdx = next.indexOf("name");
  if (nameIdx > 0) {
    next.splice(nameIdx, 1);
    next.unshift("name");
  }
  return next;
}

function parseStoredUserDirectoryColumnOrder(raw: string | null): SortKey[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const keys = parsed.filter((x): x is SortKey => typeof x === "string" && isSortKey(x));
    if (keys.length === 0) return null;
    return normalizeUserDirectoryColumnOrder(keys);
  } catch {
    return null;
  }
}

const PERMISSION_FILTER_SUGGESTIONS = [...WORKSPACE_USER_PERMISSIONS] as const;

const cellInputCn =
  "h-9 w-full min-w-0 rounded-md border border-slate-200 bg-white px-2 text-[16px] outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-200/80 disabled:opacity-60";

function emptyForm() {
  return { name: "", email: "", team: "" as string, permission: "" as string, image: null as string | null };
}

/** Drawer field stays empty for Viewer so the placeholder shows; other roles show their value. */
function permissionToFormValue(stored: string | null | undefined): string {
  const p = (stored ?? "").trim();
  if (!p) return "";
  const match = WORKSPACE_USER_PERMISSIONS.find((x) => x.toLowerCase() === p.toLowerCase());
  if (match === "Viewer") return "";
  return match ?? p;
}

/** Choosing or typing "Viewer" clears the field so only the placeholder represents the default. */
function permissionFromPickerInput(next: string): string {
  return next.trim().toLowerCase() === "viewer" ? "" : next;
}

function teamFilterLabel(f: string): string {
  if (f === "all") return "";
  if (f === "__none__") return "Unassigned only";
  return teamLabelForWorkspaceUser(f);
}

function parseStoredExtraTeamSlugs(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const p = JSON.parse(raw) as unknown;
    if (!Array.isArray(p)) return [];
    const out = new Set<string>();
    for (const x of p) {
      if (typeof x !== "string") continue;
      const n = normalizeWorkspaceUserTeam(x);
      if (n) out.add(n);
    }
    return [...out];
  } catch {
    return [];
  }
}

function resolveTeamFilterQuery(
  q: string,
  rows: readonly WorkspaceUserRow[],
  registeredTeamSlugs: readonly string[] = [],
): string {
  const t = q.trim().toLowerCase();
  if (!t || t === "all teams" || t === "all") return "all";
  if (t === "unassigned only" || t === "unassigned") return "__none__";
  const exact = MONTH_TEAM_COLUMNS.find((c) => c.label.toLowerCase() === t);
  if (exact) return exact.id;
  const prefix = MONTH_TEAM_COLUMNS.find((c) => c.label.toLowerCase().startsWith(t));
  if (prefix) return prefix.id;
  const byId = MONTH_TEAM_COLUMNS.find((c) => c.id.toLowerCase() === t);
  if (byId) return byId.id;

  const extras: { teamId: string; label: string }[] = [];
  const seenTeam = new Set<string>();
  for (const r of rows) {
    if (!r.team || seenTeam.has(r.team)) continue;
    seenTeam.add(r.team);
    extras.push({ teamId: r.team, label: teamLabelForWorkspaceUser(r.team) });
  }
  for (const slug of registeredTeamSlugs) {
    const n = normalizeWorkspaceUserTeam(slug);
    if (!n || seenTeam.has(n)) continue;
    seenTeam.add(n);
    extras.push({ teamId: n, label: teamLabelForWorkspaceUser(n) });
  }
  for (const { teamId, label } of extras) {
    if (label.toLowerCase() === t) return teamId;
  }
  for (const { teamId, label } of [...extras].sort((a, b) => b.label.length - a.label.length)) {
    if (label.toLowerCase().startsWith(t)) return teamId;
  }
  for (const { teamId } of extras) {
    if (teamId.toLowerCase() === t) return teamId;
  }
  return "all";
}

function permissionFilterLabel(f: PermissionFilter): string {
  if (f === "all") return "";
  return f;
}

/** True when `teamId` is a custom directory team not present on any other loaded user row. */
function shouldAnnounceNewDirectoryTeam(teamId: string, knownDirectoryTeamIds: readonly string[]): boolean {
  if (!teamId || MONTH_TEAM_IDS.includes(teamId)) return false;
  return !knownDirectoryTeamIds.includes(teamId);
}

function resolvePermissionFilterQuery(q: string): PermissionFilter {
  const t = q.trim().toLowerCase();
  if (!t || t === "all permissions" || t === "all") return "all";
  const exact = WORKSPACE_USER_PERMISSIONS.find((p) => p.toLowerCase() === t);
  if (exact) return exact;
  const prefix = WORKSPACE_USER_PERMISSIONS.find((p) => p.toLowerCase().startsWith(t));
  if (prefix) return prefix;
  return "all";
}

function compareUserRows(a: WorkspaceUserRow, b: WorkspaceUserRow, key: SortKey, dir: "asc" | "desc"): number {
  const mul = dir === "asc" ? 1 : -1;
  let cmp = 0;
  if (key === "team") {
    const va = teamLabelForWorkspaceUser(a.team).toLowerCase();
    const vb = teamLabelForWorkspaceUser(b.team).toLowerCase();
    cmp = va.localeCompare(vb);
  } else {
    const va = (key === "status" ? (a.status ?? "active") : a[key]).toLowerCase();
    const vb = (key === "status" ? (b.status ?? "active") : b[key]).toLowerCase();
    cmp = va.localeCompare(vb);
  }
  if (cmp !== 0) return cmp * mul;
  return a.id.localeCompare(b.id) * mul;
}

function formatUserStatusLabel(status: string): string {
  const s = (status || "active").trim();
  if (!s) return "Active";
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function parseStoredUserDirGroupLevels(raw: string | null): UserDirectoryGroupLevel[] {
  if (!raw) return [];
  try {
    const p = JSON.parse(raw) as unknown;
    if (!Array.isArray(p)) return [];
    const picked = new Set<UserDirectoryGroupLevel>();
    for (const x of p) {
      if (x === "team" || x === "permission" || x === "status") picked.add(x);
    }
    return USER_DIRECTORY_GROUP_LEVEL_ORDER.filter((l) => picked.has(l));
  } catch {
    return [];
  }
}

function userDirectoryRowGroupKey(
  row: WorkspaceUserRow,
  level: UserDirectoryGroupLevel,
): { key: string; label: string; sort: string } {
  if (level === "team") {
    const key = row.team || "__unassigned__";
    const label = row.team ? teamLabelForWorkspaceUser(row.team) : "Unassigned";
    return { key, label, sort: label.toLowerCase() };
  }
  if (level === "permission") {
    const perm = row.permission || "Viewer";
    return { key: perm.toLowerCase(), label: perm, sort: perm.toLowerCase() };
  }
  const raw = (row.status ?? "active").trim() || "active";
  const key = raw.toLowerCase();
  const label = formatUserStatusLabel(row.status ?? "active");
  return { key, label, sort: key };
}

function UserDirectorySortTrigger({
  label,
  col,
  sort,
  onToggle,
}: {
  label: string;
  col: SortKey;
  sort: SortState;
  onToggle: (k: SortKey) => void;
}) {
  const active = sort.key === col;
  return (
    <button
      type="button"
      onClick={() => onToggle(col)}
      className="inline-flex min-w-0 items-center gap-1.5 text-[13px] font-semibold uppercase tracking-[0.02em] text-white transition hover:text-white/95"
    >
      <span className="truncate">{label}</span>
      {active ? (
        sort.dir === "asc" ? (
          <ArrowUp className="size-3.5 shrink-0 text-white" aria-hidden />
        ) : (
          <ArrowDown className="size-3.5 shrink-0 text-white" aria-hidden />
        )
      ) : (
        <ArrowUpDown className="size-3.5 shrink-0 text-white/75" aria-hidden />
      )}
    </button>
  );
}

function UserDirectoryNameHeader({
  sort,
  onToggle,
  filterSlot,
}: {
  sort: SortState;
  onToggle: (k: SortKey) => void;
  filterSlot?: ReactNode;
}) {
  return (
    <th className={cn(USER_DIR_TH_CLASS, "relative pr-9")}>
      <UserDirectorySortTrigger label={USER_DIRECTORY_COLUMN_LABELS.name} col="name" sort={sort} onToggle={onToggle} />
      {filterSlot ? (
        <span className="absolute right-2 top-1/2 -translate-y-1/2">{filterSlot}</span>
      ) : null}
    </th>
  );
}

function SortableUserDirectoryColumnHeader({
  id,
  sort,
  onToggle,
  filterSlot,
}: {
  id: Exclude<SortKey, "name">;
  sort: SortState;
  onToggle: (k: SortKey) => void;
  filterSlot?: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 2 : undefined,
  };
  const label = USER_DIRECTORY_COLUMN_LABELS[id];
  const centerHeader = id === "permission" || id === "status";
  return (
    <th ref={setNodeRef} style={style} className={cn(USER_DIR_TH_CLASS, centerHeader && "text-center", "relative pr-9")}>
      <div className={cn("flex w-full min-w-0 items-center gap-1", centerHeader && "justify-center")}>
        <button
          type="button"
          className="inline-flex h-5 w-5 shrink-0 touch-none cursor-grab items-center justify-center rounded outline-none hover:bg-[#0a8ec4]/45 active:cursor-grabbing"
          aria-label={`Drag to reorder ${label} column`}
          {...attributes}
          {...listeners}
        >
          <TableColumnDragGrip />
        </button>
        <UserDirectorySortTrigger label={label} col={id} sort={sort} onToggle={onToggle} />
      </div>
      {filterSlot ? (
        <span className="absolute right-2 top-1/2 -translate-y-1/2">{filterSlot}</span>
      ) : null}
    </th>
  );
}

function EditCommitButtons({
  disabled,
  onSave,
  onCancel,
}: {
  disabled: boolean;
  onSave: () => void | Promise<void>;
  onCancel: () => void;
}) {
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      <button
        type="button"
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          onCancel();
        }}
        className="flex size-8 items-center justify-center rounded-md text-slate-500 ring-1 ring-slate-200/90 transition hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50"
        aria-label="Cancel edit"
      >
        <X className="size-4" aria-hidden />
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          void Promise.resolve(onSave());
        }}
        className="flex size-8 items-center justify-center rounded-md bg-emerald-600 text-white shadow-sm transition hover:bg-emerald-500 disabled:opacity-50"
        aria-label="Save"
      >
        <Check className="size-4" aria-hidden />
      </button>
    </span>
  );
}

function UserDirTreeConnector({ depth }: { depth: number }) {
  if (depth <= 0) return null;
  const indentPx = 8 + depth * USER_DIRECTORY_TREE_LEVEL_STEP_PX;
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute"
      style={{
        left: Math.max(2, indentPx - 18),
        top: 0,
        bottom: "50%",
        width: 14,
        borderLeft: "1.5px solid #e2e8f0",
        borderBottom: "1.5px solid #e2e8f0",
        borderBottomLeftRadius: 3,
      }}
    />
  );
}

function UsersTableRow({
  row,
  columnOrder,
  saving,
  editField,
  onEditField,
  onCancelEdit,
  onRowView,
  onOpenTeam,
  patchUser,
  directoryTeamIds,
  nameTreeDepth = 0,
}: {
  row: WorkspaceUserRow;
  columnOrder: SortKey[];
  saving: boolean;
  editField: UserEditField | null;
  onEditField: (field: UserEditField) => void;
  onCancelEdit: () => void;
  onRowView: (row: WorkspaceUserRow) => void;
  /** Opens the team editor drawer for the given slug. */
  onOpenTeam: (slug: string) => void;
  patchUser: (
    id: string,
    body: { name?: string; email?: string; team?: string; permission?: string },
  ) => Promise<boolean>;
  directoryTeamIds: readonly string[];
  /** Nesting depth when directory is grouped (each active group level adds one step). */
  nameTreeDepth?: number;
}) {
  const treeDepth = Math.max(0, Math.floor(Number(nameTreeDepth) || 0));
  /** Table cells need inset on the `<td>`; padding on inner flex was unreliable with table-fixed + nested groups. */
  const nameTdStyle =
    treeDepth > 0
      ? ({
          paddingLeft: `${8 + treeDepth * USER_DIRECTORY_TREE_LEVEL_STEP_PX}px`,
        } as const)
      : undefined;
  const [name, setName] = useState(row.name);
  const [email, setEmail] = useState(row.email);
  const [perm, setPerm] = useState(row.permission);

  useEffect(() => {
    if (editField !== "name") setName(row.name);
  }, [row.name, row.id, editField]);

  useEffect(() => {
    if (editField !== "email") setEmail(row.email);
  }, [row.email, row.id, editField]);

  useEffect(() => {
    if (editField !== "permission") setPerm(row.permission);
  }, [row.permission, row.id, editField]);

  const saveName = async () => {
    const t = name.trim();
    if (!t) {
      toast.message("Name cannot be empty.");
      return;
    }
    if (t === row.name) {
      onCancelEdit();
      return;
    }
    const ok = await patchUser(row.id, { name: t });
    if (ok) onCancelEdit();
  };

  const saveEmail = async () => {
    const t = email.trim().toLowerCase();
    if (!t) {
      toast.message("Email cannot be empty.");
      return;
    }
    if (!t.includes("@")) {
      toast.error("Enter a valid email address.");
      return;
    }
    if (t === row.email) {
      onCancelEdit();
      return;
    }
    const ok = await patchUser(row.id, { email: t });
    if (ok) onCancelEdit();
  };

  const savePermission = async () => {
    const n = normalizeWorkspaceUserPermission(perm);
    if (n === row.permission) {
      onCancelEdit();
      return;
    }
    const ok = await patchUser(row.id, { permission: n });
    if (ok) onCancelEdit();
  };

  const editing = (f: UserEditField) => editField === f;
  const rowBusy = saving || editField != null;

  const cells: Record<SortKey, ReactNode> = {
    name: (
      <td key="name" className={cn(USER_DIR_TD_BASE, treeDepth > 0 && "relative")} style={nameTdStyle}>
        {treeDepth > 0 && <UserDirTreeConnector depth={treeDepth} />}
        {editing("name") ? (
          <div className="flex min-w-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <User className="size-4 shrink-0 text-slate-500" strokeWidth={2} aria-hidden />
            <input
              value={name}
              disabled={saving}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveName();
                if (e.key === "Escape") onCancelEdit();
              }}
              className={cn(cellInputCn, "min-w-0 flex-1 font-normal text-slate-900")}
              aria-label={`Edit name for ${row.email}`}
              autoFocus
            />
            <EditCommitButtons disabled={saving} onSave={saveName} onCancel={onCancelEdit} />
          </div>
        ) : (
          <div className="flex min-w-0 items-center gap-2.5">
            <UserDirectoryAvatar image={row.image ?? null} name={row.name} />
            <span className="min-w-0 flex-1 truncate py-1.5 pr-1 font-normal text-slate-900">{row.name}</span>
            {!saving && editField == null ? (
              <div className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                <div onClick={(e) => e.stopPropagation()}>
                  <EditRowIconButton
                    label="Edit name"
                    onClick={() => {
                      onEditField("name");
                    }}
                  />
                </div>
              </div>
            ) : null}
          </div>
        )}
      </td>
    ),
    email: (
      <td key="email" className={USER_DIR_TD_BASE}>
        {editing("email") ? (
          <div className="flex min-w-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <input
              type="email"
              value={email}
              disabled={saving}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveEmail();
                if (e.key === "Escape") onCancelEdit();
              }}
              className={cn(cellInputCn, "min-w-0 flex-1")}
              aria-label={`Edit email for ${row.name}`}
              autoFocus
            />
            <EditCommitButtons disabled={saving} onSave={saveEmail} onCancel={onCancelEdit} />
          </div>
        ) : (
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 flex-1 break-all px-1 py-1.5 text-violet-700 underline decoration-violet-200 underline-offset-2">
              {row.email}
            </span>
            {!saving && editField == null ? (
              <div className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                <div onClick={(e) => e.stopPropagation()}>
                  <EditRowIconButton label="Edit email" onClick={() => onEditField("email")} />
                </div>
              </div>
            ) : null}
          </div>
        )}
      </td>
    ),
    team: (
      <td key="team" className={USER_DIR_TD_BASE}>
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 px-1 py-1.5">
            {row.team ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenTeam(row.team);
                }}
                title={`Edit ${teamLabelForWorkspaceUser(row.team)}`}
                className={cn(
                  "inline-flex rounded-full px-2.5 py-0.5 text-[13px] font-semibold leading-tight ring-1 transition hover:brightness-95 hover:ring-2",
                  row.team === "platform" && "bg-sky-50 text-sky-800 ring-sky-200/80",
                  row.team === "experience" && "bg-violet-50 text-violet-800 ring-violet-200/80",
                  row.team === "data" && "bg-amber-50 text-amber-900 ring-amber-200/80",
                  row.team === "mobile" && "bg-emerald-50 text-emerald-800 ring-emerald-200/80",
                  row.team === "growth" && "bg-rose-50 text-rose-800 ring-rose-200/80",
                  !["platform", "experience", "data", "mobile", "growth"].includes(row.team) &&
                    "bg-slate-50 text-slate-800 ring-slate-200/80",
                )}
              >
                {teamLabelForWorkspaceUser(row.team)}
              </button>
            ) : (
              <span className="text-[13px] text-slate-400">Unassigned</span>
            )}
          </span>
        </div>
      </td>
    ),
    permission: (
      <td key="permission" className={cn(USER_DIR_TD_BASE, "text-center")}>
        {editing("permission") ? (
          <div
            className="flex min-w-0 flex-wrap items-center justify-center gap-1"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="min-w-0 w-full max-w-[240px] sm:max-w-[280px]">
              <AssigneeCombobox
                value={perm}
                onChange={setPerm}
                suggestions={WORKSPACE_USER_PERMISSIONS}
                disabled={saving}
                placeholder="Permission…"
                aria-label={`Edit permission for ${row.name}`}
                className={cellInputCn}
              />
            </div>
            <EditCommitButtons disabled={saving} onSave={savePermission} onCancel={onCancelEdit} />
          </div>
        ) : (
          <div className="flex min-w-0 items-center justify-center gap-2">
            <span className="min-w-0 truncate px-1 py-1.5 text-center font-medium text-slate-700">{row.permission}</span>
            {!saving && editField == null ? (
              <div className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                <div onClick={(e) => e.stopPropagation()}>
                  <EditRowIconButton label="Edit permission" onClick={() => onEditField("permission")} />
                </div>
              </div>
            ) : null}
          </div>
        )}
      </td>
    ),
    status: (
      <td key="status" className={cn(USER_DIR_TD_BASE, "whitespace-nowrap text-center")}>
        <span
          className="inline-flex rounded-full bg-emerald-50 px-2.5 py-0.5 text-[13px] font-semibold leading-tight text-emerald-900 ring-1 ring-emerald-200/90"
          title="Status is managed by the system"
        >
          {formatUserStatusLabel(row.status ?? "active")}
        </span>
      </td>
    ),
  };

  return (
    <tr
      data-users-zebra-row="true"
      className={cn(
        "group border-t border-[#7cd3f7]/95 text-[16px] text-slate-800 transition-colors hover:!bg-[#c5ebff]",
        saving && "opacity-70",
        !rowBusy && "cursor-pointer",
      )}
      onClick={() => {
        if (rowBusy) return;
        onRowView(row);
      }}
    >
      {columnOrder.map((col) => cells[col])}
    </tr>
  );
}

type UserPanelState = { kind: "add" } | { kind: "view"; user: WorkspaceUserRow };

/** Server-side Team row returned by `/api/teams`. Membership is implicit
 *  via `WorkspaceUser.team === Team.slug`; the lead is a direct FK. */
export type TeamRow = {
  id: string;
  slug: string;
  displayName: string;
  description: string | null;
  image: string | null;
  leadId: string | null;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
};

type TeamPanelState = { kind: "add" } | { kind: "edit" };

type TeamFormState = {
  /** Existing Team row id, or null when the editor is creating a brand-new
   *  team (Add flow, or editing a slug that has no Team row yet). */
  id: string | null;
  /** Slug the editor opened with — used to diff membership on save. Null in
   *  the pure Add flow. */
  originalSlug: string | null;
  displayName: string;
  description: string;
  image: string | null;
  leadId: string | null;
  /** Workspace-user IDs picked as members in the drawer. On Save we PATCH each
   *  user's `team` field to the team's slug (and clear removed ones). */
  memberIds: string[];
};

const emptyTeamForm: TeamFormState = {
  id: null,
  originalSlug: null,
  displayName: "",
  description: "",
  image: null,
  leadId: null,
  memberIds: [],
};

export function UsersWorkspacePanel() {
  const [rows, setRows] = useState<WorkspaceUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState("");
  const [searchSuggestOpen, setSearchSuggestOpen] = useState(false);
  const searchFieldWrapRef = useRef<HTMLDivElement>(null);
  const [teamFilter, setTeamFilter] = useState<string>("all");
  const [permissionFilter, setPermissionFilter] = useState<PermissionFilter>("all");
  const [teamFilterInput, setTeamFilterInput] = useState("");
  const [permFilterInput, setPermFilterInput] = useState("");
  // Per-column filter state — drives the new column-header filter
  // popovers. `q` (global search) still filters across all columns; these
  // narrow further per-column.
  const [nameQuery, setNameQuery] = useState("");
  const [emailQuery, setEmailQuery] = useState("");
  const [teamFilterIds, setTeamFilterIds] = useState<string[]>([]);
  const [permissionFilterIds, setPermissionFilterIds] = useState<string[]>([]);
  const [statusFilterIds, setStatusFilterIds] = useState<string[]>([]);
  const [userPanel, setUserPanel] = useState<UserPanelState | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  /**
   * Avatar editor state lives at the panel level so it survives the user
   * switching drawer modes (add ↔ view). `src` is the *unsaved* data URL of
   * the freshly picked file — once Save runs in the dialog we get back a
   * persisted URL that goes into `form.image`.
   */
  const [imageDialogSrc, setImageDialogSrc] = useState<string | null>(null);
  const handleImageFilePicked = useCallback(async (file: File) => {
    try {
      const dataUrl = await readImageFileAsDataUrl(file);
      setImageDialogSrc(dataUrl);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read image");
    }
  }, []);
  const imagePicker = useImageFilePicker(handleImageFilePicked);
  const [savingRowIds, setSavingRowIds] = useState<Set<string>>(() => new Set());
  const [editCell, setEditCell] = useState<{ rowId: string; field: UserEditField } | null>(null);
  const [sort, setSort] = useState<SortState>({ key: "name", dir: "asc" });
  const [columnOrder, setColumnOrder] = useState<SortKey[]>(() => [...USER_DIRECTORY_DEFAULT_COLUMN_ORDER]);
  const [userDrawerEntered, setUserDrawerEntered] = useState(false);
  const userDrawerCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextUserDirColumnPersist = useRef(true);
  const [registeredTeamSlugs, setRegisteredTeamSlugs] = useState<string[]>([]);
  /** Server-side teams loaded from `/api/teams`; surfaced for the drawer's
   *  members/lead derivations and the directory team picker. */
  const [teams, setTeams] = useState<TeamRow[]>([]);
  /** Side-drawer (add / view) for first-class teams — mirrors `userPanel`. */
  const [teamPanel, setTeamPanel] = useState<TeamPanelState | null>(null);
  const [teamForm, setTeamForm] = useState<TeamFormState>(emptyTeamForm);
  const [savingTeam, setSavingTeam] = useState(false);
  const [teamDrawerEntered, setTeamDrawerEntered] = useState(false);
  /** Crop / upload dialog source for the team logo — independent from the
   *  user-avatar dialog so both drawers can be open without state collision. */
  const [teamImageDialogSrc, setTeamImageDialogSrc] = useState<string | null>(null);
  const handleTeamImageFilePicked = useCallback(async (file: File) => {
    try {
      const dataUrl = await readImageFileAsDataUrl(file);
      setTeamImageDialogSrc(dataUrl);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read image");
    }
  }, []);
  const teamImagePicker = useImageFilePicker(handleTeamImageFilePicked);
  const [userDirGroupLevels, setUserDirGroupLevels] = useState<UserDirectoryGroupLevel[]>([]);
  const [userDirOpenGroups, setUserDirOpenGroups] = useState<Record<string, boolean>>({});
  const [userDirGroupMenuOpen, setUserDirGroupMenuOpen] = useState(false);
  const userDirGroupMenuRef = useRef<HTMLDivElement>(null);
  const userDirZebraTbodyRef = useRef<HTMLTableSectionElement>(null);
  const skipNextUserDirGroupPersist = useRef(true);
  const defaultUserDirGroupExpanded = true;

  const cancelDrawerClose = useCallback(() => {
    if (userDrawerCloseTimerRef.current) {
      clearTimeout(userDrawerCloseTimerRef.current);
      userDrawerCloseTimerRef.current = null;
    }
  }, []);

  const viewUser =
    userPanel?.kind === "view" ? (rows.find((r) => r.id === userPanel.user.id) ?? userPanel.user) : null;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (teamFilter !== "all") params.set("team", teamFilter);
      if (permissionFilter !== "all") params.set("permission", permissionFilter);
      const res = await fetch(`/api/workspace-users?${params.toString()}`);
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as WorkspaceUserRow[];
      setRows(data);
      notifyWorkspaceUsersChangedForSprint();
    } catch (e) {
      console.error(e);
      toast.error("Failed to load users");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [teamFilter, permissionFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Fetch first-class teams once and on demand. The drawer's saveNewTeam
   *  + member edits dispatch refreshes via the returned `loadTeams`. */
  const loadTeams = useCallback(async () => {
    try {
      const res = await fetch("/api/teams");
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as TeamRow[];
      setTeams(data);
    } catch (e) {
      console.error(e);
      // Teams are optional infra (the directory still works without them);
      // log but don't blast a toast on every mount.
    }
  }, []);

  useEffect(() => {
    void loadTeams();
  }, [loadTeams]);

  /** Open the team editor for a given slug. Looks up the first-class Team row;
   *  if none exists yet (built-in delivery teams, legacy localStorage teams)
   *  the editor opens in "create on save" mode pre-filled from the slug, with
   *  members derived from users already carrying that slug. */
  const openTeamEditorBySlug = useCallback(
    (slug: string) => {
      const normalized = normalizeWorkspaceUserTeam(slug);
      if (!normalized) return;
      const existing = teams.find((t) => t.slug === normalized) ?? null;
      const memberRows = rows.filter((r) => r.team === normalized);
      setTeamForm({
        id: existing?.id ?? null,
        originalSlug: normalized,
        displayName: existing?.displayName ?? teamLabelForWorkspaceUser(normalized),
        description: existing?.description ?? "",
        image: existing?.image ?? null,
        leadId: existing?.leadId ?? null,
        memberIds: memberRows.map((r) => r.id),
      });
      setTeamPanel({ kind: "edit" });
    },
    [teams, rows],
  );

  useEffect(() => {
    const stored = parseStoredUserDirectoryColumnOrder(
      localStorage.getItem(USERS_DIRECTORY_COLUMN_ORDER_STORAGE_KEY),
    );
    if (stored) setColumnOrder(stored);
  }, []);

  useEffect(() => {
    setRegisteredTeamSlugs(parseStoredExtraTeamSlugs(localStorage.getItem(USERS_DIRECTORY_EXTRA_TEAMS_STORAGE_KEY)));
  }, []);

  useEffect(() => {
    const stored = parseStoredUserDirGroupLevels(localStorage.getItem(USERS_DIRECTORY_GROUP_LEVELS_STORAGE_KEY));
    if (stored.length > 0) setUserDirGroupLevels(stored);
  }, []);

  useEffect(() => {
    if (skipNextUserDirGroupPersist.current) {
      skipNextUserDirGroupPersist.current = false;
      return;
    }
    localStorage.setItem(USERS_DIRECTORY_GROUP_LEVELS_STORAGE_KEY, JSON.stringify(userDirGroupLevels));
  }, [userDirGroupLevels]);

  useEffect(() => {
    if (!userDirGroupMenuOpen) return;
    const fn = (e: MouseEvent) => {
      if (userDirGroupMenuRef.current?.contains(e.target as Node)) return;
      setUserDirGroupMenuOpen(false);
    };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, [userDirGroupMenuOpen]);

  const persistRegisteredTeamSlugs = useCallback((next: string[]) => {
    const merged = [...new Set(next.filter(Boolean))];
    localStorage.setItem(USERS_DIRECTORY_EXTRA_TEAMS_STORAGE_KEY, JSON.stringify(merged));
    setRegisteredTeamSlugs(merged);
  }, []);

  useEffect(() => {
    if (skipNextUserDirColumnPersist.current) {
      skipNextUserDirColumnPersist.current = false;
      return;
    }
    localStorage.setItem(USERS_DIRECTORY_COLUMN_ORDER_STORAGE_KEY, JSON.stringify(columnOrder));
  }, [columnOrder]);

  useEffect(() => {
    setTeamFilterInput(teamFilterLabel(teamFilter));
  }, [teamFilter]);

  useEffect(() => {
    setPermFilterInput(permissionFilterLabel(permissionFilter));
  }, [permissionFilter]);

  useLayoutEffect(() => {
    if (!userPanel) {
      setUserDrawerEntered(false);
      return;
    }
    cancelDrawerClose();
    setUserDrawerEntered(false);
    let alive = true;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (alive) setUserDrawerEntered(true);
      });
    });
    return () => {
      alive = false;
    };
  }, [userPanel, cancelDrawerClose]);

  useEffect(() => {
    return () => {
      if (userDrawerCloseTimerRef.current) clearTimeout(userDrawerCloseTimerRef.current);
    };
  }, []);

  const toggleSort = useCallback((key: SortKey) => {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  }, []);

  const toggleUserDirGroupLevel = useCallback((level: UserDirectoryGroupLevel) => {
    setUserDirGroupLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return USER_DIRECTORY_GROUP_LEVEL_ORDER.filter((l) => next.has(l));
    });
  }, []);

  const userDirGroupSummaryLabel = useMemo(
    () =>
      userDirGroupLevels.length === 0
        ? "None"
        : userDirGroupLevels.map((l) => USER_DIRECTORY_GROUP_LEVEL_LABELS[l]).join(" · "),
    [userDirGroupLevels],
  );

  const userDirColumnDragSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleUserDirectoryColumnDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const aid = active.id as SortKey;
    const oid = over.id as SortKey;
    if (aid === "name" || oid === "name") return;
    setColumnOrder((prev) => {
      const oldIndex = prev.indexOf(aid);
      const newIndex = prev.indexOf(oid);
      if (oldIndex < 0 || newIndex < 0) return prev;
      return normalizeUserDirectoryColumnOrder(arrayMove(prev, oldIndex, newIndex));
    });
  }, []);

  const patchUser = useCallback(
    async (id: string, body: { name?: string; email?: string; team?: string; permission?: string }) => {
      if (Object.keys(body).length === 0) return true;
      setSavingRowIds((s) => new Set(s).add(id));
      try {
        const res = await fetch(`/api/workspace-users/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await res.json()) as { error?: string } & Partial<WorkspaceUserRow>;
        if (!res.ok) {
          throw new Error(data.error ?? res.statusText);
        }
        const updated = data as WorkspaceUserRow;
        setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...updated } : r)));
        notifyWorkspaceUsersChangedForSprint();
        return true;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Update failed");
        await load();
        return false;
      } finally {
        setSavingRowIds((s) => {
          const n = new Set(s);
          n.delete(id);
          return n;
        });
      }
    },
    [load],
  );

  const q = searchText.trim().toLowerCase();
  const nameQ = nameQuery.trim().toLowerCase();
  const emailQ = emailQuery.trim().toLowerCase();
  const displayed = useMemo(() => {
    return rows.filter((r) => {
      // Global text search — name, email, team, permission, status.
      if (q) {
        const inGlobal =
          r.name.toLowerCase().includes(q) ||
          r.email.toLowerCase().includes(q) ||
          r.permission.toLowerCase().includes(q) ||
          teamLabelForWorkspaceUser(r.team).toLowerCase().includes(q) ||
          (r.status ?? "active").toLowerCase().includes(q);
        if (!inGlobal) return false;
      }
      // Per-column text searches.
      if (nameQ && !r.name.toLowerCase().includes(nameQ)) return false;
      if (emailQ && !r.email.toLowerCase().includes(emailQ)) return false;
      // Per-column multi-selects (empty array = no filter).
      if (teamFilterIds.length > 0) {
        const teamId = normalizeWorkspaceUserTeam(r.team) ?? "__none__";
        if (!teamFilterIds.includes(teamId)) return false;
      }
      if (permissionFilterIds.length > 0 && !permissionFilterIds.includes(r.permission)) return false;
      if (statusFilterIds.length > 0 && !statusFilterIds.includes(r.status ?? "active")) return false;
      return true;
    });
  }, [rows, q, nameQ, emailQ, teamFilterIds, permissionFilterIds, statusFilterIds]);

  const sortedRows = useMemo(() => {
    const list = [...displayed];
    list.sort((a, b) => compareUserRows(a, b, sort.key, sort.dir));
    return list;
  }, [displayed, sort]);

  const directoryTeamIds = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) {
      if (r.team) s.add(r.team);
    }
    // First-class teams loaded from `/api/teams` — their slug shows up in
    // the picker even when they have no members yet.
    for (const t of teams) {
      if (t.slug) s.add(t.slug);
    }
    for (const slug of registeredTeamSlugs) {
      const n = normalizeWorkspaceUserTeam(slug);
      if (n) s.add(n);
    }
    return [...s];
  }, [rows, teams, registeredTeamSlugs]);

  /** Team slug → logo URL, for showing a team's image (instead of the generic
   *  group icon) on the grouped-by-team header rows. */
  const teamImageBySlug = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of teams) {
      if (t.slug && t.image) m.set(t.slug, t.image);
    }
    return m;
  }, [teams]);

  const userDirectoryTableRows = useMemo(() => {
    const renderLeaf = (list: WorkspaceUserRow[], nameTreeDepth: number) =>
      list.map((row) => (
        <UsersTableRow
          key={row.id}
          row={row}
          columnOrder={columnOrder}
          saving={savingRowIds.has(row.id)}
          editField={editCell?.rowId === row.id ? editCell.field : null}
          onEditField={(field) => setEditCell({ rowId: row.id, field })}
          onCancelEdit={() => setEditCell(null)}
          onRowView={(r) => {
            setEditCell(null);
            cancelDrawerClose();
            setForm({
              name: r.name,
              email: r.email,
              team: r.team,
              permission: permissionToFormValue(r.permission),
              image: r.image ?? null,
            });
            setUserPanel({ kind: "view", user: r });
          }}
          onOpenTeam={openTeamEditorBySlug}
          patchUser={patchUser}
          directoryTeamIds={directoryTeamIds}
          nameTreeDepth={nameTreeDepth}
        />
      ));

    const renderTree = (list: WorkspaceUserRow[], levelIndex: number, path: string): ReactNode => {
      if (userDirGroupLevels.length === 0) return renderLeaf(list, 0);
      if (levelIndex >= userDirGroupLevels.length) {
        return renderLeaf(list, userDirGroupLevels.length);
      }
      const level = userDirGroupLevels[levelIndex];
      const groups = new Map<string, { label: string; sort: string; rows: WorkspaceUserRow[] }>();
      for (const row of list) {
        const { key, label, sort: sortKey } = userDirectoryRowGroupKey(row, level);
        if (!groups.has(key)) groups.set(key, { label, sort: sortKey, rows: [] });
        groups.get(key)!.rows.push(row);
      }
      return (
        <>
          {Array.from(groups.entries())
            .sort((a, b) => a[1].sort.localeCompare(b[1].sort))
            .map(([key, g]) => {
              const folderId = `${path}/${level}:${encodeURIComponent(key)}`;
              const isOpen = userDirOpenGroups[folderId] ?? defaultUserDirGroupExpanded;
              const indent = 8 + levelIndex * USER_DIRECTORY_TREE_LEVEL_STEP_PX;
              return (
                <Fragment key={folderId}>
                  <tr
                    data-users-zebra-row="true"
                    className="border-t border-[#7cd3f7]/95 text-[15px] text-slate-800 transition-colors hover:!bg-[#c5ebff]"
                  >
                    <td colSpan={columnOrder.length} className={cn("px-2 py-2.5", levelIndex > 0 && "relative")}>
                      {levelIndex > 0 && <UserDirTreeConnector depth={levelIndex} />}
                      <button
                        type="button"
                        className="flex min-w-0 max-w-full items-center gap-1.5 text-left font-semibold text-slate-800"
                        style={{ paddingLeft: indent }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setUserDirOpenGroups((prev) => ({
                            ...prev,
                            [folderId]: !(prev[folderId] ?? defaultUserDirGroupExpanded),
                          }));
                        }}
                      >
                        {isOpen ? (
                          <ChevronDown className="size-4 shrink-0 self-center text-slate-600" aria-hidden />
                        ) : (
                          <ChevronRight className="size-4 shrink-0 self-center text-slate-600" aria-hidden />
                        )}
                        {level === "team" && teamImageBySlug.has(key) ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={teamImageBySlug.get(key)!}
                            alt=""
                            className="size-4 shrink-0 self-center rounded-[5px] object-cover ring-1 ring-slate-200"
                          />
                        ) : (
                          <span className="flex size-4 shrink-0 items-center justify-center text-slate-500 [&_svg]:size-4">
                            {userDirectoryGroupLevelIcon(level)}
                          </span>
                        )}
                        <span className="flex shrink-0 items-center leading-none text-slate-600">
                          {USER_DIRECTORY_GROUP_LEVEL_LABELS[level]}:
                        </span>
                        <span className="min-w-0 truncate leading-none">{g.label}</span>
                        <span className="flex shrink-0 items-center text-[12px] font-normal tabular-nums leading-none text-slate-500">
                          ({g.rows.length})
                        </span>
                      </button>
                    </td>
                  </tr>
                  {isOpen ? renderTree(g.rows, levelIndex + 1, folderId) : null}
                </Fragment>
              );
            })}
        </>
      );
    };

    return userDirGroupLevels.length === 0 ? (
      <>{renderLeaf(sortedRows, 0)}</>
    ) : (
      <>{renderTree(sortedRows, 0, "root")}</>
    );
  }, [
    sortedRows,
    userDirGroupLevels,
    userDirOpenGroups,
    columnOrder,
    savingRowIds,
    editCell,
    patchUser,
    directoryTeamIds,
    cancelDrawerClose,
    openTeamEditorBySlug,
    teamImageBySlug,
  ]);

  useLayoutEffect(() => {
    const root = userDirZebraTbodyRef.current;
    if (!root) return;
    const rowEls = Array.from(root.querySelectorAll<HTMLElement>('[data-users-zebra-row="true"]'));
    rowEls.forEach((el, idx) => {
      el.style.backgroundColor = idx % 2 === 0 ? TABLE_ZEBRA_STRIPE_BG : TABLE_ZEBRA_BASE_BG;
    });
  }, [userDirectoryTableRows, loading, columnOrder]);

  const teamFilterSuggestions = useMemo(() => {
    const base = MONTH_TEAM_COLUMNS.map((c) => c.label);
    const seen = new Set(base.map((l) => l.toLowerCase()));
    const rest: string[] = [];
    for (const r of rows) {
      if (!r.team) continue;
      const lab = teamLabelForWorkspaceUser(r.team);
      if (lab === "—") continue;
      const k = lab.toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        rest.push(lab);
      }
    }
    for (const slug of registeredTeamSlugs) {
      const lab = teamLabelForWorkspaceUser(slug);
      if (lab === "—") continue;
      const k = lab.toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        rest.push(lab);
      }
    }
    rest.sort((a, b) => a.localeCompare(b));
    return [...base, ...rest, "Unassigned only"];
  }, [rows, registeredTeamSlugs]);

  const nameSuggestions = useMemo(() => {
    const s = new Set<string>();
    for (const r of displayed.slice(0, 40)) s.add(r.name);
    return [...s].sort();
  }, [displayed]);

  const closeSearchSuggestions = useCallback(() => {
    setSearchSuggestOpen(false);
  }, []);

  const handleDirectorySearchBlur = useCallback((event: FocusEvent<HTMLInputElement>) => {
    const next = event.relatedTarget as Node | null;
    if (next && searchFieldWrapRef.current?.contains(next)) return;
    window.requestAnimationFrame(() => {
      const active = document.activeElement;
      if (searchFieldWrapRef.current?.contains(active)) return;
      setSearchSuggestOpen(false);
    });
  }, []);

  const closePanel = useCallback(() => {
    if (!userPanel) {
      cancelDrawerClose();
      return;
    }
    setUserDrawerEntered(false);
    cancelDrawerClose();
    userDrawerCloseTimerRef.current = setTimeout(() => {
      userDrawerCloseTimerRef.current = null;
      setUserPanel(null);
      setForm(emptyForm());
      setUserDrawerEntered(false);
    }, 300);
  }, [userPanel, cancelDrawerClose]);

  const openCreate = () => {
    cancelDrawerClose();
    setForm(emptyForm());
    setUserPanel({ kind: "add" });
  };

  // ──────── Team drawer: helpers + slide-in animation ────────
  /** Close the team side-drawer with a brief slide-out animation matching
   *  the user drawer. */
  const closeTeamPanel = useCallback(() => {
    setTeamDrawerEntered(false);
    setTimeout(() => {
      setTeamPanel(null);
      setTeamForm(emptyTeamForm);
    }, 250);
  }, []);

  useLayoutEffect(() => {
    if (!teamPanel) {
      setTeamDrawerEntered(false);
      return;
    }
    setTeamDrawerEntered(false);
    let alive = true;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (alive) setTeamDrawerEntered(true);
      });
    });
    return () => {
      alive = false;
    };
  }, [teamPanel]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (teamPanel) {
        if (savingTeam) return;
        closeTeamPanel();
        return;
      }
      if (editCell) {
        setEditCell(null);
        return;
      }
      if (userPanel) {
        if (saving) return;
        closePanel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [teamPanel, savingTeam, closeTeamPanel, editCell, userPanel, saving, closePanel]);

  const handleSearchKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Escape" && searchSuggestOpen) {
        event.preventDefault();
        setSearchSuggestOpen(false);
      }
    },
    [searchSuggestOpen],
  );

  const saveNewUser = async () => {
    blurActiveField();
    const name = form.name.trim();
    const email = form.email.trim().toLowerCase();
    const requiredMsg = workspaceUserRequiredFieldsMessage(name, email);
    if (requiredMsg) {
      toast.message(requiredMsg);
      return;
    }
    if (!email.includes("@")) {
      toast.error("Enter a valid email address.");
      return;
    }
    const permission = normalizeWorkspaceUserPermission(form.permission);
    const nextTeam = normalizeWorkspaceUserTeam(form.team || "");
    const announceNewTeam = shouldAnnounceNewDirectoryTeam(nextTeam, directoryTeamIds);
    setSaving(true);
    try {
      const res = await fetch("/api/workspace-users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          team: nextTeam,
          permission,
          image: form.image,
        }),
      });
      const err = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      toast.success(
        announceNewTeam ? `User added · New team: ${teamLabelForWorkspaceUser(nextTeam)}` : "User added",
      );
      closePanel();
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const saveEditedUser = async () => {
    if (!viewUser) return;
    blurActiveField();
    const name = form.name.trim();
    const email = form.email.trim().toLowerCase();
    const requiredMsg = workspaceUserRequiredFieldsMessage(name, email);
    if (requiredMsg) {
      toast.message(requiredMsg);
      return;
    }
    if (!email.includes("@")) {
      toast.error("Enter a valid email address.");
      return;
    }
    const permission = normalizeWorkspaceUserPermission(form.permission);
    const body: { name?: string; email?: string; team?: string; permission?: string; image?: string | null } = {};
    if (name !== viewUser.name) body.name = name;
    if (email !== viewUser.email) body.email = email;
    const nextTeam = normalizeWorkspaceUserTeam(form.team || "");
    const prevTeamNorm = normalizeWorkspaceUserTeam(viewUser.team || "");
    const teamChanged = nextTeam !== prevTeamNorm;
    if (teamChanged) body.team = nextTeam;
    if (permission !== normalizeWorkspaceUserPermission(viewUser.permission)) {
      body.permission = permission;
    }
    // Compare against viewUser.image (may be undefined on older payloads) —
    // include when changed (covers both upload-new and clear-existing).
    const priorImage = viewUser.image ?? null;
    if ((form.image ?? null) !== priorImage) {
      body.image = form.image;
    }
    const announceNewTeam =
      teamChanged && shouldAnnounceNewDirectoryTeam(nextTeam, directoryTeamIds);
    if (Object.keys(body).length === 0) {
      closePanel();
      return;
    }
    setSaving(true);
    try {
      const ok = await patchUser(viewUser.id, body);
      if (ok) {
        toast.success(
          announceNewTeam
            ? `User updated · New team: ${teamLabelForWorkspaceUser(nextTeam)}`
            : "User updated",
        );
        closePanel();
      }
    } finally {
      setSaving(false);
    }
  };

  // ──────── Team drawer: save / delete ────────
  /** Create or update a Team row, then reconcile membership: every picked
   *  member (plus the lead) gets `team = slug`; anyone who was a member of the
   *  original slug but isn't picked anymore gets cleared. Slug is the single
   *  source of truth for membership. */
  const saveTeam = useCallback(async () => {
    blurActiveField();
    const displayName = teamForm.displayName.trim();
    if (!displayName) {
      toast.message("Enter a team name.");
      return;
    }
    const slug = normalizeWorkspaceUserTeam(displayName);
    if (!slug) {
      toast.error("Could not derive a valid team identifier.");
      return;
    }
    setSavingTeam(true);
    try {
      const payload = {
        displayName,
        description: teamForm.description.trim() || null,
        image: teamForm.image,
        leadId: teamForm.leadId,
      };
      const res = await fetch(
        teamForm.id ? `/api/teams/${teamForm.id}` : "/api/teams",
        {
          method: teamForm.id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((body as { error?: string }).error ?? res.statusText);
      }
      // Desired final roster (lead always included).
      const desired = new Set(teamForm.memberIds);
      if (teamForm.leadId) desired.add(teamForm.leadId);
      // Members who carried the original slug before this edit. After a
      // rename PATCH the server already moved them onto the new slug, so we
      // only need to (a) set newly-added members and (b) clear removed ones.
      const originalMemberIds = teamForm.originalSlug
        ? rows.filter((r) => r.team === teamForm.originalSlug).map((r) => r.id)
        : [];
      const originalSet = new Set(originalMemberIds);
      const toAssign = [...desired].filter((id) => !originalSet.has(id));
      const toClear = originalMemberIds.filter((id) => !desired.has(id));
      await Promise.all([
        ...toAssign.map((id) =>
          fetch(`/api/workspace-users/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ team: slug }),
          }),
        ),
        ...toClear.map((id) =>
          fetch(`/api/workspace-users/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ team: "" }),
          }),
        ),
      ]);
      // Backward compat: existing pickers also read the localStorage registry.
      persistRegisteredTeamSlugs([...registeredTeamSlugs, slug]);
      toast.success(teamForm.id ? `Team “${displayName}” updated.` : `Team “${displayName}” created.`);
      closeTeamPanel();
      await Promise.all([load(), loadTeams()]);
      refreshTeamImages();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSavingTeam(false);
    }
  }, [teamForm, closeTeamPanel, load, loadTeams, persistRegisteredTeamSlugs, registeredTeamSlugs, rows]);

  /** Delete the team row. Members keep their slug (so a re-add recovers them)
   *  unless the user explicitly detaches — we keep it simple and just drop the
   *  Team row, leaving membership intact. */
  const deleteTeam = useCallback(async () => {
    if (!teamForm.id) {
      // Nothing persisted yet — just close.
      closeTeamPanel();
      return;
    }
    if (!window.confirm(`Delete team “${teamForm.displayName}”? Members keep their assignment unless you change them.`)) {
      return;
    }
    setSavingTeam(true);
    try {
      const res = await fetch(`/api/teams/${teamForm.id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? res.statusText);
      }
      toast.success(`Team “${teamForm.displayName}” deleted.`);
      closeTeamPanel();
      await Promise.all([load(), loadTeams()]);
      refreshTeamImages();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setSavingTeam(false);
    }
  }, [teamForm, closeTeamPanel, load, loadTeams]);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {/* Hidden file picker shared by Add User + Edit User drawers — kept here
       *  so both Avatar fields can trigger the same input regardless of which
       *  drawer is open. */}
      {imagePicker.input}
      {teamImagePicker.input}
      <EditImageDialog
        open={teamImageDialogSrc != null}
        src={teamImageDialogSrc}
        uploadUrl="/api/uploads/team-image"
        onClose={() => setTeamImageDialogSrc(null)}
        onPickAnother={() => teamImagePicker.trigger()}
        onSave={(url) => {
          setTeamForm((f) => ({ ...f, image: url }));
          setTeamImageDialogSrc(null);
        }}
      />
      <EditImageDialog
        open={imageDialogSrc != null}
        src={imageDialogSrc}
        onClose={() => setImageDialogSrc(null)}
        onPickAnother={() => imagePicker.trigger()}
        onSave={(url) => {
          setForm((f) => ({ ...f, image: url }));
          setImageDialogSrc(null);
        }}
      />
      <div className="min-h-0 min-w-0 flex-1 overflow-x-auto [scrollbar-gutter:stable]">
        <div
          className="box-border flex h-full min-h-0 w-full min-w-full flex-col gap-5 p-6 pb-0.5 sm:p-8 sm:pb-1"
          style={{ minWidth: `max(100%, ${USER_DIRECTORY_MIN_LAYOUT_WIDTH_PX}px)` }}
        >
      <header className="flex shrink-0 flex-col gap-4 border-b border-slate-200/90 pb-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight text-slate-900">
            <span
              className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700 ring-1 ring-violet-200/80"
              aria-hidden
            >
              <Users className="size-5" />
            </span>
            Users Directory
          </h1>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setTeamForm(emptyTeamForm);
              setTeamPanel({ kind: "add" });
            }}
            className="h-8 shrink-0 gap-1.5 px-3 text-[13px] font-semibold"
          >
            <Users className="size-3.5" aria-hidden />
            Add Team
          </Button>
          <Button type="button" size="sm" onClick={openCreate} className="h-8 shrink-0 gap-1.5 px-3 text-[13px] font-bold">
            <User className="size-3.5" aria-hidden />
            Add User
          </Button>
        </div>
      </header>

      <div className="shrink-0 rounded-t-xl bg-gradient-to-r from-sky-100 via-indigo-100 to-violet-100 px-4 pb-7 pt-7 shadow-[inset_0_2px_6px_-2px_rgba(15,23,42,0.18),inset_0_-1px_3px_-1px_rgba(15,23,42,0.10),0_1px_3px_0_rgba(148,163,184,0.20)]">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:gap-3">
        <div className="flex min-w-0 w-full flex-1 flex-col gap-1.5 lg:max-w-md">
          <div ref={searchFieldWrapRef} className="relative min-w-0 w-full">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-slate-500"
            aria-hidden
          />
          <input
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            onFocus={() => setSearchSuggestOpen(true)}
            onBlur={handleDirectorySearchBlur}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search name, email, team, or permission…"
            className="h-8 w-full rounded-lg border border-slate-300 bg-white pl-10 pr-3 text-[14px] text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-violet-300 focus:ring-2 focus:ring-violet-200/80"
            aria-label="Search users"
            aria-controls="users-directory-name-suggestions"
            aria-expanded={searchSuggestOpen && nameSuggestions.length > 0}
            aria-autocomplete="list"
            aria-haspopup="listbox"
            role="combobox"
            // `autoComplete="off"` is ignored by Chrome for inputs it
            // detects as part of a profile form. A non-standard token
            // defeats the heuristic — Chrome leaves the field alone.
            autoComplete="new-search"
            name="users-directory-search"
          />
          {searchSuggestOpen && nameSuggestions.length > 0 ? (
            <div
              id="users-directory-name-suggestions"
              role="listbox"
              className="absolute left-0 right-0 top-full z-[70] mt-1 max-h-60 overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg ring-1 ring-slate-200/90"
            >
              {nameSuggestions.map((n) => (
                <button
                  key={n}
                  type="button"
                  role="option"
                  className="flex w-full items-center px-3 py-2 text-left text-[14px] text-slate-800 hover:bg-slate-50"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setSearchText(n);
                    closeSearchSuggestions();
                  }}
                >
                  {n}
                </button>
              ))}
            </div>
          ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex shrink-0 flex-col gap-1.5" ref={userDirGroupMenuRef}>
            <div className="relative">
            <button
              type="button"
              onClick={() => setUserDirGroupMenuOpen((prev) => !prev)}
              className="flex h-8 min-w-[11rem] items-center justify-between rounded-lg border border-slate-300 bg-gradient-to-b from-indigo-50 to-violet-50 px-2.5 text-[13px] transition hover:from-indigo-100 hover:to-violet-100 focus:border-violet-300 focus:outline-none focus:ring-2 focus:ring-violet-200/80"
            >
              <span className="inline-flex items-center gap-1.5 font-semibold text-slate-700">
                <Layers3 className="size-3.5 shrink-0 text-indigo-500/90" strokeWidth={2} aria-hidden />
                Group by
              </span>
              <span className="ml-1 flex max-w-[7rem] items-center justify-end truncate font-medium leading-none text-slate-600">
                {userDirGroupSummaryLabel}
              </span>
            </button>
            {userDirGroupMenuOpen ? (
              <div className="absolute left-0 z-20 mt-1 w-56 rounded-lg border border-slate-100 bg-white p-2 shadow-lg">
                {USER_DIRECTORY_GROUP_LEVEL_ORDER.map((level) => {
                  const checked = userDirGroupLevels.includes(level);
                  return (
                    <label
                      key={level}
                      className="mb-1 flex cursor-pointer items-center gap-2 rounded px-1.5 py-1.5 text-[13px] text-slate-700 last:mb-0"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleUserDirGroupLevel(level)}
                        className="h-3.5 w-3.5 shrink-0 rounded border-slate-300 accent-violet-600"
                      />
                      <span className="flex size-4 shrink-0 items-center justify-center text-slate-500 [&_svg]:size-3.5">
                        {userDirectoryGroupLevelIcon(level, "menu")}
                      </span>
                      <span className="flex items-center leading-none">
                        {USER_DIRECTORY_GROUP_LEVEL_LABELS[level]}
                      </span>
                    </label>
                  );
                })}
              </div>
            ) : null}
            </div>
          </div>
        </div>
      </div>
      </div>

      <div className="-mt-5 min-h-0 flex-1 overflow-hidden rounded-b-xl border border-slate-200/60 bg-white shadow-[inset_0_2px_6px_-2px_rgba(15,23,42,0.18),inset_0_-1px_3px_-1px_rgba(15,23,42,0.10),0_1px_3px_0_rgba(148,163,184,0.20)]">
        <div className="h-full min-h-0 overflow-auto text-[16px]">
          <DndContext
            sensors={userDirColumnDragSensors}
            collisionDetection={closestCenter}
            onDragEnd={handleUserDirectoryColumnDragEnd}
          >
            <table className="w-full min-w-[640px] table-fixed border-collapse text-left">
              <colgroup>
                {columnOrder.map((key) => (
                  <col key={key} className={USER_DIRECTORY_COL_WIDTH_CLASS[key]} />
                ))}
              </colgroup>
              <SortableContext
                items={columnOrder.filter((k) => k !== "name")}
                strategy={horizontalListSortingStrategy}
              >
                <thead className="sticky top-0 z-10 border-b border-[#19abeb]/70 bg-[#0897d5] shadow-[0_1px_0_rgba(15,23,42,0.04)]">
                  <tr>
                    {columnOrder.map((key) => {
                      // Build the per-column filter slot. Text columns
                      // (name, email) get a search input; categorical
                      // columns (team, permission, status) get a checklist.
                      let filterSlot: ReactNode = null;
                      if (key === "name") {
                        filterSlot = (
                          <UserDirColumnFilterDropdown
                            title="Filter User Name"
                            isActive={Boolean(nameQuery)}
                            onClear={() => setNameQuery("")}
                            align="left"
                          >
                            <div className="relative">
                              <Search className="pointer-events-none absolute left-2 top-1/2 z-10 size-3.5 -translate-y-1/2 text-slate-400" />
                              <input
                                value={nameQuery}
                                onChange={(e) => setNameQuery(e.target.value)}
                                placeholder="Search name…"
                                autoComplete="off"
                                className="h-8 w-full rounded-md border border-slate-300 bg-white pl-7 pr-2 text-[13px] text-slate-900 outline-none placeholder:text-slate-400 transition focus:border-violet-300 focus:ring-2 focus:ring-violet-200/80"
                              />
                            </div>
                          </UserDirColumnFilterDropdown>
                        );
                      } else if (key === "email") {
                        filterSlot = (
                          <UserDirColumnFilterDropdown
                            title="Filter Email"
                            isActive={Boolean(emailQuery)}
                            onClear={() => setEmailQuery("")}
                          >
                            <div className="relative">
                              <Search className="pointer-events-none absolute left-2 top-1/2 z-10 size-3.5 -translate-y-1/2 text-slate-400" />
                              <input
                                value={emailQuery}
                                onChange={(e) => setEmailQuery(e.target.value)}
                                placeholder="Search email…"
                                autoComplete="off"
                                className="h-8 w-full rounded-md border border-slate-300 bg-white pl-7 pr-2 text-[13px] text-slate-900 outline-none placeholder:text-slate-400 transition focus:border-violet-300 focus:ring-2 focus:ring-violet-200/80"
                              />
                            </div>
                          </UserDirColumnFilterDropdown>
                        );
                      } else if (key === "team") {
                        filterSlot = (
                          <UserDirColumnFilterDropdown
                            title="Filter Team"
                            isActive={teamFilterIds.length > 0}
                            onClear={() => setTeamFilterIds([])}
                          >
                            <UserDirCheckList
                              options={directoryTeamIds.map((id) => ({ id, label: teamLabelForWorkspaceUser(id) }))}
                              selected={teamFilterIds}
                              onChange={setTeamFilterIds}
                              emptyHint="All teams"
                            />
                          </UserDirColumnFilterDropdown>
                        );
                      } else if (key === "permission") {
                        filterSlot = (
                          <UserDirColumnFilterDropdown
                            title="Filter Permission"
                            isActive={permissionFilterIds.length > 0}
                            onClear={() => setPermissionFilterIds([])}
                          >
                            <UserDirCheckList
                              options={WORKSPACE_USER_PERMISSIONS.map((p) => ({ id: p, label: p }))}
                              selected={permissionFilterIds}
                              onChange={setPermissionFilterIds}
                              emptyHint="All permissions"
                            />
                          </UserDirColumnFilterDropdown>
                        );
                      } else if (key === "status") {
                        filterSlot = (
                          <UserDirColumnFilterDropdown
                            title="Filter Status"
                            isActive={statusFilterIds.length > 0}
                            onClear={() => setStatusFilterIds([])}
                          >
                            <UserDirCheckList
                              options={[
                                { id: "active", label: "Active" },
                                { id: "inactive", label: "Inactive" },
                              ]}
                              selected={statusFilterIds}
                              onChange={setStatusFilterIds}
                              emptyHint="All statuses"
                            />
                          </UserDirColumnFilterDropdown>
                        );
                      }
                      return key === "name" ? (
                        <UserDirectoryNameHeader key={key} sort={sort} onToggle={toggleSort} filterSlot={filterSlot} />
                      ) : (
                        <SortableUserDirectoryColumnHeader key={key} id={key} sort={sort} onToggle={toggleSort} filterSlot={filterSlot} />
                      );
                    })}
                  </tr>
                </thead>
              </SortableContext>
              <tbody ref={userDirZebraTbodyRef} className="bg-white">
            {loading ? (
              <tr>
                <td colSpan={columnOrder.length} className="px-4 py-16 text-center text-slate-500">
                  Loading users…
                </td>
              </tr>
            ) : sortedRows.length === 0 ? (
              <tr>
                <td colSpan={columnOrder.length} className="px-4 py-16 text-center text-slate-500">
                  No users match the current filters.
                </td>
              </tr>
            ) : (
              userDirectoryTableRows
            )}
              </tbody>
            </table>
          </DndContext>
        </div>
      </div>

      <p className="shrink-0 text-center text-[12px] text-slate-500">
        Showing {sortedRows.length} of {rows.length} loaded
        {teamFilter !== "all" || permissionFilter !== "all" ? " (server-filtered)" : ""}
        {q ? " · search narrows further in the browser" : ""}
        {` · sorted by ${sort.key} (${sort.dir})`}
        {userDirGroupLevels.length > 0 ? ` · grouped by ${userDirGroupSummaryLabel}` : ""}
      </p>
        </div>
      </div>

      {userPanel ? (
        <div className="fixed inset-0 z-[100] flex justify-end">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/30 backdrop-blur-[1px]"
            aria-label="Close panel"
            onClick={closePanel}
          />
          <div
            className={cn(
              "relative flex h-full w-full max-w-2xl flex-col overflow-hidden border-l border-slate-200/90 bg-white shadow-2xl ring-1 ring-black/[0.06] transition-transform duration-300 ease-out rounded-l-xl",
              userDrawerEntered ? "translate-x-0" : "translate-x-full",
            )}
            role="dialog"
            aria-modal="true"
            aria-labelledby="users-drawer-title"
          >
            {userPanel.kind === "add" ? (
              <>
                {/* Header — soft gradient + larger badge + subtitle for a more
                    polished, "directory product" feel. The bottom shadow line
                    replaces the hard border for a softer edge. */}
                <div className="relative flex shrink-0 flex-col border-b border-slate-200/80 bg-gradient-to-br from-violet-50 via-indigo-50 to-sky-50">
                  <div className="flex items-start justify-between gap-3 px-6 py-5">
                    <div className="flex min-w-0 flex-1 items-start gap-3.5">
                      <span
                        className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-md shadow-violet-300/60 ring-1 ring-white"
                        aria-hidden
                      >
                        <UserPlus className="size-5" strokeWidth={2.2} />
                      </span>
                      <div className="min-w-0">
                        <h2 id="users-drawer-title" className="text-[20px] font-bold tracking-tight text-slate-900">
                          Add User
                        </h2>
                        <p className="mt-0.5 text-[12.5px] leading-snug text-slate-600">
                          Create a new directory entry. They&rsquo;ll be linked automatically when they sign up with the same email.
                        </p>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={closePanel}
                      aria-label="Close panel"
                      disabled={saving}
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                </div>
                {/* `<form>` wrapper scopes Chrome's autofill to *this* drawer
                 *  so picking a saved Name suggestion no longer spills the
                 *  paired email into the directory search field behind. The
                 *  submit handler also gives Enter-to-save in the form. */}
                <form
                  className="flex min-h-0 flex-1 flex-col overflow-hidden"
                  autoComplete="off"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!saving) void saveNewUser();
                  }}
                >
                  <div className="flex-1 overflow-y-auto px-6 py-5">
                    <div className="w-full max-w-[440px] space-y-5">
                      <AvatarField
                        name={form.name}
                        image={form.image}
                        onPick={imagePicker.trigger}
                        onClear={() => setForm((f) => ({ ...f, image: null }))}
                        onDropFile={handleImageFilePicked}
                        disabled={saving}
                      />
                      {/* Profile section */}
                      <div className="space-y-1">
                        <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-500">Profile</p>
                        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
                          <label className="block">
                            <span className={USER_DRAWER_FIELD_LABEL_CLASS}>
                              Name{" "}
                              <span className="font-semibold text-red-600" title="Required">
                                *
                              </span>
                            </span>
                            <input
                              value={form.name}
                              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                              className="h-10 w-full rounded-lg border border-slate-200 px-3 text-[13px] outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-200/80"
                              autoComplete="name"
                              placeholder="e.g. Alice Cohen"
                              required
                              aria-required="true"
                            />
                          </label>
                          <label className="block">
                            <span className={USER_DRAWER_FIELD_LABEL_CLASS}>
                              Email{" "}
                              <span className="font-semibold text-red-600" title="Required">
                                *
                              </span>
                            </span>
                            <input
                              type="email"
                              value={form.email}
                              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                              className="h-10 w-full rounded-lg border border-slate-200 px-3 text-[13px] outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-200/80"
                              autoComplete="email"
                              placeholder="alice@company.com"
                              required
                              aria-required="true"
                            />
                          </label>
                        </div>
                      </div>
                      {/* Access section */}
                      <div className="space-y-1">
                        <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-500">Access</p>
                        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
                          <div className="block">
                            <span className={USER_DRAWER_FIELD_LABEL_CLASS}>Team (optional)</span>
                            <TeamIdCombobox
                              teamId={form.team}
                              onTeamIdChange={(id) => setForm((f) => ({ ...f, team: id }))}
                              disabled={saving}
                              placeholder="Pick a team or create new (optional)"
                              className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-200/80"
                              allowCustomTeam
                              extraTeamIds={directoryTeamIds}
                            />
                          </div>
                          <div className="block">
                            <span className={USER_DRAWER_FIELD_LABEL_CLASS}>Permission (optional)</span>
                            <AssigneeCombobox
                              value={form.permission}
                              onChange={(permission) =>
                                setForm((f) => ({ ...f, permission: permissionFromPickerInput(permission) }))
                              }
                              suggestions={WORKSPACE_USER_PERMISSIONS}
                              disabled={saving}
                              placeholder="Viewer"
                              aria-label="Permission"
                              className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-200/80"
                            />
                            <p className="mt-1 text-[11px] leading-snug text-slate-500">
                              Defaults to Viewer. Change later anytime from the directory row.
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-white px-6 py-4">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9 min-w-[100px] gap-1.5 px-4 text-sm font-medium"
                      onClick={closePanel}
                      disabled={saving}
                    >
                      <X className="size-3.5" aria-hidden />
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      size="sm"
                      className="h-9 min-w-[120px] gap-1.5 bg-gradient-to-r from-violet-600 to-indigo-600 px-4 text-sm font-semibold text-white shadow-sm shadow-violet-500/25 hover:from-violet-500 hover:to-indigo-500 disabled:opacity-50"
                      disabled={saving}
                    >
                      <UserPlus className="size-3.5" aria-hidden />
                      {saving ? "Saving…" : "Add User"}
                    </Button>
                  </div>
                </form>
              </>
            ) : viewUser ? (
              <>
                <div className="flex shrink-0 flex-col border-b border-slate-200 bg-slate-50">
                  <div className="flex items-center justify-between gap-3 px-5 py-4">
                    <div className="flex min-w-0 flex-1 items-center gap-2.5">
                      <span
                        className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700 ring-1 ring-violet-200/80"
                        aria-hidden
                      >
                        <UserPen className="size-4" strokeWidth={2} />
                      </span>
                      <div className="min-w-0 text-left">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 id="users-drawer-title" className="text-xl font-semibold tracking-tight text-slate-900">
                            Edit User
                          </h2>
                          <span
                            className="inline-flex rounded-full bg-emerald-50 px-2.5 py-0.5 text-[13px] font-semibold text-emerald-900 ring-1 ring-emerald-200/90"
                            aria-label={`Account status: ${formatUserStatusLabel(viewUser.status ?? "active")}`}
                          >
                            {formatUserStatusLabel(viewUser.status ?? "active")}
                          </span>
                        </div>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={closePanel}
                      aria-label="Close panel"
                      disabled={saving}
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                </div>
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                  <div className="flex-1 overflow-y-auto p-5">
                    <div className="w-full max-w-[400px] space-y-4">
                      <AvatarField
                        name={form.name}
                        image={form.image}
                        onPick={imagePicker.trigger}
                        onClear={() => setForm((f) => ({ ...f, image: null }))}
                        onDropFile={handleImageFilePicked}
                        disabled={saving}
                      />
                      <label className="block">
                        <span className={USER_DRAWER_FIELD_LABEL_CLASS}>
                          Name{" "}
                          <span className="font-semibold text-red-600" title="Required">
                            *
                          </span>
                        </span>
                        <input
                          value={form.name}
                          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                          className="h-10 w-full rounded-lg border border-slate-200 px-3 text-[13px] outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-200/80"
                          autoComplete="name"
                          required
                          aria-required="true"
                        />
                      </label>
                      <label className="block">
                        <span className={USER_DRAWER_FIELD_LABEL_CLASS}>
                          Email{" "}
                          <span className="font-semibold text-red-600" title="Required">
                            *
                          </span>
                        </span>
                        <input
                          type="email"
                          value={form.email}
                          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                          className="h-10 w-full rounded-lg border border-slate-200 px-3 text-[13px] outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-200/80"
                          autoComplete="email"
                          required
                          aria-required="true"
                        />
                      </label>
                      <div className="block">
                        <span className={USER_DRAWER_FIELD_LABEL_CLASS}>Team (optional)</span>
                        <TeamIdCombobox
                          teamId={form.team}
                          onTeamIdChange={(id) => setForm((f) => ({ ...f, team: id }))}
                          disabled={saving}
                          placeholder="Pick a team or create new (optional)"
                          className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-200/80"
                          allowCustomTeam
                          extraTeamIds={directoryTeamIds}
                        />
                      </div>
                      <div className="block">
                        <span className={USER_DRAWER_FIELD_LABEL_CLASS}>Permission (optional)</span>
                        <AssigneeCombobox
                          value={form.permission}
                          onChange={(permission) =>
                            setForm((f) => ({ ...f, permission: permissionFromPickerInput(permission) }))
                          }
                          suggestions={WORKSPACE_USER_PERMISSIONS}
                          disabled={saving}
                          placeholder="Viewer"
                          aria-label="Permission"
                          className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-200/80"
                        />
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-white px-5 py-4">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 min-w-[100px] px-4 text-sm font-medium"
                      onClick={closePanel}
                      disabled={saving}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      className="h-8 min-w-[100px] gap-1.5 bg-gradient-to-r from-violet-600 to-indigo-600 px-4 text-sm font-semibold text-white shadow-sm shadow-violet-500/25 hover:from-violet-500 hover:to-indigo-500 disabled:opacity-50"
                      onClick={() => void saveEditedUser()}
                      disabled={saving}
                    >
                      {saving ? "Saving…" : "Save"}
                    </Button>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {teamPanel ? (
        <div className="fixed inset-0 z-[100] flex justify-end">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/30 backdrop-blur-[1px]"
            aria-label="Close panel"
            onClick={closeTeamPanel}
          />
          <div
            className={cn(
              "relative flex h-full w-full max-w-2xl flex-col overflow-hidden border-l border-slate-200/90 bg-white shadow-2xl ring-1 ring-black/[0.06] transition-transform duration-300 ease-out rounded-l-xl",
              teamDrawerEntered ? "translate-x-0" : "translate-x-full",
            )}
            role="dialog"
            aria-modal="true"
            aria-labelledby="teams-drawer-title"
          >
            {teamPanel.kind === "add" || teamPanel.kind === "edit" ? (
              <>
                <div className="relative flex shrink-0 flex-col border-b border-slate-200/80 bg-gradient-to-br from-emerald-50 via-sky-50 to-indigo-50">
                  <div className="flex items-start justify-between gap-3 px-6 py-5">
                    <div className="flex min-w-0 flex-1 items-start gap-3.5">
                      <span
                        className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-500 to-sky-600 text-white shadow-md shadow-emerald-300/60 ring-1 ring-white"
                        aria-hidden
                      >
                        {teamForm.image ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img src={teamForm.image} alt="" className="size-full object-cover" />
                        ) : (
                          <Users className="size-5" strokeWidth={2.2} />
                        )}
                      </span>
                      <div className="min-w-0">
                        <h2 id="teams-drawer-title" className="text-[20px] font-bold tracking-tight text-slate-900">
                          {teamPanel.kind === "edit" ? "Edit Team" : "Add Team"}
                        </h2>
                        <p className="mt-0.5 text-[12.5px] leading-snug text-slate-600">
                          {teamPanel.kind === "edit"
                            ? "Update the logo, lead, and members. Renaming the team keeps every member attached."
                            : "Create a team. Add a logo, pick a lead, and invite members from your directory."}
                        </p>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={closeTeamPanel}
                      aria-label="Close panel"
                      disabled={savingTeam}
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                </div>
                <form
                  className="flex min-h-0 flex-1 flex-col overflow-hidden"
                  autoComplete="off"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!savingTeam) void saveTeam();
                  }}
                >
                  <div className="flex-1 overflow-y-auto px-6 py-5">
                    <div className="w-full max-w-[460px] space-y-5">
                      <TeamLogoField
                        name={teamForm.displayName}
                        image={teamForm.image}
                        onPick={teamImagePicker.trigger}
                        onClear={() => setTeamForm((f) => ({ ...f, image: null }))}
                        onDropFile={handleTeamImageFilePicked}
                        disabled={savingTeam}
                      />
                      <div className="space-y-1">
                        <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-500">Team</p>
                        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
                          <label className="block">
                            <span className={USER_DRAWER_FIELD_LABEL_CLASS}>
                              Name{" "}
                              <span className="font-semibold text-red-600" title="Required">
                                *
                              </span>
                            </span>
                            <input
                              value={teamForm.displayName}
                              onChange={(e) => setTeamForm((f) => ({ ...f, displayName: e.target.value }))}
                              className="h-10 w-full rounded-lg border border-slate-200 px-3 text-[13px] outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-200/80"
                              placeholder="e.g. Design Ops"
                              required
                              aria-required="true"
                            />
                          </label>
                          <label className="block">
                            <span className={USER_DRAWER_FIELD_LABEL_CLASS}>Description (optional)</span>
                            <textarea
                              value={teamForm.description}
                              onChange={(e) => setTeamForm((f) => ({ ...f, description: e.target.value }))}
                              className="min-h-[64px] w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-200/80"
                              placeholder="What this team is responsible for."
                              rows={2}
                            />
                          </label>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-500">People</p>
                        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
                          <div className="block">
                            <span className={USER_DRAWER_FIELD_LABEL_CLASS}>Team lead (optional)</span>
                            <TeamUserSinglePicker
                              users={rows}
                              value={teamForm.leadId}
                              onChange={(id) => setTeamForm((f) => ({ ...f, leadId: id }))}
                              placeholder="Pick a lead from the directory"
                              disabled={savingTeam}
                            />
                            <p className="mt-1 text-[11px] leading-snug text-slate-500">
                              The lead is automatically added to the team&rsquo;s members.
                            </p>
                          </div>
                          <div className="block">
                            <span className={USER_DRAWER_FIELD_LABEL_CLASS}>Members (optional)</span>
                            <TeamMembersPicker
                              users={rows}
                              selectedIds={teamForm.memberIds}
                              onChange={(ids) => setTeamForm((f) => ({ ...f, memberIds: ids }))}
                              alwaysIncludedId={teamForm.leadId}
                              disabled={savingTeam}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-white px-6 py-4">
                    {teamPanel.kind === "edit" && teamForm.id ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="mr-auto h-9 gap-1.5 px-3 text-sm font-medium text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                        onClick={() => void deleteTeam()}
                        disabled={savingTeam}
                      >
                        <X className="size-3.5" aria-hidden />
                        Delete team
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9 min-w-[100px] gap-1.5 px-4 text-sm font-medium"
                      onClick={closeTeamPanel}
                      disabled={savingTeam}
                    >
                      <X className="size-3.5" aria-hidden />
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      size="sm"
                      className="h-9 min-w-[120px] gap-1.5 bg-gradient-to-r from-emerald-600 to-sky-600 px-4 text-sm font-semibold text-white shadow-sm shadow-emerald-500/25 hover:from-emerald-500 hover:to-sky-500 disabled:opacity-50"
                      disabled={savingTeam}
                    >
                      <Users className="size-3.5" aria-hidden />
                      {savingTeam ? "Saving…" : teamPanel.kind === "edit" ? "Save changes" : "Add Team"}
                    </Button>
                  </div>
                </form>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
