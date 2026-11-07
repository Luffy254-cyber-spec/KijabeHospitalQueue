-- Patient registry (staff-only reads; kiosk uses RPCs)
create table public.patients (
  id uuid primary key default gen_random_uuid(),
  card_no text not null unique,
  full_name text not null,
  phone text,
  national_id text unique,
  created_at timestamptz not null default now(),
  last_visit_at timestamptz,
  last_service text
);
create sequence public.patient_card_seq start 100001;
grant select on public.patients to authenticated;
grant all on public.patients to service_role;
alter table public.patients enable row level security;
create policy "staff read patients" on public.patients for select to authenticated using (public.is_staff(auth.uid()));
create index patients_phone_idx on public.patients(phone);

alter table public.services add column category text not null default 'service';
alter table public.tickets add column patient_id uuid references public.patients(id),
  add column triage_level text not null default 'green',
  add column triage_note text,
  add column care_path text[] not null default '{}',
  add column path_step integer not null default 0,
  add column appointment_at timestamptz,
  add column appointment_service text;

-- Departments, clinics and rooms
update public.services set category='clinic' where code='consultation';
update public.services set category='payment' where code in ('cashier','insurance');
update public.services set name_en='Insurance / Corporate', name_sw='Bima / Kampuni' where code='insurance';
insert into public.services(code,prefix,name_en,name_sw,description_en,description_sw,category,avg_minutes,sort,kiosk_visible) values
 ('sha','SHA','SHA Desk','Dawati la SHA','Social Health Authority verification','Uthibitisho wa SHA','payment',5,5,false),
 ('emergency','EMG','Emergency / Casualty','Dharura','Urgent care','Huduma ya dharura','clinic',10,0,true),
 ('surgical','SUR','Surgical Clinic','Kliniki ya Upasuaji','Surgery follow-up and review','Ufuatiliaji wa upasuaji','clinic',12,10,true),
 ('paediatrics','PAE','Paediatrics Clinic','Kliniki ya Watoto','Children''s clinic','Kliniki ya watoto','clinic',10,11,true),
 ('obgyn','OBG','Maternity / ANC & Gynaecology','Kliniki ya Akina Mama','Antenatal and women''s health','Afya ya mama na wanawake','clinic',12,12,true),
 ('orthopaedics','ORT','Orthopaedic Clinic','Kliniki ya Mifupa','Bones and joints','Mifupa na viungo','clinic',12,13,true),
 ('ent','ENT','ENT Clinic','Kliniki ya Masikio, Pua na Koo','Ear, nose and throat','Masikio, pua na koo','clinic',10,14,true),
 ('eye','EYE','Eye Clinic','Kliniki ya Macho','Eye care','Huduma ya macho','clinic',12,15,true),
 ('dental','DEN','Dental Clinic','Kliniki ya Meno','Dental care','Huduma ya meno','clinic',15,16,true),
 ('medical','MED','Medical / Diabetes Clinic','Kliniki ya Kisukari','Chronic conditions','Magonjwa sugu','clinic',12,17,true),
 ('neurosurgery','NEU','Neurosurgery (CURE)','Upasuaji wa Neva (CURE)','CURE children''s neurosurgery','Upasuaji wa neva','clinic',15,18,true),
 ('physio','PHY','Physiotherapy','Tiba ya Viungo','Rehabilitation','Urekebishaji','service',20,19,true),
 ('inpatient','ADM','Inpatient Admission','Kulazwa','Admission desk','Dawati la kulazwa','service',15,20,false);

insert into public.counters(name, service_id)
select r.name, s.id from (values
 ('triage','Triage Room 3'),('triage','Triage Room 4'),
 ('consultation','Room 1'),('consultation','Room 2'),('consultation','Room 3'),('consultation','Room 8'),('consultation','Room 9'),('consultation','Room 10'),
 ('insurance','Insurance Desk 2'),('sha','SHA Desk 1'),('sha','SHA Desk 2'),
 ('emergency','Casualty Bay 1'),('emergency','Casualty Bay 2'),
 ('surgical','Surgical Room 1'),('surgical','Surgical Room 2'),
 ('paediatrics','Paeds Room 1'),('paediatrics','Paeds Room 2'),
 ('obgyn','ANC Room 1'),('obgyn','Gynae Room 2'),
 ('orthopaedics','Ortho Room 1'),('ent','ENT Room 1'),('eye','Eye Room 1'),('eye','Eye Room 2'),
 ('dental','Dental Chair 1'),('dental','Dental Chair 2'),('medical','Medical Room 1'),
 ('neurosurgery','CURE Room 1'),('physio','Physio Gym'),
 ('lab','Phlebotomy 1'),('radiology','X-Ray Room'),('radiology','Ultrasound Room'),
 ('inpatient','Admissions Desk')
) r(code,name) join public.services s on s.code=r.code;

