import type { ReactNode } from "react";

/**
 * Flat row-descriptor model for the backlog table.
 *
 * The current rendering pipeline (`renderGroupedTree` and friends) builds
 * a deeply nested JSX tree where folder rows contain their child rows
 * directly. For virtualization (and for any "only render what's visible"
 * optimization), we need a flat ordered list of "things to render", with
 * each item knowing how to render its own row.
 *
 * This module owns the type contract. The walker function that produces
 * descriptors and the per-kind renderers live in
 * `backlog-planning-panel.tsx` next to the existing render functions,
 * because they need access to ~30 closure variables (edit state,
 * callbacks, helpers). Once the descriptor model is fully wired we can
 * promote them here too.
 */

/**
 * Discriminates the kind of row a descriptor renders. Used by the
 * virtualizer to pick the right estimated height and (later) by visual
 * regression test traversal.
 */
export type RowDescriptorKind =
  | "groupFolder"     // Roadmap / Year / Quarter / Sprint group header.
  | "initiative"      // Initiative-level folder row (under a group or at top level).
  | "epic"            // Epic-level folder row (under an initiative).
  | "story"           // Leaf user-story row.
  | "createForm"      // Inline create-row form (appears mid-tree when "+" is clicked).
  | "emptyState"      // "No stories in this sprint" / empty-folder placeholder.
  | "standaloneInit"  // Initiative with no stories (under the standalone path).
  | "standaloneEpic"; // Epic under a standalone-init (rendered with no nested stories).

/**
 * Approximate row height used to estimate the total scroll area before
 * the virtualizer measures real heights. Per-kind so the scrollbar
 * doesn't jump when the virtualizer first reaches a row with a different
 * natural height than the default estimate.
 */
export const ROW_ESTIMATED_HEIGHTS: Record<RowDescriptorKind, number> = {
  groupFolder: 42,
  initiative: 46,
  epic: 42,
  story: 38,
  createForm: 52,
  emptyState: 38,
  standaloneInit: 46,
  standaloneEpic: 42,
};

export type RowDescriptor = {
  /** Stable identity for React's key and for the virtualizer's reorder
   *  detection. Built from kind + entity-id + grouping path so the same
   *  entity in different group buckets gets distinct descriptors. */
  key: string;
  kind: RowDescriptorKind;
  /** Px height hint for the virtualizer's `estimateSize`. */
  estimatedHeight: number;
  /** Returns the row's JSX. Called only when the row is in the visible
   *  window (or pinned via `rangeExtractor` for an edited/dragged row).
   *  Captures the per-row context via closure. */
  render: () => ReactNode;
};
