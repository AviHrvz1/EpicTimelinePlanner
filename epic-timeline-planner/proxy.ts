import { NextResponse, type NextRequest } from "next/server";

/**
 * Next.js 16 proxy (formerly `middleware.ts`). Runs on every matched request and lets us
 * shape the response *before* the route handler executes.
 *
 * Auth gating policy (v1):
 *   • GET requests are NEVER blocked — the app reads stay public for safe rollout.
 *   • POST / PATCH / PUT / DELETE on /api/* require a Better Auth session cookie.
 *     If the cookie is missing the request is rejected with 401 JSON before it ever
 *     hits the route handler. (The handler can still do a `requireAuth` for extra
 *     safety, but most writes are covered here.)
 *
 * We intentionally do NOT redirect unauthed UI navigations to /login — the UserChip
 * in the header surfaces the Sign-in link, and the page itself stays viewable so
 * existing readers don't get bounced. Tighten this once the auth UX is verified.
 *
 * Note: middleware/proxy runs on the Edge runtime by default, which means we can't
 * import `lib/auth.ts` (it pulls in Prisma + Node-only modules). Instead we sniff
 * the session cookie name we configured (cookiePrefix: "epic-timeline") to do a
 * cheap presence check. Cryptographic validation still happens server-side inside
 * each route handler / Better Auth flow.
 */

const SESSION_COOKIE_NAME = "epic-timeline.session_token";
const WRITE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

/** Endpoints that must stay open even for unauthed users (the auth flow itself). */
const PUBLIC_PREFIXES = ["/api/auth/"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Auth-flow endpoints (sign-in, sign-up, forgot-password, callbacks) must run for
  // unauthed visitors — otherwise nobody could ever log in.
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  if (!WRITE_METHODS.has(request.method)) {
    return NextResponse.next();
  }
  if (!pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  const cookie = request.cookies.get(SESSION_COOKIE_NAME);
  if (!cookie?.value) {
    return NextResponse.json(
      { message: "Authentication required" },
      { status: 401 },
    );
  }

  return NextResponse.next();
}

export const config = {
  // Only match API routes — UI page navigation is left alone so existing visitors
  // keep their read-only experience even before they sign in.
  matcher: ["/api/:path*"],
};
