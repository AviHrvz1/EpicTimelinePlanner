# Auth setup guide

This app uses **Better Auth** with email/password as the primary credential path and
optional OAuth providers (Google, Apple, Microsoft). Sessions, password reset, rate
limiting and brute-force lockout are all built in.

Everything lives in your existing Prisma SQLite database — there is no external
identity provider to manage.

## 1. First-run checklist

After cloning / pulling the auth feature:

1. **Install deps** (already in `package.json`): `npm install`
2. **Apply the auth migration** (the dev DB has no Prisma baseline so we apply SQL directly):
   ```bash
   sqlite3 prisma/dev.db < prisma/migrations/20260518100000_auth_models/migration.sql
   ```
   Verify with: `sqlite3 prisma/dev.db ".tables"` — you should see `User`, `Account`, `Session`,
   `Verification`, `RateLimitEvent` in the list.
3. **Generate the Prisma client**: `npx prisma generate`
4. **Restart `next dev`** so the new env vars and migrations load.

The first user signs up at `/signup`. Email/password works out of the box without any
extra configuration; OAuth providers and the password-reset email require setup below.

## 2. Cookie + session

Session cookies are prefixed `epic-timeline.*` and live for **1 day** by default, or
**30 days** when the login form's *Remember me* checkbox is ticked. Cookies are
`httpOnly` and `sameSite=lax`, marked `Secure` automatically in production.

The signing secret is `BETTER_AUTH_SECRET` in `.env`. **Rotating it signs every user
out.** Generate a new secret with:

```bash
openssl rand -base64 32
```

## 3. Password rules

| Rule | Value |
|---|---|
| Minimum length | 10 characters |
| Minimum strength score | 3 of 4 |
| Criteria | length, mixed case, digit, symbol |
| Rejection mode | Both client (`scorePassword`) and server (Better Auth `minPasswordLength` + complexity) |

The exact scorer lives at `lib/password-strength.ts`. The signup and password-reset
pages render a live strength meter using the same function.

## 4. Rate limiting + lockout

| Endpoint | Limit |
|---|---|
| `/api/auth/sign-in/email` | 5 attempts / 15 min |
| `/api/auth/sign-up/email` | 5 / hour |
| `/api/auth/forget-password` | 3 / hour |

Beyond rate limiting, `User.failedLoginCount` is incremented on each wrong password.
After 5 consecutive failures Better Auth sets `User.lockedUntil` for 15 minutes; the
login form surfaces the cooldown to the user. To clear a lockout manually:

```bash
sqlite3 prisma/dev.db "UPDATE User SET failedLoginCount=0, lockedUntil=NULL WHERE email='you@example.com';"
```

## 5. Cloudflare Turnstile (captcha)

Turnstile is shown automatically after **3 failed login attempts** in a session. To
enable it:

1. Sign in to https://dash.cloudflare.com → **Turnstile** → **Add site**
2. Choose **Managed** challenge type, add your domains (`localhost`, `127.0.0.1`, and
   any deploy URLs)
3. Copy the **Site Key** and **Secret Key**
4. Paste into `.env`:
   ```ini
   NEXT_PUBLIC_TURNSTILE_SITE_KEY=0x4A...your-site-key
   TURNSTILE_SECRET_KEY=0x4A...your-secret-key
   ```
5. Restart `next dev`

If the keys are blank, the login form simply skips the captcha step and relies on the
rate-limit + account-lockout layers.

## 6. Password reset email (AWS SES)

The reset flow:
1. User submits an email at `/forgot-password`
2. Better Auth writes a token into the `Verification` table and calls
   `sendResetPassword` (defined in `lib/auth.ts`)
3. That handler calls `sendResetEmail()` in `lib/email/send-reset-email.ts`, which
   sends a templated message via AWS SES v2

### To enable real email delivery

1. Sign in to the AWS console → **SES** in the same region as `AWS_REGION` (currently
   `us-east-1`)
2. **Verified identities → Create identity** — pick *Email address* and verify a sender
   address you own (e.g. `noreply@your-domain.com`). Until you raise the SES production
   limit, you can only send TO addresses that are also verified.
