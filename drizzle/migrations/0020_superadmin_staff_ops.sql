-- Superadmin ops: staff approval, room assignment, attendance, summons, daily stats

do $$ begin
  alter type public.app_role add value if not exists 'superadmin';
exception when duplicate_object then null;
end $$;

create table if not exists public.staff_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  status text not null default 'pending'
    check (status in ('pending','approved','suspended','rejected')),
  approved_at timestamptz,
  approved_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.staff_room_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  counter_id uuid not null references public.counters(id) on delete cascade,
  assigned_by uuid references auth.users(id),
  assigned_at timestamptz not null default now(),
  unique (user_id, counter_id)
);

create table if not exists public.staff_attendance (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null default ((now() at time zone 'Africa/Nairobi')::date),
  checked_in_at timestamptz not null default now(),
  checked_out_at timestamptz,
  counter_id uuid references public.counters(id),
  unique (user_id, day)
);

create table if not exists public.staff_summons (
  id uuid primary key default gen_random_uuid(),
  from_admin uuid not null references auth.users(id),
  to_staff uuid not null references auth.users(id) on delete cascade,
  message text not null default 'Please report to the admin office.',
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz
);

create index if not exists staff_summons_to_idx on public.staff_summons(to_staff, acknowledged_at);
create index if not exists staff_attendance_day_idx on public.staff_attendance(day);

grant select, insert, update, delete on public.staff_profiles, public.staff_room_assignments, public.staff_attendance, public.staff_summons to authenticated, service_role;

create or replace function public.is_superadmin(_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _uid and role in ('superadmin','admin')
  );
$$;

create or replace function public.is_staff(_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.user_roles ur
    left join public.staff_profiles sp on sp.user_id = ur.user_id
    where ur.user_id = _uid
      and ur.role in ('staff','admin','superadmin')
      and (
        ur.role in ('admin','superadmin')
        or coalesce(sp.status, 'approved') = 'approved'
      )
  );
$$;

-- Do not auto-approve strangers; heal missing profile as pending for new staff only
drop function if exists public.ensure_staff_access();
create or replace function public.ensure_staff_access()
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not signed in'; end if;
  if public.is_superadmin(uid) then return; end if;
  if public.is_staff(uid) then return; end if;
  -- pending / suspended / no role
  if exists (select 1 from staff_profiles where user_id = uid and status = 'pending') then
    raise exception 'Your account is awaiting admin approval';
  end if;
  if exists (select 1 from staff_profiles where user_id = uid and status = 'suspended') then
    raise exception 'Your account is suspended — contact admin';
  end if;
  raise exception 'Not authorized — ask a superadmin to approve your staff account';
end $$;

create or replace function public.get_my_access()
returns json language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
  roles text[];
  st text;
  att json;
  rooms json;
  summons json;
begin
  if uid is null then raise exception 'Not signed in'; end if;
  select coalesce(array_agg(role::text), '{}') into roles from user_roles where user_id = uid;
  select coalesce(status, 'approved') into st from staff_profiles where user_id = uid;
  if st is null then st := case when 'admin' = any(roles) or 'superadmin' = any(roles) then 'approved' else 'pending' end; end if;
  select row_to_json(a) into att from staff_attendance a
    where a.user_id = uid and a.day = (now() at time zone 'Africa/Nairobi')::date and a.checked_out_at is null;
  select coalesce(json_agg(json_build_object('counter_id', r.counter_id, 'name', c.name, 'service_id', c.service_id)), '[]'::json)
    into rooms
    from staff_room_assignments r join counters c on c.id = r.counter_id
    where r.user_id = uid;
  select coalesce(json_agg(json_build_object(
      'id', s.id, 'message', s.message, 'created_at', s.created_at,
      'from_email', (select email from auth.users u where u.id = s.from_admin)
    ) order by s.created_at desc), '[]'::json)
    into summons
    from staff_summons s where s.to_staff = uid and s.acknowledged_at is null;
  return json_build_object(
    'user_id', uid,
    'roles', roles,
    'status', st,
    'is_superadmin', public.is_superadmin(uid),
    'is_staff', public.is_staff(uid),
    'attendance', att,
    'assigned_rooms', rooms,
    'summons', summons
  );
