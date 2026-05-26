# Backlog Virtualization — chunked plan

> **Resume protocol:** A new session should read this file FIRST to find the next `TODO` chunk and start there. After each chunk, update its status to `DONE` and add notes about what was actually done + any decisions/deviations.
>
> **Branch:** `perf/backlog-virtualization`
> **Goal:** Drop Group By toggle from ~3s `reactCommit` to ~150-300ms by only mounting the ~30 visible rows instead of all 500.
> **Library:** `@tanstack/react-virtual` (already installed in `epic-timeline-planner/`).
> **Architecture:** flatten-then-virtualize — walk the grouped tree once into a flat `RowDescriptor[]`, virtualize the array.

---

## Why this is the only path that fixes Group By

The diagnostic probes shipped in `e32d9e0` proved:

- Data-shaping `useMemo`s: ~10ms total per Group By click.
- JSX tree construction: ~10-200ms.
- **React reconciliation + DOM mutations: 2.2-3.6 seconds.** This is 500 rows × 16 cells = ~8000 DOM nodes torn down under their old parent folders and rebuilt under new ones. No amount of `React.memo` helps — the rows are being **mounted fresh**, not re-rendered.

The 2024-2025 consensus for tables of this size (Linear, Notion-style apps, every TanStack Table example past 50 rows): flatten the tree, virtualize the flat list. See the research notes baked into [`#research-notes`](#research-notes) below.

---

## Chunks

### Chunk 1 — Descriptor types + walker  **STATUS: DONE**

**Done in commit (this chunk):**
- New file `components/backlog/backlog-row-descriptors.ts` with `RowDescriptor` type, `RowDescriptorKind` union, and `ROW_ESTIMATED_HEIGHTS` per-kind defaults.
- Walker functions inside the panel (next to `renderGroupedTree`): `buildBacklogRowDescriptors`, `walkGroupedTreeIntoDescriptors`, `walkLeafRowsIntoDescriptors`, `walkStandaloneInitiativeRowsIntoDescriptors`. Each mirrors the bucketing / sorting / open-folder logic of its counterpart renderer so descriptor order matches existing visual order. Edge cases handled: roadmap seeding, Q1-Q4 + Unscheduled seeding, quarter fan-out for standalone initiatives spanning quarters, Epic-only flatten.
- For chunk 1, every descriptor's `render()` returns `null` (placeholder). Chunk 2 wires real per-row JSX.
- Walker is called in parallel with the existing render in the grouped path; the count logs to console as `[virt] grouped descriptors: N`. Build time logs as `↳ buildDescriptors (grouped)` in the latency popup.
- Visual: zero change (descriptors aren't used for rendering yet).

**Goal:** Have a working `buildBacklogRowDescriptors()` function that walks the grouped tree exactly the way the current renderers do, but emits a flat `RowDescriptor[]` instead of nested JSX. **Not yet used for rendering** — pure prep.

**Output:**
- New file `components/backlog/backlog-row-descriptors.ts` (or types co-located with the panel; whichever fits cleaner) with:
  ```ts
  type RowDescriptorKind =
    | "groupFolder"
    | "initiative"
    | "epic"
    | "story"
    | "createForm"
    | "emptyState";
  type RowDescriptor = {
    key: string;          // stable per row identity (storyId, epicId, folderId+kind)
    kind: RowDescriptorKind;
    estimatedHeight: number;
    render: () => React.ReactNode;
  };
  ```
- A `buildBacklogRowDescriptors(args): RowDescriptor[]` function that takes the same inputs as `renderGroupedTree` (rows, standaloneRows, levelIndex, path) and emits descriptors. Each descriptor's `render()` closure captures the per-row context.
- Wire it in alongside the existing render: call it, `console.log` the count, but still render via the old path. Zero visual change. This proves the walker enumerates correctly.

**Acceptance:** Compile clean, console shows a sensible count per filter change, no visual regression.

---

### Chunk 2 — Render from descriptors (non-virtualized)  **STATUS: DONE**

**Done in this chunk's commit:**
- Walker fully captures per-descriptor data (folder icons/actions, init/epic/story row data, indents). `render()` thunks now return real JSX.
- Per-row descriptors:
  - `groupFolder` → `renderFolderRow(... () => null)`. Quarter-level "+" form becomes a sibling `createForm` descriptor emitted right after the folder.
  - `initiative` → `renderInitiativeRow(... () => null)`. The init's own create-row form (when active) still renders inside the init's wrapper div — automatic via the existing renderer body.
  - `epic` → `renderEpicRow(... () => null)`. Epic's own create-row form renders inside the epic wrapper — automatic.
  - `story` → `<BacklogStoryRow row={row} indentPx={indentPx} isEditing… ctx={storyRowCtx} />` directly.
  - `standaloneInit` → `renderStandaloneInitiativeRows([init], indentPx)` — full unit in non-Epic-only mode (giving up per-epic flattening; standalone inits are a small subset).
  - `standaloneEpic` (Epic-only only) → `renderStandaloneInitiativeRows([{...init, epics: [oneEpic]}], indentPx)` — leverages the existing renderer's Epic-only `hidden` class on the init folder so per-epic descriptors don't visually duplicate.
- Grouped-path call site now uses `descriptors.map((d) => <Fragment key={d.key}>{d.render()}</Fragment>)`. Phase `renderFromDescriptors (grouped)` shows up in the latency popup alongside the existing `buildDescriptors (grouped)`.

**Known visual deltas vs main (to revisit in chunk 6 polish if they matter):**
- The subtle `bg-slate-50/50` gray tint that used to wrap nested epic rows under an initiative is gone, because nested children are now sibling descriptors not children of the init wrapper. Connector lines + indent are still per-row so the tree is still readable.
- DOM has an extra wrapping `<div>` per non-story descriptor (the existing `renderFolderRow` / `renderEpicRow` / `renderInitiativeRow` `<div key={folderId}>` outer). Cosmetic — no layout change.

**Behavioral verification needed (run before chunk 3):**
- Open/close every folder level → all descriptors update correctly.
- Click "+" at each level (quarter, initiative, epic) → create form appears at right position.
- Edit story title/cell → only that row re-renders (memo intact via `BacklogStoryRow`).
- Rename a roadmap → inline input shows in folder header.
- Search → search-matching highlight still works.
- Toggle every Work Item filter combination → grouped path uses descriptors; non-grouped still uses old rendering (chunks 6).

**Goal:** Replace the grouped-tree JSX with `descriptors.map(d => d.render())`. Still rendering ALL rows. **This forces the walker to be correct before adding virtualization complexity.**

**What's already in place (scaffolding from end of chunk-1 session, committed alongside):**
- `renderEpicRow` and `renderInitiativeRow` now accept an optional `renderChildrenOverride?: () => React.ReactNode` param. When provided, it replaces the default "render nested children" body. The walker will pass `() => null` so each descriptor renders ONLY its own header row.
- `renderFolderRow` already accepts `renderChildren` natively (existing signature) — nothing to change there.

**What still needs to happen in chunk 2:**
1. **Capture the per-descriptor data in the walker.** Right now descriptors only carry `{key, kind, estimatedHeight, render: () => null}`. Each render closure needs to bind the row's data + indent + group-folder icons/actions when emitted in the walker:
   - `groupFolder` needs: folderId, label, count, indentPx, leadingIcon (depends on level: roadmap=MapIcon / year=CalendarDays / quarter=QuarterYearProgressIcon | CalendarOff for unscheduled), trailingAction (Schedule jump for Unscheduled / + button for quarter / rename button for roadmap when applicable), defaultOpenOverride (false for empty quarter folders), labelOverride (IsolatedTextInput when actively renaming a roadmap). Duplicate the icon/action logic from `renderGroupedTree`'s loop into a helper used by both the walker and the existing renderer.
   - `initiative` needs: all 10 args of `renderInitiativeRow` + indent. Call `renderInitiativeRow(..., () => null)`.
   - `epic` needs: all 6 args of `renderEpicRow` + indent. Call `renderEpicRow(..., () => null)`.
   - `story` needs: row, indentPx, all the editing flags. Render `<BacklogStoryRow row={row} indentPx={indentPx} ... ctx={storyRowCtx} />` directly using the existing `storyRowCtx`.
   - `standaloneInit` needs: extract a "render one standalone-init folder header (no epics)" helper out of `renderStandaloneInitiativeRows`. Pass `init.epics = []` workaround vs a real refactor — pick one.
   - `standaloneEpic` needs: extract a per-epic helper from the inline body of `renderStandaloneInitiativeRows` (the `initiative.epics.map((epic) => ...)` block).
2. **Inline-create forms** that currently appear mid-tree (e.g. when user clicks "+" on an initiative folder) should also be emitted as `createForm` descriptors in the walker's iteration so they show up at the right position in the flat list.
3. **Replace the call site** at the JSX entry point (currently `timePhase("renderTreeJSX (grouped)", () => renderGroupedTree(...))`) with a `descriptors.map(d => d.render())` mapper, wrapped in `timePhase("renderFromDescriptors (grouped)")` for comparison.
4. **Visual smoke test:** every group level open/close, edit a row, click +Add Initiative inside a quarter, rename a roadmap, click Schedule on an unscheduled epic, search, every filter type. Anything broken vs the live `main` branch?
5. **Acceptable visual deltas to defer:** losing the `bg-slate-50/50` subtle background tint on nested epic children (it lived on the wrapper div around children that no longer exists in the flat output). Fix in chunk 6 polish if it matters.

**Acceptance:** App looks identical to before chunk 2 (modulo the bg-tint delta noted above) and the grouped path now flows through the descriptor list.

---

### Chunk 3 — Wire `useVirtualizer` for grouped path  **STATUS: DONE**

**Done in this chunk's commit:**
- `@tanstack/react-virtual`'s `useVirtualizer` wired up in a new module-level `VirtualizedBacklogRows` component.
- Scroll container: existing `overflow-y-auto` div on the table body now carries a `tableScrollRef` that's passed to the virtualizer's `getScrollElement`.
- `estimateSize` reads each descriptor's `estimatedHeight` (per-kind defaults from `ROW_ESTIMATED_HEIGHTS`).
- `getItemKey` returns the descriptor's stable key so reconciliation reuses row instances when descriptors reorder (e.g. folder open/close).
- Each visible row mounts inside a `position: absolute` wrapper with `transform: translateY(start)`, `width: 100%`, and `ref={virtualizer.measureElement}` so the virtualizer corrects estimated heights with real measurements.
- Grouped-path JSX entry now uses `<VirtualizedBacklogRows descriptors={...} scrollElementRef={tableScrollRef} />` instead of `descriptors.map((d) => d.render())`.
- Other paths (story-only flat, epic-only flat, ungrouped initiative list) keep current rendering — chunk 6 extends virtualization to them.

**Expected behavior:**
- Group By toggle: `reactCommit` should drop dramatically (verifiable in the latency popup). ~30 rows mount instead of ~500.
- Scrolling: smooth. Rows offscreen unmount; new visible rows mount with their estimated height, then auto-correct after measurement.
- Open/close folder: walker re-runs (folder state in deps), descriptor list shrinks/grows, virtualizer reconciles.

**Known limitations to address in chunks 4–6:**
- **Inline edit popovers** unmount when row scrolls offscreen (chunk 4 fixes via `rangeExtractor` pinning the editing row).
- **DnD ghost** likewise unmounts mid-drag (chunk 4 + `verticalListSortingStrategy`).
- **Sticky column header alignment**: the header is OUTSIDE the virtualizer wrapper and uses `position: sticky`. Should still work but verify (chunk 5).
- Standalone-init descriptors in non-Epic-only mode emit a SINGLE descriptor for the whole init+epics block (per chunk 2 design). The virtualizer's `estimateSize` for these is `standaloneInit + epics*standaloneEpic` so the scrollbar is sane.

**Goal:** Only ~30 visible rows render. Group By drops from 3s to under 300ms.

**Output:**
- Scroll container is the existing `<div className="overflow-y-auto">` wrapping the table body — `getScrollElement: () => scrollRef.current`.
- `useVirtualizer({ count: descriptors.length, getScrollElement, estimateSize: i => descriptors[i].estimatedHeight, overscan: 8 })`.
- Inner wrapper: `style={{ height: virtualizer.getTotalSize(), position: 'relative' }}`.
- Each visible item: `style={{ position: 'absolute', top: virtualRow.start, left: 0, right: 0 }}`.
- `estimateSize` per kind: story=38, epic=42, folder=42, initiative=46, etc.

**Acceptance:**
- Scrolling smooth, no jumpy positions.
- Group By toggle's `reactCommit` drops below ~300ms (verifiable in the latency debugger).
- All non-edit/non-drag interactions still work.

---

### Chunk 4 — Keep editing + dragging rows mounted  **STATUS: DONE**

**What was actually done:**
- Pinning logic via `rangeExtractor` on `useVirtualizer`. Default visible range (start..end) is computed as a Set; pinned indices are added on top so they're always included in the rendered items.
- `VirtualizedBacklogRows` accepts `pinStoryIds: readonly string[]`. Resolves each ID → descriptor index via suffix match on `-story-${id}` (story descriptor keys always end with this).
- Panel computes `pinStoryIds` via `useMemo` over `[editingStoryCell, editingStoryTitle]`. Empty array when nothing is being edited.

**DnD: no change needed** — the only DnD in this panel is column-reorder in the table header, which is OUTSIDE the virtualizer. No row-level drag-and-drop exists. If row DnD is added later, the same pinning pattern will handle the active drag id.

**Behavior expected:**
- Edit a story cell → scroll the edited row out of view → scroll back. Editor's typed draft + focus state preserved (was being lost before because the row unmounted).
- Same for an in-progress story title rename.

**Goal:** A row being edited or actively dragged shouldn't unmount when it scrolls out of the virtual window.

**Output:**
- `rangeExtractor` option on `useVirtualizer`:
  ```ts
  rangeExtractor: (range) => {
    const baseIndices = defaultRangeExtractor(range);
    const pinned = new Set(baseIndices);
    if (editingStoryCell?.storyId) {
      const idx = descriptors.findIndex(d => d.key === storyKey(editingStoryCell.storyId));
      if (idx >= 0) pinned.add(idx);
    }
    if (activeDragId) { /* same pattern */ }
    return Array.from(pinned).sort((a, b) => a - b);
  }
  ```
- Use `verticalListSortingStrategy` from `@dnd-kit/sortable` (not `rectSortingStrategy`).

**Acceptance:** Edit a row in-line → scroll the edited row offscreen → scroll back → editor still open with your typed value. Drag a row from top of viewport down past the bottom edge → ghost stays visible.

---

### Chunk 5 — Sticky column header + alignment  **STATUS: DONE (verification only — no code change)**

**Findings:**
- The existing layout already matches the TanStack Virtual recommended two-div pattern (research notes section).
  - Outer scroll container: `<div ref={tableScrollRef} className="overflow-y-auto">`.
  - Inner wrapper: `<div className="w-max min-w-full">`.
  - Header: `<div className="sticky top-0 z-10 ...">` lives INSIDE the inner wrapper (not the scroll container) — exactly what fixes the TanStack Virtual issue #640 "sticky header disappears mid-scroll" failure mode.
  - Virtualizer wrapper is a sibling of the header inside the same inner wrapper. Header sticks to the top of the scroll container; rows scroll under it as expected.
- Column-width alignment: both the header and each virtualized row use `style={{ gridTemplateColumns: tableGridTemplate }}`. The header naturally sizes to its grid (max-content sum). The inner wrapper inherits that width via `w-max`. The virtualizer wrapper at `width: 100%` matches the inner wrapper. Each row at `width: 100%` matches too → header and row columns align byte-for-byte regardless of column resizing.

**No code change required.** If user reports a sticky-header glitch during the chunks 1-4 smoke test, revisit and apply the explicit fix recipes from issue #640.

**Goal:** Column header stays visible while scrolling; column widths align perfectly with the virtualized rows below.

**Output:**
- Two-div pattern from the TanStack research: outer scroll container, inner wrapper. Header has `position: sticky; top: 0; z-index: 10` inside the inner wrapper, not the scroll container.
- Header and rows share the same `gridTemplateColumns` string (already do via `tableGridTemplate`).
- Verify alignment at all column widths after a column resize.

**Acceptance:** Header always visible during scroll; column borders line up with row cells at any column-width setting.

---

### Chunk 6 — Extend to non-grouped paths + verify  **STATUS: PARTIAL — flat story-only done; flat epic-only + ungrouped initiative list TODO**

**What's done in this chunk's commit:**
- **Flat story-only path** (Work Item filter = "story", no grouping) now goes through the descriptor pipeline + VirtualizedBacklogRows. Each story row in `sortedGroupedStoryRows` becomes one descriptor; same memoized `BacklogStoryRow` + `pinStoryIds` pinning. Group By's perf pattern now applies to "story-only" filter too.

**What's still TODO in chunk 6 for the next session:**
1. ✅ **Flat epic-only path** — DONE in this commit. Reuses the existing `walkStandaloneInitiativeRowsIntoDescriptors` (which already knows how to emit per-epic descriptors in Epic-only mode) and pipes through `VirtualizedBacklogRows`.
2. **Ungrouped initiative list** (no Work Item filter active + no grouping). The biggest remaining piece. Currently the inline `fullyFiltered.map((initiative) => { ... ~1100 lines of inline JSX ... })` block at lines ~8822-9916. Needs a parallel walker that:
   - Iterates `fullyFiltered` initiatives.
   - Each emits an `initiative` descriptor; the render thunk calls the existing inline JSX as a function (extract into a `renderUngroupedInitiative(initiative)` helper).
   - When open (`openInitiatives[initiative.id]`), iterate its epics; each emits an `epic` descriptor whose render is similar — extract from the inline body.
   - Each epic's stories emit `story` descriptors → `<BacklogStoryRow ... />`.
   - **Catch:** this path uses `openInitiatives` (separate state from `openGroupFolders`). Need to honor that.
3. **Full smoke test** of every interaction across every path:
   - Open/close folders at every level
   - Edit each cell type in a story
   - Inline-create at quarter / initiative / epic level
   - Rename roadmap
   - Schedule jump button for unscheduled epic
   - Search with highlight
   - Every filter type independently and in combinations
   - Column resize alignment with virtualized rows
   - Compare side-by-side with `main` for visual regressions (the bg-slate-50/50 tint and extra wrapper divs noted in chunk 2 are expected; anything else is a regression).

**Goal:** Apply the descriptor + virtualizer pattern to the three non-grouped paths and run a full interaction smoke test.

**Output:**
- Flat story-only (Work Item filter = story, no grouping) — already trivially virtualizable.
- Flat epic-only (Work Item filter = epic, no grouping).
- Non-grouped default (inline `fullyFiltered.map(initiative => ...)` rendering at line ~8175).
- Smoke test: search, every filter type, every Group By combination, edit each cell type, drag rows, inline-create at every nesting level, "Schedule" jump button, roadmap rename, column reorder, column resize.

**Acceptance:** Every existing interaction works. Latency debugger shows reactCommit < 300ms for ALL operations including Group By.

---

## Research notes

Stuff worth remembering when picking up later:

- **DnD-kit + virtualization:** must use `verticalListSortingStrategy`, NOT `rectSortingStrategy`. See dnd-kit discussion #411.
- **Sticky header pattern:** outer scroll container, inner wrapper, header `position: sticky` inside the inner wrapper (TanStack Virtual issue #640).
- **TanStack Virtual "Sticky" example** shows `rangeExtractor` returning specific indices to keep certain rows always-mounted. Same trick handles edit + drag pinning.
- **Per-kind estimateSize** matters: story (38px) and folder (42px) have different intrinsic heights. Wrong estimates → scroll-position jumps when virtualizer measures real heights.
- The current `content-visibility: auto` on row containers (shipped in `e32d9e0`) becomes redundant once virtualization is in (offscreen rows don't exist in DOM at all). Can be removed in chunk 6 polish.

---

## Notes-from-execution

> Each chunk should append a "what was actually done" subsection under itself or here, noting any decisions/deviations from the plan.
