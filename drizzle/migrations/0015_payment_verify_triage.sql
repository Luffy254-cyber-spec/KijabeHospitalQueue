-- Payment verification before ticket; first wait at triage; editable insurers catalog;
-- insurance/card details visible only to registration / insurance / billing (cashier/sha) staff.

-- Catalog of medical insurers Kijabe accepts (staff can add/edit later)
create table if not exists public.insurance_providers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text unique,
  active boolean not null default true,
  sort int not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists insurance_providers_active_idx on public.insurance_providers (active, sort, name);

alter table public.tickets
  add column if not exists payment_detail text,
  add column if not exists insurer_id uuid references public.insurance_providers(id);

-- Seed common Kenyan medical cover options (editable by staff)
insert into public.insurance_providers (name, code, sort) values
  ('SHA / Social Health Authority', 'SHA', 10),
  ('NHIF (legacy)', 'NHIF', 20),
  ('AAR Insurance', 'AAR', 30),
  ('Jubilee Health Insurance', 'JUBILEE', 40),
  ('Britam Insurance', 'BRITAM', 50),
  ('CIC Insurance Group', 'CIC', 60),
  ('Madison Insurance', 'MADISON', 70),
  ('APA Insurance', 'APA', 80),
  ('UAP Old Mutual', 'UAP', 90),
  ('Sanlam Kenya', 'SANLAM', 100),
  ('Resolution Insurance', 'RESOLUTION', 110),
  ('Kenya Alliance Insurance', 'KAI', 120),
  ('First Assurance', 'FIRST', 130),
  ('Heritage Insurance', 'HERITAGE', 140),
  ('GA Insurance', 'GA', 150),
  ('Occidental Insurance', 'OCCIDENTAL', 160),
  ('The Monarch Insurance', 'MONARCH', 170),
  ('Pacis Insurance', 'PACIS', 180),
  ('Trident Insurance', 'TRIDENT', 190),
  ('Corporate / Employer medical scheme', 'CORPORATE', 200),
  ('Other (specify at desk)', 'OTHER', 900)
on conflict (code) do nothing;

-- List active insurers for kiosk / staff
create or replace function public.list_insurance_providers()
returns json language sql security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object(
    'id', id, 'name', name, 'code', code, 'sort', sort
  ) order by sort, name), '[]'::json)
  from insurance_providers where active = true;
$$;

-- Staff (registration / insurance / billing desks or admin) manage catalog
create or replace function public.staff_upsert_insurer(
  p_id uuid, p_name text, p_code text, p_active boolean, p_sort int
) returns json language plpgsql security definer set search_path = public as $$
declare r public.insurance_providers;
begin
  if not public.is_staff(auth.uid()) then raise exception 'Staff only'; end if;
  if length(trim(coalesce(p_name,''))) < 2 then raise exception 'Name required'; end if;
  if p_id is null then
    insert into insurance_providers(name, code, active, sort)
      values (trim(p_name), nullif(upper(trim(coalesce(p_code,''))), ''), coalesce(p_active, true), coalesce(p_sort, 100))
      returning * into r;
  else
    update insurance_providers set
      name = trim(p_name),
      code = coalesce(nullif(upper(trim(coalesce(p_code,''))), ''), code),
      active = coalesce(p_active, active),
      sort = coalesce(p_sort, sort),
      updated_at = now()
    where id = p_id returning * into r;
    if r.id is null then raise exception 'Insurer not found'; end if;
  end if;
  return json_build_object('id', r.id, 'name', r.name, 'code', r.code, 'active', r.active, 'sort', r.sort);
end $$;

create or replace function public.staff_list_insurers_all()
returns json language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff(auth.uid()) then raise exception 'Staff only'; end if;
  return coalesce((select json_agg(json_build_object(
    'id', id, 'name', name, 'code', code, 'active', active, 'sort', sort
  ) order by sort, name) from insurance_providers), '[]'::json);
end $$;

-- issue_visit: cash | card | insurance | sha; optional card brand / insurer; start at triage for clinics
drop function if exists public.issue_visit(uuid, text, text, text, text, text, text, timestamptz, text);
drop function if exists public.issue_visit(uuid, text, text, text, text, text, text, timestamptz, text, text, uuid);

