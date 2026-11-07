-- Patient + staff structured names; room occupancy (no forced room assignment)

alter table public.patients
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists surname text;

alter table public.staff_profiles
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists surname text,
  add column if not exists phone text;

-- Backfill from full_name where possible
update public.patients
set first_name = coalesce(nullif(first_name,''), split_part(full_name, ' ', 1)),
    last_name = coalesce(nullif(last_name,''), nullif(split_part(full_name, ' ', 2), '')),
    surname = coalesce(nullif(surname,''), nullif(split_part(full_name, ' ', 3), ''))
where full_name is not null and first_name is null;

update public.staff_profiles
set first_name = coalesce(nullif(first_name,''), split_part(coalesce(full_name,''), ' ', 1)),
    last_name = coalesce(nullif(last_name,''), nullif(split_part(coalesce(full_name,''), ' ', 2), '')),
    surname = coalesce(nullif(surname,''), nullif(split_part(coalesce(full_name,''), ' ', 3), ''))
where full_name is not null and (first_name is null or first_name = '');

create or replace function public._compose_name(p_first text, p_last text, p_surname text)
returns text language sql immutable as $$
  select trim(both ' ' from concat_ws(' ',
    nullif(trim(coalesce(p_first,'')), ''),
    nullif(trim(coalesce(p_last,'')), ''),
    nullif(trim(coalesce(p_surname,'')), '')
  ));
$$;

create or replace function public.register_patient(
  p_first_name text, p_last_name text, p_surname text,
  p_phone text, p_national_id text
)
returns json language plpgsql security definer set search_path = public as $$
declare p public.patients; fname text; lname text; sname text; fulln text; nid text;
begin
  fname := initcap(trim(coalesce(p_first_name,'')));
  lname := initcap(trim(coalesce(p_last_name,'')));
  sname := initcap(trim(coalesce(p_surname,'')));
  fulln := public._compose_name(fname, lname, sname);
  if length(fname) < 2 or length(fulln) < 3 then raise exception 'Invalid name'; end if;
  nid := nullif(upper(trim(coalesce(p_national_id,''))), '');
  if nid is not null and exists(select 1 from patients where national_id = nid) then
    raise exception 'ID already registered';
  end if;
  insert into patients(card_no, full_name, first_name, last_name, surname, phone, national_id)
  values (null, fulln, fname, nullif(lname,''), nullif(sname,''), p_phone, nid)
  returning * into p;
  return json_build_object(
    'patient_id', p.id, 'card_no', p.card_no,
    'first_name', p.first_name, 'last_name', p.last_name, 'surname', p.surname
  );
end $$;

-- Keep old signature working by wrapping
create or replace function public.register_patient(p_name text, p_phone text, p_national_id text)
returns json language plpgsql security definer set search_path = public as $$
declare parts text[]; f text; l text; s text;
begin
  parts := regexp_split_to_array(trim(regexp_replace(coalesce(p_name,''), '\s+', ' ', 'g')), ' ');
  f := coalesce(parts[1], '');
  l := coalesce(parts[2], '');
  s := coalesce(parts[3], '');
  return public.register_patient(f, l, s, p_phone, p_national_id);
end $$;

create or replace function public.lookup_patient(
  p_first_name text, p_last_name text, p_surname text,
  p_kind text, p_value text
)
returns json language plpgsql security definer set search_path = public as $$
declare p public.patients; v text := trim(coalesce(p_value,'')); fulln text;
begin
  fulln := public._compose_name(p_first_name, p_last_name, p_surname);
  if length(fulln) < 3 or length(v) < 4 then return json_build_object('found', false); end if;
  select * into p from patients
  where (
      lower(regexp_replace(full_name,'\s+',' ','g')) = lower(regexp_replace(fulln,'\s+',' ','g'))
      or (
        lower(coalesce(first_name,'')) = lower(trim(p_first_name))
        and (nullif(trim(p_last_name),'') is null or lower(coalesce(last_name,'')) = lower(trim(p_last_name)))
        and (nullif(trim(p_surname),'') is null or lower(coalesce(surname,'')) = lower(trim(p_surname)))
      )
    )
    and case p_kind
      when 'phone' then phone = v
      when 'card' then card_no = v
      when 'national_id' then national_id = v
      else false end
  limit 1;
  if p.id is null then return json_build_object('found', false); end if;
  return json_build_object(
    'found', true, 'patient_id', p.id, 'card_no', p.card_no,
    'first_name', coalesce(p.first_name, split_part(p.full_name,' ',1)),
    'last_name', p.last_name, 'surname', p.surname,
    'last_visit_at', p.last_visit_at, 'last_service', p.last_service, 'returning', true
  );
end $$;

-- Legacy lookup(name, kind, value)
create or replace function public.lookup_patient(p_name text, p_kind text, p_value text)
returns json language plpgsql security definer set search_path = public as $$
declare parts text[];
begin
  parts := regexp_split_to_array(trim(regexp_replace(coalesce(p_name,''), '\s+', ' ', 'g')), ' ');
  return public.lookup_patient(coalesce(parts[1],''), coalesce(parts[2],''), coalesce(parts[3],''), p_kind, p_value);
