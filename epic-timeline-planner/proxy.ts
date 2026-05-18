import { NextResponse, type NextRequest } from "next/server";

/**
 * Next.js 16 proxy (formerly `middleware.ts`). Runs on every matched request and
 * lets us shape the response *before* the route handler executes.
 *
 * Auth gating policy (v2 — full route protection):
 *   • Public routes (auth pages, legal pages, /api/auth/*) always pass through.
 *   • Any other navigation without the Better Auth session cookie is redirected
 *     to /login?redirect=<original-path>.
 *   • Write requests (POST/PATCH/PUT/DELETE) under /api/* without the cookie
 *     still get a 401 JSON response so XHR/fetch callers see a clean error.
 *
 * Proxy runs on the Edge runtime by default, so we can't import lib/auth.ts
 * (it pulls in Prisma + Node-only modules). Instead we sniff the session cookie
 * name we configured (cookiePrefix: "epic-timeline") for a cheap presence check.
 * Cryptographic validation still happens server-side inside the route handler.
 */

const SESSION_COOKIE_NAMES = [
  "epic-timeline.session_token",
  "epic-timeline.session_token-multi.0",
];
const WRITE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

/** UI routes that must be reachable for an unauthenticated visitor.
 *  Note: "/" is intentionally listed here because the roadmap-planning page
 *  renders the live planner behind a login modal overlay for unauth users.
 *  The modal blocks interaction client-side, so letting the page load
 *  unauthenticated is safe — write endpoints under /api/* still 401. */
const PUBLIC_UI_PREFIXES = [
  "/",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/legal",
];
/** Endpoints that must stay open for the auth flow itself. */
const PUBLIC_API_PREFIXES = ["/api/auth/"];

function isPublicUi(pathname: string): boolean {
  return PUBLIC_UI_PREFIXES.some((p) => {
    if (p === "/") return pathname === "/"; // exact match — don't treat "/" as a prefix of everything
    return pathname === p || pathname.startsWith(`${p}/`);
  });
}

function hasSessionCookie(request: NextRequest): boolean {
  return SESSION_COOKIE_NAMES.some((name) => request.cookies.get(name)?.value);
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Auth-flow API endpoints must run for unauthed visitors — otherwise nobody
  // could ever log in.
  if (PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const sessionOk = hasSessionCookie(request);

  // API write requests: reject early with 401 JSON if no session.
  if (pathname.startsWith("/api/")) {
    if (!WRITE_METHODS.has(request.method)) {
      return NextResponse.next();
    }
    if (!sessionOk) {
      return NextResponse.json(
        { message: "Authentication required" },
        { status: 401 },
      );
    }
    return NextResponse.next();
  }

  // UI navigation: enforce auth unless the route is public.
  if (isPublicUi(pathname)) {
    return NextResponse.next();
  }

  if (sessionOk) {
    return NextResponse.next();
  }

  // No session → bounce to /login, preserving where the user was trying to go.
  const loginUrl = new URL("/login", request.url);
  if (pathname !== "/") {
    loginUrl.searchParams.set("redirect", pathname + request.nextUrl.search);
  }
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Match every request except Next.js internals + static assets, so we can
  // gate both UI navigation and API writes.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|map|woff|woff2|ttf)).*)",
  ],
};
