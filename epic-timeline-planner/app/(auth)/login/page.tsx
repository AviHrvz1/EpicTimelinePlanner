import { ENABLED_OAUTH_PROVIDERS } from "@/lib/auth";

import { LoginForm } from "@/components/auth/login-form";

/**
 * /login — email/password sign-in with OAuth fallbacks. Reads which OAuth providers are
 * configured from lib/auth.ts (server-only) and hands the flags down to the client form
 * so we don't accidentally expose credential presence via NEXT_PUBLIC_* vars.
 */
export default function LoginPage() {
  return (
    <div className="space-y-5">
      <div className="space-y-1 text-center">
        <h1 className="text-lg font-bold text-slate-800">Sign in</h1>
        <p className="text-[12px] text-slate-500">Welcome back. Pick up where you left off.</p>
      </div>
      <LoginForm enabledProviders={ENABLED_OAUTH_PROVIDERS} />
    </div>
  );
}
