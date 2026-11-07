-- WebAuthn / biometric credentials (fingerprint, Face ID, Windows Hello)
create table if not exists public.staff_webauthn_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  credential_id text not null unique,
  public_key text not null,
  counter bigint not null default 0,
  transports text[] not null default '{}',
  device_type text,
  backed_up boolean not null default false,
  friendly_name text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists staff_webauthn_credentials_user_idx
  on public.staff_webauthn_credentials(user_id);

create table if not exists public.webauthn_challenges (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  user_id uuid references auth.users(id) on delete cascade,
  purpose text not null check (purpose in ('register', 'login')),
  challenge text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists webauthn_challenges_email_idx
  on public.webauthn_challenges(lower(email), purpose);

grant select, insert, update, delete on public.staff_webauthn_credentials to authenticated, service_role;
grant select, insert, update, delete on public.webauthn_challenges to authenticated, service_role;
