"use client";

import { Check, X } from "lucide-react";

import {
  PASSWORD_CRITERIA,
  PASSWORD_STRENGTH_COLORS,
  type PasswordCriterionKey,
  scorePassword,
} from "@/lib/password-strength";
import { cn } from "@/lib/utils";

/**
 * Live password-strength meter — a 4-segment bar + criteria checklist. Pure component:
 * given the current password string, renders the result of `scorePassword()`. The server
 * uses the same scorer (lib/password-strength.ts) so what the user sees here matches what
 * the server enforces.
 */
export function PasswordStrengthMeter({ password }: { password: string }) {
  const strength = scorePassword(password);
  const segments = [1, 2, 3, 4] as const;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        {segments.map((segment) => {
          const filled = strength.score >= segment;
          const color = filled
            ? PASSWORD_STRENGTH_COLORS[strength.score]
            : PASSWORD_STRENGTH_COLORS[0];
          return (
            <span
              key={segment}
              className={cn(
                "h-1.5 flex-1 rounded-full transition-colors",
                color,
              )}
              aria-hidden
            />
          );
        })}
        <span
          className={cn(
            "ml-2 min-w-[3.5rem] text-right text-[11px] font-semibold tabular-nums",
            strength.acceptable ? "text-emerald-600" : "text-slate-500",
          )}
          aria-live="polite"
        >
          {strength.label}
        </span>
      </div>

      <ul className="space-y-1 text-[12px] text-slate-500">
        {(Object.keys(PASSWORD_CRITERIA) as PasswordCriterionKey[]).map((key) => {
          const passed = strength.passed.includes(key);
          return (
            <li
              key={key}
              className={cn(
                "flex items-center gap-1.5",
                passed ? "text-emerald-600" : "text-slate-400",
              )}
            >
              {passed ? (
                <Check className="size-3.5 shrink-0" strokeWidth={2.5} />
              ) : (
                <X className="size-3.5 shrink-0" strokeWidth={2} />
              )}
              <span>{PASSWORD_CRITERIA[key]}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
