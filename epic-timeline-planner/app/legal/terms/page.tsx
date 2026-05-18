import Link from "next/link";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service — Bird Eye Viewer",
  description: "The terms that govern your use of Bird Eye Viewer.",
};

/**
 * Terms of Service. Adapted from Automattic's Legalmattic open-source legal
 * templates (Creative Commons Attribution-ShareAlike 4.0) and pared down to
 * the obligations actually relevant to a roadmap / sprint planning SaaS.
 *
 * NOT LEGAL ADVICE. Have a qualified attorney review this document before
 * relying on it in production. Governing law, dispute resolution, arbitration
 * clauses, and consumer-protection carve-outs must be reviewed by counsel.
 */
export default function TermsOfServicePage() {
  const lastUpdated = "May 2026";
  return (
    <div className="prose-bep">
      <h1>Terms of Service</h1>
      <p className="text-sm text-slate-500">Last updated: {lastUpdated}</p>

      <p>
        These Terms of Service ("Terms") govern your access to and use of Bird
        Eye Viewer (the "Service"). By creating an account or using the
        Service, you agree to be bound by these Terms. If you don't agree,
        please don't use the Service.
      </p>

      <h2>1. Your Account</h2>
      <p>
        You must provide accurate information when creating an account and
        keep it up to date. You're responsible for safeguarding your password
        and for all activity that happens under your account. Notify us
        immediately if you suspect any unauthorized use.
      </p>

      <h2>2. Acceptable Use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>Use the Service to violate any applicable law or regulation.</li>
        <li>
          Upload content that infringes intellectual-property rights or that
          is unlawful, defamatory, harassing, or otherwise objectionable.
        </li>
        <li>
          Attempt to gain unauthorized access to the Service, other accounts,
          or any underlying infrastructure.
        </li>
        <li>
          Interfere with the operation of the Service, including by sending
          excessive automated requests, probing for vulnerabilities without
          authorization, or attempting to circumvent rate limits.
        </li>
        <li>
          Use the Service to send unsolicited communications or to distribute
          malware.
        </li>
      </ul>

      <h2>3. Your Content</h2>
      <p>
        You retain all rights to the content you create on the Service —
        roadmaps, initiatives, epics, stories, comments, notes, and any other
        text or data you enter ("Your Content"). By using the Service you
        grant us a limited license to host, store, transmit, and display Your
        Content solely for the purpose of providing the Service to you. We
        will not use Your Content for advertising, model training, or any
        purpose beyond operating the Service.
      </p>

      <h2>4. Our Intellectual Property</h2>
      <p>
        The Service, including its software, design, logos, and trademarks,
        is owned by the Bird Eye Viewer team and is protected by intellectual
        property law. Nothing in these Terms transfers ownership of any part
        of the Service to you. You may not copy, modify, distribute, or
        reverse-engineer the Service except as expressly permitted by law.
      </p>

      <h2>5. Pricing and Subscriptions</h2>
      <p>
        Some features of the Service may be offered on a paid subscription
        basis. If you sign up for a paid plan, you agree to pay the fees and
        applicable taxes for that plan. We may change pricing for new
        billing periods on reasonable notice. You may cancel at any time
        through your account settings; cancellations take effect at the end
        of the then-current billing period.
      </p>

      <h2>6. Termination</h2>
      <p>
        You may stop using the Service and delete your account at any time.
        We may suspend or terminate your access to the Service if you violate
        these Terms, if required by law, or if continuing to provide the
        Service to you would expose us to legal liability. On termination,
        the rights granted under these Terms cease immediately, but sections
        intended to survive (including the IP, disclaimer, liability, and
        governing-law sections) will continue to apply.
      </p>

      <h2>7. Disclaimer of Warranties</h2>
      <p>
        THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES
        OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING WITHOUT LIMITATION
        IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
        PURPOSE, OR NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICE WILL
        BE UNINTERRUPTED, ERROR-FREE, OR FREE OF HARMFUL COMPONENTS.
      </p>

      <h2>8. Limitation of Liability</h2>
      <p>
        TO THE FULLEST EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT WILL
        THE BIRD EYE VIEWER TEAM BE LIABLE FOR ANY INDIRECT, INCIDENTAL,
        SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS
        OR REVENUES, WHETHER INCURRED DIRECTLY OR INDIRECTLY, OR ANY LOSS OF
        DATA, USE, GOODWILL, OR OTHER INTANGIBLE LOSSES, RESULTING FROM YOUR
        ACCESS TO OR USE OF, OR INABILITY TO ACCESS OR USE, THE SERVICE.
      </p>

      <h2>9. Indemnification</h2>
      <p>
        You agree to defend, indemnify, and hold harmless the Bird Eye Viewer
        team from and against any claims, liabilities, damages, losses, and
        expenses (including reasonable legal fees) arising out of or in any
        way connected with your access to or use of the Service or your
        violation of these Terms.
      </p>

      <h2>10. Changes to These Terms</h2>
      <p>
        We may revise these Terms from time to time. If a revision is
        material, we will notify you (for example, by email or via a prominent
        notice on the Service) before the new Terms take effect. Continuing to
        use the Service after the new Terms come into effect means you accept
        the revised Terms.
      </p>

      <h2>11. Governing Law</h2>
      <p>
        These Terms are governed by the laws of the jurisdiction where the
        Bird Eye Viewer team is established, without regard to its conflict
        of law provisions. The specific jurisdiction and venue will be
        confirmed before the Service is offered for commercial use.
      </p>

      <h2>12. Contact</h2>
      <p>
        Questions about these Terms? Email us at{" "}
        <a href="mailto:legal@birdeyeviewer.app">legal@birdeyeviewer.app</a>.
      </p>

      <hr />
      <p className="text-xs text-slate-500">
        See also our <Link href="/legal/privacy">Privacy Policy</Link>.
      </p>
    </div>
  );
}
