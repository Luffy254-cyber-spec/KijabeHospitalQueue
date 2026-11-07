-- Superadmin: create new department/service, observe any room queue (read-only)

drop function if exists public.admin_create_room(text, uuid, boolean);

create or replace function public.admin_create_service(
  p_name_en text,
  p_name_sw text default null,
  p_category text default 'service',
  p_avg_minutes int default 8,
  p_prefix text default null
) returns json
language plpgsql security definer set search_path = public as $$
declare
  n text := trim(p_name_en);
  code text;
  pref text;
  sid uuid;
  cat text := coalesce(nullif(trim(p_category), ''), 'service');
  avgm int := greatest(1, least(coalesce(p_avg_minutes, 8), 120));
  sortn int;
begin
  if not public.is_superadmin(auth.uid()) then
    raise exception 'Superadmin only';
  end if;
  if n is null or length(n) < 2 then
    raise exception 'Department name required';
  end if;

  -- slug code from name
  code := lower(regexp_replace(n, '[^a-zA-Z0-9]+', '_', 'g'));
  code := trim(both '_' from code);
  if length(code) < 2 then code := 'dept'; end if;
  code := left(code, 24);
  if exists (select 1 from public.services s where s.code = code) then
    code := left(code, 20) || '_' || floor(random()*900+100)::int::text;
  end if;

  pref := coalesce(nullif(upper(trim(p_prefix)), ''), upper(left(regexp_replace(n, '[^a-zA-Z]', '', 'g'), 2)));
  if pref is null or length(pref) < 1 then pref := 'D'; end if;
  pref := left(pref, 3);

  select coalesce(max(sort), 0) + 10 into sortn from public.services;

  insert into public.services(
    code, prefix, name_en, name_sw, description_en, description_sw,
    kiosk_visible, avg_minutes, sort, surge_threshold, category
  ) values (
    code, pref, n, coalesce(nullif(trim(p_name_sw), ''), n),
    'Added by superadmin', 'Imeongezwa na superadmin',
    false, avgm, sortn, 25, cat
  ) returning id into sid;

  insert into public.automation_settings(service_id, surge_threshold)
  values (sid, 25)
  on conflict do nothing;

  return json_build_object(
    'id', sid,
    'code', code,
    'prefix', pref,
    'name_en', n,
    'category', cat
  );
end $$;

create or replace function public.admin_create_room(
  p_name text,
  p_service_id uuid default null,
  p_active boolean default true,
  p_new_service_name text default null
) returns json
language plpgsql security definer set search_path = public as $$
declare
  rid uuid;
  rname text := trim(p_name);
  sid uuid := p_service_id;
  svc text;
  created_svc json;
begin
  if not public.is_superadmin(auth.uid()) then
    raise exception 'Superadmin only';
  end if;
  if rname is null or length(rname) < 2 then
    raise exception 'Room name required';
  end if;

  if sid is null and coalesce(trim(p_new_service_name), '') <> '' then
    created_svc := public.admin_create_service(trim(p_new_service_name));
    sid := (created_svc->>'id')::uuid;
  end if;

  if sid is null then
    raise exception 'Choose a department or type a new one';
  end if;

  select name_en into svc from public.services where id = sid;
  if svc is null then
    raise exception 'Unknown service';
  end if;

  if exists (
    select 1 from public.counters c
    where lower(c.name) = lower(rname) and c.service_id = sid
  ) then
    raise exception 'A room with that name already exists for this department';
  end if;

  insert into public.counters (name, service_id, active)
  values (rname, sid, coalesce(p_active, true))
  returning id into rid;

  return json_build_object(
    'id', rid,
    'name', rname,
    'service_id', sid,
    'service', svc,
    'active', coalesce(p_active, true),
    'new_service', created_svc
  );
end $$;

-- Read-only full queue for any room (superadmin observation — no check-in, no actions)
create or replace function public.admin_observe_queue(p_counter uuid)
returns json
language plpgsql security definer set search_path = public as $$
declare
  c public.counters;
  svc public.services;
  today date := (now() at time zone 'Africa/Nairobi')::date;
  occupant text;
  occupant_email text;
  tickets json;
begin
  if not public.is_superadmin(auth.uid()) then
    raise exception 'Superadmin only';
  end if;
  select * into c from counters where id = p_counter;
  if c.id is null then raise exception 'Unknown room'; end if;
  select * into svc from services where id = c.service_id;

  select
    coalesce(sp.full_name, public._compose_name(sp.first_name, sp.last_name, sp.surname), split_part(u.email,'@',1)),
    u.email
  into occupant, occupant_email
  from staff_attendance a
  join auth.users u on u.id = a.user_id
  left join staff_profiles sp on sp.user_id = a.user_id
  where a.counter_id = c.id and a.day = today and a.checked_out_at is null
  limit 1;

  select coalesce(json_agg(row_to_json(x)), '[]'::json) into tickets from (
    select t.id, t.token, t.status, t.priority, t.payment, t.visit_type, t.queued_at, t.counter_id,
      t.service_id, t.recall_count, t.triage_level, t.triage_note, t.care_path, t.path_step, t.appointment_at,
      t.patient_id, t.payment_detail, t.insurer_id,
      p.card_no as hospital_no,
      (select ip.name from insurance_providers ip where ip.id = t.insurer_id) as insurer_name,
      coalesce(p.first_name, '') as patient_first,
      coalesce(p.last_name, '') as patient_last,
      coalesce(p.surname, '') as patient_surname,
      p.phone as patient_phone
    from tickets t
    left join patients p on p.id = t.patient_id
    where t.service_id = c.service_id
      and (
        (t.status = 'waiting')
        or (t.status in ('called','serving') and t.counter_id = c.id)
      )
    order by
      case t.status when 'serving' then 0 when 'called' then 1 else 2 end,
      t.priority desc, t.queued_at
  ) x;

  return json_build_object(
    'counter_id', c.id,
    'room', c.name,
    'active', c.active,
    'service_id', svc.id,
    'service', svc.name_en,
    'service_code', svc.code,
    'occupied', occupant is not null,
    'occupant', occupant,
    'occupant_email', occupant_email,
    'tickets', tickets,
    'observe_only', true
  );
end $$;

grant execute on function public.admin_create_service(text, text, text, int, text) to authenticated;
grant execute on function public.admin_create_room(text, uuid, boolean, text) to authenticated;
grant execute on function public.admin_observe_queue(uuid) to authenticated;
