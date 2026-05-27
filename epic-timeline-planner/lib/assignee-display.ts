/**
 * Short display form for an assignee name on compact chips / cards:
 * "Avi Horowitz" → "Avi H.". Single-name people are returned unchanged.
 * Keeps the chip narrow so several stories can sit side-by-side without
 * truncating. The full name still drives tooltip + avatar lookup, so
 * the accessible name is preserved at the call sites.
 */
export function formatAssigneeShortLabel(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return fullName.trim();
  const first = parts[0];
  const lastInitial = parts[parts.length - 1][0];
  if (!lastInitial) return first;
  return `${first} ${lastInitial.toUpperCase()}.`;
}
