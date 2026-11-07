-- After patient registration, put them in the Registration queue so the TV/display shows them.
-- If they later complete full check-in for another service, close the registration placeholder ticket.

create or replace function public.queue_at_registration(p_patient uuid, p_language text default 'en')
returns json language plpgsql security definer set search_path = public as $$
declare
  open_id uuid;
  existing json;
begin
  select t.id into open_id
  from tickets t
  where t.patient_id = p_patient
    and t.status in ('waiting', 'called', 'serving')
  order by t.queued_at desc
  limit 1;

  if open_id is not null then
    existing := public.get_ticket_status(open_id);
    return json_build_object('queued', false, 'already', true, 'ticket', existing);
  end if;

  return (
    public.issue_visit(
      p_patient,
      'registration',
      'walk_in',
      'cash',
      'green',
      'Auto-queued at registration after patient register',
      coalesce(nullif(p_language, ''), 'en'),
      null,
      null
    )::jsonb || jsonb_build_object('queued', true, 'already', false)
  )::json;
end $$;

-- When issuing a real visit, finish any open registration-only placeholder for this patient
create or replace function public.issue_visit(p_patient uuid, p_service_code text, p_visit_type text, p_payment text,
  p_triage text, p_triage_note text, p_language text, p_appt_at timestamptz, p_appt_service text)
returns json language plpgsql security definer set search_path = public as $$
declare s public.services; first_s public.services; n int; t public.tickets; ahead int; desks int; pr int;
  pay text; path text[]; pat public.patients; reg_code text;
begin
  select * into s from services where code = p_service_code;
  if s.id is null then raise exception 'Unknown service'; end if;
  select * into pat from patients where id = p_patient;
  if pat.id is null then raise exception 'Unknown patient'; end if;
  if p_visit_type not in ('walk_in','booked') then raise exception 'Invalid visit type'; end if;
  if p_payment not in ('cash','insurance','sha') then raise exception 'Invalid payment'; end if;
  if p_triage not in ('red','orange','green') then raise exception 'Invalid triage'; end if;

  -- Close registration placeholder if moving on to another service
  if p_service_code <> 'registration' then
    select code into reg_code from services where code = 'registration';
    update tickets t
      set status = 'done', completed_at = now()
    from services sv
    where t.service_id = sv.id
      and sv.code = 'registration'
      and t.patient_id = p_patient
      and t.status in ('waiting', 'called', 'serving')
      and coalesce(array_length(t.care_path, 1), 0) <= 1;
  end if;

  pay := case p_payment when 'cash' then 'cashier' when 'insurance' then 'insurance' else 'sha' end;
  if s.category = 'clinic' then path := array['triage', s.code, pay];
  elsif s.code in ('pharmacy','lab','radiology','physio') then path := array[pay, s.code];
  elsif s.code = 'triage' then path := array['triage','consultation', pay];
  elsif s.code = 'emergency' then path := array['emergency', pay];
  else path := array[s.code]; end if;
  if p_triage = 'red' and path[1] <> 'triage' and s.code <> 'emergency' then path := array['triage'] || path; end if;
  pr := case when p_triage in ('red','orange') then 1 else 0 end;
  select * into first_s from services where code = path[1];
  insert into daily_sequences(service_id, day, last_no) values (first_s.id, date '2000-01-01', 1)
    on conflict (service_id, day) do update set last_no = daily_sequences.last_no + 1 returning last_no into n;
  insert into tickets(token, service_id, visit_type, payment, priority, phone, language, patient_id, triage_level, triage_note, care_path, path_step, appointment_at, appointment_service)
    values (
      first_s.prefix || '-' || case p_triage when 'red' then 'R' when 'orange' then 'O' else '' end || lpad(n::text, 6, '0'),
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

revoke all on function public.queue_at_registration(uuid, text) from public;
grant execute on function public.queue_at_registration(uuid, text) to anon, authenticated;
