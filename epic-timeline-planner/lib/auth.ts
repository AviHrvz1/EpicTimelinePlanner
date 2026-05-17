import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";

import { db } from "@/lib/db";
import { PASSWORD_MIN_LENGTH } from "@/lib/password-strength";
import { sendResetEmail } from "@/lib/email/send-reset-email";

/**
 * Server-side Better Auth instance. Mounted at /api/auth/* via app/api/auth/[...all]/route.ts.
 *
 * Design notes:
 *  - Reads/writes through the existing Prisma client (lib/db.ts) so the auth tables live in
 *    the same SQLite file as everything else. No external session store.
 *  - Sessions are 1 day by default; "Remember me" on the login form passes a 30-day override.
 *  - Email/password is the primary credential path; OAuth providers are added only when their
 *    CLIENT_ID env var is set (empty creds → key omitted entirely, so the corresponding button
 *    on the login page renders as null).
 *  - Rate limit uses the `database` storage backend, which writes through Better Auth's
 *    own rateLimit table — we don't need to point it at our custom RateLimitEvent table.
 *  - First-time signups auto-link to a matching WorkspaceUser row (by email) so directory
 *    entries pre-created by an admin "activate" when that person signs up.
 */

const googleClientId = process.env.AUTH_GOOGLE_CLIENT_ID?.trim();
const googleClientSecret = process.env.AUTH_GOOGLE_CLIENT_SECRET?.trim();
const appleClientId = process.env.AUTH_APPLE_CLIENT_ID?.trim();
const appleClientSecret = process.env.AUTH_APPLE_CLIENT_SECRET?.trim();
const microsoftClientId = process.env.AUTH_MICROSOFT_CLIENT_ID?.trim();
const microsoftClientSecret = process.env.AUTH_MICROSOFT_CLIENT_SECRET?.trim();

type SocialProviderConfig = NonNullable<
  Parameters<typeof betterAuth>[0]["socialProviders"]
>;

const socialProviders: SocialProviderConfig = {};
if (googleClientId && googleClientSecret) {
  socialProviders.google = { clientId: googleClientId, clientSecret: googleClientSecret };
}
if (appleClientId && appleClientSecret) {
  socialProviders.apple = { clientId: appleClientId, clientSecret: appleClientSecret };
}
if (microsoftClientId && microsoftClientSecret) {
  socialProviders.microsoft = {
    clientId: microsoftClientId,
    clientSecret: microsoftClientSecret,
    tenantId: process.env.AUTH_MICROSOFT_TENANT_ID?.trim() || "common",
  };
}

/** Public flags surfaced to the client so the OAuth buttons can render conditionally. */
export const ENABLED_OAUTH_PROVIDERS = {
  google: Boolean(googleClientId && googleClientSecret),
  apple: Boolean(appleClientId && appleClientSecret),
  microsoft: Boolean(microsoftClientId && microsoftClientSecret),
};

export const auth = betterAuth({
  appName: "Epic Timeline Planner",
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
  secret:
    process.env.BETTER_AUTH_SECRET ||
    // Dev-only fallback so a missing secret doesn't take the whole app down before .env is
    // populated. In production the env var MUST be set — see docs/AUTH_SETUP.md.
    "dev-only-insecure-secret-do-not-use-in-production",

  database: prismaAdapter(db, { provider: "sqlite" }),

  emailAndPassword: {
    enabled: true,
    minPasswordLength: PASSWORD_MIN_LENGTH,
    maxPasswordLength: 128,
    // Skip email-verification for v1 — flip to `true` once you've verified an SES sender.
    requireEmailVerification: false,
    autoSignIn: true,
    sendResetPassword: async ({ user, url }) => {
      await sendResetEmail({ to: user.email, resetUrl: url, userName: user.name });
    },
  },

  socialProviders,

  session: {
    // Default 1-day session; the login form's "Remember me" checkbox extends to 30 days
    // by passing `rememberMe: true` to the signIn call.
    expiresIn: 60 * 60 * 24, // 1 day
    updateAge: 60 * 60 * 24, // refresh once a day
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },

  rateLimit: {
    enabled: true,
    // Memory storage is correct for a single Next.js instance. Switch to "database"
    // (and add the matching rateLimit table) only when we deploy multi-instance — the
    // in-memory window then wouldn't be shared across workers.
    storage: "memory",
    window: 60, // 60-second sliding window for the default rule
    max: 30,
    // Per-endpoint overrides — Better Auth applies these to its own paths.
    customRules: {
      "/sign-in/email": { window: 60 * 15, max: 5 }, // 5 attempts / 15 min
      "/sign-up/email": { window: 60 * 60, max: 5 }, // 5 / hour
      "/request-password-reset": { window: 60 * 60, max: 3 }, // 3 / hour
    },
  },

  advanced: {
    cookiePrefix: "epic-timeline",
    // Better Auth defaults to httpOnly + sameSite=lax + secure-in-prod, which is what we want.
  },

  databaseHooks: {
    user: {
      create: {
        after: async (newUser) => {
          // Auto-link to a pre-existing WorkspaceUser if the admin added the team directory
          // entry before this person signed up. Match strictly on email; ignore failures so a
          // missing/duplicate WorkspaceUser never blocks signup.
          try {
            const wu = await db.workspaceUser.findUnique({
              where: { email: newUser.email },
            });
            if (wu) {
              await db.user.update({
                where: { id: newUser.id },
                data: { workspaceUserId: wu.id },
              });
            }
          } catch (err) {
            console.warn("[auth] WorkspaceUser link skipped:", err);
          }
        },
      },
    },
  },

  // Must be last in the plugin list — handles Next.js cookie marshalling.
  plugins: [nextCookies()],
});

/** Convenience type for the resolved session (matches Better Auth's inferred shape). */
export type AuthSession = Awaited<ReturnType<typeof auth.api.getSession>>;
