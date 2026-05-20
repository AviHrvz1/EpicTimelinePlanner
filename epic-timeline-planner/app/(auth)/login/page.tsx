import Link from "next/link";

import { ENABLED_OAUTH_PROVIDERS } from "@/lib/auth";

import { LoginForm } from "@/components/auth/login-form";

// Always render the "Continue with Google" affordance so the auth surface
// matches the design even before the AUTH_GOOGLE_CLIENT_ID env is set.
const VISIBLE_OAUTH_PROVIDERS = {
  ...ENABLED_OAUTH_PROVIDERS,
  google: true,
};

/**
 * /login — email/password sign-in with OAuth fallbacks. Reads which OAuth providers are
 * configured from lib/auth.ts (server-only) and hands the flags down to the client form
 * so we don't accidentally expose credential presence via NEXT_PUBLIC_* vars.
 */
export default function LoginPage() {
  return (
    <div className="space-y-7">
      <div className="space-y-2 text-center">
        <h1 className="text-[34px] font-extrabold leading-tight tracking-tight text-slate-900">
          Welcome to Bird Eye Viewer
        </h1>
        <p className="text-[14px] leading-relaxed text-slate-500">
          Sign in to keep planning.
        </p>
      </div>
      <LoginForm enabledProviders={VISIBLE_OAUTH_PROVIDERS} />
      <p className="pt-4 text-center text-[13.5px] leading-relaxed text-slate-500">
        By proceeding, you agree to the{" "}
        <Link href="/legal/terms" className="font-semibold text-indigo-600 hover:text-indigo-700 hover:underline">
          Terms of Service
        </Link>{" "}
        and{" "}
        <Link href="/legal/privacy" className="font-semibold text-indigo-600 hover:text-indigo-700 hover:underline">
          Privacy Policy
        </Link>
        .
      </p>
    </div>
  );
}