create or replace function public.issue_visit(
  p_patient uuid, p_service_code text, p_visit_type text, p_payment text,
  p_triage text, p_triage_note text, p_language text, p_appt_at timestamptz, p_appt_service text,
  p_payment_detail text default null, p_insurer_id uuid default null
) returns json language plpgsql security definer set search_path = public as $$
declare s public.services; first_s public.services; n int; t public.tickets; ahead int; desks int; pr int;
  pay text; path text[]; pat public.patients; detail text; ins public.insurance_providers;
begin
  select * into s from services where code = p_service_code;
  if s.id is null then raise exception 'Unknown service'; end if;
  select * into pat from patients where id = p_patient;
  if pat.id is null then raise exception 'Unknown patient'; end if;
  if p_visit_type not in ('walk_in','booked') then raise exception 'Invalid visit type'; end if;
  if p_payment not in ('cash','card','insurance','sha') then raise exception 'Invalid payment'; end if;
  if p_triage not in ('red','orange','green') then raise exception 'Invalid triage'; end if;

  detail := nullif(trim(coalesce(p_payment_detail,'')), '');
  if p_payment = 'card' and detail is null then raise exception 'Card brand required'; end if;
  if p_payment = 'insurance' then
    if p_insurer_id is null then raise exception 'Insurance provider required'; end if;
    select * into ins from insurance_providers where id = p_insurer_id and active;
    if ins.id is null then raise exception 'Unknown or inactive insurer'; end if;
    detail := coalesce(detail, ins.name);
  end if;
  if p_payment = 'sha' and p_insurer_id is null then
    select id, name into ins from insurance_providers where code = 'SHA' and active limit 1;
    p_insurer_id := ins.id;
    detail := coalesce(detail, ins.name, 'SHA');
  end if;

  -- Close any open triage/registration placeholders when issuing a fuller visit
  if p_service_code not in ('triage','registration') then
    update tickets tk set status = 'done', completed_at = now()
    from services sv
    where tk.service_id = sv.id and sv.code in ('triage','registration')
      and tk.patient_id = p_patient and tk.status in ('waiting','called','serving')
      and coalesce(array_length(tk.care_path,1),0) <= 1;
  end if;

  -- Care path: clinics always start at triage; card bills at cashier like cash
  pay := case p_payment
    when 'cash' then 'cashier'
    when 'card' then 'cashier'
    when 'insurance' then 'insurance'
    else 'sha' end;
  if s.category = 'clinic' then path := array['triage', s.code, pay];
  elsif s.code in ('pharmacy','lab','radiology','physio') then path := array['triage', pay, s.code];
  elsif s.code = 'triage' then path := array['triage','consultation', pay];
  elsif s.code = 'emergency' then path := array['emergency', pay];
  elsif s.code = 'registration' then path := array['triage'];
  else path := array['triage', s.code]; end if;

  if p_triage = 'red' and path[1] <> 'triage' and s.code <> 'emergency' then
    path := array['triage'] || path;
  end if;

  pr := case when p_triage in ('red','orange') then 1 else 0 end;
  select * into first_s from services where code = path[1];
  insert into daily_sequences(service_id, day, last_no) values (first_s.id, date '2000-01-01', 1)
    on conflict (service_id, day) do update set last_no = daily_sequences.last_no + 1 returning last_no into n;
  insert into tickets(token, service_id, visit_type, payment, priority, phone, language, patient_id,
    triage_level, triage_note, care_path, path_step, appointment_at, appointment_service, payment_detail, insurer_id)
  values (
    first_s.prefix || '-' || case p_triage when 'red' then 'R' when 'orange' then 'O' else '' end || lpad(n::text, 6, '0'),
    first_s.id, p_visit_type, p_payment, pr, pat.phone, coalesce(p_language,'en'), pat.id,
    p_triage, left(p_triage_note, 200), path, 0, p_appt_at, nullif(p_appt_service,''), detail, p_insurer_id
  ) returning * into t;
  update patients set last_visit_at = now(), last_service = s.name_en where id = pat.id;
  insert into ticket_events(ticket_id, action, service_id) values (t.id, 'issued', first_s.id);
  select count(*) into ahead from tickets x where x.service_id = first_s.id and x.status = 'waiting' and x.id <> t.id
    and (x.priority > t.priority or (x.priority = t.priority and x.queued_at <= t.queued_at));
  select greatest(count(*),1) into desks from counters where service_id = first_s.id and active;
  return json_build_object(
    'id', t.id, 'token', t.token, 'ahead', ahead,
    'est_minutes', ceil(ahead * first_s.avg_minutes / desks::numeric),
    'service_en', first_s.name_en, 'service_sw', first_s.name_sw,
    'created_at', t.created_at, 'triage', t.triage_level,
    'payment', t.payment, 'payment_detail', t.payment_detail,
    'path', (select json_agg(json_build_object('en', x.name_en, 'sw', x.name_sw) order by ord)
      from unnest(path) with ordinality u(c, ord) join services x on x.code = u.c),
    'card_no', pat.card_no);
