const { PrismaClient } = require("../lib/generated/prisma");

const prisma = new PrismaClient();
const YEAR = 2026;

function quarterFromMonth(month) {
  if (month == null) return null;
  if (month <= 3) return 1;
  if (month <= 6) return 2;
  if (month <= 9) return 3;
  return 4;
}

function story(title, assignee, sprint, status, estimatedDays, daysLeft, month) {
  return {
    title,
    assignee,
    planYear: YEAR,
    planQuarter: quarterFromMonth(month),
    sprint,
    status,
    estimatedDays,
    daysLeft,
  };
}

function storyWithSnapshots(title, assignee, sprint, status, estimatedDays, daysLeft, month, snapshots) {
  return {
    ...story(title, assignee, sprint, status, estimatedDays, daysLeft, month),
    snapshots: { create: snapshots },
  };
}

function snapshot(isoDate, status, sprint, estimatedDays, daysLeft, assignee) {
  return {
    snapshotDate: new Date(isoDate),
    status,
    sprint,
    estimatedDays,
    daysLeft,
    assignee,
  };
}

/** @param {"platform"|"experience"|"data"} team — delivery column; story assignees use that team’s roster (P / E / A names). */
function epic(title, assignee, color, startMonth, endMonth, sprint, stories, team = "platform", endSprint = 2) {
  return {
    title,
    assignee,
    color,
    planYear: YEAR,
    planQuarter: quarterFromMonth(startMonth),
    planSprint: sprint,
    planStartMonth: startMonth,
    planEndMonth: endMonth ?? startMonth,
    planEndSprint: endSprint,
    team,
    userStories: { create: stories },
  };
}

