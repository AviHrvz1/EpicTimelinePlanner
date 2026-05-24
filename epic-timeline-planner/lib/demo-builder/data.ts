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
export interface DemoInitiativeSeed {
  title: string;
  icon: string;
  /** 1-12, calendar-month start within the plan year. */
  startMonth: number;
  /** Number of months the initiative spans (inclusive). */
  monthSpan: number;
}

// Staircase layout: start months cascade across the year so the 10 initiative
// rows form a top-left → bottom-right diagonal on the all-quarters Gantt.
// Spans vary 5-8 months so the epic-chaining math (5 slots = monthSpan/5)
// naturally produces mixed widths — some 1-month epics (= 2 sprints, the
// minimum needed for the title to render) and some 2-month epics, instead
// of every epic being identical. Each row's epics still chain
// non-overlappingly.
//
//   span 5 → widths [1,1,1,1,1]
//   span 6 → widths [1,1,1,1,2]
//   span 7 → widths [1,1,2,1,2]
//   span 8 → widths [1,2,1,2,2]
export const DEMO_INITIATIVES: DemoInitiativeSeed[] = [
  { title: "Onboarding revamp", icon: "🚀", startMonth: 1, monthSpan: 5 },
  { title: "Payments platform v2", icon: "💳", startMonth: 1, monthSpan: 8 },
  { title: "Mobile app redesign", icon: "📱", startMonth: 2, monthSpan: 6 },
  { title: "Analytics data warehouse", icon: "📊", startMonth: 3, monthSpan: 7 },
  { title: "Growth experiments Q2", icon: "🌱", startMonth: 4, monthSpan: 6 },
  { title: "Search & discovery", icon: "🔎", startMonth: 4, monthSpan: 7 },
  { title: "Reliability & SLOs", icon: "🛡️", startMonth: 5, monthSpan: 6 },
  { title: "Customer self-serve", icon: "🤝", startMonth: 6, monthSpan: 6 },
  { title: "AI-assisted workflows", icon: "🤖", startMonth: 7, monthSpan: 6 },
  { title: "Year-end performance push", icon: "🏁", startMonth: 8, monthSpan: 5 },
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
 * 60-name pool — we draw the first N (one per uploaded avatar) and pair them
 * positionally with the avatar URLs. Mix of common first / last names so the
 * directory feels populated without obvious duplicates. Order matters only
 * for determinism (the same number of avatars always gets the same names).
 */
export const DEMO_NAME_POOL: string[] = [
  "Alice Cohen", "Bryce Patel", "Carmen Liu", "Diego Reyes", "Elena Wang",
  "Felix Brown", "Gianna Singh", "Hassan Park", "Iris Murphy", "Javier Lee",
  "Kira Nakamura", "Liam Foster", "Maya Patel", "Noah Chen", "Olivia Garcia",
  "Priya Sharma", "Quinn O'Neil", "Rafael Souza", "Sara Cohen", "Tomás Vidal",
  "Uma Khan", "Vivian Adler", "Wesley Tan", "Xiulan Zhao", "Yara Haddad",
  "Zach Mendoza", "Aaron Mendel", "Beatrice Caron", "Camille Roy", "Dante Fontana",
  "Eitan Levi", "Farah Ahmed", "Greta Lindqvist", "Hugo Bernard", "Inga Larsson",
  "Jonas Weber", "Kasia Wójcik", "Lior Shapira", "Mira Patel", "Nico Russo",
  "Omar Khalil", "Petra Novak", "Quentin Hart", "Rosa Estevez", "Soren Holt",
  "Talia Schmidt", "Ulises Vega", "Vera Ivanova", "Wendell Brooks", "Xavi Puig",
  "Yossi Avraham", "Zara Hussain", "Anya Petrov", "Bram Janssen", "Cleo Fontaine",
  "Devon Hughes", "Esme Costa", "Finn Doherty", "Gisela Mora", "Hank Carter",
];
