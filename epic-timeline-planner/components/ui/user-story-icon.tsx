"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";

type UserStoryIconProps = {
  className?: string;
};

export function UserStoryIcon({ className }: UserStoryIconProps) {
  return (
    <Image
      src="/user-story-icon-app-v2.png"
      alt=""
      width={16}
      height={16}
      className={cn("size-4 shrink-0 select-none", className)}
      aria-hidden
    />
  );
}
