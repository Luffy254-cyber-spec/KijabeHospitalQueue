-- Brute-force protection: sliding-window counters per bucket/subject.
-- Subjects are keyed hashes (HMAC of email/work-id/IP) — no raw addresses stored.

create table if not exists public.security_throttle (
  bucket text not null,
  subject text not null,
  window_start timestamptz not null default now(),
  failures integer not null default 0,
  blocked_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (bucket, subject)
);

create index if not exists security_throttle_blocked_idx
  on public.security_throttle (blocked_until);

create table if not exists public.security_events (
  id bigserial primary key,
  kind text not null,
  bucket text not null,
  subject text not null,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists security_events_created_idx
  on public.security_events (created_at desc);

-- Server-only tables: keep them out of any PostgREST-style surface.
alter table public.security_throttle enable row level security;
alter table public.security_events enable row level security;

create or replace function public.security_throttle_hit(
  p_bucket text, p_subject text, p_window_seconds integer, p_max integer, p_block_seconds integer
) returns json language plpgsql security definer set search_path = public as $$
declare r public.security_throttle;
begin
  insert into security_throttle(bucket, subject, window_start, failures)
  values (p_bucket, p_subject, now(), 1)
  on conflict (bucket, subject) do update set
    failures = case
      when security_throttle.window_start < now() - make_interval(secs => p_window_seconds) then 1
      else security_throttle.failures + 1
    end,
    window_start = case
      when security_throttle.window_start < now() - make_interval(secs => p_window_seconds) then now()
      else security_throttle.window_start
    end,
    updated_at = now()
  returning * into r;

  if r.blocked_until is not null and r.blocked_until > now() then
    return json_build_object(
      'allowed', false,
      'retry_after', ceil(extract(epoch from (r.blocked_until - now())))::int,
      'failures', r.failures
    );
  end if;

  if r.failures > p_max then
    update security_throttle
       set blocked_until = now() + make_interval(secs => p_block_seconds),
           updated_at = now()
     where bucket = p_bucket and subject = p_subject
     returning * into r;
    insert into security_events(kind, bucket, subject, note)
      values ('rate_limited', p_bucket, p_subject, format('failures=%s', r.failures));
    return json_build_object(
      'allowed', false,
      'retry_after', p_block_seconds,
      'failures', r.failures
    );
  end if;

  return json_build_object('allowed', true, 'retry_after', 0, 'failures', r.failures);
end $$;

revoke all on function public.security_throttle_hit(text, text, integer, integer, integer) from public;
grant execute on function public.security_throttle_hit(text, text, integer, integer, integer)
  to anon, authenticated, service_role;

create or replace function public.security_throttle_clear(p_bucket text, p_subject text)
returns void language sql security definer set search_path = public as $$
  delete from security_throttle where bucket = p_bucket and subject = p_subject;
$$;

revoke all on function public.security_throttle_clear(text, text) from public;
grant execute on function public.security_throttle_clear(text, text)
  to anon, authenticated, service_role;

-- Hourly pruning so the tables cannot grow without bound.
create or replace function public.security_throttle_prune()
returns void language sql security definer set search_path = public as $$
  delete from security_throttle
   where coalesce(blocked_until, window_start) < now() - interval '1 day';
  delete from security_events where created_at < now() - interval '90 days';
$$;

revoke all on function public.security_throttle_prune() from public;
grant execute on function public.security_throttle_prune() to service_role;
