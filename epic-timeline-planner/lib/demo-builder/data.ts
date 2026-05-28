/**
 * Static catalogs used by the demo seeder: team slugs (matches existing
 * `MONTH_TEAM_COLUMNS`), initiative titles + icons, epic title templates
 * keyed by team, story title templates, and a name pool for synthetic
 * WorkspaceUsers (the source images carry no names).
 */

/**
 * The 5 demo teams. Slugs must match existing `MONTH_TEAM_COLUMNS` slugs so
 * sprint capacity / kanban / Gantt all map them to the existing lane styles
 * — we're not creating a new set of teams, just populating the planner with
 * data spread across the ones it already knows about.
 */
export const DEMO_TEAM_SLUGS = ["platform", "mobile", "experience", "data", "growth"] as const;
export type DemoTeamSlug = (typeof DEMO_TEAM_SLUGS)[number];

/** Pretty labels keyed by slug — used for assignee → team mapping and team
 *  filter chips. */
export const DEMO_TEAM_LABELS: Record<DemoTeamSlug, string> = {
  platform: "Platform",
  mobile: "Mobile",
  experience: "Experience",
  data: "Data & analytics",
  growth: "Growth",
};

/**
 * The 10 demo initiatives. Each gets a distinct `timelineRow` (its array
 * index) so the all-quarters Gantt renders them on separate rows with no
 * vertical overlap. `monthSpan` defines the planned window length and
 * `startMonth` the first month — chosen so the 10 initiatives are spread
 * across Q1-Q4 without piling up.
 */
/** One epic's placement within its initiative window: `span` = length in
 *  months (1 = a month, 2 = two months, 3 = a quarter, 4 = quarter + a month);
 *  `gap` = empty months left BEFORE this epic (0 = back-to-back with the
 *  previous one). The 5 epics of an initiative are laid out sequentially, so
 *  they never overlap on the shared timeline row. */
export interface DemoEpicSlot {
  span: number;
  gap: number;
}

export interface DemoInitiativeSeed {
  title: string;
  icon: string;
  /** 1-12, calendar-month start within the plan year. */
  startMonth: number;
  /** Placement of this initiative's 5 epics (one per team). Durations are
   *  deliberately varied — a mix of 1-month, 2-month, quarter (3), and
   *  quarter-plus-a-month (4) epics, with occasional gaps between them — so
   *  the Gantt shows realistic spread instead of uniform one-month blocks.
   *  The initiative's own end month is derived from the last epic's end. */
  epicLayout: DemoEpicSlot[];
}

// Staircase layout: start months cascade so the 10 initiative rows form a
// top-left → bottom-right diagonal on the all-quarters Gantt.
//
// Icons left blank intentionally: the Gantt's `InitiativeTimelineBar`
// hardcodes the initiative bar icon to the lightning-bolt fallback
// (passing `icon={null}` to `InitiativePlanBarIcon`). Seeding empty
// strings here makes the dialog breadcrumb render the same lightning
// bolt — consistent with everywhere else in the app — instead of a
// per-initiative emoji the rest of the UI doesn't surface.
//
// Each `epicLayout` has exactly 5 slots (one epic per team). Spans cover
// 1/2/3/4 months across the dataset so the planner shows a real range of
// epic widths; gaps (>0) leave breathing room between some epics.
export const DEMO_INITIATIVES: DemoInitiativeSeed[] = [
  { title: "Onboarding revamp", icon: "", startMonth: 1, epicLayout: [{ span: 1, gap: 0 }, { span: 2, gap: 0 }, { span: 1, gap: 1 }, { span: 3, gap: 0 }, { span: 1, gap: 1 }] },
  { title: "Payments platform v2", icon: "", startMonth: 1, epicLayout: [{ span: 2, gap: 0 }, { span: 1, gap: 1 }, { span: 4, gap: 0 }, { span: 1, gap: 1 }, { span: 1, gap: 0 }] },
  { title: "Mobile app redesign", icon: "", startMonth: 2, epicLayout: [{ span: 1, gap: 0 }, { span: 3, gap: 0 }, { span: 1, gap: 1 }, { span: 1, gap: 0 }, { span: 2, gap: 1 }] },
  { title: "Analytics data warehouse", icon: "", startMonth: 1, epicLayout: [{ span: 3, gap: 0 }, { span: 1, gap: 1 }, { span: 2, gap: 0 }, { span: 1, gap: 1 }, { span: 1, gap: 0 }] },
  { title: "Growth experiments Q2", icon: "", startMonth: 4, epicLayout: [{ span: 1, gap: 0 }, { span: 2, gap: 0 }, { span: 1, gap: 0 }, { span: 1, gap: 0 }, { span: 1, gap: 0 }] },
  { title: "Search & discovery", icon: "", startMonth: 3, epicLayout: [{ span: 2, gap: 0 }, { span: 1, gap: 1 }, { span: 1, gap: 0 }, { span: 3, gap: 0 }, { span: 1, gap: 0 }] },
  { title: "Reliability & SLOs", icon: "", startMonth: 5, epicLayout: [{ span: 1, gap: 0 }, { span: 2, gap: 0 }, { span: 1, gap: 0 }, { span: 1, gap: 0 }, { span: 1, gap: 0 }] },
  { title: "Customer self-serve", icon: "", startMonth: 3, epicLayout: [{ span: 1, gap: 0 }, { span: 1, gap: 1 }, { span: 3, gap: 0 }, { span: 1, gap: 1 }, { span: 1, gap: 0 }] },
  { title: "AI-assisted workflows", icon: "", startMonth: 2, epicLayout: [{ span: 2, gap: 0 }, { span: 1, gap: 1 }, { span: 1, gap: 0 }, { span: 4, gap: 0 }, { span: 1, gap: 0 }] },
  { title: "Year-end performance push", icon: "", startMonth: 8, epicLayout: [{ span: 1, gap: 0 }, { span: 1, gap: 0 }, { span: 1, gap: 0 }, { span: 1, gap: 0 }, { span: 1, gap: 0 }] },
];