end $$;

create or replace function public.staff_register_patient(
  p_first_name text, p_last_name text, p_surname text,
  p_phone text, p_national_id text, p_hospital_no text
)
returns json language plpgsql security definer set search_path = public as $$
declare p public.patients; hno text; fname text; lname text; sname text; fulln text; nid text;
begin
  if not public.is_staff(auth.uid()) then raise exception 'Not authorized'; end if;
  hno := upper(regexp_replace(trim(coalesce(p_hospital_no,'')), '\s+', '', 'g'));
  if length(hno) < 3 then raise exception 'Hospital number required'; end if;
  if exists(select 1 from patients where card_no = hno) then raise exception 'Hospital number already used'; end if;
  fname := initcap(trim(coalesce(p_first_name,'')));
  lname := initcap(trim(coalesce(p_last_name,'')));
  sname := initcap(trim(coalesce(p_surname,'')));
  fulln := public._compose_name(fname, lname, sname);
  if length(fname) < 2 or length(fulln) < 3 then raise exception 'Invalid name'; end if;
  nid := nullif(upper(trim(coalesce(p_national_id,''))), '');
  insert into patients(card_no, full_name, first_name, last_name, surname, phone, national_id)
  values (hno, fulln, fname, nullif(lname,''), nullif(sname,''), p_phone, nid)
  returning * into p;
  return json_build_object(
    'patient_id', p.id, 'card_no', p.card_no,
    'first_name', p.first_name, 'last_name', p.last_name, 'surname', p.surname
  );
end $$;

-- Legacy staff_register_patient(name,...)
create or replace function public.staff_register_patient(
  p_name text, p_phone text, p_national_id text, p_hospital_no text
)
returns json language plpgsql security definer set search_path = public as $$
declare parts text[];
begin
  parts := regexp_split_to_array(trim(regexp_replace(coalesce(p_name,''), '\s+', ' ', 'g')), ' ');
  return public.staff_register_patient(
    coalesce(parts[1],''), coalesce(parts[2],''), coalesce(parts[3],''),
    p_phone, p_national_id, p_hospital_no
  );
end $$;

-- Staff check-in: any room (no allocation gate)
create or replace function public.staff_check_in(p_counter uuid)
returns json language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'Africa/Nairobi')::date; uid uuid := auth.uid();
begin
  if not public.is_staff(uid) then raise exception 'Not authorized'; end if;
  insert into staff_attendance(user_id, day, checked_in_at, counter_id)
  values (uid, d, now(), p_counter)
  on conflict (user_id, day) do update set
    checked_in_at = coalesce(staff_attendance.checked_in_at, now()),
    checked_out_at = null,
    counter_id = p_counter;
  return json_build_object('ok', true, 'day', d, 'counter_id', p_counter);
end $$;

create or replace function public.admin_create_staff(
  p_email text, p_password text,
  p_first_name text default null, p_last_name text default null, p_surname text default null,
  p_phone text default null, p_approve boolean default true
)
returns json language plpgsql security definer set search_path = public as $$
declare uid uuid; em text := lower(trim(p_email));
  fname text := initcap(trim(coalesce(p_first_name,'')));
  lname text := initcap(trim(coalesce(p_last_name,'')));
  sname text := initcap(trim(coalesce(p_surname,'')));
  fulln text;
begin
  if not public.is_superadmin(auth.uid()) then raise exception 'Superadmin only'; end if;
  if length(p_password) < 8 then raise exception 'Password must be at least 8 characters'; end if;
  fulln := public._compose_name(fname, lname, sname);
  insert into auth.users(email, encrypted_password, email_confirmed_at)
  values (em, crypt(p_password, gen_salt('bf')), now())
  returning id into uid;
  insert into user_roles(user_id, role) values (uid, 'staff') on conflict do nothing;
  insert into staff_profiles(user_id, full_name, first_name, last_name, surname, phone, status, approved_at, approved_by)
  values (
    uid, nullif(fulln,''), nullif(fname,''), nullif(lname,''), nullif(sname,''),
    nullif(trim(coalesce(p_phone,'')),''),
    case when p_approve then 'approved' else 'pending' end,
    case when p_approve then now() else null end,
    case when p_approve then auth.uid() else null end
  )
  on conflict (user_id) do update set
    full_name = coalesce(excluded.full_name, staff_profiles.full_name),
    first_name = coalesce(excluded.first_name, staff_profiles.first_name),
    last_name = coalesce(excluded.last_name, staff_profiles.last_name),
    surname = coalesce(excluded.surname, staff_profiles.surname),
    phone = coalesce(excluded.phone, staff_profiles.phone),
    status = excluded.status,
    approved_at = excluded.approved_at,
    approved_by = excluded.approved_by,
    updated_at = now();
  return json_build_object('id', uid, 'email', em, 'status', case when p_approve then 'approved' else 'pending' end);
exception when unique_violation then
  raise exception 'Email already registered';
end $$;

