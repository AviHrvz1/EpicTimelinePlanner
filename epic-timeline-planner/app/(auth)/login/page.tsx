import Image from "next/image";

import { ENABLED_OAUTH_PROVIDERS } from "@/lib/auth";

import { LoginForm } from "@/components/auth/login-form";

/**
 * /login — email/password sign-in with OAuth fallbacks. Reads which OAuth providers are
 * configured from lib/auth.ts (server-only) and hands the flags down to the client form
 * so we don't accidentally expose credential presence via NEXT_PUBLIC_* vars.
 */
export default function LoginPage() {
  return (
    <div className="space-y-7">
      <div className="space-y-1.5">
        <h1 className="flex items-center gap-2.5 text-[30px] font-extrabold leading-tight tracking-tight text-slate-900">
          <Image
            src="/bird-eye-bubble.png"
            alt=""
            width={56}
            height={56}
            priority
            quality={100}
            className="size-7"
            aria-hidden
          />
          Sign in
        </h1>
        <p className="text-[13px] leading-relaxed text-slate-500">
          Welcome back. Pick up where you left off.
        </p>
      </div>
      <LoginForm enabledProviders={ENABLED_OAUTH_PROVIDERS} />
    </div>
  );
}
