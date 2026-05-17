/**
 * Pure password-strength scoring used by BOTH the live UI meter (signup / reset pages)
 * and the server-side validator in lib/auth.ts. Keeping a single source of truth means
 * the meter you see while typing matches exactly what the server enforces.
 *
 * Score range: 0 (empty/weak) → 4 (strong). Minimum acceptable: 3.
 *
 * Criteria (each contributes one point):
 *   1. ≥ 10 characters (the hard floor; without this the score is capped at 1)
 *   2. Contains both lowercase + uppercase letters
 *   3. Contains at least one digit
 *   4. Contains at least one symbol (anything not [A-Za-z0-9])
 */

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MIN_SCORE = 3;

export type PasswordCriterionKey =
  | "length"
  | "mixedCase"
  | "digit"
  | "symbol";

export type PasswordStrength = {
  score: 0 | 1 | 2 | 3 | 4;
  label: "Too short" | "Weak" | "Fair" | "Good" | "Strong";
  /** Subset of criteria keys that the password currently SATISFIES. */
  passed: PasswordCriterionKey[];
  /** Subset of criteria keys the password is STILL MISSING (UI shows as unchecked). */
  missing: PasswordCriterionKey[];
  /** True when score ≥ PASSWORD_MIN_SCORE; the server uses this to accept/reject. */
  acceptable: boolean;
};

/**
 * Human-readable strings for each criterion — used by the UI checklist below the meter.
 * Kept here so any future label changes update both the UI and any docs that quote them.
 */
export const PASSWORD_CRITERIA: Record<PasswordCriterionKey, string> = {
  length: `At least ${PASSWORD_MIN_LENGTH} characters`,
  mixedCase: "Uppercase and lowercase letters",
  digit: "At least one number",
  symbol: "At least one symbol (e.g. !@#$%)",
};

/** Single source of truth for the meter bar's per-segment color. Index = score. */
export const PASSWORD_STRENGTH_COLORS: Readonly<Record<PasswordStrength["score"], string>> = {
  0: "bg-slate-200",
  1: "bg-red-500",
  2: "bg-orange-500",
  3: "bg-amber-500",
  4: "bg-emerald-500",
};

export function scorePassword(password: string): PasswordStrength {
  const passed: PasswordCriterionKey[] = [];

  if (password.length >= PASSWORD_MIN_LENGTH) passed.push("length");
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) passed.push("mixedCase");
  if (/\d/.test(password)) passed.push("digit");
  if (/[^A-Za-z0-9]/.test(password)) passed.push("symbol");

  // Length is a hard floor — if the password is too short we cap the displayed score at 1.
  // Otherwise the meter could read "Good" for a 6-char string that hits 3 of the other criteria.
  let score = passed.length as PasswordStrength["score"];
  if (!passed.includes("length") && score > 1) score = 1;
  if (password.length === 0) score = 0;

  const label: PasswordStrength["label"] = (() => {
    if (password.length === 0) return "Too short";
    if (!passed.includes("length")) return "Too short";
    if (score <= 1) return "Weak";
    if (score === 2) return "Fair";
    if (score === 3) return "Good";
    return "Strong";
  })();

  const missing = (Object.keys(PASSWORD_CRITERIA) as PasswordCriterionKey[]).filter(
    (key) => !passed.includes(key),
  );

  return {
    score,
    label,
    passed,
    missing,
    acceptable: score >= PASSWORD_MIN_SCORE,
  };
}
