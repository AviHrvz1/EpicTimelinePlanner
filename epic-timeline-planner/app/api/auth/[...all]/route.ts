import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/lib/auth";

/**
 * Catch-all that mounts every Better Auth endpoint under /api/auth/*:
 *   POST /api/auth/sign-in/email
 *   POST /api/auth/sign-up/email
 *   POST /api/auth/sign-out
 *   GET  /api/auth/get-session
 *   POST /api/auth/forget-password
 *   POST /api/auth/reset-password
 *   GET  /api/auth/callback/{provider}   (OAuth)
 * ...and the rest. Better Auth handles routing internally; we only need to forward
 * the HTTP method calls.
 */
export const { GET, POST } = toNextJsHandler(auth);