async function main() {
  await prisma.workspaceUser.deleteMany();
  await prisma.storyComment.deleteMany();
  await prisma.storyHistory.deleteMany();
  await prisma.storyDailySnapshot.deleteMany();
  await prisma.userStory.deleteMany();
  await prisma.epicComment.deleteMany();
  await prisma.epicHistory.deleteMany();
  await prisma.epic.deleteMany();
  await prisma.initiativeComment.deleteMany();
  await prisma.initiativeHistory.deleteMany();
  await prisma.initiative.deleteMany();

  const initiatives = [
    {
      title: "Onboarding Modernization",
      assignee: "Elena",
      color: "#3b82f6",
      status: "scheduled",
      startMonth: 1,
      endMonth: 2,
      timelineRow: 0,
      epics: [
        epic("Signup Flow Refresh", "Elena", "#2563eb", 1, 1, 1, [
          story("New signup stepper UI", "Erin", 1, "inProgress", 6, 3, 1),
          story("Inline validation hints", "Evan", 1, "todo", 4, 4, 1),
          story("Progressive profiling prompts", "Edith", 1, "todo", 5, null, 1),
          story("Activation welcome email tweaks", "Emma", 1, "inProgress", 3, 2, 1),
          story("Accessibility keyboard pass", "Elena", 1, "done", 2, 0, 1),
        ], "experience"),
        epic("Profile Completion Nudge", "Evan", "#1d4ed8", 2, 2, 2, [
          story("Progress bar in header", "Emma", 2, "todo", 5, 5, 2),
          story("Reminder cadence", "Erin", 2, "inProgress", 3, 2, 2),
          story("Drop-off analytics event", "Emma", 2, "approved", 2, 0, 2),
        ], "experience"),
      ],
    },
    {
      title: "Sprint Reliability Program",
      assignee: "Perry",
      color: "#0ea5e9",
      status: "scheduled",
      startMonth: 2,
      endMonth: 3,
      timelineRow: 1,
      epics: [
        epic("CI Flake Cleanup", "Perry", "#0284c7", 2, 2, 1, [
          story("Retry policy for flaky tests", "Perry", 1, "todo", 4, 4, 2),
          story("Cache test artifacts", "Paige", 1, "done", 3, 0, 2),
          story("Shard balancing", "Poppy", 1, "inProgress", 5, 2, 2),
          story("Nightly quarantine dashboard", "Petra", 1, "todo", 2, null, 2),
        ], "platform"),
        epic("Release Gate Automation", "Poppy", "#0369a1", 3, 3, 2, [
          story("Rollback checklist", "Poppy", 2, "todo", 4, 4, 3),
          story("Slack release digest", "Perry", 2, "inProgress", 3, 1, 3),
          story("Manual approval step", "Poppy", null, "todo", 2, 2, 3),
        ], "platform"),
        epic(
          "lala",
          "Petra",
          "#0284c7",
          3,
          5,
          2,
          [
            storyWithSnapshots("lala - deploy guardrails", "Paige", 7, "inProgress", 8, 2, 4, [
              snapshot("2026-04-01T12:00:00.000Z", "todo", 7, 8, 8, "Paige"),
              snapshot("2026-04-03T12:00:00.000Z", "inProgress", 7, 8, 7, "Paige"),
              snapshot("2026-04-06T12:00:00.000Z", "inProgress", 7, 8, 6, "Paige"),
              snapshot("2026-04-09T12:00:00.000Z", "inProgress", 7, 8, 5, "Paige"),
              snapshot("2026-04-12T12:00:00.000Z", "inProgress", 7, 8, 4, "Paige"),
              snapshot("2026-04-15T12:00:00.000Z", "inProgress", 7, 8, 3, "Paige"),
              snapshot("2026-04-18T12:00:00.000Z", "inProgress", 8, 8, 3, "Paige"),
              snapshot("2026-04-22T12:00:00.000Z", "inProgress", 8, 8, 2, "Paige"),
              snapshot("2026-04-26T12:00:00.000Z", "done", 8, 8, 0, "Paige"),
            ]),
            storyWithSnapshots("lala - release metrics feed", "Perry", 8, "todo", 6, 2, 4, [
              snapshot("2026-04-01T12:00:00.000Z", "todo", 7, 6, 6, "Perry"),
              snapshot("2026-04-05T12:00:00.000Z", "todo", 7, 6, 6, "Perry"),
              snapshot("2026-04-10T12:00:00.000Z", "inProgress", 7, 6, 5, "Perry"),
              snapshot("2026-04-14T12:00:00.000Z", "inProgress", 7, 6, 4, "Perry"),
              snapshot("2026-04-18T12:00:00.000Z", "inProgress", 8, 6, 3, "Perry"),
              snapshot("2026-04-22T12:00:00.000Z", "inProgress", 8, 6, 2, "Perry"),
              snapshot("2026-04-28T12:00:00.000Z", "inProgress", 8, 6, 1, "Perry"),
            ]),
          ],
          "platform",
          1,
        ),
      ],
    },
    {
      title: "Insights & Reporting",
      assignee: "Alice",
      color: "#8b5cf6",
      status: "scheduled",
      startMonth: 4,
      endMonth: 5,
      timelineRow: 2,
      epics: [
        epic("Executive Dashboard v2", "Alice", "#7c3aed", 4, 4, 1, [
          story("KPI trend chart", "Alice", 1, "inProgress", 5, 3, 4),
          story("Regional split widgets", "Aaron", 1, "todo", 4, 4, 4),
          story("Scorecard export polish", "Aria", 1, "todo", 2, 1, 4),
          story("Revenue drill-down", "Asher", 1, "done", 4, 0, 4),
        ], "data"),
        epic("Weekly Digest Builder", "Aria", "#6d28d9", 5, 5, 2, [
          story("Digest layout blocks", "Aiden", 2, "todo", 3, 3, 5),
          story("Auto-send scheduler", "Alice", 2, "inProgress", 4, 2, 5),
          story("Summary KPI computation", "Aaron", 2, "approved", 3, 0, 5),
        ], "data"),
      ],
    },
    {
      title: "Billing Experience Revamp",
      assignee: "Evan",
      color: "#f97316",
      status: "scheduled",
      startMonth: 6,
      endMonth: 6,
      timelineRow: 3,
      epics: [
        epic("Invoice Hub", "Evan", "#ea580c", 6, 6, 1, [
          story("Invoice list filtering", "Evan", 1, "todo", 4, 4, 6),
          story("PDF download cache", "Erin", 1, "done", 2, 0, 6),
          story("Failed payment notices", "Elena", 1, "inProgress", 3, 2, 6),
        ], "experience"),
        epic("Checkout Resilience", "Emma", "#c2410c", 6, 6, 2, [
          story("Card retry UX", "Emma", 2, "inProgress", 4, 1, 6),
          story("Tax line explainers", "Erin", 2, "todo", 2, 2, 6),
          story("Receipt resend endpoint", "Evan", null, "todo", 2, 2, 6),
        ], "experience"),
      ],
    },
    {
      title: "Collaboration Workspace",
      assignee: "Edith",
      color: "#14b8a6",
      status: "scheduled",
      startMonth: 7,
      endMonth: 8,
      timelineRow: 4,
      epics: [
        epic("Comment Threads", "Edith", "#0f766e", 7, 7, 1, [
          story("Threaded replies", "Edith", 1, "inProgress", 5, 2, 7),
          story("Mention notifications", "Elena", 1, "todo", 4, 4, 7),
          story("Thread resolve action", "Erin", 1, "done", 2, 0, 7),
        ], "experience"),
        epic("Presence & Cursors", "Evan", "#0d9488", 8, 8, 2, [
          story("Realtime cursor channel", "Evan", 2, "todo", 6, 6, 8),
          story("Idle state indicator", "Emma", 2, "inProgress", 3, 2, 8),
          story("Presence fallback polling", "Edith", 2, "todo", 3, 3, 8),
          story("Avatar stack live sync", "Elena", 2, "inProgress", 4, null, 8),
        ], "experience"),
      ],
    },
    {
      title: "Search & Discovery Upgrade",
      assignee: "Pascal",
      color: "#a855f7",
      status: "scheduled",
      startMonth: 8,
      endMonth: 9,
      timelineRow: 5,
      epics: [
        epic("Unified Search API", "Pascal", "#9333ea", 8, 8, 1, [
          story("Cross-entity index schema", "Pascal", 1, "inProgress", 6, 3, 8),
          story("Zero-downtime reindex", "Perry", 1, "todo", 5, 5, 8),
          story("Search health alerts", "Paige", 1, "done", 2, 0, 8),
        ], "platform"),
        epic("Discovery Surface", "Poppy", "#7e22ce", 9, 9, 2, [
          story("Trending cards module", "Poppy", 2, "todo", 4, 4, 9),
          story("Related initiatives block", "Perry", 2, "inProgress", 3, 1, 9),
          story("Recently viewed cache", "Paige", 2, "approved", 2, 0, 9),
        ], "platform"),
      ],
    },
    {
      title: "Mobile Performance Drive",
      assignee: "Petra",
      color: "#22c55e",
      status: "scheduled",
      startMonth: 9,
      endMonth: 10,
      timelineRow: 6,
      epics: [
        epic("Bundle Budget Enforcement", "Petra", "#16a34a", 9, 9, 1, [
          story("Chunk size CI gate", "Petra", 1, "inProgress", 4, 2, 9),
          story("Unused dep detector", "Poppy", 1, "todo", 3, 3, 9),
          story("Vendor split audit", "Paige", 1, "done", 3, 0, 9),
        ], "platform"),
        epic("Runtime Smoothness", "Pascal", "#15803d", 10, 10, 2, [
          story("Main-thread long task log", "Pascal", 2, "todo", 4, 4, 10),
          story("Image decode defer", "Paige", 2, "inProgress", 3, 1, 10),
          story("Skeleton shimmer tune", "Poppy", null, "todo", 2, 2, 10),
        ], "platform"),
      ],
    },
    {
      title: "Security Hardening Wave",
      assignee: "Paige",
      color: "#ef4444",
      status: "scheduled",
      startMonth: 10,
      endMonth: 11,
      timelineRow: 7,
      epics: [
        epic("Session Protection", "Paige", "#dc2626", 10, 10, 1, [
          story("Refresh token rotation", "Paige", 1, "inProgress", 5, 2, 10),
          story("IP anomaly prompts", "Perry", 1, "todo", 4, 4, 10),
          story("Concurrent session cap", "Pascal", 1, "done", 3, 0, 10),
        ], "platform"),
        epic("Audit Trail Expansion", "Perry", "#b91c1c", 11, 11, 2, [
          story("Privileged action logs", "Perry", 2, "todo", 4, 4, 11),
          story("Export audit CSV", "Paige", 2, "inProgress", 3, 2, 11),
          story("Tamper alert webhook", "Poppy", 2, "approved", 2, 0, 11),
        ], "platform"),
      ],
    },
    {
      title: "Data Platform Evolution",
      assignee: "Aaron",
      color: "#06b6d4",
      status: "scheduled",
      startMonth: 11,
      endMonth: 12,
      timelineRow: 8,
      epics: [
        epic("Event Pipeline v3", "Aaron", "#0891b2", 11, 11, 1, [
          story("Schema registry support", "Aaron", 1, "todo", 5, 5, 11),
          story("Dead-letter queue replay", "Alice", 1, "inProgress", 4, 2, 11),
          story("Ingestion lag dashboard", "Aria", 1, "done", 3, 0, 11),
        ], "data"),
        epic("Warehouse Freshness", "Alice", "#0e7490", 12, 12, 2, [
          story("Hourly snapshot delta", "Alice", 2, "todo", 4, 4, 12),
          story("Late-arrival backfill", "Asher", 2, "inProgress", 3, 2, 12),
          story("Model contract tests", "Aiden", 2, "approved", 2, 0, 12),
        ], "data"),
      ],
    },
    {
      title: "AI Assist Backlog",
      assignee: "Poppy",
      color: "#f59e0b",
      status: "backlog",
      startMonth: null,
      endMonth: null,
      timelineRow: 9,
      epics: [
        epic("Prompt Library", "Poppy", "#d97706", null, null, null, [
          story("Draft template categories", "Poppy", null, "todo", 3, 3, null),
          story("Usage telemetry", "Perry", null, "todo", 4, 4, null),
          story("Prompt quality rubric", "Pascal", null, "todo", 3, 3, null),
        ], "platform"),
        epic("Copilot Suggestions", "Emma", "#b45309", null, null, null, [
          story("Context window strategy", "Emma", null, "todo", 5, 5, null),
          story("Hint ranking experiment", "Erin", null, "todo", 4, 4, null),
          story("Safety fallback response", "Evan", null, "todo", 3, 3, null),
        ], "experience"),
      ],
    },
    // ── Sprint 9 (May 1-15 2026) showcase initiatives ──────────────────────────
    // Data team: slow start, accelerates, crosses ideal line around day 5 → finishes ahead
    {
      title: "Analytics Acceleration Q2",
      assignee: "Alice",
      color: "#06b6d4",
      status: "scheduled",
      startMonth: 5,
      endMonth: 5,
      timelineRow: 10,
      epics: [
        epic(
          "Real-time KPI Pipeline",
          "Alice",
          "#0891b2",
          5,
          5,
          9,
          [
            storyWithSnapshots("Stream aggregation layer", "Alice", 9, "inProgress", 8, 3, 5, [
              snapshot("2026-05-01T12:00:00.000Z", "todo",       9, 8, 8, "Alice"),
              snapshot("2026-05-02T12:00:00.000Z", "todo",       9, 8, 8, "Alice"),
              snapshot("2026-05-03T12:00:00.000Z", "inProgress", 9, 8, 7, "Alice"),
              snapshot("2026-05-04T12:00:00.000Z", "inProgress", 9, 8, 7, "Alice"),
              snapshot("2026-05-05T12:00:00.000Z", "inProgress", 9, 8, 5, "Alice"),
              snapshot("2026-05-06T12:00:00.000Z", "inProgress", 9, 8, 4, "Alice"),
              snapshot("2026-05-07T12:00:00.000Z", "inProgress", 9, 8, 3, "Alice"),
            ]),
            storyWithSnapshots("Metric schema migration", "Aaron", 9, "inProgress", 7, 3, 5, [
              snapshot("2026-05-01T12:00:00.000Z", "todo",       9, 7, 7, "Aaron"),
              snapshot("2026-05-02T12:00:00.000Z", "todo",       9, 7, 7, "Aaron"),
              snapshot("2026-05-03T12:00:00.000Z", "inProgress", 9, 7, 6, "Aaron"),
              snapshot("2026-05-04T12:00:00.000Z", "inProgress", 9, 7, 6, "Aaron"),
              snapshot("2026-05-05T12:00:00.000Z", "inProgress", 9, 7, 5, "Aaron"),
              snapshot("2026-05-06T12:00:00.000Z", "inProgress", 9, 7, 4, "Aaron"),
              snapshot("2026-05-07T12:00:00.000Z", "inProgress", 9, 7, 3, "Aaron"),
            ]),
            storyWithSnapshots("Dashboard widget connector", "Aria", 9, "inProgress", 6, 3, 5, [
              snapshot("2026-05-01T12:00:00.000Z", "todo",       9, 6, 6, "Aria"),
              snapshot("2026-05-02T12:00:00.000Z", "todo",       9, 6, 6, "Aria"),
              snapshot("2026-05-03T12:00:00.000Z", "inProgress", 9, 6, 6, "Aria"),
              snapshot("2026-05-04T12:00:00.000Z", "inProgress", 9, 6, 5, "Aria"),
              snapshot("2026-05-05T12:00:00.000Z", "inProgress", 9, 6, 5, "Aria"),
              snapshot("2026-05-06T12:00:00.000Z", "inProgress", 9, 6, 4, "Aria"),
              snapshot("2026-05-07T12:00:00.000Z", "inProgress", 9, 6, 3, "Aria"),
            ]),
            storyWithSnapshots("Alerting threshold config", "Asher", 9, "inProgress", 5, 3, 5, [
              snapshot("2026-05-01T12:00:00.000Z", "todo",       9, 5, 5, "Asher"),
              snapshot("2026-05-02T12:00:00.000Z", "todo",       9, 5, 5, "Asher"),
              snapshot("2026-05-03T12:00:00.000Z", "todo",       9, 5, 4, "Asher"),
              snapshot("2026-05-04T12:00:00.000Z", "inProgress", 9, 5, 4, "Asher"),
              snapshot("2026-05-05T12:00:00.000Z", "inProgress", 9, 5, 4, "Asher"),
              snapshot("2026-05-06T12:00:00.000Z", "inProgress", 9, 5, 3, "Asher"),
              snapshot("2026-05-07T12:00:00.000Z", "inProgress", 9, 5, 3, "Asher"),
            ]),
            storyWithSnapshots("Data retention policy page", "Aiden", 9, "done", 4, 0, 5, [
              snapshot("2026-05-01T12:00:00.000Z", "todo",       9, 4, 4, "Aiden"),
              snapshot("2026-05-02T12:00:00.000Z", "todo",       9, 4, 4, "Aiden"),
              snapshot("2026-05-03T12:00:00.000Z", "inProgress", 9, 4, 4, "Aiden"),
              snapshot("2026-05-04T12:00:00.000Z", "inProgress", 9, 4, 4, "Aiden"),
              snapshot("2026-05-05T12:00:00.000Z", "inProgress", 9, 4, 3, "Aiden"),
              snapshot("2026-05-06T12:00:00.000Z", "done",       9, 4, 0, "Aiden"),
              snapshot("2026-05-07T12:00:00.000Z", "done",       9, 4, 0, "Aiden"),
            ]),
          ],
          "data",
          2,
        ),
      ],
    },
    // Platform team: strong from day 1, consistently well ahead of ideal
    {
      title: "Platform Velocity Q2",
      assignee: "Perry",
      color: "#0ea5e9",
      status: "scheduled",
      startMonth: 5,
      endMonth: 5,
      timelineRow: 11,
      epics: [
        epic(
          "Infrastructure Hardening S9",
          "Perry",
          "#0284c7",
          5,
          5,
          9,
          [
            storyWithSnapshots("Canary deployment pipeline", "Perry", 9, "inProgress", 7, 1, 5, [
              snapshot("2026-05-01T12:00:00.000Z", "todo",       9, 7, 7, "Perry"),
              snapshot("2026-05-02T12:00:00.000Z", "inProgress", 9, 7, 5, "Perry"),
              snapshot("2026-05-03T12:00:00.000Z", "inProgress", 9, 7, 4, "Perry"),
              snapshot("2026-05-04T12:00:00.000Z", "inProgress", 9, 7, 3, "Perry"),
              snapshot("2026-05-05T12:00:00.000Z", "inProgress", 9, 7, 3, "Perry"),
              snapshot("2026-05-06T12:00:00.000Z", "inProgress", 9, 7, 2, "Perry"),
              snapshot("2026-05-07T12:00:00.000Z", "inProgress", 9, 7, 1, "Perry"),
            ]),
            storyWithSnapshots("Auto-scaling policy tuning", "Paige", 9, "inProgress", 6, 1, 5, [
              snapshot("2026-05-01T12:00:00.000Z", "todo",       9, 6, 6, "Paige"),
              snapshot("2026-05-02T12:00:00.000Z", "inProgress", 9, 6, 5, "Paige"),
              snapshot("2026-05-03T12:00:00.000Z", "inProgress", 9, 6, 4, "Paige"),
              snapshot("2026-05-04T12:00:00.000Z", "inProgress", 9, 6, 3, "Paige"),
              snapshot("2026-05-05T12:00:00.000Z", "inProgress", 9, 6, 3, "Paige"),
              snapshot("2026-05-06T12:00:00.000Z", "inProgress", 9, 6, 2, "Paige"),
              snapshot("2026-05-07T12:00:00.000Z", "inProgress", 9, 6, 1, "Paige"),
            ]),
            storyWithSnapshots("DB connection pool refactor", "Poppy", 9, "done", 6, 0, 5, [
              snapshot("2026-05-01T12:00:00.000Z", "todo",       9, 6, 6, "Poppy"),
              snapshot("2026-05-02T12:00:00.000Z", "inProgress", 9, 6, 4, "Poppy"),
              snapshot("2026-05-03T12:00:00.000Z", "inProgress", 9, 6, 3, "Poppy"),
              snapshot("2026-05-04T12:00:00.000Z", "inProgress", 9, 6, 2, "Poppy"),
              snapshot("2026-05-05T12:00:00.000Z", "done",       9, 6, 0, "Poppy"),
              snapshot("2026-05-06T12:00:00.000Z", "done",       9, 6, 0, "Poppy"),
              snapshot("2026-05-07T12:00:00.000Z", "done",       9, 6, 0, "Poppy"),
            ]),
            storyWithSnapshots("Log sampling strategy", "Petra", 9, "done", 5, 0, 5, [
              snapshot("2026-05-01T12:00:00.000Z", "todo",       9, 5, 5, "Petra"),
              snapshot("2026-05-02T12:00:00.000Z", "inProgress", 9, 5, 4, "Petra"),
              snapshot("2026-05-03T12:00:00.000Z", "inProgress", 9, 5, 3, "Petra"),
              snapshot("2026-05-04T12:00:00.000Z", "inProgress", 9, 5, 2, "Petra"),
              snapshot("2026-05-05T12:00:00.000Z", "inProgress", 9, 5, 2, "Petra"),
              snapshot("2026-05-06T12:00:00.000Z", "done",       9, 5, 0, "Petra"),
              snapshot("2026-05-07T12:00:00.000Z", "done",       9, 5, 0, "Petra"),
            ]),
          ],
          "platform",
          2,
        ),
      ],
    },
    // Experience team: typical sprint, minor slip mid-week, roughly tracks ideal
    {
      title: "Experience Polish Q2",
      assignee: "Elena",
      color: "#8b5cf6",
      status: "scheduled",
      startMonth: 5,
      endMonth: 5,
      timelineRow: 12,
      epics: [
        epic(
          "UX Quality Sprint 9",
          "Elena",
          "#7c3aed",
          5,
          5,
          9,
          [
            storyWithSnapshots("Responsive nav overhaul", "Elena", 9, "inProgress", 6, 3, 5, [
              snapshot("2026-05-01T12:00:00.000Z", "todo",       9, 6, 6, "Elena"),
              snapshot("2026-05-02T12:00:00.000Z", "inProgress", 9, 6, 6, "Elena"),
              snapshot("2026-05-03T12:00:00.000Z", "inProgress", 9, 6, 5, "Elena"),
              snapshot("2026-05-04T12:00:00.000Z", "inProgress", 9, 6, 5, "Elena"),
              snapshot("2026-05-05T12:00:00.000Z", "inProgress", 9, 6, 4, "Elena"),
              snapshot("2026-05-06T12:00:00.000Z", "inProgress", 9, 6, 4, "Elena"),
              snapshot("2026-05-07T12:00:00.000Z", "inProgress", 9, 6, 3, "Elena"),
            ]),
            storyWithSnapshots("Toast notification system", "Erin", 9, "inProgress", 5, 3, 5, [
              snapshot("2026-05-01T12:00:00.000Z", "todo",       9, 5, 5, "Erin"),
              snapshot("2026-05-02T12:00:00.000Z", "inProgress", 9, 5, 5, "Erin"),
              snapshot("2026-05-03T12:00:00.000Z", "inProgress", 9, 5, 4, "Erin"),
              snapshot("2026-05-04T12:00:00.000Z", "inProgress", 9, 5, 4, "Erin"),
              snapshot("2026-05-05T12:00:00.000Z", "inProgress", 9, 5, 4, "Erin"),
              snapshot("2026-05-06T12:00:00.000Z", "inProgress", 9, 5, 3, "Erin"),
              snapshot("2026-05-07T12:00:00.000Z", "inProgress", 9, 5, 3, "Erin"),
            ]),
            storyWithSnapshots("Empty state illustrations", "Evan", 9, "inProgress", 5, 3, 5, [
              snapshot("2026-05-01T12:00:00.000Z", "todo",       9, 5, 5, "Evan"),
              snapshot("2026-05-02T12:00:00.000Z", "todo",       9, 5, 4, "Evan"),
              snapshot("2026-05-03T12:00:00.000Z", "inProgress", 9, 5, 4, "Evan"),
              snapshot("2026-05-04T12:00:00.000Z", "inProgress", 9, 5, 4, "Evan"),
              snapshot("2026-05-05T12:00:00.000Z", "inProgress", 9, 5, 4, "Evan"),
              snapshot("2026-05-06T12:00:00.000Z", "inProgress", 9, 5, 3, "Evan"),
              snapshot("2026-05-07T12:00:00.000Z", "inProgress", 9, 5, 3, "Evan"),
            ]),
            storyWithSnapshots("Focus ring accessibility pass", "Edith", 9, "done", 4, 0, 5, [
              snapshot("2026-05-01T12:00:00.000Z", "todo",       9, 4, 4, "Edith"),
              snapshot("2026-05-02T12:00:00.000Z", "inProgress", 9, 4, 4, "Edith"),
              snapshot("2026-05-03T12:00:00.000Z", "inProgress", 9, 4, 3, "Edith"),
              snapshot("2026-05-04T12:00:00.000Z", "inProgress", 9, 4, 3, "Edith"),
              snapshot("2026-05-05T12:00:00.000Z", "inProgress", 9, 4, 2, "Edith"),
              snapshot("2026-05-06T12:00:00.000Z", "done",       9, 4, 0, "Edith"),
              snapshot("2026-05-07T12:00:00.000Z", "done",       9, 4, 0, "Edith"),
            ]),
          ],
          "experience",
          2,
        ),
      ],
    },
  ];

  for (const [index, init] of initiatives.entries()) {
    await prisma.initiative.create({
      data: {
        title: init.title,
        icon: "",
        assignee: init.assignee,
        color: init.color,
        status: init.status,
        startMonth: init.startMonth,
        endMonth: init.endMonth,
        timelineRow: init.timelineRow ?? index,
        year: YEAR,
        epics: { create: init.epics },
      },
    });
  }

  const workspaceUsers = [
    { name: "Paige Chen", email: "paige.chen@example.com", team: "platform", permission: "Admin" },
    { name: "Perry Stone", email: "perry.stone@example.com", team: "platform", permission: "Editor" },
    { name: "Poppy Miles", email: "poppy.miles@example.com", team: "platform", permission: "Editor" },
    { name: "Petra Wells", email: "petra.wells@example.com", team: "platform", permission: "Viewer" },
    { name: "Pascal Ruiz", email: "pascal.ruiz@example.com", team: "platform", permission: "Viewer" },
    { name: "Elena Park", email: "elena.park@example.com", team: "experience", permission: "Admin" },
    { name: "Erin Blake", email: "erin.blake@example.com", team: "experience", permission: "Editor" },
    { name: "Evan Cho", email: "evan.cho@example.com", team: "experience", permission: "Editor" },
    { name: "Edith Moore", email: "edith.moore@example.com", team: "experience", permission: "Viewer" },
    { name: "Emma Liu", email: "emma.liu@example.com", team: "experience", permission: "Viewer" },
    { name: "Alice Hart", email: "alice.hart@example.com", team: "data", permission: "Admin" },
    { name: "Aaron Cole", email: "aaron.cole@example.com", team: "data", permission: "Editor" },
    { name: "Aria Singh", email: "aria.singh@example.com", team: "data", permission: "Editor" },
    { name: "Asher Kim", email: "asher.kim@example.com", team: "data", permission: "Viewer" },
    { name: "Aiden Frost", email: "aiden.frost@example.com", team: "data", permission: "Viewer" },
    { name: "Jordan Lee", email: "jordan.lee@example.com", team: "", permission: "Viewer" },
  ];
  for (const u of workspaceUsers) {
    await prisma.workspaceUser.create({ data: u });
  }

  console.log(
    "Demo seed complete with 13 initiatives (incl. 3 Sprint 9 showcase), 16 workspace users. Sprint 9 burndown patterns: data=slow-start-then-crosses-ideal, platform=consistently-ahead, experience=tracks-ideal.",
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
