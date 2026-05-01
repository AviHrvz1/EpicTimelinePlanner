export const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export const FULL_MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export const QUARTERS = [
  { label: "Q1", months: [1, 2, 3] },
  { label: "Q2", months: [4, 5, 6] },
  { label: "Q3", months: [7, 8, 9] },
  { label: "Q4", months: [10, 11, 12] },
] as const;

/** Encoded in `quarter-capacity:` drop targets when the portfolio shows all months at once. */
export const ALL_QUARTERS_TEAM_CAPACITY_LABEL = "All quarters";

export const ALL_YEAR_PLAN_MONTHS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export function clampMonth(month: number): number {
  return Math.max(1, Math.min(12, month));
}

export function monthRange(startMonth: number, endMonth: number): number[] {
  const start = clampMonth(startMonth);
  const end = clampMonth(endMonth);
  if (start > end) return [];
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}
