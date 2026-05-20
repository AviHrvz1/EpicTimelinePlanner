import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { ENABLED_OAUTH_PROVIDERS } from "@/lib/auth";

import { SignupForm } from "@/components/auth/signup-form";

const VISIBLE_OAUTH_PROVIDERS = {
  ...ENABLED_OAUTH_PROVIDERS,
  google: true,
};

/**
 * /signup — create a new account. Server enforces the same password rules as the live
 * strength meter (see lib/password-strength.ts → scorePassword + lib/auth.ts).
 */
export default function SignupPage() {
  return (
    <div className="space-y-7">
      <Link
        href="/login"
        className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-indigo-600 transition-colors hover:text-indigo-700 hover:underline"
      >
        <ArrowLeft className="size-3.5" />
        Back to sign in
      </Link>
      <div className="space-y-2 text-center">
        <h1 className="text-[34px] font-extrabold leading-tight tracking-tight text-slate-900">
          Welcome to Bird Eye Viewer
        </h1>
        <p className="text-[14px] leading-relaxed text-slate-500">
          Get started — it&apos;s free.
        </p>
      </div>
      <SignupForm enabledProviders={VISIBLE_OAUTH_PROVIDERS} />
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
