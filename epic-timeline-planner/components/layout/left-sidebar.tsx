"use client";

import Image from "next/image";
import {
  Clock,
  HelpCircle,
  LayoutGrid,
  LineChart,
  Map as MapIcon,
  Settings,
  Users,
} from "lucide-react";

import { cn } from "@/lib/utils";

type TopMode = "roadmap" | "backlog" | "dashboard" | "users" | "demoBuilder" | "timeDebugger";

/**
 * Fixed vertical nav rail anchored to the left edge of the viewport.
 * Mirrors the topMode switcher with icon buttons; the logo at the top
 * doubles as a "back to roadmap" home button.
 */
export function LeftSidebar({
  topMode,
  onSelectMode,
  onLogoClick,
}: {
  topMode: TopMode;
  onSelectMode: (mode: TopMode) => void;
  onLogoClick?: () => void;
}) {
  return (
    <aside
      className="fixed inset-y-0 left-0 z-40 flex w-[64px] shrink-0 flex-col items-center gap-2 border-r border-slate-200/80 bg-white/95 py-3 shadow-[2px_0_12px_-6px_rgba(15,23,42,0.10)] backdrop-blur"
      aria-label="Primary navigation"
    >
      <button
        type="button"
        onClick={onLogoClick}
        title="Bird Eye Viewer — back to roadmap"
        aria-label="Back to roadmap"
        className="group inline-flex size-[44px] shrink-0 items-center justify-center rounded-xl transition-transform hover:scale-[1.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
      >
        <Image
          src="/downloads/Logo-simple.png"
          alt="Bird Eye Viewer"
          width={1024}
          height={1024}
          priority
          quality={100}
          sizes="40px"
          className="block size-[40px] shrink-0"
        />
      </button>

      <div className="mt-2 flex flex-col items-center gap-1.5">
        <NavItem
          icon={<MapIcon className="size-5" strokeWidth={1.9} />}
          label="Roadmap"
          active={topMode === "roadmap"}
          onClick={() => onSelectMode("roadmap")}
        />
        <NavItem
          icon={<LayoutGrid className="size-5" strokeWidth={1.9} />}
          label="Dashboard"
          active={topMode === "dashboard"}
          onClick={() => onSelectMode("dashboard")}
        />
        <NavItem
          icon={<Users className="size-5" strokeWidth={1.9} />}
          label="Users"
          active={topMode === "users"}
          onClick={() => onSelectMode("users")}
        />
        <NavItem
          icon={<LineChart className="size-5" strokeWidth={1.9} />}
          label="Backlog"
          active={topMode === "backlog"}
          onClick={() => onSelectMode("backlog")}
        />
        <NavItem
          icon={<Clock className="size-5" strokeWidth={1.9} />}
          label="Time debugger"
          active={topMode === "timeDebugger"}
          onClick={() => onSelectMode("timeDebugger")}
        />
        <NavItem
          icon={<Settings className="size-5" strokeWidth={1.9} />}
          label="Demo builder"
          active={topMode === "demoBuilder"}
          onClick={() => onSelectMode("demoBuilder")}
        />
      </div>

      <div className="mt-auto flex flex-col items-center gap-1.5">
        <NavItem
          icon={<HelpCircle className="size-5" strokeWidth={1.9} />}
          label="Help"
          active={false}
          onClick={() => {}}
          disabled
        />
      </div>
    </aside>
  );
}

function NavItem({
  icon,
  label,
  active,
  onClick,
  disabled = false,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "inline-flex size-[40px] items-center justify-center rounded-xl transition outline-none",
        "focus-visible:ring-2 focus-visible:ring-indigo-300",
        active
          ? "bg-indigo-50 text-indigo-600 ring-1 ring-indigo-200/80"
          : "text-slate-500 hover:bg-slate-100 hover:text-slate-800",
        disabled && "cursor-not-allowed opacity-40 hover:bg-transparent hover:text-slate-500",
      )}
    >
      {icon}
    </button>
  );
}