-- Kiosk patient lookup: only confirms a match of name + identifier
create or replace function public.lookup_patient(p_name text, p_kind text, p_value text)
returns json language plpgsql security definer set search_path = public as $$
declare p public.patients; v text := upper(regexp_replace(coalesce(p_value,''), '\s', '', 'g'));
begin
  if length(trim(coalesce(p_name,''))) < 3 or length(v) < 4 then return json_build_object('found', false); end if;
  select * into p from patients where lower(regexp_replace(full_name,'\s+',' ','g')) = lower(regexp_replace(trim(p_name),'\s+',' ','g'))
    and case p_kind when 'phone' then phone = v when 'card' then card_no = v when 'national_id' then national_id = v else false end
    limit 1;
  if p.id is null then return json_build_object('found', false); end if;
  return json_build_object('found', true, 'patient_id', p.id, 'card_no', p.card_no, 'first_name', split_part(p.full_name,' ',1),
    'last_visit_at', p.last_visit_at, 'last_service', p.last_service, 'has_phone', p.phone is not null);
end $$;

create or replace function public.register_patient(p_name text, p_phone text, p_national_id text)
returns json language plpgsql security definer set search_path = public as $$
declare p public.patients; nid text := nullif(upper(regexp_replace(coalesce(p_national_id,''),'\s','','g')),'');
begin
  if length(trim(coalesce(p_name,''))) < 3 or length(p_name) > 120 then raise exception 'Invalid name'; end if;
  if p_phone is not null and p_phone !~ '^\+254[0-9]{9}$' then raise exception 'Invalid phone'; end if;
  if nid is not null and nid !~ '^[A-Z0-9]{5,12}$' then raise exception 'Invalid ID'; end if;
  if nid is not null and exists(select 1 from patients where national_id = nid) then raise exception 'ID already registered'; end if;
  insert into patients(card_no, full_name, phone, national_id)
    values ('KH' || nextval('patient_card_seq'), regexp_replace(trim(p_name),'\s+',' ','g'), p_phone, nid) returning * into p;
  return json_build_object('patient_id', p.id, 'card_no', p.card_no, 'first_name', split_part(p.full_name,' ',1));
end $$;

-- Issue a visit with care path and colour triage
create or replace function public.issue_visit(p_patient uuid, p_service_code text, p_visit_type text, p_payment text,
  p_triage text, p_triage_note text, p_language text, p_appt_at timestamptz, p_appt_service text)
returns json language plpgsql security definer set search_path = public as $$
declare s public.services; first_s public.services; n int; t public.tickets; ahead int; desks int; pr int;
  pay text; path text[]; pat public.patients;
