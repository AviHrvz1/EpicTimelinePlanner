"use client";

import { useMemo } from "react";

import { commentDisplayHtml } from "@/lib/rich-comment-html";
import { cn } from "@/lib/utils";

export function RichCommentBody({ body, className }: { body: string; className?: string }) {
  const html = useMemo(() => commentDisplayHtml(body), [body]);
  if (!html) return null;
  return (
    <div
      className={cn(
        "rich-comment-body text-[13px] text-slate-800 [&_a]:text-blue-600 [&_a]:underline [&_blockquote]:my-1 [&_blockquote]:border-l-2 [&_blockquote]:border-slate-300 [&_blockquote]:pl-2 [&_img]:max-h-48 [&_img]:max-w-full [&_img]:rounded [&_ol]:my-1 [&_p]:my-1 [&_ul]:my-1",
        className,
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
