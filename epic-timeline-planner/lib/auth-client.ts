"use client";

import { createAuthClient } from "better-auth/react";

/**
 * Browser-side Better Auth client. All login/signup/signout/useSession calls in the
 * UI flow through this instance.
 *
 * baseURL is intentionally NOT hardcoded — Better Auth defaults to the current origin
 * when omitted in the browser, which is exactly what we want for both localhost and
 * any future deploy without changing client config.
 */
export const authClient = createAuthClient();

export const { signIn, signUp, signOut, useSession, getSession } = authClient;