end $$;

create or replace function public.admin_list_staff()
returns json language plpgsql security definer set search_path = public as $$
begin
  if not public.is_superadmin(auth.uid()) then raise exception 'Superadmin only'; end if;
  return coalesce((select json_agg(row_to_json(x) order by x.created_at desc nulls last) from (
    select u.id, u.email, u.email_confirmed_at, u.created_at,
      coalesce(sp.full_name, split_part(u.email,'@',1)) as full_name,
      coalesce(sp.status, case when exists(select 1 from user_roles r where r.user_id=u.id and r.role in ('admin','superadmin')) then 'approved' else 'pending' end) as status,
      sp.approved_at,
      (select array_agg(role::text) from user_roles ur where ur.user_id = u.id) as roles,
      exists(
        select 1 from staff_attendance a
        where a.user_id = u.id and a.day = (now() at time zone 'Africa/Nairobi')::date and a.checked_out_at is null
      ) as on_duty,
      (select c.name from staff_attendance a left join counters c on c.id = a.counter_id
        where a.user_id = u.id and a.day = (now() at time zone 'Africa/Nairobi')::date and a.checked_out_at is null limit 1) as current_room,
      (select coalesce(json_agg(json_build_object('counter_id', ra.counter_id, 'name', c.name)), '[]'::json)
        from staff_room_assignments ra join counters c on c.id = ra.counter_id where ra.user_id = u.id) as rooms
    from auth.users u
    left join staff_profiles sp on sp.user_id = u.id
    where exists (select 1 from user_roles ur where ur.user_id = u.id)
       or exists (select 1 from staff_profiles p where p.user_id = u.id)
  ) x), '[]'::json);
end $$;

create or replace function public.admin_create_staff(p_email text, p_password text, p_name text default null, p_approve boolean default true)
returns json language plpgsql security definer set search_path = public as $$
declare uid uuid; em text := lower(trim(p_email));
begin
  if not public.is_superadmin(auth.uid()) then raise exception 'Superadmin only'; end if;
  if length(p_password) < 8 then raise exception 'Password must be at least 8 characters'; end if;
  insert into auth.users(email, encrypted_password, email_confirmed_at)
  values (em, crypt(p_password, gen_salt('bf')), now())
  returning id into uid;
  insert into user_roles(user_id, role) values (uid, 'staff') on conflict do nothing;
  insert into staff_profiles(user_id, full_name, status, approved_at, approved_by)
  values (uid, nullif(trim(p_name),''), case when p_approve then 'approved' else 'pending' end,
    case when p_approve then now() else null end, case when p_approve then auth.uid() else null end)
  on conflict (user_id) do update set
    full_name = coalesce(excluded.full_name, staff_profiles.full_name),
    status = excluded.status,
    approved_at = excluded.approved_at,
    approved_by = excluded.approved_by,
    updated_at = now();
  return json_build_object('id', uid, 'email', em, 'status', case when p_approve then 'approved' else 'pending' end);
exception when unique_violation then
  raise exception 'Email already registered';
end $$;