3. Make sure your IAM user (the one whose keys are in `.env`) has the `ses:SendEmail`
   action allowed.
4. Set `AUTH_EMAIL_FROM` in `.env` to the verified address you just created.
5. Restart `next dev`.

If `AUTH_EMAIL_FROM` is blank, the reset link is **logged to the server console**
instead of emailed — perfect for local dev.

## 7. OAuth providers

All three buttons (Google / Apple / Microsoft) appear on the login page only when
their `CLIENT_ID` and `CLIENT_SECRET` are present in `.env`. To enable a provider,
follow its developer-console steps below and paste the credentials into `.env`.

The callback URL for every provider is:
```
${BETTER_AUTH_URL}/api/auth/callback/{provider}
```
…for example: `http://localhost:3000/api/auth/callback/google`.

### Google

1. https://console.cloud.google.com/ → **APIs & Services → Credentials**
2. **Create OAuth client ID** → *Web application*
3. **Authorized redirect URI**: `http://localhost:3000/api/auth/callback/google` (and
   your production URL when ready)
4. Copy the Client ID + secret into `AUTH_GOOGLE_CLIENT_ID` and
   `AUTH_GOOGLE_CLIENT_SECRET`.

### Microsoft (Entra ID)

1. https://portal.azure.com → **Entra ID → App registrations → New registration**
2. **Redirect URI**: Web → `http://localhost:3000/api/auth/callback/microsoft`
3. **Certificates & secrets → New client secret**
4. Copy the Application (client) ID into `AUTH_MICROSOFT_CLIENT_ID`, the secret VALUE
   (not the ID) into `AUTH_MICROSOFT_CLIENT_SECRET`. Optionally set
   `AUTH_MICROSOFT_TENANT_ID` to lock down to a single tenant; leave blank for
   multi-tenant.

### Apple

1. https://developer.apple.com/account/resources/identifiers → **Identifiers → +**
2. Create an **App ID**, enable **Sign in with Apple**
3. Create a **Services ID** (this is the OAuth client ID)
4. Add the return URL `http://localhost:3000/api/auth/callback/apple`
5. Generate a **Sign in with Apple** key (Keys → +), download the `.p8` file, and use
   the standard Apple JWT-as-secret flow to produce `AUTH_APPLE_CLIENT_SECRET`. The
   client ID is the Services ID slug, e.g. `com.yourcompany.app.web`.

## 8. WorkspaceUser auto-link

The auth `User` is separate from `WorkspaceUser` (the team-directory profile). On
first signup `lib/auth.ts → databaseHooks.user.create.after` runs:

```ts
const wu = await db.workspaceUser.findUnique({ where: { email: user.email } });
if (wu) await db.user.update({ where: { id: user.id }, data: { workspaceUserId: wu.id } });
```

So if an admin pre-creates a `WorkspaceUser` with someone's email, that directory
entry automatically links to the auth account on first signup — no manual step
needed.

## 9. Read vs write gating (v1)

`proxy.ts` blocks unauthenticated **writes** (`POST` / `PATCH` / `PUT` / `DELETE`)
on `/api/*` but lets **`GET`** through. This is a deliberately soft rollout — existing
read-only flows keep working while you verify the auth UX. Tighten this once you're
ready by extending the matcher / method list.

## 10. Sign-out / session management

The `UserChip` in the top header opens a dropdown with a **Sign out** button which
calls `signOut()` from `lib/auth-client.ts`. Server-side this deletes the user's row
in the `Session` table and clears the cookie.

To kill all sessions for a user (e.g. password rotation, suspected compromise):

```bash
sqlite3 prisma/dev.db "DELETE FROM Session WHERE userId = (SELECT id FROM User WHERE email='you@example.com');"
```

## 11. What's NOT included in v1

- 2FA / TOTP — Better Auth has a plugin; flip in `lib/auth.ts` when ready
- Magic-link email login
- Email-verification gate (`requireEmailVerification` is `false`)
- Account deletion / GDPR export endpoints
- Admin UI to lock/unlock users
- Gating GET routes (kept public)