end $$;

-- First wait is triage (not registration).
create or replace function public.queue_at_triage(p_patient uuid, p_language text default 'en')
returns json language plpgsql security definer set search_path = public as $$
declare open_id uuid; existing json;
begin
  select t.id into open_id from tickets t
  where t.patient_id = p_patient and t.status in ('waiting','called','serving')
  order by t.queued_at desc limit 1;
  if open_id is not null then
    existing := public.get_ticket_status(open_id);
    return json_build_object('queued', false, 'already', true, 'ticket', existing);
  end if;
  return (
    public.issue_visit(
      p_patient, 'triage', 'walk_in', 'cash', 'green',
      'Queued at triage after verification',
      coalesce(nullif(p_language,''),'en'), null, null, null, null
    )::jsonb || jsonb_build_object('queued', true, 'already', false)
  )::json;
end $$;

create or replace function public.queue_at_registration(p_patient uuid, p_language text default 'en')
returns json language plpgsql security definer set search_path = public as $$
begin
  return public.queue_at_triage(p_patient, p_language);
end $$;

-- Counter queue: hide payment_detail / insurer from non billing-reg-insurance desks
create or replace function public.get_counter_queue(p_counter uuid)
returns json language plpgsql security definer set search_path = public as $$
declare c public.counters; svc public.services; can_see_cover boolean;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  perform public.ensure_staff_access();
  if not public.is_staff(auth.uid()) then raise exception 'Not authorized'; end if;
  select * into c from counters where id = p_counter;
  if c.id is null then raise exception 'Unknown counter'; end if;
  select * into svc from services where id = c.service_id;
  can_see_cover := svc.code in ('registration','cashier','insurance','sha') or public.has_role(auth.uid(), 'admin');

  return coalesce((select json_agg(row_to_json(x)) from (
    select t.id, t.token, t.status, t.priority, t.payment, t.visit_type, t.queued_at, t.counter_id,
      t.service_id, t.recall_count, t.triage_level, t.triage_note, t.care_path, t.path_step, t.appointment_at,
      case when can_see_cover then t.payment_detail else null end as payment_detail,
      case when can_see_cover then t.insurer_id else null end as insurer_id,
      case when can_see_cover then (
        select ip.name from insurance_providers ip where ip.id = t.insurer_id
      ) else null end as insurer_name
    from tickets t
    where t.service_id = c.service_id
      and (
        (t.status = 'waiting')
        or (t.status in ('called','serving') and t.counter_id = c.id)
      )
    order by
      case t.status when 'serving' then 0 when 'called' then 1 else 2 end,
      t.priority desc, t.queued_at
  ) x), '[]'::json);
end $$;

revoke all on function public.list_insurance_providers() from public;
grant execute on function public.list_insurance_providers() to anon, authenticated;
revoke all on function public.staff_upsert_insurer(uuid,text,text,boolean,int) from public;
grant execute on function public.staff_upsert_insurer(uuid,text,text,boolean,int) to authenticated;
revoke all on function public.staff_list_insurers_all() from public;
grant execute on function public.staff_list_insurers_all() to authenticated;
revoke all on function public.queue_at_triage(uuid,text) from public;
grant execute on function public.queue_at_triage(uuid,text) to anon, authenticated;
revoke all on function public.issue_visit(uuid,text,text,text,text,text,text,timestamptz,text,text,uuid) from public;
grant execute on function public.issue_visit(uuid,text,text,text,text,text,text,timestamptz,text,text,uuid) to anon, authenticated;