/**
 * Per-team epic title templates. Each initiative gets one epic per team,
 * picked round-robin from these lists with the initiative name prepended
 * so titles stay unique and contextual (e.g. "Mobile · Login flow").
 */
export const DEMO_EPIC_TITLES_BY_TEAM: Record<DemoTeamSlug, string[]> = {
  platform: [
    "API foundations",
    "Auth & permissions",
    "Service mesh upgrade",
    "Background jobs",
    "Observability",
    "Schema migration",
    "Feature flag plumbing",
    "Secrets rotation",
    "Internal admin tooling",
    "Rate limiting",
  ],
  mobile: [
    "Login flow",
    "Push notifications",
    "Offline cache",
    "App-store assets",
    "Native nav refresh",
    "Deeplink coverage",
    "Tablet layouts",
    "Biometrics",
    "iOS 18 polish",
    "Crash-rate reduction",
  ],
  experience: [
    "Onboarding wizard",
    "Empty states",
    "Settings IA",
    "Marketing landing",
    "In-app tour",
    "Design system tokens",
    "Help center polish",
    "Conversion microcopy",
    "Pricing page UX",
    "Accessibility audit",
  ],
  data: [
    "Event tracking spec",
    "ETL pipeline",
    "Reporting cube",
    "Cohort definitions",
    "Funnel dashboards",
    "Data quality alerts",
    "BigQuery cost guardrails",
    "ML feature store",
    "Forecasting model",
    "GDPR data deletion",
  ],
  growth: [
    "Lifecycle emails",
    "Referral program",
    "Paid acquisition funnel",
    "SEO content sprint",
    "Pricing test",
    "Webhooks for partners",
    "Activation tutorial",
    "Trial-to-paid nudge",
    "Re-engagement push",
    "Annual plan upsell",
  ],
};

/**
 * Story templates per team — picked round-robin per epic and prefixed with
 * the epic title so each story reads as something concrete. Length doesn't
 * need to match epic count exactly; we wrap.
 */
export const DEMO_STORY_TEMPLATES_BY_TEAM: Record<DemoTeamSlug, string[]> = {
  platform: [
    "Provision new IAM role",
    "Add health-check endpoint",
    "Switch queue to Redis Streams",
    "Backfill historical rows",
    "Wire structured logging",
    "Bump dependency to latest",
    "Add request-id middleware",
    "Update OpenAPI spec",
    "Cache common queries",
    "Document new env vars",
    "Decompose monolithic handler",
    "Retry on transient errors",
  ],
  mobile: [
    "Wire SwiftUI screen",
    "Update Android theme tokens",
    "Add empty-state illustration",
    "Hook up analytics events",
    "Fix tablet layout regression",
    "Update app-store screenshots",
    "Add deep-link handler",
    "Bump iOS deployment target",
    "Add accessibility labels",
    "Profile cold-start time",
    "Wire push notification token sync",
    "Add error toast for offline",
  ],
  experience: [
    "Tweak onboarding copy",
    "Add micro-animation",
    "Fix mobile-safari overflow",
    "Update Figma library",
    "Add tooltip explanations",
    "Polish empty-state CTA",
    "Improve focus rings",
    "Rebalance typography scale",
    "Add success confetti",
    "Tighten margins on form",
    "Add keyboard shortcut hints",
    "Polish color contrast",
  ],
  data: [
    "Add unit tests for transform",
    "Document warehouse schema",
    "Investigate row-count drop",
    "Update Looker view",
    "Add data freshness SLA",
    "Backfill 90 days of events",
    "Audit PII fields",
    "Add cohort sample query",
    "Wire alert for null spikes",
    "Optimize join order",
    "Add dbt snapshot",
    "Document KPI definitions",
  ],
  growth: [
    "Draft email subject lines",
    "Set up A/B test bucket",
    "Wire conversion event",
    "Schedule send window",
    "Build referral landing page",
    "Add UTM parameters",
    "Audit funnel drop-off",
    "Update pricing copy",
    "Add segment for trial users",
    "Tune retargeting audience",
    "Write blog launch post",
    "Update help center FAQ",
  ],
};