begin
  select * into s from services where code = p_service_code;
  if s.id is null then raise exception 'Unknown service'; end if;
  select * into pat from patients where id = p_patient;
  if pat.id is null then raise exception 'Unknown patient'; end if;
  if p_visit_type not in ('walk_in','booked') then raise exception 'Invalid visit type'; end if;
  if p_payment not in ('cash','insurance','sha') then raise exception 'Invalid payment'; end if;
  if p_triage not in ('red','orange','green') then raise exception 'Invalid triage'; end if;
  pay := case p_payment when 'cash' then 'cashier' when 'insurance' then 'insurance' else 'sha' end;
  if s.category = 'clinic' then path := array['triage', s.code, pay];
  elsif s.code in ('pharmacy','lab','radiology','physio') then path := array[pay, s.code];
  elsif s.code = 'triage' then path := array['triage','consultation', pay];
  else path := array[s.code]; end if;
  if p_triage = 'red' and path[1] <> 'triage' and s.code <> 'emergency' then path := array['triage'] || path; end if;
  -- Self-reported colours: red outranks orange inside priority 1; only staff can escalate to emergency (2)
  pr := case when p_triage in ('red','orange') then 1 else 0 end;
  select * into first_s from services where code = path[1];
  -- Running number per department (never resets, so tokens stay unique across days in a 24/7 hospital)
  insert into daily_sequences(service_id, day, last_no) values (first_s.id, date '2000-01-01', 1)
    on conflict (service_id, day) do update set last_no = daily_sequences.last_no + 1 returning last_no into n;
  insert into tickets(token, service_id, visit_type, payment, priority, phone, language, patient_id, triage_level, triage_note, care_path, path_step, appointment_at, appointment_service)
    values (first_s.prefix || '-' || case p_triage when 'red' then 'R' when 'orange' then 'O' else '' end || lpad((n % 10000)::text, 4, '0'),
      first_s.id, p_visit_type, p_payment, pr, pat.phone, coalesce(p_language,'en'), pat.id, p_triage, left(p_triage_note, 200), path, 0,
      p_appt_at, nullif(p_appt_service,''))
    returning * into t;
  update patients set last_visit_at = now(), last_service = s.name_en where id = pat.id;
  insert into ticket_events(ticket_id, action, service_id) values (t.id, 'issued', first_s.id);
  select count(*) into ahead from tickets x where x.service_id = first_s.id and x.status = 'waiting' and x.id <> t.id
    and (x.priority > t.priority or (x.priority = t.priority and x.queued_at <= t.queued_at));
  select greatest(count(*),1) into desks from counters where service_id = first_s.id and active;
  return json_build_object('id', t.id, 'token', t.token, 'ahead', ahead, 'est_minutes', ceil(ahead * first_s.avg_minutes / desks::numeric),
    'service_en', first_s.name_en, 'service_sw', first_s.name_sw, 'created_at', t.created_at, 'triage', t.triage_level,
    'path', (select json_agg(json_build_object('en', x.name_en, 'sw', x.name_sw) order by ord) from unnest(path) with ordinality u(c, ord) join services x on x.code = u.c),
    'card_no', pat.card_no);
end $$;

revoke all on function public.lookup_patient(text,text,text), public.register_patient(text,text,text),
  public.issue_visit(uuid,text,text,text,text,text,text,timestamptz,text) from public;
grant execute on function public.lookup_patient(text,text,text), public.register_patient(text,text,text),
  public.issue_visit(uuid,text,text,text,text,text,text,timestamptz,text) to anon, authenticated;

CREATE OR REPLACE FUNCTION public.call_next(p_counter uuid)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare c public.counters; t public.tickets;
begin
  if not public.is_staff(auth.uid()) then raise exception 'Not authorized'; end if;
  select * into c from counters where id = p_counter and active;
  if c.id is null then raise exception 'Counter not open'; end if;
  select * into t from tickets where service_id = c.service_id and status = 'waiting'
    order by priority desc, (triage_level = 'red') desc, (triage_level = 'orange') desc, queued_at limit 1 for update skip locked;
  if t.id is null then return null; end if;
  update tickets set status='called', counter_id=c.id, called_at=now() where id=t.id returning * into t;
  insert into ticket_events(ticket_id, action, service_id, counter_id, staff_id, staff_email)
    values (t.id,'called',c.service_id,c.id,auth.uid(), auth.jwt()->>'email');
  return row_to_json(t);
end $function$;

