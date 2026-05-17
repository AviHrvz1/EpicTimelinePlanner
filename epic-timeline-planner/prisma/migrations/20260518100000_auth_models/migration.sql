-- Auth models (Better Auth shape) + WorkspaceUser soft-link.
-- Applied directly via sqlite3 because the dev DB has no Prisma baseline (P3005).

CREATE TABLE "User" (
  "id"               TEXT PRIMARY KEY,
  "email"            TEXT NOT NULL UNIQUE,
  "emailVerified"    INTEGER NOT NULL DEFAULT 0,
  "name"             TEXT,
  "image"            TEXT,
  "passwordHash"     TEXT,
  "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
  "lockedUntil"      DATETIME,
  "workspaceUserId"  TEXT UNIQUE REFERENCES "WorkspaceUser"("id") ON DELETE SET NULL,
  "createdAt"        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "User_email_idx" ON "User"("email");

CREATE TABLE "Account" (
  "id"                    TEXT PRIMARY KEY,
  "userId"                TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "providerId"            TEXT NOT NULL,
  "accountId"             TEXT NOT NULL,
  "accessToken"           TEXT,
  "refreshToken"          TEXT,
  "accessTokenExpiresAt"  DATETIME,
  "refreshTokenExpiresAt" DATETIME,
  "scope"                 TEXT,
  "idToken"               TEXT,
  "password"              TEXT,
  "createdAt"             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "Account_providerId_accountId_key" ON "Account"("providerId", "accountId");
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

CREATE TABLE "Session" (
  "id"        TEXT PRIMARY KEY,
  "userId"    TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "token"     TEXT NOT NULL UNIQUE,
  "expiresAt" DATETIME NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

CREATE TABLE "Verification" (
  "id"         TEXT PRIMARY KEY,
  "identifier" TEXT NOT NULL,
  "value"      TEXT NOT NULL,
  "expiresAt"  DATETIME NOT NULL,
  "createdAt"  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "Verification_identifier_idx" ON "Verification"("identifier");

CREATE TABLE "RateLimitEvent" (
  "id"        TEXT PRIMARY KEY,
  "key"       TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "RateLimitEvent_key_createdAt_idx" ON "RateLimitEvent"("key", "createdAt");
