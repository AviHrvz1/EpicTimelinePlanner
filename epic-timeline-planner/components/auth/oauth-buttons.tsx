"use client";

import { useState } from "react";
import { toast } from "sonner";

import { signIn } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

type Provider = "google" | "apple" | "microsoft";

/**
 * Renders OAuth login buttons for whichever providers are enabled on the server.
 *
 * `enabledProviders` is computed in lib/auth.ts (ENABLED_OAUTH_PROVIDERS) and passed in
 * from the server component, so the client never needs to read process.env. A button is
 * hidden when its provider has no credentials set — keeps the login UI from showing a
 * "Continue with Google" affordance that would fail the OAuth handshake.
 */
export function OAuthButtons({
  enabledProviders,
  callbackURL = "/",
}: {
  enabledProviders: { google: boolean; apple: boolean; microsoft: boolean };
  callbackURL?: string;
}) {
  const [pending, setPending] = useState<Provider | null>(null);

  if (!enabledProviders.google && !enabledProviders.apple && !enabledProviders.microsoft) {
    return null;
  }

  async function handleOAuth(provider: Provider) {
    setPending(provider);
    try {
      await signIn.social({ provider, callbackURL });
    } catch (err) {
      const message = err instanceof Error ? err.message : `${provider} sign-in failed`;
      toast.error(message);
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-2">
        {enabledProviders.google && (
          <OAuthButton
            label="Continue with Google"
            provider="google"
            pending={pending === "google"}
            disabled={pending != null && pending !== "google"}
            onClick={() => handleOAuth("google")}
            icon={<GoogleIcon />}
          />
        )}
        {enabledProviders.apple && (
          <OAuthButton
            label="Continue with Apple"
            provider="apple"
            pending={pending === "apple"}
            disabled={pending != null && pending !== "apple"}
            onClick={() => handleOAuth("apple")}
            icon={<AppleIcon />}
          />
        )}
        {enabledProviders.microsoft && (
          <OAuthButton
            label="Continue with Microsoft"
            provider="microsoft"
            pending={pending === "microsoft"}
            disabled={pending != null && pending !== "microsoft"}
            onClick={() => handleOAuth("microsoft")}
            icon={<MicrosoftIcon />}
          />
        )}
      </div>
    </div>
  );
}

function OAuthButton({
  label,
  pending,
  disabled,
  onClick,
  icon,
}: {
  label: string;
  provider: Provider;
  pending: boolean;
  disabled: boolean;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled || pending}
      onClick={onClick}
      className={cn(
        "inline-flex h-12 w-full items-center justify-center gap-3 rounded-full border border-slate-200 bg-white px-6 text-[13px] font-bold uppercase tracking-[0.08em] text-slate-700 shadow-sm transition-all",
        "hover:border-slate-300 hover:bg-slate-50 hover:shadow",
        "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-slate-200",
        "disabled:cursor-not-allowed disabled:opacity-50",
      )}
    >
      <span className="size-5 shrink-0">{icon}</span>
      <span>{pending ? "Redirecting…" : label}</span>
    </button>
  );
}

function GoogleIcon() {
  return (
    <svg className="size-5 shrink-0" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.19 3.32v2.76h3.55c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.55-2.76c-.98.66-2.23 1.06-3.73 1.06-2.87 0-5.3-1.94-6.16-4.54H2.18v2.84A11 11 0 0 0 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1A6.6 6.6 0 0 1 5.48 12c0-.73.13-1.44.36-2.1V7.07H2.18a11 11 0 0 0 0 9.87L5.84 14.1z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.2 1.65l3.15-3.15A11 11 0 0 0 12 1a11 11 0 0 0-9.82 6.07L5.84 9.9C6.7 7.3 9.13 5.38 12 5.38z"
      />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg className="size-5 shrink-0" viewBox="0 0 24 24" aria-hidden fill="#111827">
      <path d="M16.365 1.43c0 1.14-.41 2.21-1.23 3.21-.91 1.12-2.06 1.79-3.21 1.7-.13-1.1.43-2.27 1.21-3.18.85-1.01 2.21-1.7 3.23-1.73zM21 17.36c-.51 1.13-.76 1.64-1.42 2.65-.92 1.4-2.22 3.15-3.83 3.17-1.43.02-1.8-.94-3.74-.93-1.94.01-2.34.94-3.78.92-1.61-.02-2.84-1.6-3.76-3-2.57-3.92-2.84-8.51-1.25-10.95.85-1.31 2.19-2.07 3.45-2.07 1.29 0 2.1.71 3.16.71 1.03 0 1.66-.71 3.15-.71 1.29 0 2.66.7 3.62 1.91-3.19 1.74-2.67 6.3.4 7.3z" />
    </svg>
  );
}

function MicrosoftIcon() {
  return (
    <svg className="size-5 shrink-0" viewBox="0 0 24 24" aria-hidden>
      <path fill="#F25022" d="M11.4 11.4H1V1h10.4z" />
      <path fill="#7FBA00" d="M23 11.4H12.6V1H23z" />
      <path fill="#00A4EF" d="M11.4 23H1V12.6h10.4z" />
      <path fill="#FFB900" d="M23 23H12.6V12.6H23z" />
    </svg>
  );
}
