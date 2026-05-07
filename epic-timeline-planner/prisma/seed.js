const { PrismaClient } = require("../lib/generated/prisma");
const prisma = new PrismaClient();
const YEAR = 2026;

// ─── helpers ───────────────────────────────────────────────────────────────

function quarterFromMonth(m) {
  if (!m) return null;
  if (m <= 3) return 1;
  if (m <= 6) return 2;
  if (m <= 9) return 3;
  return 4;
}

function story(title, assignee, sprint, status, estimatedDays, daysLeft, month, description = null) {
  return {
    title, assignee,
    planYear: YEAR,
    planQuarter: quarterFromMonth(month),
    sprint, status, estimatedDays, daysLeft,
    ...(description ? { description } : {}),
  };
}

function sw(title, assignee, sprint, status, estimatedDays, daysLeft, month, snapshots, description = null) {
  const base = story(title, assignee, sprint, status, estimatedDays, daysLeft, month, description);
  if (!snapshots) return base;
  return { ...base, snapshots: { create: snapshots } };
}

function snap(isoDate, status, sprint, estimatedDays, daysLeft, assignee) {
  return { snapshotDate: new Date(isoDate), status, sprint, estimatedDays, daysLeft, assignee };
}

function epic(title, assignee, color, startMonth, endMonth, planSprint, stories, team, endSprint = 2, description = null) {
  return {
    title, assignee, color,
    planYear: YEAR,
    planQuarter: quarterFromMonth(startMonth),
    planSprint,
    planStartMonth: startMonth,
    planEndMonth: endMonth ?? startMonth,
    planEndSprint: endSprint,
    team,
    ...(description ? { description } : {}),
    userStories: { create: stories },
  };
}

// ─── snapshot date ranges per sprint ────────────────────────────────────────
const SD = {
  1: ["2026-01-01","2026-01-05","2026-01-08","2026-01-12","2026-01-14"],
  2: ["2026-01-15","2026-01-19","2026-01-23","2026-01-27","2026-01-31"],
  3: ["2026-02-01","2026-02-05","2026-02-09","2026-02-12","2026-02-14"],
  4: ["2026-02-15","2026-02-19","2026-02-22","2026-02-25","2026-02-28"],
  5: ["2026-03-01","2026-03-05","2026-03-09","2026-03-12","2026-03-14"],
  6: ["2026-03-15","2026-03-19","2026-03-23","2026-03-27","2026-03-31"],
  7: ["2026-04-01","2026-04-05","2026-04-08","2026-04-12","2026-04-14"],
  8: ["2026-04-15","2026-04-19","2026-04-23","2026-04-27","2026-04-30"],
  9: ["2026-05-01","2026-05-03","2026-05-05","2026-05-07"],
};

// pct of estDays remaining at each snapshot date
const PATTERNS = {
  ahead:   [1.00, 0.50, 0.20, 0.00, 0.00],  // Platform: burns fast, consistently ahead
  steady:  [1.00, 0.70, 0.40, 0.10, 0.00],  // Experience: even, predictable
  behind:  [1.00, 1.00, 0.70, 0.30, 0.00],  // struggling: slow start, rushes at end
  creep:   [1.00, 1.00, 0.70, 0.35, 0.00],  // scope creep: use makeSnapsCreep
  // sprint 9 partial (4 dates: May 1,3,5,7)
  ahead9:  [1.00, 0.60, 0.30, 0.15],        // Platform sprint 9: well ahead
  steady9: [1.00, 0.80, 0.55, 0.35],        // Experience sprint 9: on track
  behind9: [1.00, 1.00, 0.85, 0.70],        // slow teams sprint 9: barely moving
  done9:   [1.00, 0.55, 0.00, 0.00],        // finished early in sprint 9
};

function makeSnaps(sprint, assignee, est, patternKey) {
  const dates = SD[sprint];
  const pcts = PATTERNS[patternKey];
  if (!dates || !pcts) return [];
  return dates.map((d, i) => {
    const pct = pcts[i] !== undefined ? pcts[i] : 0;
    const rem = Math.ceil(est * pct);
    const st = rem === 0 ? "done" : pct === 1.0 && i < 2 ? "todo" : "inProgress";
    return snap(d + "T08:00:00.000Z", st, sprint, est, rem, assignee);
  });
}

// scope creep: estDays increases from estOrig → estNew at snapshot index 2
function makeSnapsCreep(sprint, assignee, estOrig, estNew) {
  const dates = SD[sprint];
  if (!dates) return [];
  const ests = [estOrig, estOrig, estNew, estNew, estNew].slice(0, dates.length);
  const rems = [estOrig, estOrig, Math.ceil(estNew * 0.70), Math.ceil(estNew * 0.35), 0].slice(0, dates.length);
  return dates.map((d, i) => snap(
    d + "T08:00:00.000Z",
    rems[i] === 0 ? "done" : rems[i] === ests[i] ? "todo" : "inProgress",
    sprint, ests[i], rems[i], assignee
  ));
}

// daysLeft for sprint-9 current stories
function daysLeft9(est, patternKey) {
  const pcts = PATTERNS[patternKey];
  if (!pcts) return est;
  return Math.ceil(est * pcts[3]);
}

