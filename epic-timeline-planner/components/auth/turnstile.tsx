"use client";

import { useEffect, useId, useRef, useState } from "react";

const TURNSTILE_SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const TURNSTILE_SCRIPT_ID = "cf-turnstile-script";

/**
 * Cloudflare Turnstile widget. Renders only when both:
 *   1. NEXT_PUBLIC_TURNSTILE_SITE_KEY is set
 *   2. The parent passes `visible={true}` (we show it after 3 failed login attempts)
 *
 * The widget calls onSuccess(token) once the user solves the challenge. The token is then
 * sent with the next sign-in request and verified server-side via Cloudflare's siteverify
 * endpoint (handled in the login server action; not in this component).
 *
 * If the site key isn't set we return null — so the failing-login path falls back to the
 * rate-limit + lockout protections only (still safe, just one fewer layer).
 */
declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: {
          sitekey: string;
          callback: (token: string) => void;
          "error-callback"?: () => void;
          "expired-callback"?: () => void;
          theme?: "light" | "dark" | "auto";
        },
      ) => string;
      reset: (id: string) => void;
      remove: (id: string) => void;
    };
  }
}

export function Turnstile({
  visible,
  onSuccess,
  onError,
}: {
  visible: boolean;
  onSuccess: (token: string) => void;
  onError?: () => void;
}) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [scriptReady, setScriptReady] = useState(
    typeof window !== "undefined" && Boolean(window.turnstile),
  );
  const placeholderId = useId();

  // Inject the Turnstile script once per page load. Re-renders of this component re-use it.
  useEffect(() => {
    if (!siteKey || !visible) return;
    if (typeof window === "undefined") return;
    if (window.turnstile) {
      setScriptReady(true);
      return;
    }
    if (document.getElementById(TURNSTILE_SCRIPT_ID)) return;
    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.id = TURNSTILE_SCRIPT_ID;
    script.onload = () => setScriptReady(true);
    document.head.appendChild(script);
  }, [siteKey, visible]);

  // Render / re-render the widget when the script and key are both ready.
  useEffect(() => {
    if (!siteKey || !visible || !scriptReady || !containerRef.current) return;
    if (!window.turnstile) return;
    if (widgetIdRef.current) return; // already rendered
    widgetIdRef.current = window.turnstile.render(containerRef.current, {
      sitekey: siteKey,
      callback: onSuccess,
      "error-callback": () => onError?.(),
      "expired-callback": () => onError?.(),
      theme: "light",
    });
    return () => {
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          /* widget may already be gone — safe to ignore */
        }
        widgetIdRef.current = null;
      }
    };
  }, [siteKey, visible, scriptReady, onSuccess, onError]);

  if (!siteKey || !visible) return null;

  return (
    <div className="my-2">
      <div ref={containerRef} id={`turnstile-${placeholderId}`} />
    </div>
  );
}
