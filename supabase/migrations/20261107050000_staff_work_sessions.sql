-- Multi-session staff work tracking for payroll / hours export
create table if not exists public.staff_work_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null default ((now() at time zone 'Africa/Nairobi')::date),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  last_seen_at timestamptz not null default now(),
  counter_id uuid references public.counters(id) on delete set null
);

create index if not exists staff_work_sessions_user_day_idx
  on public.staff_work_sessions(user_id, day);
create index if not exists staff_work_sessions_open_idx
  on public.staff_work_sessions(user_id)
  where ended_at is null;

grant select, insert, update, delete on public.staff_work_sessions to authenticated, service_role;

-- Close any open session for this user
create or replace function public.staff_close_open_sessions()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.staff_work_sessions
  set ended_at = coalesce(last_seen_at, now()),
      last_seen_at = greatest(coalesce(last_seen_at, now()), now())
  where user_id = auth.uid() and ended_at is null;
end $$;

create or replace function public.staff_check_in(p_counter uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  d date := (now() at time zone 'Africa/Nairobi')::date;
  uid uuid := auth.uid();
begin
  if not public.is_staff(uid) then raise exception 'Not authorized'; end if;
  if exists (select 1 from staff_room_assignments where user_id = uid)
     and not exists (select 1 from staff_room_assignments where user_id = uid and counter_id = p_counter) then
    raise exception 'This room is not allocated to you — ask admin';
  end if;

  insert into staff_attendance(user_id, day, checked_in_at, counter_id)
  values (uid, d, now(), p_counter)
  on conflict (user_id, day) do update set
    checked_in_at = coalesce(staff_attendance.checked_in_at, now()),
    checked_out_at = null,
    counter_id = p_counter;

  -- If already online with an open session, just bump presence / room
  if exists (select 1 from staff_work_sessions where user_id = uid and ended_at is null) then
    update staff_work_sessions
      set last_seen_at = now(),
          counter_id = coalesce(p_counter, counter_id)
      where user_id = uid and ended_at is null;
  else
    insert into staff_work_sessions(user_id, day, started_at, last_seen_at, counter_id)
    values (uid, d, now(), now(), p_counter);
  end if;

  return json_build_object('ok', true, 'day', d, 'counter_id', p_counter);
end $$;

create or replace function public.staff_check_out()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  d date := (now() at time zone 'Africa/Nairobi')::date;
begin
  update staff_attendance
    set checked_out_at = now()
    where user_id = auth.uid()
      and day = d
      and checked_out_at is null;

  update staff_work_sessions
    set ended_at = now(),
        last_seen_at = now()
    where user_id = auth.uid()
      and ended_at is null;
end $$;

-- Heartbeat while console is open (keeps last_seen fresh for live hours)
create or replace function public.staff_session_ping(p_counter uuid default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  d date := (now() at time zone 'Africa/Nairobi')::date;
  uid uuid := auth.uid();
  open_id uuid;
begin
  if not public.is_staff(uid) then raise exception 'Not authorized'; end if;

  select id into open_id
  from staff_work_sessions
  where user_id = uid and ended_at is null
  order by started_at desc
  limit 1;

  if open_id is null then
    insert into staff_work_sessions(user_id, day, started_at, last_seen_at, counter_id)
    values (uid, d, now(), now(), p_counter)
    returning id into open_id;
  else
    update staff_work_sessions
      set last_seen_at = now(),
          counter_id = coalesce(p_counter, counter_id)
      where id = open_id;
  end if;

  -- Auto-close stale sessions older than 12 minutes with no ping (crashed tab)
  update staff_work_sessions
    set ended_at = last_seen_at
    where ended_at is null
      and last_seen_at < now() - interval '12 minutes'
      and user_id <> uid;

  return json_build_object('ok', true, 'session_id', open_id);
end $$;

-- Superadmin payroll timesheet: daily hours + login windows
create or replace function public.admin_staff_timesheet(p_from date default null, p_to date default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  d0 date := coalesce(p_from, (now() at time zone 'Africa/Nairobi')::date - 6);
  d1 date := coalesce(p_to, (now() at time zone 'Africa/Nairobi')::date);
begin
  if not public.is_superadmin(auth.uid()) then raise exception 'Superadmin only'; end if;
  if d1 < d0 then
    raise exception 'End date must be on or after start date';
  end if;

  -- Finalize abandoned open sessions before reporting
  update staff_work_sessions
    set ended_at = last_seen_at
    where ended_at is null
      and last_seen_at < now() - interval '12 minutes';

  return json_build_object(
    'from', d0,
    'to', d1,
    'generated_at', now(),
    'rows', coalesce((
      select json_agg(x order by x.day desc, x.email)
      from (
        select
          s.user_id,
          u.email,
          coalesce(sp.full_name, split_part(u.email, '@', 1)) as name,
          s.day,
          round((extract(epoch from (
            sum(coalesce(s.ended_at, s.last_seen_at, now()) - s.started_at)
          )) / 3600.0)::numeric, 2) as hours,
          count(*)::int as sessions,
          min(s.started_at) as first_login,
          max(coalesce(s.ended_at, s.last_seen_at)) as last_activity,
          bool_or(s.ended_at is null) as still_online,
          coalesce((
            select json_agg(json_build_object(
              'started_at', ss.started_at,
              'ended_at', ss.ended_at,
              'last_seen_at', ss.last_seen_at,
              'minutes', round((extract(epoch from (
                coalesce(ss.ended_at, ss.last_seen_at, now()) - ss.started_at
              )) / 60.0)::numeric, 1),
              'room', c.name,
              'open', ss.ended_at is null
            ) order by ss.started_at)
            from staff_work_sessions ss
            left join counters c on c.id = ss.counter_id
            where ss.user_id = s.user_id and ss.day = s.day
          ), '[]'::json) as windows
        from staff_work_sessions s
        join auth.users u on u.id = s.user_id
        left join staff_profiles sp on sp.user_id = s.user_id
        where s.day between d0 and d1
        group by s.user_id, u.email, sp.full_name, s.day
      ) x
    ), '[]'::json)
  );
end $$;

grant execute on function public.staff_close_open_sessions() to authenticated;
grant execute on function public.staff_session_ping(uuid) to authenticated;
grant execute on function public.admin_staff_timesheet(date, date) to authenticated;