create or replace function public.admin_delete_staff(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_superadmin(auth.uid()) then raise exception 'Superadmin only'; end if;
  if p_user = auth.uid() then raise exception 'Cannot delete yourself'; end if;
  if public.is_superadmin(p_user) and not public.has_role(auth.uid(), 'superadmin') then
    raise exception 'Only a superadmin can remove another admin';
  end if;
  delete from auth.users where id = p_user;
end $$;

create or replace function public.admin_set_staff_status(p_user uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_superadmin(auth.uid()) then raise exception 'Superadmin only'; end if;
  if p_status not in ('pending','approved','suspended','rejected') then raise exception 'Invalid status'; end if;
  insert into staff_profiles(user_id, status, approved_at, approved_by, updated_at)
  values (p_user, p_status,
    case when p_status='approved' then now() else null end,
    case when p_status='approved' then auth.uid() else null end, now())
  on conflict (user_id) do update set
    status = excluded.status,
    approved_at = case when p_status='approved' then now() else staff_profiles.approved_at end,
    approved_by = case when p_status='approved' then auth.uid() else staff_profiles.approved_by end,
    updated_at = now();
  insert into user_roles(user_id, role) values (p_user, 'staff') on conflict do nothing;
end $$;

create or replace function public.admin_assign_room(p_user uuid, p_counter uuid, p_clear boolean default false)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_superadmin(auth.uid()) then raise exception 'Superadmin only'; end if;
  if p_clear then
    delete from staff_room_assignments where user_id = p_user and (p_counter is null or counter_id = p_counter);
    return;
  end if;
  if p_counter is null then raise exception 'Counter required'; end if;
  insert into staff_room_assignments(user_id, counter_id, assigned_by)
  values (p_user, p_counter, auth.uid())
  on conflict (user_id, counter_id) do update set assigned_by = auth.uid(), assigned_at = now();
end $$;

create or replace function public.admin_summon_staff(p_user uuid, p_message text default null)
returns json language plpgsql security definer set search_path = public as $$
declare sid uuid; msg text := coalesce(nullif(trim(p_message),''), 'You are summoned — please report to the admin office immediately.');
begin
  if not public.is_superadmin(auth.uid()) then raise exception 'Superadmin only'; end if;
  insert into staff_summons(from_admin, to_staff, message) values (auth.uid(), p_user, msg) returning id into sid;
  return json_build_object('id', sid, 'message', msg);
end $$;

create or replace function public.staff_ack_summon(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update staff_summons set acknowledged_at = now()
  where id = p_id and to_staff = auth.uid() and acknowledged_at is null;
end $$;

create or replace function public.staff_check_in(p_counter uuid)
returns json language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'Africa/Nairobi')::date; uid uuid := auth.uid();
begin
  if not public.is_staff(uid) then raise exception 'Not authorized'; end if;
  -- If rooms are assigned, must check in to an assigned room
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
  return json_build_object('ok', true, 'day', d, 'counter_id', p_counter);
end $$;

create or replace function public.staff_check_out()
returns void language plpgsql security definer set search_path = public as $$
begin
  update staff_attendance set checked_out_at = now()
  where user_id = auth.uid() and day = (now() at time zone 'Africa/Nairobi')::date and checked_out_at is null;
end $$;

create or replace function public.admin_ops_board()
returns json language plpgsql security definer set search_path = public as $$
declare today date := (now() at time zone 'Africa/Nairobi')::date;
begin
  if not public.is_superadmin(auth.uid()) then raise exception 'Superadmin only'; end if;
  return json_build_object(
    'day', today,
    'on_duty', coalesce((select json_agg(json_build_object(
        'user_id', a.user_id, 'email', u.email, 'name', coalesce(sp.full_name, split_part(u.email,'@',1)),
        'counter_id', a.counter_id, 'room', c.name, 'since', a.checked_in_at
      )) from staff_attendance a
      join auth.users u on u.id = a.user_id
      left join staff_profiles sp on sp.user_id = a.user_id
      left join counters c on c.id = a.counter_id
      where a.day = today and a.checked_out_at is null), '[]'::json),
    'absent_staff', coalesce((select json_agg(json_build_object(
        'user_id', u.id, 'email', u.email, 'name', coalesce(sp.full_name, split_part(u.email,'@',1))
      )) from auth.users u
      join user_roles ur on ur.user_id = u.id and ur.role = 'staff'
      left join staff_profiles sp on sp.user_id = u.id
      where coalesce(sp.status,'approved') = 'approved'
        and not exists (
          select 1 from staff_attendance a
          where a.user_id = u.id and a.day = today and a.checked_out_at is null
        )
        and not public.is_superadmin(u.id)
    ), '[]'::json),
    'empty_rooms', coalesce((select json_agg(json_build_object(
        'counter_id', c.id, 'name', c.name, 'service', s.name_en
      ) order by c.name) from counters c
      join services s on s.id = c.service_id
      where c.active
        and not exists (
          select 1 from staff_attendance a
          where a.counter_id = c.id and a.day = today and a.checked_out_at is null
        )
    ), '[]'::json),
    'pending_approvals', coalesce((select json_agg(json_build_object(
        'user_id', u.id, 'email', u.email, 'name', coalesce(sp.full_name, split_part(u.email,'@',1)), 'created_at', u.created_at
      )) from staff_profiles sp join auth.users u on u.id = sp.user_id where sp.status = 'pending'), '[]'::json),
    'open_summons', coalesce((select count(*) from staff_summons where acknowledged_at is null), 0)
  );
end $$;

create or replace function public.admin_daily_stats(p_day date default null)
returns json language plpgsql security definer set search_path = public as $$
declare d date := coalesce(p_day, (now() at time zone 'Africa/Nairobi')::date);
begin
  if not public.is_superadmin(auth.uid()) then raise exception 'Superadmin only'; end if;
  return json_build_object(
    'day', d,
    'total_patients', (select count(*) from tickets t
      where (t.created_at at time zone 'Africa/Nairobi')::date = d),
    'by_status', coalesce((select json_object_agg(status, n) from (
      select status, count(*) n from tickets t
      where (t.created_at at time zone 'Africa/Nairobi')::date = d group by status) z), '{}'::json),
    'by_triage', coalesce((select json_object_agg(coalesce(triage_level,'green'), n) from (
      select triage_level, count(*) n from tickets t
      where (t.created_at at time zone 'Africa/Nairobi')::date = d group by triage_level) z), '{}'::json),
    'by_payment', coalesce((select json_object_agg(payment, n) from (
      select payment, count(*) n from tickets t
      where (t.created_at at time zone 'Africa/Nairobi')::date = d group by payment) z), '{}'::json),
    'by_service', coalesce((select json_agg(json_build_object('service', s.name_en, 'count', n) order by n desc) from (
      select service_id, count(*) n from tickets t
      where (t.created_at at time zone 'Africa/Nairobi')::date = d group by service_id) x
      join services s on s.id = x.service_id), '[]'::json),
    'visits', coalesce((select json_agg(row_to_json(v) order by v.created_at) from (
      select t.token, t.status, t.priority, t.triage_level, t.triage_note, t.payment, t.visit_type,
        t.care_path, t.created_at, t.completed_at, s.name_en as service,
        p.card_no as hospital_no, p.full_name as patient_name
      from tickets t
      join services s on s.id = t.service_id
      left join patients p on p.id = t.patient_id
      where (t.created_at at time zone 'Africa/Nairobi')::date = d
    ) v), '[]'::json)
  );
end $$;

revoke all on function public.is_superadmin(uuid) from public;
grant execute on function public.is_superadmin(uuid) to authenticated;
grant execute on function public.get_my_access() to authenticated;
grant execute on function public.admin_list_staff() to authenticated;
grant execute on function public.admin_create_staff(text,text,text,boolean) to authenticated;
grant execute on function public.admin_delete_staff(uuid) to authenticated;
grant execute on function public.admin_set_staff_status(uuid,text) to authenticated;
grant execute on function public.admin_assign_room(uuid,uuid,boolean) to authenticated;
grant execute on function public.admin_summon_staff(uuid,text) to authenticated;
grant execute on function public.staff_ack_summon(uuid) to authenticated;
grant execute on function public.staff_check_in(uuid) to authenticated;
grant execute on function public.staff_check_out() to authenticated;
grant execute on function public.admin_ops_board() to authenticated;
grant execute on function public.admin_daily_stats(date) to authenticated;
