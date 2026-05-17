import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

/**
 * Send a password-reset email via AWS SES v2. Falls back to `console.log` in development
 * (or any environment where AUTH_EMAIL_FROM is unset) so the dev flow never silently fails
 * and you can grab the reset link from the terminal during local testing.
 *
 * Wired from Better Auth's `emailAndPassword.sendResetPassword` hook in lib/auth.ts. Don't
 * call it directly from API routes — always go through Better Auth so rate-limit and the
 * Verification table stay in sync.
 *
 * Required env:
 *   AUTH_EMAIL_FROM        — verified SES sender (e.g. "noreply@your-domain.com")
 *   AWS_REGION             — already set in .env (us-east-1)
 *   AWS_ACCESS_KEY_ID      — already set
 *   AWS_SECRET_ACCESS_KEY  — already set
 */
export async function sendResetEmail(args: {
  to: string;
  resetUrl: string;
  userName?: string | null;
}): Promise<void> {
  const { to, resetUrl, userName } = args;
  const from = process.env.AUTH_EMAIL_FROM?.trim();

  if (!from) {
    console.log("[auth] AUTH_EMAIL_FROM not set — logging reset link instead of emailing.");
    console.log(`[auth] reset link for ${to}: ${resetUrl}`);
    return;
  }

  const region = process.env.AWS_REGION || "us-east-1";
  const client = new SESv2Client({ region });

  const subject = "Reset your epic-timeline-planner password";
  const greeting = userName ? `Hi ${escapeHtml(userName)},` : "Hi,";
  const safeResetUrl = escapeAttr(resetUrl);

  // Keep the HTML deliberately plain — Gmail/Outlook strip <style> blocks; inline rules survive.
  const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f8fafc;padding:24px;color:#0f172a">
  <div style="max-width:520px;margin:0 auto;background:white;border:1px solid #e2e8f0;border-radius:12px;padding:24px">
    <h1 style="font-size:18px;font-weight:700;margin:0 0 12px">Reset your password</h1>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.5">${greeting} You (or someone with access to your email) asked to reset your epic-timeline-planner password.</p>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.5">Click the button below to set a new password. The link expires in 1 hour.</p>
    <p style="margin:0 0 24px"><a href="${safeResetUrl}" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#4f46e5);color:white;font-weight:600;padding:10px 18px;border-radius:8px;text-decoration:none;font-size:14px">Reset password</a></p>
    <p style="margin:0;font-size:12px;color:#64748b">If the button doesn't work, paste this link into your browser:<br><span style="word-break:break-all">${safeResetUrl}</span></p>
    <p style="margin:24px 0 0;font-size:12px;color:#94a3b8">Didn't request this? You can safely ignore this email — your password won't change.</p>
  </div>
</body></html>`;

  const text = `${userName ? `Hi ${userName},` : "Hi,"}

You (or someone with access to your email) asked to reset your epic-timeline-planner password.

Reset your password (link expires in 1 hour):
${resetUrl}

Didn't request this? You can safely ignore this email.`;

  try {
    await client.send(
      new SendEmailCommand({
        FromEmailAddress: from,
        Destination: { ToAddresses: [to] },
        Content: {
          Simple: {
            Subject: { Data: subject, Charset: "UTF-8" },
            Body: {
              Html: { Data: html, Charset: "UTF-8" },
              Text: { Data: text, Charset: "UTF-8" },
            },
          },
        },
      }),
    );
  } catch (err) {
    // Surface the failure to server logs but never to the client — the auth flow
    // returns 200 either way so we don't leak which emails are registered.
    console.error("[auth] SES sendResetEmail failed:", err);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(s: string): string {
  return s.replace(/"/g, "&quot;");
}