async function main() {
  // ─── wipe ──────────────────────────────────────────────────────────────
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

  // ─── initiatives ───────────────────────────────────────────────────────
  const initiatives = [

    // ══════════════════════════════════════════════════════════════════════
    // 1. Core Infrastructure Modernization — Platform — months 1-4 — DONE
    //    Pattern: ahead (strong team, consistently finishes early)
    // ══════════════════════════════════════════════════════════════════════
    {
      title: "Core Infrastructure Modernization",
      assignee: "Perry",
      color: "#0ea5e9",
      status: "scheduled",
      startMonth: 1,
      endMonth: 4,
      timelineRow: 0,
      description: "Modernize our core infrastructure stack to support 10x growth over the next two years. Migrate to service mesh architecture using Envoy, implement database sharding for horizontal scalability, and upgrade Kubernetes clusters to the latest LTS release. This initiative unblocks all product teams from current infrastructure bottlenecks.",
      epics: [
        epic("Service Mesh Migration", "Perry", "#0284c7", 1, 2, 1, [
          sw("Replace direct service calls with Envoy proxy", "Perry", 1, "done", 5, 0, 1,
            makeSnaps(1, "Perry", 5, "ahead"),
            "Instrument all inter-service HTTP calls to route through Envoy sidecars. Validate zero-regression on latency p99 before cutover."),
          sw("Configure mTLS for inter-service communications", "Paige", 1, "done", 4, 0, 1,
            makeSnaps(1, "Paige", 4, "ahead"),
            "Enable mutual TLS on all service-to-service channels. Provision certificates via cert-manager and automate rotation."),
          sw("Sidecar injection for auth and session services", "Poppy", 2, "done", 4, 0, 1,
            makeSnaps(2, "Poppy", 4, "ahead"),
            "Auto-inject Envoy sidecars into the auth and session namespaces. Update Helm charts and verify health checks."),
          sw("Service health check and readiness endpoints", "Petra", 2, "done", 3, 0, 1,
            makeSnaps(2, "Petra", 3, "ahead"),
            "Standardize /healthz and /readyz endpoints across all mesh-enrolled services following the k8s probe contract."),
          sw("Traffic metrics and Grafana alert rules", "Pascal", 2, "done", 5, 0, 1,
            makeSnaps(2, "Pascal", 5, "ahead"),
            "Expose Envoy metrics to Prometheus. Build Grafana dashboard with P50/P95/P99 latency and create PagerDuty-linked alert rules."),
          sw("Circuit-breaker policies for downstream calls", "Perry", 2, "done", 4, 0, 1,
            makeSnaps(2, "Perry", 4, "ahead"),
            "Configure Envoy outlier detection and circuit-breaker thresholds on all critical downstream dependencies."),
        ], "platform", 2,
          "Migrate all inter-service communication to Envoy service mesh to gain observability, mTLS, and circuit-breaking with zero application-code changes."),

        epic("Database Sharding", "Paige", "#0369a1", 2, 3, 1, [
          sw("Shard key strategy and design document", "Perry", 3, "done", 5, 0, 2,
            makeSnaps(3, "Perry", 5, "ahead"),
            "Analyze access patterns across top-10 tables. Select user_id as the primary shard key and document the routing strategy for cross-shard queries."),
          sw("Cross-shard query router service", "Paige", 3, "done", 6, 0, 2,
            makeSnaps(3, "Paige", 6, "ahead"),
            "Build a query router layer that transparently fans out cross-shard SELECTs, merges results, and handles pagination consistently."),
          sw("Data migration and backfill tooling", "Poppy", 4, "done", 5, 0, 2,
            makeSnaps(4, "Poppy", 5, "ahead"),
            "Write idempotent migration scripts to backfill data into the sharded schema. Include dry-run mode, progress tracking, and rollback capability."),
          sw("Shard rebalancer daemon", "Petra", 4, "done", 4, 0, 2,
            makeSnaps(4, "Petra", 4, "ahead"),
            "Implement background daemon that monitors shard hot-spots and triggers automatic rebalancing during low-traffic windows."),
          sw("Write path sharding rollout", "Pascal", 5, "done", 5, 0, 3,
            makeSnaps(5, "Pascal", 5, "ahead"),
            "Route all write operations through the new sharded write path behind a feature flag. Perform staged rollout at 1% → 10% → 100%."),
          sw("Read replica routing update", "Perry", 5, "done", 4, 0, 3,
            makeSnaps(5, "Perry", 4, "ahead"),
            "Update read path to select the nearest shard replica, eliminating all cross-shard read hops that currently add 40-80ms latency."),
        ], "platform", 2,
          "Implement horizontal database sharding keyed on user_id to eliminate the write bottleneck on the monolithic users table and unlock sub-10ms query times at 100M rows."),

        epic("Kubernetes Upgrade", "Poppy", "#075985", 3, 4, 2, [
          sw("Upgrade control plane to Kubernetes v1.28", "Perry", 6, "done", 5, 0, 3,
            makeSnaps(6, "Perry", 5, "ahead"),
            "Upgrade all control-plane components (kube-apiserver, etcd, kube-scheduler, kube-controller-manager) to v1.28 in staging first, then production."),
          sw("Migrate deprecated PodSecurityPolicy manifests", "Paige", 6, "done", 6, 0, 3,
            makeSnaps(6, "Paige", 6, "ahead"),
            "PSP API removed in v1.25. Audit all 47 PSP manifests and replace with equivalent Pod Security Admission (PSA) labels."),
          sw("Node pool rolling update", "Poppy", 7, "done", 4, 0, 4,
            makeSnaps(7, "Poppy", 4, "ahead"),
            "Drain and replace all existing node pools with v1.28 images. Use PodDisruptionBudgets to ensure zero downtime during rotation."),
          sw("Cluster autoscaler tuning for new node sizes", "Petra", 7, "done", 5, 0, 4,
            makeSnaps(7, "Petra", 5, "ahead"),
            "Benchmark new m6g.2xlarge ARM instances. Update autoscaler configs and bin-packing parameters to reduce idle node cost by ~25%."),
          sw("Production canary rollout with 10% traffic slice", "Pascal", 8, "done", 4, 0, 4,
            makeSnaps(8, "Pascal", 4, "ahead"),
            "Validate v1.28 cluster under real traffic using Flagger canary. Monitor error rate, latency, and memory pressure for 48 hours before full cut."),
          sw("Network policy hardening and egress rules", "Perry", 8, "done", 5, 0, 4,
            makeSnaps(8, "Perry", 5, "ahead"),
            "Implement default-deny NetworkPolicies for all namespaces. Whitelist only required egress destinations identified in the security audit."),
        ], "platform", 2,
          "Upgrade all clusters from k8s v1.23 to v1.28 to gain access to new autoscaling features, fix security CVEs, and remove deprecated APIs that block future tooling upgrades."),
      ],
    },

    // ══════════════════════════════════════════════════════════════════════
    // 2. Mobile App Redesign — Mobile — months 1-3 — DONE
    //    Pattern: behind (slow progress, scope creep, barely finishes)
    // ══════════════════════════════════════════════════════════════════════
    {
      title: "Mobile App Redesign",
      assignee: "Marcus",
      color: "#f97316",
      status: "scheduled",
      startMonth: 1,
      endMonth: 3,
      timelineRow: 1,
      description: "Complete visual and structural overhaul of the iOS and Android apps to address mounting user feedback on navigation confusion and visual inconsistency. Redesign navigation patterns, implement a shared design system, and add offline capabilities so the app remains usable in low-connectivity environments.",
      epics: [
        epic("Navigation Overhaul", "Marcus", "#ea580c", 1, 2, 1, [
          sw("Tab bar and bottom nav redesign", "Marcus", 1, "done", 5, 0, 1,
            makeSnaps(1, "Marcus", 5, "behind"),
            "Replace hamburger menu with persistent tab bar. Validate information architecture with 15 user interviews before implementing."),
          sw("Gesture navigation support for Android 10+", "Maya", 1, "done", 4, 0, 1,
            makeSnapsCreep(1, "Maya", 4, 5),
            "Support Android gesture navigation (edge-swipe back). Resolve conflicts with custom swipe handlers in the photo viewer and carousel."),
          sw("Deep link routing rewrite", "Miles", 2, "done", 6, 0, 1,
            makeSnaps(2, "Miles", 6, "behind"),
            "Replace legacy deep link scheme with App Links (Android) and Universal Links (iOS). Map all 140 existing deep link routes to the new schema."),
          sw("Back stack management and history fix", "Mia", 2, "done", 4, 0, 1,
            makeSnaps(2, "Mia", 4, "behind"),
            "Fix inconsistent back-stack behaviour when navigating across bottom tabs. Implement a deterministic navigation state machine."),
          sw("Navigation transition animations", "Morgan", 2, "done", 3, 0, 1,
            makeSnaps(2, "Morgan", 3, "behind"),
            "Add 200ms shared-element transitions between primary and detail screens to match the redesigned motion language."),
        ], "mobile", 2,
          "Restructure navigation from hamburger-menu pattern to persistent tab bar with gesture support, eliminating the #1 UX complaint in app store reviews."),

        epic("Design System v2", "Maya", "#c2410c", 2, 3, 1, [
          sw("Design token system (color, spacing, type)", "Marcus", 3, "done", 5, 0, 2,
            makeSnaps(3, "Marcus", 5, "behind"),
            "Define semantic token layers (global → alias → component) for color, spacing, radius, and typography. Publish as a shared package consumed by both iOS and Android."),
          sw("Button and action component rewrite", "Maya", 3, "done", 4, 0, 2,
            makeSnaps(3, "Maya", 4, "behind"),
            "Replace 12 ad-hoc button variants with a single design-system Button with state machine (idle/loading/success/error) and accessibility labels."),
          sw("Form field components (input, select, picker)", "Miles", 4, "done", 5, 0, 2,
            makeSnapsCreep(4, "Miles", 5, 7),
            "Build unified FormField wrapper handling validation, error messages, and keyboard avoidance. Cover text input, dropdown select, and date picker."),
          sw("Color theme engine (light/dark/high-contrast)", "Mia", 4, "done", 4, 0, 2,
            makeSnaps(4, "Mia", 4, "behind"),
            "Implement real-time theme switching by binding all UI to semantic color tokens. Add high-contrast accessibility theme to comply with WCAG 2.1 AA."),
          sw("Component Storybook with visual regression tests", "Morgan", 5, "done", 5, 0, 3,
            makeSnaps(5, "Morgan", 5, "behind"),
            "Set up Storybook for React Native with all 28 design-system components. Wire into CI to catch visual regressions on every PR."),
          sw("Migration guide and legacy component deprecation", "Marcus", 5, "done", 3, 0, 3,
            makeSnaps(5, "Marcus", 3, "behind"),
            "Document migration path from legacy components. Add console warnings on deprecated components with target removal in v3.0."),
        ], "mobile", 2,
          "Build a shared design-system token layer for iOS and Android that eliminates visual inconsistency and reduces per-feature styling effort by ~60%."),

        epic("Offline Mode", "Miles", "#9a3412", 3, 3, 1, [
          sw("SQLite local schema and migration system", "Marcus", 5, "done", 5, 0, 3,
            makeSnaps(5, "Marcus", 5, "behind"),
            "Design offline-first SQLite schema mirroring core API entities. Implement versioned migrations to handle schema changes without data loss."),
          sw("Sync conflict resolution engine", "Maya", 6, "done", 6, 0, 3,
            makeSnapsCreep(6, "Maya", 6, 8),
            "Build last-write-wins + CRDT hybrid conflict resolver for entities that can be edited offline by multiple users (notes, checklists)."),
          sw("Offline write queue and retry mechanism", "Miles", 6, "done", 5, 0, 3,
            makeSnaps(6, "Miles", 5, "behind"),
            "Queue all writes during offline state. Retry with exponential backoff on reconnection. Surface pending count and error state in UI."),
          sw("Background sync service", "Mia", 6, "done", 4, 0, 3,
            makeSnaps(6, "Mia", 4, "behind"),
            "Register iOS BGProcessingTask and Android WorkManager job to sync delta data every 15 minutes when the app is backgrounded."),
          sw("Connectivity status banner and offline UX", "Morgan", 6, "done", 3, 0, 3,
            makeSnaps(6, "Morgan", 3, "behind"),
            "Show persistent offline banner with last-synced timestamp. Disable irreversible actions (delete, publish) until reconnected."),
        ], "mobile", 2,
          "Make the core app experience fully functional without an internet connection, syncing changes bidirectionally when connectivity is restored."),
      ],
    },

    // ══════════════════════════════════════════════════════════════════════
    // 3. Data Platform 2.0 — Data — months 2-4 — DONE
    //    Pattern: slow start, scope creep, catches up in sprint 2
    // ══════════════════════════════════════════════════════════════════════
    {
      title: "Data Platform 2.0",
      assignee: "Alice",
      color: "#8b5cf6",
      status: "scheduled",
      startMonth: 2,
      endMonth: 4,
      timelineRow: 2,
      description: "Rebuild our data infrastructure around a modern streaming architecture and a cloud-native data lake. The current batch-pipeline approach adds 6-12 hours of data lag, blocks real-time product decisions, and creates costly operational overhead. Version 2.0 targets sub-minute data freshness, 10× query performance, and self-serve access for analysts.",
      epics: [
        epic("Streaming Pipeline", "Alice", "#7c3aed", 2, 3, 1, [
          sw("Kafka cluster setup and topic schema registry", "Alice", 3, "done", 5, 0, 2,
            makeSnaps(3, "Alice", 5, "behind"),
            "Provision a 3-broker Kafka cluster. Define Avro schemas for core event types and register in Confluent Schema Registry to enforce compatibility."),
          sw("ETL job migration to Kafka Streams", "Aaron", 3, "done", 6, 0, 2,
            makeSnapsCreep(3, "Aaron", 6, 8),
            "Rewrite the 8 highest-volume ETL jobs as stateless Kafka Streams processors. Validate output parity against the batch jobs before decommissioning."),
          sw("Dead-letter queue and poison-pill handling", "Aria", 4, "done", 4, 0, 2,
            makeSnaps(4, "Aria", 4, "behind"),
            "Route malformed or repeatedly-failing messages to a DLQ topic. Build an ops dashboard to replay or discard DLQ messages with audit trail."),
          sw("Consumer lag monitoring and auto-scaler", "Asher", 4, "done", 5, 0, 2,
            makeSnaps(4, "Asher", 5, "behind"),
            "Export Kafka consumer-group lag to Datadog. Trigger horizontal pod autoscaling when any consumer group falls more than 50k messages behind."),
          sw("End-to-end data freshness SLA dashboard", "Aiden", 4, "done", 4, 0, 2,
            makeSnaps(4, "Aiden", 4, "behind"),
            "Build a Grafana board tracking event ingestion latency from source-emit to sink-write. Alert oncall if p99 freshness exceeds 60 seconds."),
        ], "data", 2,
          "Replace nightly batch ETL with real-time Kafka Streams pipelines, reducing data freshness from 8 hours to under 60 seconds for core product events."),

        epic("Data Lake Redesign", "Aaron", "#6d28d9", 3, 4, 1, [
          sw("Iceberg table format migration", "Alice", 5, "done", 6, 0, 3,
            makeSnaps(5, "Alice", 6, "behind"),
            "Convert all 320 Parquet tables in S3 to Apache Iceberg format for ACID transactions, time-travel queries, and schema evolution support."),
          sw("Partition pruning and Z-order clustering", "Aaron", 5, "done", 5, 0, 3,
            makeSnapsCreep(5, "Aaron", 5, 7),
            "Apply Z-order clustering on (user_id, event_date) columns on the 5 hottest tables. Measure query speedup vs. baseline in Athena."),
          sw("Data catalog with column-level lineage", "Aria", 6, "done", 5, 0, 3,
            makeSnaps(6, "Aria", 5, "behind"),
            "Integrate DataHub to auto-catalog all Iceberg tables. Capture column-level lineage from dbt transforms to surface data dependencies in the UI."),
          sw("Row-level access policies for PII tables", "Asher", 6, "done", 4, 0, 3,
            makeSnaps(6, "Asher", 4, "behind"),
            "Implement Apache Ranger row-filter policies on tables containing PII. Only analysts with explicit grants can query email and phone columns."),
          sw("Automated data quality checks with Great Expectations", "Aiden", 6, "done", 5, 0, 3,
            makeSnaps(6, "Aiden", 5, "behind"),
            "Add Great Expectations suites to all 32 dbt models. Fail CI on data quality regressions and alert the owning team in Slack."),
        ], "data", 2,
          "Migrate data lake storage to Apache Iceberg for ACID transactions, schema evolution, and time-travel, enabling reliable self-serve analytics at petabyte scale."),

        epic("Real-time Metrics API", "Aria", "#5b21b6", 4, 4, 1, [
          sw("GraphQL subscription layer on top of Kafka", "Alice", 7, "done", 6, 0, 4,
            makeSnaps(7, "Alice", 6, "behind"),
            "Expose a GraphQL subscription endpoint that fans out from Kafka topics, allowing dashboards and product features to receive push updates without polling."),
          sw("Metric materialized views in Redis", "Aaron", 7, "done", 5, 0, 4,
            makeSnapsCreep(7, "Aaron", 5, 7),
            "Pre-aggregate the 20 most-queried metric rollups (DAU, revenue, conversion) into Redis sorted sets updated on every Kafka event."),
          sw("API rate limiting and quota management", "Aria", 8, "done", 4, 0, 4,
            makeSnaps(8, "Aria", 4, "behind"),
            "Implement per-consumer rate limits (1000 req/min default, 10k for internal services) using a token-bucket algorithm backed by Redis."),
          sw("SDK for embedding real-time charts in product", "Asher", 8, "done", 5, 0, 4,
            makeSnaps(8, "Asher", 5, "behind"),
            "Publish a typed React SDK wrapping the GraphQL subscriptions API. Include chart components for line, bar, and funnel with automatic reconnect on drop."),
          sw("Load testing and SLA certification", "Aiden", 8, "done", 4, 0, 4,
            makeSnaps(8, "Aiden", 4, "behind"),
            "Run k6 load tests at 5× projected peak (50k concurrent subscribers). Document P99 latency and certify the API against the 200ms SLA."),
        ], "data", 2,
          "Build a real-time metrics API layer on top of Kafka that delivers sub-200ms push updates to dashboards and product features, eliminating polling anti-patterns."),
      ],
    },

    // ══════════════════════════════════════════════════════════════════════
    // 4. Growth Engine — Growth — months 3-6 — IN PROGRESS
    //    Pattern: sprints 5-6 behind, sprints 7-8 great, sprint 9 behind
    // ══════════════════════════════════════════════════════════════════════
    {
      title: "Growth Engine",
      assignee: "Grace",
      color: "#10b981",
      status: "scheduled",
      startMonth: 3,
      endMonth: 6,
      timelineRow: 3,
      description: "Build the first-generation growth infrastructure to accelerate user acquisition and reduce churn. The three pillars are a viral referral program (target: 15% of new sign-ups from referrals), a self-serve A/B testing platform (unblock 10 experiments per quarter), and data-driven retention campaigns triggered by engagement signals.",
      epics: [
        epic("Referral Program", "Grace", "#059669", 3, 4, 1, [
          sw("Referral link generation and tracking", "Grace", 5, "done", 5, 0, 3,
            makeSnaps(5, "Grace", 5, "behind"),
            "Generate unique short-URLs per user backed by a referral attribution table. Track click, sign-up, and conversion events for attribution reporting."),
          sw("Reward fulfilment engine (credits + free tier)", "Griffin", 5, "done", 5, 0, 3,
            makeSnaps(5, "Griffin", 5, "behind"),
            "Credit the referrer with $10 in account credits and upgrade the referee to a 30-day free Pro trial automatically on verified conversion."),
          sw("Share sheet deep links for iOS and Android", "Gina", 5, "done", 4, 0, 3,
            makeSnapsCreep(5, "Gina", 4, 6),
            "Integrate native iOS Share Sheet and Android Intent chooser. Embed UTM parameters and referral code in the shared URL for attribution."),
          sw("Referral leaderboard and social proof widget", "George", 6, "done", 4, 0, 3,
            makeSnaps(6, "George", 4, "behind"),
            "Show a real-time leaderboard of top referrers on the marketing page. Embed a social proof snippet ('Joined via referral') on the onboarding flow."),
          sw("Fraud detection for self-referral abuse", "Glen", 6, "done", 4, 0, 3,
            makeSnaps(6, "Glen", 4, "behind"),
            "Detect and void referrals where referrer and referee share the same device fingerprint, IP subnet, or payment instrument."),
          sw("Analytics dashboard for referral funnel", "Grace", 6, "done", 3, 0, 3,
            makeSnaps(6, "Grace", 3, "behind"),
            "Build a Retool dashboard showing click → sign-up → activation → conversion funnel by channel, time, and referrer cohort."),
        ], "growth", 2,
          "Launch a viral two-sided referral program targeting 15% of new sign-ups from referrals within 90 days of launch, with built-in fraud prevention."),

        epic("A/B Testing Platform", "Griffin", "#047857", 4, 5, 1, [
          sw("Feature flag service with gradual rollout", "Grace", 7, "done", 5, 0, 4,
            makeSnaps(7, "Grace", 5, "ahead"),
            "Build a lightweight feature flag service backed by Postgres + Redis cache. Support percentage rollouts, user cohort targeting, and kill-switch."),
          sw("Experiment assignment and bucketing engine", "Griffin", 7, "done", 6, 0, 4,
            makeSnaps(7, "Griffin", 6, "ahead"),
            "Implement a deterministic user-bucketing algorithm using MurmurHash3 on user_id + experiment_id. Guarantee bucket stability across sessions."),
          sw("Metric tracking SDK for web and mobile", "Gina", 8, "done", 5, 0, 4,
            makeSnaps(8, "Gina", 5, "ahead"),
            "Publish a typed SDK that auto-instruments experiment exposure, goal conversion, and guardrail metric events without custom tracking code."),
          sw("Statistical significance engine (t-test + CUPED)", "George", 8, "done", 6, 0, 4,
            makeSnaps(8, "George", 6, "ahead"),
            "Implement two-sided Welch's t-test with CUPED variance reduction. Compute daily sequential p-values and display confidence intervals in the UI."),
          sw("Experiment management UI (create, monitor, ship)", "Glen", 9, "inProgress",
            5, daysLeft9(5, "behind9"), 5,
            makeSnaps(9, "Glen", 5, "behind9"),
            "Build the experiment management console: wizard to create experiments, live results with significance bands, and one-click ship to 100%."),
          sw("Mutual exclusion and experiment scheduling", "Grace", 9, "inProgress",
            4, daysLeft9(4, "behind9"), 5,
            makeSnaps(9, "Grace", 4, "behind9"),
            "Prevent overlapping experiments from contaminating each other's results. Add scheduling so experiments auto-start at a specified date and auto-stop at significance."),
        ], "growth", 2,
          "Build a self-serve A/B testing platform that lets product teams run statistically rigorous experiments without data-engineering involvement, targeting 10+ concurrent experiments per quarter."),

        epic("Retention Campaigns", "Gina", "#065f46", 5, 6, 1, [
          sw("Behavioral trigger engine (inactivity, churn signals)", "Griffin", 9, "inProgress",
            5, daysLeft9(5, "behind9"), 5,
            makeSnaps(9, "Griffin", 5, "behind9"),
            "Compute real-time inactivity scores and churn probability from the streaming pipeline. Fire trigger events to the campaign engine when users cross risk thresholds."),
          sw("Email campaign builder with A/B subject lines", "Gina", 9, "inProgress",
            4, daysLeft9(4, "behind9"), 5,
            makeSnaps(9, "Gina", 4, "behind9"),
            "Build a drag-and-drop email template builder with variable substitution. Integrate with SendGrid and expose A/B subject-line testing natively."),
          sw("Push notification personalization engine", "George", 10, "todo", 5, 5, 5, null,
            "Use collaborative filtering on user activity patterns to select the most relevant push notification content per user from a pool of variants."),
          sw("Campaign performance and revenue attribution", "Glen", 10, "todo", 4, 4, 5, null,
            "Track open rate, click rate, conversion, and 30-day revenue uplift per campaign. Attribute revenue using last-touch with a 7-day window."),
          sw("In-app retention modal with personalized offers", "Grace", 11, "todo", 5, 5, 6, null,
            "Show a personalized retention modal to users who attempt to cancel or have been inactive for 14 days. Dynamically select the best offer from experiments."),
        ], "growth", 2,
          "Build a behavioral retention system that identifies at-risk users via churn signals and automatically delivers personalized campaigns across email, push, and in-app channels."),
      ],
    },

    // ══════════════════════════════════════════════════════════════════════
    // 5. User Onboarding Revamp — Experience — months 3-6 — IN PROGRESS
    //    Pattern: steady, predictable
    // ══════════════════════════════════════════════════════════════════════
    {
      title: "User Onboarding Revamp",
      assignee: "Elena",
      color: "#3b82f6",
      status: "scheduled",
      startMonth: 3,
      endMonth: 6,
      timelineRow: 4,
      description: "Redesign the new user experience from the first screen to the first value moment. Qualitative research shows 62% of new users abandon within the first session due to feature confusion and a blank-canvas experience. Target: raise 7-day activation rate from 34% to 55% by adding guided flows, contextual tooltips, and personalized welcome journeys.",
      epics: [
        epic("Welcome Flow", "Elena", "#2563eb", 3, 4, 1, [
          sw("Personalized welcome quiz (role + use-case)", "Elena", 5, "done", 5, 0, 3,
            makeSnaps(5, "Elena", 5, "steady"),
            "3-question quiz at sign-up that segments users by role (engineer / manager / exec) and use-case (planning / reporting / hiring). Drives template selection."),
          sw("Template gallery with 1-click project creation", "Erin", 5, "done", 5, 0, 3,
            makeSnaps(5, "Erin", 5, "steady"),
            "Show a curated gallery of 18 project templates filtered by the quiz result. '1-click start' pre-populates the project and launches the interactive tutorial."),
          sw("Animated progress tracker (3-step activation)", "Evan", 6, "done", 4, 0, 3,
            makeSnaps(6, "Evan", 4, "steady"),
            "Show a persistent progress widget tracking 3 activation milestones (create project / invite team / complete first sprint). Celebrate each with a confetti micro-interaction."),
          sw("Welcome email sequence (day 0, 3, 7)", "Edith", 6, "done", 4, 0, 3,
            makeSnaps(6, "Edith", 4, "steady"),
            "Trigger a 3-email drip sequence on sign-up: day-0 tips, day-3 feature spotlight, day-7 team invite nudge. Personalised by role from quiz."),
          sw("Onboarding completion event and analytics", "Emma", 6, "done", 3, 0, 3,
            makeSnaps(6, "Emma", 3, "steady"),
            "Emit a unified `onboarding_completed` event when all 3 activation milestones are hit. Feed into the activation funnel dashboard."),
        ], "experience", 2,
          "Create a personalised first-session experience with a role-based quiz, template gallery, and guided 3-step activation milestones to lift 7-day activation rate by 20pp."),

        epic("Interactive Tutorial", "Erin", "#1d4ed8", 4, 5, 1, [
          sw("Contextual tooltip overlay system", "Elena", 7, "done", 5, 0, 4,
            makeSnaps(7, "Elena", 5, "steady"),
            "Build a tooltip system that attaches to any DOM element via data attributes. Supports sequential steps, branching (skip/back/next), and auto-positioning."),
          sw("Interactive sprint board tutorial (10 steps)", "Erin", 7, "done", 6, 0, 4,
            makeSnaps(7, "Erin", 6, "steady"),
            "Guide users through creating their first sprint: add stories → estimate → assign → drag to in-progress → mark done. Each step waits for the user's action."),
          sw("Video explainer embeds (3 core features)", "Evan", 8, "done", 4, 0, 4,
            makeSnaps(8, "Evan", 4, "steady"),
            "Embed 60-second Loom-style explainers for the timeline, capacity planning, and burndown views. Auto-show on first visit to each section."),
          sw("Tutorial skip and resume logic", "Edith", 8, "done", 3, 0, 4,
            makeSnaps(8, "Edith", 3, "steady"),
            "Allow users to pause the tutorial and resume later from the same step. Store progress in localStorage and sync to the DB on sign-in."),
          sw("Completion reward: Pro trial unlock", "Emma", 9, "inProgress",
            4, daysLeft9(4, "steady9"), 5,
            makeSnaps(9, "Emma", 4, "steady9"),
            "Grant a 14-day Pro trial on tutorial completion. Show a celebration screen with trial badge and highlight the 3 Pro features that are now unlocked."),
          sw("Tutorial A/B test: guided vs. self-directed", "Elena", 9, "inProgress",
            3, daysLeft9(3, "steady9"), 5,
            makeSnaps(9, "Elena", 3, "steady9"),
            "Run an experiment comparing the 10-step guided tour against a self-directed mode with a checklist. Primary metric: 7-day activation rate."),
        ], "experience", 2,
          "Build a fully interactive, step-by-step product tutorial that guides new users through core workflows and measures the impact on 7-day activation rate via a split test."),

        epic("Activation Milestones", "Evan", "#1e40af", 5, 6, 1, [
          sw("Milestone tracking engine and progress API", "Erin", 9, "inProgress",
            5, daysLeft9(5, "steady9"), 5,
            makeSnaps(9, "Erin", 5, "steady9"),
            "Build a server-side milestone tracker that evaluates user actions in real-time and emits events when users reach each activation milestone."),
          sw("In-product achievement badges", "Evan", 9, "inProgress",
            4, daysLeft9(4, "steady9"), 5,
            makeSnaps(9, "Evan", 4, "steady9"),
            "Award badges on milestone completion (First Sprint, First Invite, Power User). Show a badge shelf on the user profile and in weekly digest emails."),
          sw("Streak tracking and daily habit nudges", "Edith", 10, "todo", 4, 4, 5, null,
            "Track daily active use streak. Send a push notification at the user's usual login time if they haven't logged in that day, with streak count."),
          sw("Activation leaderboard for team accounts", "Emma", 10, "todo", 3, 3, 5, null,
            "Show a team-level activation leaderboard to encourage friendly competition. Highlight who completed onboarding and who still needs help."),
          sw("Lifecycle email at 30-day mark (upsell or churn save)", "Elena", 11, "todo", 4, 4, 6, null,
            "Send a personalised 30-day review email. For highly activated users: highlight usage stats and prompt team upgrade. For low-activation: offer a 1:1 onboarding call."),
        ], "experience", 2,
          "Gamify the post-signup journey with achievement badges, streaks, and team leaderboards to sustain engagement past the first session and increase 30-day retention."),
      ],
    },

    // ══════════════════════════════════════════════════════════════════════
    // 6. Developer Experience — Platform — months 4-7 — IN PROGRESS
    //    Pattern: ahead (strong platform team returns for infra work)
    // ══════════════════════════════════════════════════════════════════════
    {
      title: "Developer Experience",
      assignee: "Paige",
      color: "#6366f1",
      status: "scheduled",
      startMonth: 4,
      endMonth: 7,
      timelineRow: 5,
      description: "Invest in internal developer tooling to halve average cycle time (currently 4.2 days median). Three workstreams: a modernised CI/CD pipeline targeting 8-minute green builds (down from 24), a self-service dev portal with automated environment provisioning, and a full-stack observability platform to cut MTTR from 47 minutes to under 10.",
      epics: [
        epic("CI/CD Pipeline Modernisation", "Perry", "#4f46e5", 4, 5, 1, [
          sw("Migrate from Jenkins to GitHub Actions", "Perry", 7, "done", 5, 0, 4,
            makeSnaps(7, "Perry", 5, "ahead"),
            "Migrate all 62 Jenkins pipelines to GitHub Actions. Use reusable workflow templates for the common build → test → lint → security-scan pattern."),
          sw("Parallelised test sharding (Jest + Pytest)", "Paige", 7, "done", 5, 0, 4,
            makeSnaps(7, "Paige", 5, "ahead"),
            "Shard the Jest and Pytest test suites across 8 parallel workers using split-by-timing. Target: cut test phase from 18 minutes to under 3."),
          sw("Docker layer caching and BuildKit optimisation", "Poppy", 8, "done", 4, 0, 4,
            makeSnaps(8, "Poppy", 4, "ahead"),
            "Enable BuildKit's layer-caching and inline cache export. Reduce average Docker build time from 8 minutes to under 90 seconds."),
          sw("Automated dependency vulnerability scanning", "Petra", 8, "done", 4, 0, 4,
            makeSnaps(8, "Petra", 4, "ahead"),
            "Integrate Dependabot and Trivy into every PR. Block merges on critical CVEs. Auto-open fix PRs for patch-level updates."),
          sw("Build time dashboard and weekly report", "Pascal", 9, "inProgress",
            4, daysLeft9(4, "ahead9"), 5,
            makeSnaps(9, "Pascal", 4, "ahead9"),
            "Publish Grafana dashboard tracking p50/p95 build duration per repo, per week. Email the weekly trend report to engineering leads every Monday."),
          sw("PR preview environments with automated teardown", "Perry", 9, "inProgress",
            5, daysLeft9(5, "ahead9"), 5,
            makeSnaps(9, "Perry", 5, "ahead9"),
            "Spin up a full-stack preview environment for every PR using ephemeral namespaces. Teardown automatically 2 hours after the PR is closed or merged."),
        ], "platform", 2,
          "Modernise CI/CD by migrating to GitHub Actions, parallelising test execution, and optimising Docker layer caching to cut median build time from 24 to 8 minutes."),

        epic("Self-serve Dev Portal", "Paige", "#4338ca", 5, 6, 1, [
          sw("Service catalogue with ownership and runbooks", "Paige", 9, "inProgress",
            5, daysLeft9(5, "ahead9"), 5,
            makeSnaps(9, "Paige", 5, "ahead9"),
            "Build a Backstage-based service catalogue listing all 87 services with owner team, on-call rotation, tech stack, and links to runbooks and dashboards."),
          sw("One-click dev environment provisioning (Devcontainer)", "Poppy", 9, "inProgress",
            5, daysLeft9(5, "ahead9"), 5,
            makeSnaps(9, "Poppy", 5, "ahead9"),
            "Define Devcontainer specs for every service. Engineers run a single command to get a fully configured local environment with seed data within 5 minutes."),
          sw("API contract testing and mock server generation", "Petra", 10, "todo", 5, 5, 5, null,
            "Validate API contracts with Pact consumer-driven contract tests. Auto-generate typed mock servers for downstream consumers to test against."),
          sw("Secrets management via Vault integration", "Pascal", 10, "todo", 4, 4, 5, null,
            "Integrate HashiCorp Vault for dynamic secret generation. Remove all static secrets from .env files and CI variables across all 87 services."),
          sw("Internal npm registry for shared packages", "Perry", 11, "todo", 3, 3, 6, null,
            "Set up a private npm registry (Verdaccio) for shared internal packages. Migrate 14 git-submodule dependencies to published packages."),
        ], "platform", 2,
          "Build a Backstage-powered developer portal with self-service environment provisioning, service catalogue, and secrets management to reduce platform onboarding time from 3 days to 2 hours."),

        epic("Observability Stack", "Poppy", "#3730a3", 6, 7, 1, [
          story("Distributed tracing with OpenTelemetry", "Paige", 11, "todo", 6, 6, 6,
            "Instrument all services with OpenTelemetry SDKs. Export traces to Jaeger with sampling at 10% production, 100% for error traces."),
          story("Centralised log aggregation (Loki + Grafana)", "Perry", 11, "todo", 5, 5, 6,
            "Replace per-service log ships with a unified Loki stack. Build Grafana dashboards per service with pre-built ERROR/WARN log filters."),
          story("SLO and error-budget tracking per service", "Poppy", 12, "todo", 5, 5, 6,
            "Define SLOs (availability + latency) for all Tier-1 services. Compute error-budget burn rate and page oncall when budget drops below 20%."),
          story("Automated runbook generation from alerts", "Petra", 12, "todo", 4, 4, 6,
            "Use LLM to generate first-draft runbooks from alert definitions and past incident Slack threads. Publish to the dev portal service catalogue."),
          story("Chaos engineering harness (Gremlin integration)", "Pascal", 13, "todo", 5, 5, 7,
            "Integrate Gremlin for controlled failure injection. Run weekly chaos experiments on non-prod to validate resilience and automatically update runbooks."),
        ], "platform", 2,
          "Deploy a full-stack observability platform (distributed tracing, centralised logging, SLO tracking) targeting MTTR reduction from 47 minutes to under 10 minutes."),
      ],
    },

    // ══════════════════════════════════════════════════════════════════════
    // 7. Analytics Suite — Data — months 5-8 — SCHEDULED
    //    Pattern: slow/behind in sprint 9 (new team spun up, getting started)
    // ══════════════════════════════════════════════════════════════════════
    {
      title: "Analytics Suite",
      assignee: "Asher",
      color: "#ec4899",
      status: "scheduled",
      startMonth: 5,
      endMonth: 8,
      timelineRow: 6,
      description: "Deliver a best-in-class self-serve analytics platform for internal and external users. Business teams currently wait 3-5 days for custom reports from the data team. The suite covers an executive KPI dashboard, a drag-and-drop report builder for analysts, and a predictive analytics module powered by AutoML. Target: 80% of reporting requests handled without data-team involvement.",
      epics: [
        epic("Executive KPI Dashboard", "Alice", "#db2777", 5, 6, 1, [
          sw("KPI metric store with historical snapshots", "Alice", 9, "inProgress",
            6, daysLeft9(6, "behind9"), 5,
            makeSnaps(9, "Alice", 6, "behind9"),
            "Build a metric store service that computes and caches daily snapshots of all 42 executive KPIs. Serves as the single source of truth for all dashboard views."),
          sw("Revenue and ARR trend charts", "Aaron", 9, "inProgress",
            5, daysLeft9(5, "behind9"), 5,
            makeSnaps(9, "Aaron", 5, "behind9"),
            "Render monthly/quarterly/YoY revenue and ARR charts with cohort overlay and annotation support for key events (product launches, pricing changes)."),
          sw("Cohort retention heatmap", "Aria", 9, "inProgress",
            5, daysLeft9(5, "behind9"), 5,
            makeSnaps(9, "Aria", 5, "behind9"),
            "Build a triangular cohort retention heatmap showing month-0 through month-12 retention for each sign-up cohort since launch."),
          sw("Dashboard access controls and sharing links", "Asher", 10, "todo", 4, 4, 5, null,
            "Implement role-based access (exec-only, finance, all-hands view). Generate shareable links with optional TTL and viewer-only permission."),
          sw("Scheduled email delivery (weekly/monthly digest)", "Aiden", 10, "todo", 4, 4, 5, null,
            "Send a customisable digest email every Monday with the week-over-week KPI changes. Allow execs to subscribe to specific charts."),
        ], "data", 2,
          "Build a real-time executive dashboard showing ARR, DAU, retention, and conversion KPIs with drill-down, cohort analysis, and scheduled delivery."),

        epic("Self-serve Report Builder", "Aaron", "#be185d", 6, 7, 1, [
          story("Drag-and-drop report canvas", "Alice", 11, "todo", 6, 6, 6,
            "Build a drag-and-drop canvas where analysts can place chart blocks, metric tiles, and filter controls. Save reports to the catalogue with tags."),
          story("SQL query editor with schema autocomplete", "Aaron", 11, "todo", 5, 5, 6,
            "Embed a Monaco-based SQL editor with schema-aware autocomplete against the data lake. Show row previews inline and export results to CSV/Excel."),
          story("Pre-built chart types (line, bar, funnel, scatter)", "Aria", 12, "todo", 5, 5, 6,
            "Implement 8 chart types using Recharts. Each chart type has a guided wizard for mapping columns to axes, colour, and aggregation."),
          story("Report scheduling and Slack delivery", "Asher", 12, "todo", 4, 4, 6,
            "Allow any saved report to be scheduled (cron) and delivered to a Slack channel or email list. Include a diff mode highlighting changes from the previous run."),
          story("Report version history and rollback", "Aiden", 13, "todo", 4, 4, 7,
            "Version every report save with a full snapshot. Allow restoring any previous version with a single click and viewing a diff between versions."),
        ], "data", 2,
          "Give analysts a self-serve SQL report builder with a drag-and-drop canvas, scheduled delivery, and versioning so they no longer block on the data team for custom analysis."),

        epic("Predictive Analytics Module", "Aria", "#9d174d", 7, 8, 1, [
          story("AutoML training pipeline for churn prediction", "Alice", 13, "todo", 6, 6, 7,
            "Build an AutoML pipeline using H2O.ai that trains a churn prediction model nightly on the last 90 days of user activity. Target AUC > 0.85."),
          story("Feature store for ML model inputs", "Aaron", 13, "todo", 5, 5, 7,
            "Implement a feature store (Feast) that pre-computes and serves the 120 behavioural features used by the churn and LTV models."),
          story("LTV scoring API for sales prioritisation", "Aria", 14, "todo", 5, 5, 7,
            "Serve predicted 12-month LTV scores via a REST API consumed by Salesforce. Refresh scores weekly. Used to prioritise outbound sales sequences."),
          story("Forecast confidence intervals and anomaly flags", "Asher", 15, "todo", 4, 4, 8,
            "Display 80% and 95% confidence intervals on all forecast charts. Automatically flag actuals that fall outside the confidence band as anomalies."),
          story("Model performance monitoring and drift detection", "Aiden", 15, "todo", 5, 5, 8,
            "Track model accuracy metrics weekly. Alert when prediction drift exceeds a threshold, triggering an automatic re-training run."),
        ], "data", 2,
          "Add predictive capabilities to the analytics suite: AutoML churn prediction (AUC > 0.85), LTV scoring, and forecast confidence intervals powered by an automated feature store."),
      ],
    },

    // ══════════════════════════════════════════════════════════════════════
    // 8. Mobile Performance — Mobile — months 5-7 — SCHEDULED
    //    Pattern: behind in sprint 9, slow start
    // ══════════════════════════════════════════════════════════════════════
    {
      title: "Mobile Performance",
      assignee: "Mia",
      color: "#14b8a6",
      status: "scheduled",
      startMonth: 5,
      endMonth: 7,
      timelineRow: 7,
      description: "Resolve critical performance regressions in the iOS and Android apps that are driving a 1.5-star average review score. Benchmark targets: cold-start time under 2 seconds (currently 5.4s), scroll frame rate at consistent 60fps, and 50% reduction in peak memory footprint. Users on mid-range devices are reporting frequent crashes due to OOM errors.",
      epics: [
        epic("Startup Time Optimisation", "Marcus", "#0d9488", 5, 6, 1, [
          sw("App startup profiling and bottleneck analysis", "Marcus", 9, "inProgress",
            5, daysLeft9(5, "behind9"), 5,
            makeSnaps(9, "Marcus", 5, "behind9"),
            "Profile iOS and Android cold/warm start using Instruments and Android Studio Profiler. Create a flamegraph of the critical path and identify the top 5 bottlenecks."),
          sw("Lazy module loading and code splitting", "Maya", 9, "inProgress",
            5, daysLeft9(5, "behind9"), 5,
            makeSnaps(9, "Maya", 5, "behind9"),
            "Split the JavaScript bundle into 3 async chunks (core, features, settings). Defer loading of non-critical modules until after the first interactive frame."),
          sw("Native image caching and decode-off-main-thread", "Miles", 10, "todo", 5, 5, 5, null,
            "Use SDWebImage (iOS) and Coil (Android) with in-memory + disk LRU caches. Decode images on a background thread to eliminate frame drops on scroll."),
          sw("Baseline profiles for Android (ART ahead-of-time)", "Mia", 10, "todo", 4, 4, 5, null,
            "Generate Android Baseline Profile to pre-compile the hot code path. Target: cut time-to-interactive from 3.2s to under 1s on first launch after install."),
          sw("Startup time CI gate (fail if > 2.5s)", "Morgan", 10, "todo", 3, 3, 5, null,
            "Add a startup-time performance test to CI using Maestro. Fail the build if cold-start time regresses beyond 2.5s on the reference device."),
        ], "mobile", 2,
          "Reduce app cold-start time from 5.4 seconds to under 2 seconds on mid-range devices through lazy loading, native image caching, and Android ART baseline profiles."),

        epic("Memory Profiling & Leak Fixes", "Maya", "#0f766e", 6, 7, 1, [
          story("Heap dump analysis and leak identification", "Marcus", 11, "todo", 5, 5, 6,
            "Take heap dumps in both idle and active states on 5 device profiles. Use LeakCanary (Android) and Instruments Allocations (iOS) to identify retention cycles."),
          story("Image pipeline memory cap and eviction policy", "Maya", 11, "todo", 5, 5, 6,
            "Cap the in-memory image cache at 15% of available heap. Implement LRU eviction with pressure callbacks from the OS to release on low-memory warnings."),
          story("ViewHolder and adapter recycling audit", "Miles", 12, "todo", 4, 4, 6,
            "Audit all 34 RecyclerView adapters for incorrect item recycling. Fix view-type mismatches that force full re-inflation and cause memory spikes on fast scroll."),
          story("Background service wake-lock audit", "Mia", 12, "todo", 4, 4, 6,
            "Audit all background services for WakeLock acquisition without guaranteed release. Replace with WorkManager JobScheduler and add 5-minute hard timeout."),
          story("Automated memory regression test suite", "Morgan", 13, "todo", 4, 4, 7,
            "Build a Maestro-driven regression test that measures peak heap usage for the 5 highest-traffic flows. Gate merges that increase peak memory by > 5%."),
        ], "mobile", 2,
          "Eliminate the top 3 memory leak patterns and implement an automated regression suite to cut OOM crashes by 80% and remove 1.5-star reviews citing battery drain."),

        epic("Network Caching & Latency", "Miles", "#115e59", 6, 7, 2, [
          story("HTTP response caching with ETag/If-Modified-Since", "Marcus", 12, "todo", 4, 4, 6,
            "Add ETag-based conditional request support to the mobile API gateway. Client caches valid responses and skips the network entirely for unchanged data."),
          story("Offline-first data fetching with stale-while-revalidate", "Maya", 12, "todo", 4, 4, 6,
            "Implement a stale-while-revalidate strategy for all read-heavy screens (feed, profile, settings). Users see cached data instantly and refresh silently in background."),
          story("Request priority queuing (critical vs. prefetch)", "Miles", 13, "todo", 4, 4, 7,
            "Assign priority levels to all API calls. Defer background prefetch requests when the device is on a slow connection and the critical request queue is non-empty."),
          story("Network performance analytics integration", "Mia", 13, "todo", 3, 3, 7,
            "Instrument all API calls with timing, payload size, and cache-hit metrics. Export to Datadog for per-endpoint analysis and p99 latency tracking."),
          story("CDN edge caching for static asset bundles", "Morgan", 14, "todo", 3, 3, 7,
            "Configure CloudFront to cache JS/CSS bundles at edge with 30-day TTL. Invalidate on each release. Expected: 70% cache hit rate reducing TTFB by 300ms."),
        ], "mobile", 2,
          "Implement HTTP response caching, stale-while-revalidate data fetching, and CDN edge caching to reduce perceived load times by 60% on mobile networks."),
      ],
    },

    // ══════════════════════════════════════════════════════════════════════
    // 9. Payments Modernisation — Platform — months 6-9 — SCHEDULED (future)
    // ══════════════════════════════════════════════════════════════════════
    {
      title: "Payments Modernisation",
      assignee: "Poppy",
      color: "#f59e0b",
      status: "scheduled",
      startMonth: 6,
      endMonth: 9,
      timelineRow: 8,
      description: "Replace the legacy Stripe v2 integration with a modern payments infrastructure supporting multi-currency checkout, subscription lifecycle management, and ML-based fraud detection. The current system loses an estimated $180k/year to chargebacks due to absent 3DS2 enforcement and rule-based fraud detection that has a 35% false-positive rate.",
      epics: [
        epic("Payment Gateway v2", "Perry", "#d97706", 6, 7, 1, [
          story("Stripe v3 SDK migration with Strong Customer Authentication", "Perry", 11, "todo", 6, 6, 6,
            "Upgrade to Stripe Billing v3. Implement 3DS2 SCA flows for EU/UK compliance. Add graceful fallback for SCA-exempt transactions under €30."),
          story("Multi-currency checkout (USD, EUR, GBP, JPY)", "Paige", 11, "todo", 5, 5, 6,
            "Support presentment currency at checkout using IP geolocation + user preference. Store all values in USD cents internally and convert at display time."),
          story("Payment method vault (save card, SEPA, BACS)", "Poppy", 12, "todo", 5, 5, 6,
            "Allow users to save payment methods to a PCI-compliant vault. Support SEPA Direct Debit and BACS for European and UK enterprise accounts."),
          story("Failed payment dunning and retry logic", "Petra", 12, "todo", 5, 5, 6,
            "Implement smart dunning: retry failed payments on days 3, 7, 14 after failure. Send customised emails at each stage. Suspend account gracefully at day 28."),
          story("Payment event webhooks and audit log", "Pascal", 13, "todo", 4, 4, 7,
            "Consume Stripe webhooks for all payment lifecycle events. Store an immutable audit log with idempotency keys. Expose a payments history UI to users."),
        ], "platform", 2,
          "Migrate to Stripe v3 with SCA support, multi-currency checkout, and payment method vaulting to unblock enterprise sales in EU and UK markets."),

        epic("Fraud Detection Engine", "Paige", "#b45309", 7, 8, 1, [
          story("ML fraud scoring model (XGBoost)", "Perry", 13, "todo", 6, 6, 7,
            "Train an XGBoost classifier on 18 months of transaction history. Feature set: velocity, device fingerprint, geolocation, historical chargeback rate. Target: F1 > 0.92."),
          story("Real-time transaction risk scoring API", "Paige", 13, "todo", 5, 5, 7,
            "Serve ML fraud scores synchronously with <30ms P99 latency. Integrate into the checkout flow with three outcomes: allow, 3DS challenge, or block."),
          story("Rule engine for high-velocity pattern blocking", "Poppy", 14, "todo", 5, 5, 7,
            "Complement the ML model with a Redis-backed rule engine. Block card-testing attacks (10+ authorisation attempts/minute) and known stolen BIN ranges."),
          story("Chargeback dispute automation", "Petra", 15, "todo", 4, 4, 8,
            "Auto-generate dispute evidence packages (transaction logs, shipping info, device fingerprint) and submit to Stripe via API within 24 hours of a chargeback."),
          story("Fraud model performance monitoring", "Pascal", 15, "todo", 4, 4, 8,
            "Track precision, recall, and false-positive rate weekly. Alert when FPR exceeds 5% (currently 35%). Trigger automatic retraining when performance degrades."),
        ], "platform", 2,
          "Replace rule-based fraud detection with an ML model (XGBoost, target F1 > 0.92) to cut the 35% false-positive rate and reduce chargeback losses by 70%."),

        epic("Subscription Engine", "Poppy", "#92400e", 8, 9, 1, [
          story("Subscription plan management (create, update, cancel)", "Perry", 15, "todo", 5, 5, 8,
            "Build a subscription management API supporting tiered plans (Free, Pro, Enterprise). Handle upgrades, downgrades, and cancellations with prorated billing."),
          story("Annual billing discount and mid-cycle upgrades", "Paige", 15, "todo", 5, 5, 8,
            "Offer 20% annual billing discount. Handle mid-cycle plan changes by computing the prorated credit/charge and applying it to the next invoice."),
          story("Usage-based billing for API calls", "Poppy", 16, "todo", 5, 5, 8,
            "Add a metered billing component for API usage beyond plan limits ($0.001 per API call over quota). Track usage in Redis and sync to Stripe at billing period close."),
          story("Invoice generation and PDF export", "Petra", 16, "todo", 4, 4, 8,
            "Auto-generate PDF invoices for each billing event. Include VAT/GST for applicable jurisdictions determined by the billing address."),
          story("Self-serve billing portal (Stripe Customer Portal)", "Pascal", 17, "todo", 3, 3, 9,
            "Embed the Stripe Customer Portal for users to view invoices, update payment methods, and manage subscriptions without contacting support."),
        ], "platform", 2,
          "Build a full subscription lifecycle engine supporting tiered plans, mid-cycle plan changes, usage-based billing, and self-serve management via the Stripe Customer Portal."),
      ],
    },

    // ══════════════════════════════════════════════════════════════════════
    // 10. AI-Powered Features — Data — months 7-10 — SCHEDULED (future)
    // ══════════════════════════════════════════════════════════════════════
    {
      title: "AI-Powered Features",
      assignee: "Aiden",
      color: "#a855f7",
      status: "scheduled",
      startMonth: 7,
      endMonth: 10,
      timelineRow: 9,
      description: "Embed LLM capabilities across core product surfaces to drive a step-change in user productivity. Research shows users spend 40% of their time in the product on manual data entry and search. Three AI workstreams: a semantic search that replaces keyword matching, a personalised recommendation engine for templates and insights, and a natural-language forecasting assistant for leadership teams.",
      epics: [
        epic("Semantic Search", "Alice", "#9333ea", 7, 8, 1, [
          story("Vector embedding pipeline for all content types", "Alice", 13, "todo", 6, 6, 7,
            "Embed all user-generated content (stories, initiatives, comments) using OpenAI text-embedding-3-large. Store in pgvector with ANN indexes for <50ms queries."),
          story("Hybrid search (BM25 + vector ANN re-ranking)", "Aaron", 13, "todo", 5, 5, 7,
            "Combine BM25 keyword results with ANN vector results using a learned re-ranking model (cross-encoder). Improves MRR@10 from 0.41 to 0.72 in offline eval."),
          story("Natural language query parsing", "Aria", 14, "todo", 5, 5, 7,
            "Parse natural language queries into structured filters (assignee, sprint, status, date range) using a fine-tuned intent-classification model before vector search."),
          story("Search result relevance feedback loop", "Asher", 14, "todo", 4, 4, 7,
            "Capture implicit relevance signals (click, scroll-past, result ignored) to continuously fine-tune the re-ranking model via weekly online learning runs."),
          story("Global search keyboard shortcut and command palette", "Aiden", 15, "todo", 4, 4, 8,
            "Expose semantic search via a Cmd+K command palette. Surface recent queries, suggested filters, and quick-action shortcuts in the dropdown."),
        ], "data", 2,
          "Replace keyword search with a hybrid semantic + BM25 search engine backed by pgvector embeddings to improve search MRR@10 from 0.41 to over 0.70."),

        epic("Recommendation Engine", "Aaron", "#7e22ce", 8, 9, 1, [
          story("Collaborative filtering model for template suggestions", "Alice", 15, "todo", 6, 6, 8,
            "Train a matrix factorisation model on user-template interaction data. Recommend templates at project creation with a predicted engagement score."),
          story("Similar-story suggestions on story creation", "Aaron", 15, "todo", 5, 5, 8,
            "When a user creates a new story, surface the 3 most semantically similar past stories from their team. Pre-fill estimate and assignee from the best match."),
          story("Insight surfacing: automated anomaly callouts", "Aria", 16, "todo", 5, 5, 8,
            "Detect statistically significant metric changes and surface them as automated insight cards in the dashboard. Include a plain-English explanation of the change."),
          story("Personalised daily digest (what to focus on)", "Asher", 16, "todo", 4, 4, 8,
            "Send a personalised morning digest email at 8am local time listing overdue stories, at-risk sprints, and recommended actions based on the user's role."),
          story("Recommendation quality A/B test framework", "Aiden", 17, "todo", 4, 4, 9,
            "Run recommendations through the A/B testing platform. Primary metric: accept rate for template and story suggestions. Retrain weekly on accepted/rejected signal."),
        ], "data", 2,
          "Build a personalised recommendation engine that suggests templates, auto-fills story estimates, and surfaces proactive insights to reduce manual decision-making."),

        epic("Forecasting Assistant", "Aria", "#6b21a8", 9, 10, 1, [
          story("Natural language query interface for KPI forecasting", "Alice", 17, "todo", 6, 6, 9,
            "Build a conversational interface where leaders can ask questions like 'When will we reach 1M DAU?' and receive a model-backed forecast with confidence intervals."),
          story("Time-series forecasting models (Prophet + N-BEATS)", "Aaron", 17, "todo", 5, 5, 9,
            "Train Prophet and N-BEATS models on 24 months of KPI history. Select the best model per metric via automated backtesting. Serve forecasts via a REST API."),
          story("What-if scenario simulator", "Aria", 18, "todo", 5, 5, 9,
            "Allow users to adjust input parameters (pricing, marketing spend, churn rate) and see the resulting impact on forecasted KPIs using a causal inference model."),
          story("Forecast accuracy tracking and model versioning", "Asher", 19, "todo", 4, 4, 10,
            "Compare each model's 30/60/90-day forecasts against actuals. Version models and auto-rollback if forecast accuracy drops below 80% MAPE."),
          story("Forecast report generation and PDF export", "Aiden", 19, "todo", 4, 4, 10,
            "Generate a boardroom-ready PDF forecast report with narrative summaries written by the LLM. Schedule monthly distribution to the exec team."),
        ], "data", 2,
          "Build a natural-language forecasting assistant that answers forward-looking KPI questions with model-backed confidence intervals and what-if scenario simulation."),
      ],
    },
  ];

  // ─── persist ────────────────────────────────────────────────────────────
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
        ...(init.description ? { description: init.description } : {}),
        epics: { create: init.epics },
      },
    });
  }

  // ─── workspace users ────────────────────────────────────────────────────
  const workspaceUsers = [
    // Platform
    { name: "Perry Stone",  email: "perry.stone@example.com",  team: "platform",   permission: "Admin"  },
    { name: "Paige Chen",   email: "paige.chen@example.com",   team: "platform",   permission: "Editor" },
    { name: "Poppy Miles",  email: "poppy.miles@example.com",  team: "platform",   permission: "Editor" },
    { name: "Petra Wells",  email: "petra.wells@example.com",  team: "platform",   permission: "Editor" },
    { name: "Pascal Ruiz",  email: "pascal.ruiz@example.com",  team: "platform",   permission: "Viewer" },
    // Experience
    { name: "Elena Park",   email: "elena.park@example.com",   team: "experience", permission: "Admin"  },
    { name: "Erin Blake",   email: "erin.blake@example.com",   team: "experience", permission: "Editor" },
    { name: "Evan Cho",     email: "evan.cho@example.com",     team: "experience", permission: "Editor" },
    { name: "Edith Moore",  email: "edith.moore@example.com",  team: "experience", permission: "Editor" },
    { name: "Emma Liu",     email: "emma.liu@example.com",     team: "experience", permission: "Viewer" },
    // Data
    { name: "Alice Hart",   email: "alice.hart@example.com",   team: "data",       permission: "Admin"  },
    { name: "Aaron Cole",   email: "aaron.cole@example.com",   team: "data",       permission: "Editor" },
    { name: "Aria Singh",   email: "aria.singh@example.com",   team: "data",       permission: "Editor" },
    { name: "Asher Kim",    email: "asher.kim@example.com",    team: "data",       permission: "Editor" },
    { name: "Aiden Frost",  email: "aiden.frost@example.com",  team: "data",       permission: "Viewer" },
    // Mobile
    { name: "Marcus Webb",  email: "marcus.webb@example.com",  team: "mobile",     permission: "Admin"  },
    { name: "Maya Patel",   email: "maya.patel@example.com",   team: "mobile",     permission: "Editor" },
    { name: "Miles Grant",  email: "miles.grant@example.com",  team: "mobile",     permission: "Editor" },
    { name: "Mia Torres",   email: "mia.torres@example.com",   team: "mobile",     permission: "Editor" },
    { name: "Morgan Reed",  email: "morgan.reed@example.com",  team: "mobile",     permission: "Viewer" },
    // Growth
    { name: "Grace Flynn",  email: "grace.flynn@example.com",  team: "growth",     permission: "Admin"  },
    { name: "Griffin Shaw", email: "griffin.shaw@example.com", team: "growth",     permission: "Editor" },
    { name: "Gina Marsh",   email: "gina.marsh@example.com",   team: "growth",     permission: "Editor" },
    { name: "George Lim",   email: "george.lim@example.com",   team: "growth",     permission: "Editor" },
    { name: "Glen Ford",    email: "glen.ford@example.com",    team: "growth",     permission: "Viewer" },
  ];

  for (const u of workspaceUsers) {
    await prisma.workspaceUser.create({ data: u });
  }

  console.log("✅ Demo seed complete: 10 initiatives · 30 epics · 5 teams · 25 users");
  console.log("   Burndown patterns: Platform=ahead, Experience=steady, Data=slow+creep, Mobile=behind, Growth=inconsistent");
  console.log("   Sprint 9 active: Platform(2 epics/ahead), Experience(2 epics/steady), Data(1 epic/behind), Mobile(1 epic/behind), Growth(2 epics/behind)");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
