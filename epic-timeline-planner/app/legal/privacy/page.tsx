import Link from "next/link";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — Bird Eye Viewer",
  description:
    "How Bird Eye Viewer collects, uses, and protects your personal information.",
};

/**
 * Privacy Policy. Adapted from Automattic's Legalmattic open-source legal
 * templates (Creative Commons Attribution-ShareAlike 4.0) and tailored to the
 * data flows actually used by Bird Eye Viewer — accounts, roadmaps, sprint
 * data, authentication cookies, optional OAuth providers.
 *
 * NOT LEGAL ADVICE. Have a qualified attorney review this document before
 * relying on it in any production deployment. Operating jurisdiction, GDPR
 * controller designation, governing law, and the data-processing addendum for
 * enterprise customers must be reviewed by counsel.
 */
export default function PrivacyPolicyPage() {
  const lastUpdated = "May 2026";
  return (
    <div className="prose-bep">
      <h1>Privacy Policy</h1>
      <p className="text-sm text-slate-500">Last updated: {lastUpdated}</p>

      <p>
        Your privacy is important to us. This Privacy Policy describes what
        information we collect about you when you use Bird Eye Viewer (the
        "Service"), how we use it, who we share it with, and the choices you
        have about that information.
      </p>

      <h2>1. Who We Are</h2>
      <p>
        Bird Eye Viewer is a roadmap and sprint planning tool operated by the
        Bird Eye Viewer team ("we," "us," "our"). If you have any questions
        about this policy, contact us at{" "}
        <a href="mailto:privacy@birdeyeviewer.app">privacy@birdeyeviewer.app</a>.
      </p>

      <h2>2. Information We Collect</h2>
      <p>We collect three categories of information:</p>
      <ul>
        <li>
          <strong>Account information.</strong> When you sign up we collect
          your name, email address, and password (stored as a salted hash — we
          never see your password in plain text). If you sign in with a
          third-party provider (Google, Apple, Microsoft), we receive your
          name, email, and a unique provider ID from that provider.
        </li>
        <li>
          <strong>Product data.</strong> The content you create while using
          the Service — roadmaps, initiatives, epics, user stories, comments,
          and any text or notes you enter — is stored so we can render it back
          to you.
        </li>
        <li>
          <strong>Technical information.</strong> Limited diagnostic data
          including IP address, browser/user-agent, timestamps of requests,
          and authentication-related events (sign-in, sign-out, password
          reset). This is used for security, abuse prevention, and rate
          limiting.
        </li>
      </ul>

      <h2>3. How We Use Information</h2>
      <p>We use the information we collect to:</p>
      <ul>
        <li>Provide, operate, and maintain the Service.</li>
        <li>Authenticate you and keep your session secure.</li>
        <li>Send service-related communications (password resets, security alerts).</li>
        <li>Detect, prevent, and respond to fraud, abuse, and security incidents.</li>
        <li>Comply with legal obligations.</li>
      </ul>
      <p>
        We do <strong>not</strong> sell your personal information to third
        parties, and we do not use the content of your roadmaps or stories to
        train any machine-learning models.
      </p>

      <h2>4. Cookies</h2>
      <p>
        We use a small number of strictly necessary cookies. The most important
        one stores your authenticated session so you don't have to sign in on
        every page load. We do not use advertising cookies or third-party
        tracking cookies.
      </p>

      <h2>5. Third-Party Services</h2>
      <p>
        When enabled, the Service integrates with the following third parties.
        Each provider receives only the data necessary for its function and is
        bound by its own privacy policy:
      </p>
      <ul>
        <li>
          <strong>OAuth providers</strong> (Google, Apple, Microsoft) — used
          only if you choose to sign in with one of them.
        </li>
        <li>
          <strong>Email delivery</strong> — transactional emails (password
          reset, security notifications) are sent via our email-delivery
          provider.
        </li>
      </ul>

      <h2>6. Data Retention</h2>
      <p>
        We retain account information for as long as your account is active.
        If you delete your account, we will delete or anonymize your personal
        information within 30 days, except where we are required to retain it
        to comply with legal obligations, resolve disputes, or enforce our
        agreements.
      </p>

      <h2>7. Your Rights</h2>
      <p>
        Depending on where you live, you may have the following rights with
        respect to your personal information:
      </p>
      <ul>
        <li>
          <strong>Access</strong> — request a copy of the personal
          information we hold about you.
        </li>
        <li><strong>Correction</strong> — ask us to correct inaccurate data.</li>
        <li>
          <strong>Deletion</strong> — request that we delete your account and
          associated personal data.
        </li>
        <li>
          <strong>Portability</strong> — receive your data in a structured,
          machine-readable format.
        </li>
        <li>
          <strong>Objection / restriction</strong> — object to certain
          processing, or request that we restrict it.
        </li>
      </ul>
      <p>
        EU/UK residents have additional rights under the General Data
        Protection Regulation (GDPR), and California residents have additional
        rights under the California Consumer Privacy Act (CCPA), including the
        right to opt out of the sale of personal information (we do not sell
        personal information). To exercise any of these rights, email{" "}
        <a href="mailto:privacy@birdeyeviewer.app">privacy@birdeyeviewer.app</a>.
      </p>

      <h2>8. Security</h2>
      <p>
        We use industry-standard safeguards to protect your data, including
        encryption in transit (HTTPS), salted password hashing, rate limiting,
        and brute-force lockout on sign-in. No system is perfectly secure,
        however, and we cannot guarantee that unauthorized parties will never
        be able to defeat those measures.
      </p>

      <h2>9. Children</h2>
      <p>
        The Service is not directed to children under 13 (or under 16 in the
        EU/UK). We do not knowingly collect personal information from
        children. If you believe a child has provided us with personal
        information, contact us and we will delete it.
      </p>

      <h2>10. Changes</h2>
      <p>
        We may update this Privacy Policy from time to time. If we make
        material changes we will notify you (for example, by email or via a
        prominent notice on the Service) before the changes take effect. The
        date at the top of this page shows when it was last revised.
      </p>

      <h2>11. Contact</h2>
      <p>
        Questions about this policy or our privacy practices? Email us at{" "}
        <a href="mailto:privacy@birdeyeviewer.app">privacy@birdeyeviewer.app</a>.
      </p>

      <hr />
      <p className="text-xs text-slate-500">
        See also our <Link href="/legal/terms">Terms of Service</Link>.
      </p>
    </div>
  );
}