/**
 * Per-team demo user names. The FIRST FIVE names of each delivery-trio team
 * (platform / experience / data) intentionally start with the same first
 * names as `defaultMembersForTeam` in `lib/sprint-capacity.ts` (Paige,
 * Perry, Poppy, Petra, Pascal etc.) so the sprint-kanban / capacity chip
 * dedup picks up the directory user's photo — otherwise the default
 * roster's bare first-name chip ("Paige") appears alongside the directory
 * chip ("Paige Cohen") and the user sees an avatarless chip.
 * Mobile + Growth teams aren't in the default roster, so any names work.
 */
export const DEMO_USER_NAMES_BY_TEAM: Record<DemoTeamSlug, readonly string[]> = {
  platform: [
    "Paige Cohen", "Perry Brown", "Poppy Chen", "Petra Davis", "Pascal Evans",
    "Priya Sharma", "Quentin Hart", "Sara Cohen",
  ],
  mobile: [
    "Maya Patel", "Liam Foster", "Noah Chen", "Olivia Garcia", "Bryce Patel",
    "Carmen Liu", "Diego Reyes", "Felix Brown",
  ],
  experience: [
    "Elena Wang", "Erin Lindqvist", "Evan Hall", "Edith Janssen", "Emma Johnson",
    "Gianna Singh", "Hugo Bernard", "Inga Larsson",
  ],
  data: [
    "Alice Khan", "Aaron Mendel", "Aria Mendez", "Asher Holt", "Aiden O'Brien",
    "Beatrice Caron", "Camille Roy",
  ],
  growth: [
    "Rafael Souza", "Wesley Tan", "Yara Haddad", "Zach Mendoza", "Lior Shapira",
    "Nico Russo", "Omar Khalil",
  ],
};

/** Short, demo-friendly description templates. Keyed nothing in particular —
 *  we just pick from the list with a hash so most items have one. */
export const DEMO_INITIATIVE_DESCRIPTIONS: string[] = [
  "Cross-team initiative to ship the next major version. Outcome metrics tracked in the launch dashboard.",
  "Multi-quarter program to modernize core systems and reduce on-call load.",
  "Strategic bet aligned with the OKR for the half. Quarterly checkpoints with the steering committee.",
  "Customer-driven workstream — top of the qualitative research list from last quarter.",
  "Foundational work that unblocks several downstream product initiatives.",
];

export const DEMO_EPIC_DESCRIPTIONS: string[] = [
  "Implementation slice for this initiative. Ships behind a feature flag, dialed up gradually.",
  "Targeted improvements to address pain points surfaced in the last user research round.",
  "Tech foundation milestone — no user-facing change, but unblocks the next set of stories.",
  "Cleanup + refactor pass. No new features, but pays down debt that was slowing the team.",
  "Bug-bash + polish epic to clear the top regressions before the release.",
];

export const DEMO_STORY_DESCRIPTIONS: string[] = [
  "Standard implementation task — see the design doc linked in the epic description for details.",
  "Refactor + tests. Should not change behavior; verify with the existing snapshot suite.",
  "Wire up the new endpoint and add the JSON-schema validation.",
  "UI polish — match the Figma spec and update the Storybook story.",
  "Investigate and root-cause the regression reported in last week's support tickets.",
];

/** Label pools — initiatives / epics / stories pull a few at random. */
export const DEMO_LABELS_POOL: string[] = [
  "tech-debt", "high-priority", "customer-request", "infra", "ux",
  "research", "experiment", "compliance", "accessibility", "performance",
  "security", "Q2-goal", "needs-design", "blocked", "spike",
];

/**
 * Flat fallback name pool — used only if a team's specific list runs out
 * (shouldn't happen at 38 users, but defensive). Mix of common first / last
 * names. Order is stable for deterministic seeding.
 */
export const DEMO_NAME_POOL: string[] = [
  "Quinn O'Neil", "Tomás Vidal", "Uma Khan", "Vivian Adler", "Xiulan Zhao",
  "Iris Murphy", "Javier Lee", "Kira Nakamura", "Dante Fontana", "Eitan Levi",
  "Farah Ahmed", "Greta Reyes", "Jonas Weber", "Kasia Wójcik", "Mira Patel",
  "Rosa Estevez", "Soren Holt", "Talia Schmidt", "Ulises Vega", "Vera Ivanova",
  "Wendell Brooks", "Xavi Puig", "Yossi Avraham", "Zara Hussain", "Anya Petrov",
  "Bram Janssen", "Cleo Fontaine", "Devon Hughes", "Esme Costa", "Finn Doherty",
];
