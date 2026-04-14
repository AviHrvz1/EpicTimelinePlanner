const { PrismaClient } = require("../lib/generated/prisma");

const prisma = new PrismaClient();
const YEAR = 2026;

function story(title, assignee, sprint, status, estimatedDays, daysLeft) {
  return {
    title,
    assignee,
    sprint,
    status,
    estimatedDays,
    daysLeft,
  };
}

async function main() {
  await prisma.storyComment.deleteMany();
  await prisma.storyHistory.deleteMany();
  await prisma.userStory.deleteMany();
  await prisma.epicComment.deleteMany();
  await prisma.epicHistory.deleteMany();
  await prisma.epic.deleteMany();
  await prisma.initiativeComment.deleteMany();
  await prisma.initiativeHistory.deleteMany();
  await prisma.initiative.deleteMany();

  await prisma.initiative.create({
    data: {
      title: "Onboarding Modernization",
      icon: "🎯",
      assignee: "Maya",
      color: "#3b82f6",
      status: "scheduled",
      startMonth: 2,
      endMonth: 4,
      timelineRow: 0,
      year: YEAR,
      epics: {
        create: [
          {
            title: "Signup Flow Refresh",
            assignee: "Maya",
            color: "#2563eb",
            planSprint: 1,
            planStartMonth: 2,
            planEndMonth: 2,
            userStories: {
              create: [
                story("New signup stepper UI", "Liam", 1, "inProgress", 6, 3),
                story("Inline validation hints", "Ava", 1, "todo", 4, 4),
                story("Email verification fallback", "Noah", null, "todo", 3, 3),
                story("Accessibility keyboard pass", "Liam", 1, "done", 2, 0),
              ],
            },
          },
          {
            title: "Profile Completion Nudge",
            assignee: "Noah",
            color: "#1d4ed8",
            planSprint: 2,
            planStartMonth: 2,
            planEndMonth: 2,
            userStories: {
              create: [
                story("Progress bar in header", "Mia", 2, "todo", 5, 5),
                story("Email reminder cadence", "Ethan", 2, "inProgress", 3, 2),
                story("Drop-off analytics event", "Mia", 2, "approved", 2, 0),
              ],
            },
          },
        ],
      },
    },
  });

  await prisma.initiative.create({
    data: {
      title: "Sprint Reliability Program",
      icon: "🎯",
      assignee: "Ethan",
      color: "#0ea5e9",
      status: "scheduled",
      startMonth: 2,
      endMonth: 3,
      timelineRow: 1,
      year: YEAR,
      epics: {
        create: [
          {
            title: "CI Flake Cleanup",
            assignee: "Ethan",
            color: "#0284c7",
            planSprint: 1,
            planStartMonth: 2,
            planEndMonth: 2,
            userStories: {
              create: [
                story("Retry policy for flaky tests", "Ethan", 1, "todo", 4, 4),
                story("Cache test artifacts", "Liam", 1, "done", 3, 0),
                story("Parallel test shard balancing", "Noah", 1, "inProgress", 5, 2),
              ],
            },
          },
          {
            title: "Release Gate Automation",
            assignee: "Ava",
            color: "#0369a1",
            planSprint: 2,
            planStartMonth: 2,
            planEndMonth: 2,
            userStories: {
              create: [
                story("Auto rollback checklist", "Ava", 2, "todo", 4, 4),
                story("Slack release digest", "Maya", 2, "inProgress", 3, 1),
                story("Manual approval step", "Ava", null, "todo", 2, 2),
              ],
            },
          },
        ],
      },
    },
  });

  await prisma.initiative.create({
    data: {
      title: "Insights & Reporting",
      icon: "🎯",
      assignee: "Ava",
      color: "#8b5cf6",
      status: "scheduled",
      startMonth: 3,
      endMonth: 5,
      timelineRow: 2,
      year: YEAR,
      epics: {
        create: [
          {
            title: "Executive Dashboard v2",
            assignee: "Ava",
            color: "#7c3aed",
            userStories: {
              create: [
                story("KPI trend chart", "Mia", null, "todo", 5, 5),
                story("Regional split widgets", "Liam", null, "todo", 4, 4),
              ],
            },
          },
        ],
      },
    },
  });

  await prisma.initiative.create({
    data: {
      title: "AI Assist Backlog",
      icon: "🎯",
      assignee: "Noah",
      color: "#f97316",
      status: "backlog",
      timelineRow: 3,
      year: YEAR,
      epics: {
        create: [
          {
            title: "Prompt Library",
            assignee: "Noah",
            color: "#ea580c",
            userStories: {
              create: [
                story("Draft template categories", "Noah", null, "todo", 3, 3),
                story("Usage telemetry", "Ethan", null, "todo", 4, 4),
              ],
            },
          },
        ],
      },
    },
  });

  console.log("Demo seed complete.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
