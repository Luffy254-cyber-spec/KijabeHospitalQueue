-- Account recovery: password reset and email change both run through a 6-digit
-- code mailed by Firebase Auth, then a single-use ticket that the browser
-- carries to the next step. Everything is stored hashed and time-boxed.

alter table auth.users
  add column if not exists firebase_local_id text,
  add column if not exists firebase_purge_secret text,
  add column if not exists login_code_hash text,
  add column if not exists login_code_expires timestamptz,
  add column if not exists login_pending_token text,
  add column if not exists signup_pending_token text;

alter table auth.users
  add column if not exists reset_code_hash text,
  add column if not exists reset_code_expires timestamptz,
  add column if not exists reset_ticket_hash text,
  add column if not exists reset_ticket_expires timestamptz,
  add column if not exists email_change_code_hash text,
  add column if not exists email_change_code_expires timestamptz,
  add column if not exists email_change_ticket_hash text,
  add column if not exists email_change_ticket_expires timestamptz,
  add column if not exists email_change_new_email text,
  add column if not exists email_change_confirm_token text,
  add column if not exists email_change_confirm_expires timestamptz,
  add column if not exists email_change_fb_local_id text,
  add column if not exists email_change_fb_secret text;

create index if not exists users_email_change_confirm_token_idx
  on auth.users (email_change_confirm_token)
  where email_change_confirm_token is not null;
