-- TOTP authenticator MFA: AES-256-GCM sealed secrets, pending enrollment window, replay guard
alter table auth.users add column if not exists totp_secret_enc text;
alter table auth.users add column if not exists totp_enabled_at timestamptz;
alter table auth.users add column if not exists totp_pending_enc text;
alter table auth.users add column if not exists totp_pending_expires timestamptz;
alter table auth.users add column if not exists totp_last_step bigint;