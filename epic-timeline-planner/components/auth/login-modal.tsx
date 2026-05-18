"use client";

import { useState } from "react";
import { ArrowLeft } from "lucide-react";

import { useSession } from "@/lib/auth-client";
import { BrandPanel } from "./brand-panel";
import { LoginForm } from "./login-form";
import { SignupForm } from "./signup-form";

// OAuth provider flags. The real ENABLED_OAUTH_PROVIDERS lives in lib/auth.ts
// which is server-only (imports Prisma); to avoid pulling that into a client
// component we mirror the flags here from NEXT_PUBLIC_* env vars, defaulting
// to all-false when nothing's configured. The /login and /signup pages still
// pass the authoritative server value for direct visits — this is just for
// the in-app modal.
const ENABLED_OAUTH_PROVIDERS_CLIENT = {
  google: Boolean(process.env.NEXT_PUBLIC_AUTH_GOOGLE_CLIENT_ID?.trim()),
  apple: Boolean(process.env.NEXT_PUBLIC_AUTH_APPLE_CLIENT_ID?.trim()),
  microsoft: Boolean(process.env.NEXT_PUBLIC_AUTH_MICROSOFT_CLIENT_ID?.trim()),
};

type AuthMode = "login" | "signup";

/**
 * Renders a blocking overlay with the sign-in or create-account form on top
 * of whatever page mounted it. Used on the roadmap-planning view so the
 * planner stays visible (slightly dimmed) behind the popup while blocking
 * interaction until the user authenticates.
 *
 * The user can toggle between the login and signup views inside the modal
 * itself — no page navigation, so the planner stays mounted underneath.
 */
export function LoginModal() {
  const { data, isPending } = useSession();
  const [mode, setMode] = useState<AuthMode>("login");

  // Still resolving the session — render nothing so we don't flash the modal
  // for users who are actually logged in.
  if (isPending) return null;
  if (data?.user) return null;

  return (
    <div
      role="dialog"
      aria-modal
      aria-label={mode === "login" ? "Sign in to Bird Eye Viewer" : "Create your Bird Eye Viewer account"}
      className="fixed inset-0 z-[1000] flex items-center justify-center"
    >
      {/* Backdrop — 30% dim so the planner is clearly de-emphasized while
          still being visible underneath. Still swallows click events. */}
      <div className="absolute inset-0 bg-slate-900/30" aria-hidden />

      {/* Modal card — floats above the planner with a strong drop shadow.
          Split-screen layout (form left, brand panel right) like /login;
          on mobile the brand panel collapses and only the form shows.
          No ring border — the drop shadow alone separates the card from
          the planner behind it. */}
      <div className="relative z-10 mx-4 grid w-full max-w-5xl overflow-hidden rounded-3xl bg-white shadow-[0_40px_100px_-15px_rgba(15,23,42,0.55),0_20px_40px_-20px_rgba(15,23,42,0.35)] lg:grid-cols-[9fr_11fr]">
        <section className="flex flex-col px-8 py-8 sm:px-12 sm:py-10 lg:px-14 lg:py-10">
          <div className="my-auto w-full max-w-[420px] py-4">
            {/* When in signup mode, show a "Back to sign in" link above the
                heading so the user can return to the login view easily. */}
            {mode === "signup" && (
              <button
                type="button"
                onClick={() => setMode("login")}
                className="mb-5 inline-flex items-center gap-1.5 text-[12px] font-semibold text-indigo-600 transition-colors hover:text-indigo-700 hover:underline"
              >
                <ArrowLeft className="size-3.5" />
                Back to sign in
              </button>
            )}
            <div className="mb-6 space-y-1.5">
              <h2 className="text-[26px] font-extrabold leading-tight tracking-tight text-slate-900">
                {mode === "login" ? "Sign in" : "Create your account"}
              </h2>
              <p className="text-[13px] leading-relaxed text-slate-500">
                {mode === "login"
                  ? "Please sign in to continue with Bird Eye Viewer."
                  : "Free, takes a minute. Get back to planning your roadmap."}
              </p>
            </div>
            {mode === "login" ? (
              <LoginForm
                enabledProviders={ENABLED_OAUTH_PROVIDERS_CLIENT}
                onSwitchToSignup={() => setMode("signup")}
              />
            ) : (
              <SignupForm
                enabledProviders={ENABLED_OAUTH_PROVIDERS_CLIENT}
                onSwitchToLogin={() => setMode("login")}
              />
            )}
          </div>
        </section>
        <BrandPanel />
      </div>
    </div>
  );
}