-- Compat wrapper for old admin_create_staff(email, password, name, approve)
create or replace function public.admin_create_staff(p_email text, p_password text, p_name text default null, p_approve boolean default true)
returns json language plpgsql security definer set search_path = public as $$
declare parts text[];
begin
  parts := regexp_split_to_array(trim(regexp_replace(coalesce(p_name,''), '\s+', ' ', 'g')), ' ');
  return public.admin_create_staff(
    p_email, p_password,
    coalesce(parts[1],''), coalesce(parts[2],''), coalesce(parts[3],''),
    null, p_approve
  );
end $$;

create or replace function public.admin_list_staff()
returns json language plpgsql security definer set search_path = public as $$
begin
  if not public.is_superadmin(auth.uid()) then raise exception 'Superadmin only'; end if;
  return coalesce((select json_agg(row_to_json(x) order by x.created_at desc nulls last) from (
    select u.id, u.email, u.email_confirmed_at, u.created_at,
      coalesce(sp.full_name, public._compose_name(sp.first_name, sp.last_name, sp.surname), split_part(u.email,'@',1)) as full_name,
      sp.first_name, sp.last_name, sp.surname, sp.phone,
      coalesce(sp.status, case when exists(select 1 from user_roles r where r.user_id=u.id and r.role in ('admin','superadmin')) then 'approved' else 'pending' end) as status,
      sp.approved_at,
      (select array_agg(role::text) from user_roles ur where ur.user_id = u.id) as roles,
      exists(
        select 1 from staff_attendance a
        where a.user_id = u.id and a.day = (now() at time zone 'Africa/Nairobi')::date and a.checked_out_at is null
      ) as on_duty,
      (select c.name from staff_attendance a left join counters c on c.id = a.counter_id
        where a.user_id = u.id and a.day = (now() at time zone 'Africa/Nairobi')::date and a.checked_out_at is null limit 1) as current_room
    from auth.users u
    left join staff_profiles sp on sp.user_id = u.id
    where exists (select 1 from user_roles ur where ur.user_id = u.id)
       or exists (select 1 from staff_profiles p where p.user_id = u.id)
  ) x), '[]'::json);
end $$;

create or replace function public.admin_ops_board()
returns json language plpgsql security definer set search_path = public as $$
declare today date := (now() at time zone 'Africa/Nairobi')::date;
begin
  if not public.is_superadmin(auth.uid()) then raise exception 'Superadmin only'; end if;
  return json_build_object(
    'day', today,
    'on_duty', coalesce((select json_agg(json_build_object(
        'user_id', a.user_id, 'email', u.email,
        'name', coalesce(sp.full_name, public._compose_name(sp.first_name, sp.last_name, sp.surname), split_part(u.email,'@',1)),
        'counter_id', a.counter_id, 'room', c.name, 'since', a.checked_in_at
      )) from staff_attendance a
      join auth.users u on u.id = a.user_id
      left join staff_profiles sp on sp.user_id = a.user_id
      left join counters c on c.id = a.counter_id
      where a.day = today and a.checked_out_at is null), '[]'::json),
    'absent_staff', coalesce((select json_agg(json_build_object(
        'user_id', u.id, 'email', u.email,
        'name', coalesce(sp.full_name, public._compose_name(sp.first_name, sp.last_name, sp.surname), split_part(u.email,'@',1))
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
    'rooms', coalesce((select json_agg(json_build_object(
        'counter_id', c.id, 'name', c.name, 'service', s.name_en,
        'occupied', exists(
          select 1 from staff_attendance a
          where a.counter_id = c.id and a.day = today and a.checked_out_at is null
        ),
        'occupant', (
          select coalesce(sp.full_name, public._compose_name(sp.first_name, sp.last_name, sp.surname), split_part(u.email,'@',1))
          from staff_attendance a
          join auth.users u on u.id = a.user_id
          left join staff_profiles sp on sp.user_id = a.user_id
          where a.counter_id = c.id and a.day = today and a.checked_out_at is null
          limit 1
        ),
        'occupant_email', (
          select u.email from staff_attendance a
          join auth.users u on u.id = a.user_id
          where a.counter_id = c.id and a.day = today and a.checked_out_at is null
          limit 1
        )
      ) order by c.name) from counters c
      join services s on s.id = c.service_id
      where c.active
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
        'user_id', u.id, 'email', u.email,
        'name', coalesce(sp.full_name, public._compose_name(sp.first_name, sp.last_name, sp.surname), split_part(u.email,'@',1)),
        'created_at', u.created_at
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
        p.card_no as hospital_no,
        coalesce(p.full_name, public._compose_name(p.first_name, p.last_name, p.surname)) as patient_name,
        p.first_name, p.last_name, p.surname
      from tickets t
      join services s on s.id = t.service_id
      left join patients p on p.id = t.patient_id
      where (t.created_at at time zone 'Africa/Nairobi')::date = d
    ) v), '[]'::json)
  );
end $$;

grant execute on function public.register_patient(text,text,text,text,text) to anon, authenticated;
grant execute on function public.lookup_patient(text,text,text,text,text) to anon, authenticated;
grant execute on function public.staff_register_patient(text,text,text,text,text,text) to authenticated;
grant execute on function public.admin_create_staff(text,text,text,text,text,text,boolean) to authenticated;
