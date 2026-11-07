-- Staff auth: Firebase mail helpers + login verification codes
alter table auth.users add column if not exists firebase_local_id text;
alter table auth.users add column if not exists firebase_purge_secret text;
alter table auth.users add column if not exists login_code_hash text;
alter table auth.users add column if not exists login_code_expires timestamptz;
alter table auth.users add column if not exists login_pending_token text;
alter table auth.users add column if not exists signup_pending_token text;