CREATE OR REPLACE FUNCTION public.staff_action(p_ticket uuid, p_action text, p_target_service uuid DEFAULT NULL::uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare t public.tickets; svc text; nxt uuid; tgt public.services; pay text; ins text[]; newpath text[];
begin
  if not public.is_staff(auth.uid()) then raise exception 'Not authorized'; end if;
  select * into t from tickets where id = p_ticket for update;
  if t.id is null then raise exception 'Ticket not found'; end if;
  select code into svc from services where id = t.service_id;
  pay := case t.payment when 'cash' then 'cashier' when 'insurance' then 'insurance' else 'sha' end;
  if p_action = 'recall' then update tickets set called_at=now(), recall_count=recall_count+1, status='called' where id=t.id;
  elsif p_action = 'start' then update tickets set status='serving', started_at=now() where id=t.id;
  elsif p_action = 'complete' and coalesce(array_length(t.care_path,1),0) > t.path_step + 1 then
    select id into nxt from services where code = t.care_path[t.path_step + 2];
    update tickets set service_id=nxt, path_step=path_step+1, status='waiting', counter_id=null, called_at=null, started_at=null, recall_count=0, queued_at=now() where id=t.id;
    insert into ticket_events(ticket_id, action, service_id, counter_id, staff_id, staff_email)
      values (t.id, 'complete', t.service_id, t.counter_id, auth.uid(), auth.jwt()->>'email');
    p_action := 'auto_route'; p_target_service := nxt;
  elsif p_action = 'complete' and svc = 'consultation' and coalesce(array_length(t.care_path,1),0) = 0 then
    select id into nxt from services where code = pay;
    update tickets set service_id=nxt, status='waiting', counter_id=null, called_at=null, started_at=null, recall_count=0, queued_at=now() where id=t.id;
    insert into ticket_events(ticket_id, action, service_id, counter_id, staff_id, staff_email)
      values (t.id, 'complete', t.service_id, t.counter_id, auth.uid(), auth.jwt()->>'email');
    p_action := 'auto_route'; p_target_service := nxt;
  elsif p_action = 'complete' then update tickets set status='done', completed_at=now() where id=t.id;
  elsif p_action = 'no_show' then update tickets set status='no_show', completed_at=now() where id=t.id;
  elsif p_action in ('requeue','skip') then update tickets set status='waiting', counter_id=null, called_at=null, recall_count=recall_count+1 where id=t.id;
  elsif p_action = 'escalate' then update tickets set priority=2, triage_level='red' where id=t.id;
  elsif p_action = 'transfer' then
    select * into tgt from services where id = p_target_service;
    if tgt.id is null then raise exception 'Target required'; end if;
    -- Paid services (pharmacy, lab, imaging, physio) go through the patient's payment desk first
    ins := case when tgt.code in ('pharmacy','lab','radiology','physio') and svc <> pay then array[pay, tgt.code] else array[tgt.code] end;
    if coalesce(array_length(t.care_path,1),0) = 0 then newpath := array[svc] || ins;
    else newpath := t.care_path[1:t.path_step+1] || ins || coalesce(t.care_path[t.path_step+2:array_length(t.care_path,1)], '{}'); end if;
    -- drop a now-redundant duplicate payment step right after
    select id into nxt from services where code = ins[1];
    update tickets set care_path=newpath, path_step=case when array_length(t.care_path,1) is null then 1 else path_step+1 end,
      service_id=nxt, status='waiting', counter_id=null, called_at=null, started_at=null, recall_count=0, queued_at=now() where id=t.id;
    p_target_service := nxt;
  else raise exception 'Unknown action'; end if;
  insert into ticket_events(ticket_id, action, service_id, counter_id, staff_id, staff_email)
    values (t.id, p_action, coalesce(p_target_service, t.service_id), t.counter_id, auth.uid(),
      case when p_action = 'auto_route' then 'Automation' else auth.jwt()->>'email' end);
end $function$;

CREATE OR REPLACE FUNCTION public.get_ticket_status(p_id uuid)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare t public.tickets; s public.services; c public.counters; ahead int; fb boolean;
begin
  select * into t from tickets where id = p_id;
  if t.id is null then return null; end if;
  select * into s from services where id = t.service_id;
  select * into c from counters where id = t.counter_id;
  select count(*) into ahead from tickets x where x.service_id = t.service_id and x.status = 'waiting' and x.id <> t.id
    and (x.priority > t.priority or (x.priority = t.priority and x.queued_at <= t.queued_at));
  select exists(select 1 from feedback where ticket_id = t.id) into fb;
  return json_build_object('id', t.id, 'token', t.token, 'status', t.status, 'service_en', s.name_en, 'service_sw', s.name_sw,
    'counter', c.name, 'ahead', case when t.status='waiting' then ahead else 0 end,
    'est_minutes', case when t.status='waiting' then ahead * s.avg_minutes else 0 end,
    'created_at', t.created_at, 'has_feedback', fb, 'language', t.language, 'triage', t.triage_level, 'step', t.path_step,
    'path', (select json_agg(json_build_object('en', x.name_en, 'sw', x.name_sw) order by ord) from unnest(t.care_path) with ordinality u(c, ord) join services x on x.code = u.c));
end $function$;