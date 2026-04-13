import { GripVertical } from "lucide-react";

import { cn } from "@/lib/utils";

const sizeClass = {
  sm: "size-3.5",
  md: "size-4",
} as const;

/** Minimal drag affordance (no boxed grid). Parent should add padding / hover styles. */
export function DragHandleIcon({
  className,
  size = "md",
  onDark,
}: {
  className?: string;
  size?: keyof typeof sizeClass;
  /** For use on dark / saturated backgrounds. */
  onDark?: boolean;
}) {
  return (
    <GripVertical
      className={cn(
        sizeClass[size],
        "shrink-0",
        onDark ? "text-white/85" : "text-slate-400",
        className,
      )}
      strokeWidth={2}
      aria-hidden
    />
  );
}
