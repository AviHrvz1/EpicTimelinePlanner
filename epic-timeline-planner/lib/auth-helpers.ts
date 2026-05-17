import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";

/**
 * Server-side guard for API route handlers. Returns the authenticated user on success or a
 * 401 NextResponse on failure — call sites just do:
 *
 *     const session = await requireAuth(request);
 *     if (session instanceof NextResponse) return session;
 *     // ...use session.user.id
 *
 * Keeps the gating ergonomics simple and avoids try/catch noise in every route.
 */
export async function requireAuth(
  request: NextRequest,
): Promise<{ user: { id: string; email: string; name: string | null } } | NextResponse> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return NextResponse.json(
      { message: "Authentication required" },
      { status: 401 },
    );
  }
  return {
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name ?? null,
    },
  };
}

/**
 * Same as requireAuth but returns null instead of a response — for places that need to
 * optionally read the current user without short-circuiting the request.
 */
export async function getOptionalUser(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  return session?.user ?? null;
}
