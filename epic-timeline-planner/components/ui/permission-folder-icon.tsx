"use client";

import { ShieldUser } from "lucide-react";

import { cn } from "@/lib/utils";

/** Access / role grouping — used in users directory tree and available for reuse. */
export function PermissionFolderIcon({ className }: { className?: string }) {
  return <ShieldUser className={cn("size-4 shrink-0 text-slate-500", className)} strokeWidth={2} aria-hidden />;
}
