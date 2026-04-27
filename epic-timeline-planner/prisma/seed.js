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

function epic(title, assignee, color, startMonth, endMonth, sprint, stories) {
  return {
    title,
    assignee,
    color,
    planYear: YEAR,
    planQuarter: quarterFromMonth(startMonth),
    planSprint: sprint,
    planStartMonth: startMonth,
    planEndMonth: endMonth ?? startMonth,
    userStories: { create: stories },
  };
}

async function main() {
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
      assignee: "Maya",
      color: "#3b82f6",
      status: "scheduled",
      startMonth: 1,
      endMonth: 2,
      timelineRow: 0,
      epics: [
        epic("Signup Flow Refresh", "Maya", "#2563eb", 1, 1, 1, [
          story("New signup stepper UI", "Liam", 1, "inProgress", 6, 3, 1),
          story("Inline validation hints", "Ava", 1, "todo", 4, 4, 1),
          story("Progressive profiling prompts", "Zoe", 1, "todo", 5, null, 1),
          story("Activation welcome email tweaks", "Ben", 1, "inProgress", 3, 2, 1),
          story("Accessibility keyboard pass", "Liam", 1, "done", 2, 0, 1),
        ]),
        epic("Profile Completion Nudge", "Noah", "#1d4ed8", 2, 2, 2, [
          story("Progress bar in header", "Mia", 2, "todo", 5, 5, 2),
          story("Reminder cadence", "Ethan", 2, "inProgress", 3, 2, 2),
          story("Drop-off analytics event", "Mia", 2, "approved", 2, 0, 2),
        ]),
      ],
    },
    {
      title: "Sprint Reliability Program",
      assignee: "Ethan",
      color: "#0ea5e9",
      status: "scheduled",
      startMonth: 2,
      endMonth: 3,
      timelineRow: 1,
      epics: [
        epic("CI Flake Cleanup", "Ethan", "#0284c7", 2, 2, 1, [
          story("Retry policy for flaky tests", "Ethan", 1, "todo", 4, 4, 2),
          story("Cache test artifacts", "Liam", 1, "done", 3, 0, 2),
          story("Shard balancing", "Noah", 1, "inProgress", 5, 2, 2),
          story("Nightly quarantine dashboard", "Iris", 1, "todo", 2, null, 2),
        ]),
        epic("Release Gate Automation", "Ava", "#0369a1", 3, 3, 2, [
          story("Rollback checklist", "Ava", 2, "todo", 4, 4, 3),
          story("Slack release digest", "Maya", 2, "inProgress", 3, 1, 3),
          story("Manual approval step", "Ava", null, "todo", 2, 2, 3),
        ]),
      ],
    },
    {
      title: "Insights & Reporting",
      assignee: "Ava",
      color: "#8b5cf6",
      status: "scheduled",
      startMonth: 4,
      endMonth: 5,
      timelineRow: 2,
      epics: [
        epic("Executive Dashboard v2", "Ava", "#7c3aed", 4, 4, 1, [
          story("KPI trend chart", "Mia", 1, "inProgress", 5, 3, 4),
          story("Regional split widgets", "Liam", 1, "todo", 4, 4, 4),
          story("Scorecard export polish", "Omar", 1, "todo", 2, 1, 4),
          story("Revenue drill-down", "Ava", 1, "done", 4, 0, 4),
        ]),
        epic("Weekly Digest Builder", "Noah", "#6d28d9", 5, 5, 2, [
          story("Digest layout blocks", "Noah", 2, "todo", 3, 3, 5),
          story("Auto-send scheduler", "Ethan", 2, "inProgress", 4, 2, 5),
          story("Summary KPI computation", "Maya", 2, "approved", 3, 0, 5),
        ]),
      ],
    },
    {
      title: "Billing Experience Revamp",
      assignee: "Noah",
      color: "#f97316",
      status: "scheduled",
      startMonth: 6,
      endMonth: 6,
      timelineRow: 3,
      epics: [
        epic("Invoice Hub", "Noah", "#ea580c", 6, 6, 1, [
          story("Invoice list filtering", "Noah", 1, "todo", 4, 4, 6),
          story("PDF download cache", "Liam", 1, "done", 2, 0, 6),
          story("Failed payment notices", "Ava", 1, "inProgress", 3, 2, 6),
        ]),
        epic("Checkout Resilience", "Maya", "#c2410c", 6, 6, 2, [
          story("Card retry UX", "Maya", 2, "inProgress", 4, 1, 6),
          story("Tax line explainers", "Ethan", 2, "todo", 2, 2, 6),
          story("Receipt resend endpoint", "Noah", null, "todo", 2, 2, 6),
        ]),
      ],
    },
    {
      title: "Collaboration Workspace",
      assignee: "Mia",
      color: "#14b8a6",
      status: "scheduled",
      startMonth: 7,
      endMonth: 8,
      timelineRow: 4,
      epics: [
        epic("Comment Threads", "Mia", "#0f766e", 7, 7, 1, [
          story("Threaded replies", "Mia", 1, "inProgress", 5, 2, 7),
          story("Mention notifications", "Ava", 1, "todo", 4, 4, 7),
          story("Thread resolve action", "Liam", 1, "done", 2, 0, 7),
        ]),
        epic("Presence & Cursors", "Ethan", "#0d9488", 8, 8, 2, [
          story("Realtime cursor channel", "Ethan", 2, "todo", 6, 6, 8),
          story("Idle state indicator", "Noah", 2, "inProgress", 3, 2, 8),
          story("Presence fallback polling", "Maya", 2, "todo", 3, 3, 8),
          story("Avatar stack live sync", "Zoe", 2, "inProgress", 4, null, 8),
        ]),
      ],
    },
    {
      title: "Search & Discovery Upgrade",
      assignee: "Liam",
      color: "#a855f7",
      status: "scheduled",
      startMonth: 8,
      endMonth: 9,
      timelineRow: 5,
      epics: [
        epic("Unified Search API", "Liam", "#9333ea", 8, 8, 1, [
          story("Cross-entity index schema", "Liam", 1, "inProgress", 6, 3, 8),
          story("Zero-downtime reindex", "Ethan", 1, "todo", 5, 5, 8),
          story("Search health alerts", "Ava", 1, "done", 2, 0, 8),
        ]),
        epic("Discovery Surface", "Mia", "#7e22ce", 9, 9, 2, [
          story("Trending cards module", "Mia", 2, "todo", 4, 4, 9),
          story("Related initiatives block", "Noah", 2, "inProgress", 3, 1, 9),
          story("Recently viewed cache", "Liam", 2, "approved", 2, 0, 9),
        ]),
      ],
    },
    {
      title: "Mobile Performance Drive",
      assignee: "Ethan",
      color: "#22c55e",
      status: "scheduled",
      startMonth: 9,
      endMonth: 10,
      timelineRow: 6,
      epics: [
        epic("Bundle Budget Enforcement", "Ethan", "#16a34a", 9, 9, 1, [
          story("Chunk size CI gate", "Ethan", 1, "inProgress", 4, 2, 9),
          story("Unused dep detector", "Maya", 1, "todo", 3, 3, 9),
          story("Vendor split audit", "Liam", 1, "done", 3, 0, 9),
        ]),
        epic("Runtime Smoothness", "Noah", "#15803d", 10, 10, 2, [
          story("Main-thread long task log", "Noah", 2, "todo", 4, 4, 10),
          story("Image decode defer", "Ava", 2, "inProgress", 3, 1, 10),
          story("Skeleton shimmer tune", "Mia", null, "todo", 2, 2, 10),
        ]),
      ],
    },
    {
      title: "Security Hardening Wave",
      assignee: "Ava",
      color: "#ef4444",
      status: "scheduled",
      startMonth: 10,
      endMonth: 11,
      timelineRow: 7,
      epics: [
        epic("Session Protection", "Ava", "#dc2626", 10, 10, 1, [
          story("Refresh token rotation", "Ava", 1, "inProgress", 5, 2, 10),
          story("IP anomaly prompts", "Ethan", 1, "todo", 4, 4, 10),
          story("Concurrent session cap", "Noah", 1, "done", 3, 0, 10),
        ]),
        epic("Audit Trail Expansion", "Maya", "#b91c1c", 11, 11, 2, [
          story("Privileged action logs", "Maya", 2, "todo", 4, 4, 11),
          story("Export audit CSV", "Liam", 2, "inProgress", 3, 2, 11),
          story("Tamper alert webhook", "Ava", 2, "approved", 2, 0, 11),
        ]),
      ],
    },
    {
      title: "Data Platform Evolution",
      assignee: "Noah",
      color: "#06b6d4",
      status: "scheduled",
      startMonth: 11,
      endMonth: 12,
      timelineRow: 8,
      epics: [
        epic("Event Pipeline v3", "Noah", "#0891b2", 11, 11, 1, [
          story("Schema registry support", "Noah", 1, "todo", 5, 5, 11),
          story("Dead-letter queue replay", "Ethan", 1, "inProgress", 4, 2, 11),
          story("Ingestion lag dashboard", "Mia", 1, "done", 3, 0, 11),
        ]),
        epic("Warehouse Freshness", "Liam", "#0e7490", 12, 12, 2, [
          story("Hourly snapshot delta", "Liam", 2, "todo", 4, 4, 12),
          story("Late-arrival backfill", "Ava", 2, "inProgress", 3, 2, 12),
          story("Model contract tests", "Maya", 2, "approved", 2, 0, 12),
        ]),
      ],
    },
    {
      title: "AI Assist Backlog",
      assignee: "Noah",
      color: "#f59e0b",
      status: "backlog",
      startMonth: null,
      endMonth: null,
      timelineRow: 9,
      epics: [
        epic("Prompt Library", "Noah", "#d97706", null, null, null, [
          story("Draft template categories", "Noah", null, "todo", 3, 3, null),
          story("Usage telemetry", "Ethan", null, "todo", 4, 4, null),
          story("Prompt quality rubric", "Ava", null, "todo", 3, 3, null),
        ]),
        epic("Copilot Suggestions", "Maya", "#b45309", null, null, null, [
          story("Context window strategy", "Maya", null, "todo", 5, 5, null),
          story("Hint ranking experiment", "Liam", null, "todo", 4, 4, null),
          story("Safety fallback response", "Noah", null, "todo", 3, 3, null),
        ]),
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

  console.log("Demo seed complete with 10 initiatives.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
