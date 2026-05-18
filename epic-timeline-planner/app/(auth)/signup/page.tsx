import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { ENABLED_OAUTH_PROVIDERS } from "@/lib/auth";

import { SignupForm } from "@/components/auth/signup-form";

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
      <div className="space-y-1.5">
        <h1 className="text-[30px] font-extrabold leading-tight tracking-tight text-slate-900">
          Create your account
        </h1>
        <p className="text-[13px] leading-relaxed text-slate-500">
          Free, takes a minute. Already invited?{" "}
          <span className="font-medium text-slate-700">Use the email your admin added.</span>
        </p>
      </div>
      <SignupForm enabledProviders={ENABLED_OAUTH_PROVIDERS} />
    </div>
  );
}
