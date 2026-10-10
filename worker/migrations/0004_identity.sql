create table "auth_user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" integer not null, "image" text, "createdAt" date not null, "updatedAt" date not null);

create table "auth_session" ("id" text not null primary key, "expiresAt" date not null, "token" text not null unique, "createdAt" date not null, "updatedAt" date not null, "ipAddress" text, "userAgent" text, "userId" text not null references "auth_user" ("id") on delete cascade);

create table "auth_account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "auth_user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date not null, "updatedAt" date not null);

create table "auth_verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null);

create table "auth_passkey" ("id" text not null primary key, "name" text, "publicKey" text not null, "userId" text not null references "auth_user" ("id") on delete cascade, "credentialID" text not null, "counter" integer not null, "deviceType" text not null, "backedUp" integer not null, "transports" text, "createdAt" date, "aaguid" text);

create table "auth_rate_limit" ("id" text not null primary key, "key" text not null unique, "count" integer not null, "lastRequest" bigint not null);

create index "auth_session_userId_idx" on "auth_session" ("userId");

create index "auth_account_userId_idx" on "auth_account" ("userId");

create index "auth_verification_identifier_idx" on "auth_verification" ("identifier");

create index "auth_passkey_userId_idx" on "auth_passkey" ("userId");

create index "auth_passkey_credentialID_idx" on "auth_passkey" ("credentialID");

-- One provider identity can belong to only one login, including concurrent callbacks.
CREATE UNIQUE INDEX auth_account_provider_subject ON auth_account ("providerId", "accountId");

-- Identity and cycling profiles evolve independently. An owner can be claimed once.
CREATE TABLE auth_user_owners (
  auth_user_id TEXT PRIMARY KEY REFERENCES auth_user(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL UNIQUE
);

CREATE TABLE auth_browser_flows (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  client_state TEXT NOT NULL,
  challenge TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('created', 'authorizing', 'complete')),
  expires_at INTEGER NOT NULL,
  started_at INTEGER,
  code_hash TEXT UNIQUE,
  session_id TEXT REFERENCES auth_session(id) ON DELETE CASCADE
);
CREATE INDEX auth_browser_flows_expiry ON auth_browser_flows(expires_at);
CREATE TABLE auth_browser_limits (key TEXT PRIMARY KEY, window INTEGER NOT NULL, count INTEGER NOT NULL);
CREATE INDEX auth_browser_limits_window ON auth_browser_limits(window);

CREATE UNIQUE INDEX auth_passkey_credential_unique ON auth_passkey (credentialID);
