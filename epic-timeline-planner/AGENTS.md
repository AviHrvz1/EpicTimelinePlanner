<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Work in progress: backlog perf — multi-phase

Plan file: **`docs/virtualization-plan.md`** (single source of truth for all perf work). Branch: **`perf/backlog-virtualization`**.

**Phase 1: Backlog table virtualization — DONE** (all 4 rendering paths). Awaiting user verification before merge to main.

**Phase 2: Charts / dashboard optimization — TODO**. Triggers if user says *"continue with phase 2"* or *"do the charts perf work"*. Step-by-step plan is in `docs/virtualization-plan.md` under the "Phase 2" heading.

**Phase 3: Server-side aggregation — future**. Only needed at true scale (10k+ stories); details in same plan doc.

When the user says *"continue virtualization"* or *"continue phase N"*, read the plan doc first to find the next `TODO` chunk and start there. Update each chunk's status to `DONE` after every commit.
