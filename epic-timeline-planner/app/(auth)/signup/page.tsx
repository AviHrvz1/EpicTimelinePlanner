import { ENABLED_OAUTH_PROVIDERS } from "@/lib/auth";

import { SignupForm } from "@/components/auth/signup-form";

/**
 * /signup — create a new account. Server enforces the same password rules as the live
 * strength meter (see lib/password-strength.ts → scorePassword + lib/auth.ts).
 */
export default function SignupPage() {
  return (
    <div className="space-y-5">
      <div className="space-y-1 text-center">
        <h1 className="text-lg font-bold text-slate-800">Create your account</h1>
        <p className="text-[12px] text-slate-500">
          Free, takes a minute. Already invited?{" "}
          <span className="text-slate-700">Use the email your admin added.</span>
        </p>
      </div>
      <SignupForm enabledProviders={ENABLED_OAUTH_PROVIDERS} />
    </div>
  );
}
