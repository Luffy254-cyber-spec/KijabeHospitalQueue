-- Stage 2: department fees + M-Pesa/cash/insurance payments + wider unique tokens
-- Stage 1 polish: more rooms, care-path gates at payment desks

create table if not exists public.service_fees (
  id uuid primary key default gen_random_uuid(),
  service_code text not null references public.services(code) on delete cascade,
  visit_type text not null default 'default' check (visit_type in ('default','walk_in','booked')),
  amount_kes integer not null check (amount_kes >= 0),
  label text not null default 'Consultation fee',
  unique (service_code, visit_type)
);
alter table public.service_fees enable row level security;
create policy "staff read fees" on public.service_fees for select to authenticated using (public.is_staff(auth.uid()));
create policy "admins manage fees" on public.service_fees for all to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));
grant select on public.service_fees to authenticated;
grant all on public.service_fees to service_role;

-- Estimated AIC Kijabe-style OPD fees (staff can override at cashier)
insert into public.service_fees(service_code, visit_type, amount_kes, label) values
  ('consultation','default',800,'OPD consultation'),
  ('consultation','booked',600,'Booked consultation'),
  ('triage','default',200,'Triage assessment'),
  ('emergency','default',1500,'Casualty / emergency'),
  ('surgical','default',1200,'Surgical clinic'),
  ('paediatrics','default',900,'Paediatrics clinic'),
  ('obgyn','default',1000,'Maternity / ANC / Gynae'),
  ('orthopaedics','default',1200,'Orthopaedic clinic'),
  ('ent','default',1000,'ENT clinic'),
  ('eye','default',1100,'Eye clinic'),
  ('dental','default',1500,'Dental clinic'),
  ('medical','default',1000,'Medical / diabetes clinic'),
  ('neurosurgery','default',1500,'Neurosurgery (CURE)'),
  ('lab','default',500,'Laboratory base fee'),
  ('radiology','default',800,'Radiology base fee'),
  ('pharmacy','default',300,'Pharmacy dispensing'),
  ('physio','default',700,'Physiotherapy session'),
  ('inpatient','default',2000,'Admission processing'),
  ('cashier','default',0,'Cashier (use visit fee)'),
  ('insurance','default',0,'Insurance desk'),
  ('sha','default',0,'SHA desk')
on conflict (service_code, visit_type) do nothing;

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  method text not null check (method in ('mpesa','cash','insurance','sha','waiver')),
  amount_kes integer not null check (amount_kes >= 0),
  phone text,
  status text not null default 'pending' check (status in ('pending','pushed','paid','failed','cancelled')),
  merchant_request_id text,
  checkout_request_id text,
  mpesa_receipt text,
  result_code integer,
  result_desc text,
  cover_ref text,
  waiver_reason text,
  paid_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index payments_ticket_idx on public.payments(ticket_id);
create index payments_checkout_idx on public.payments(checkout_request_id);
create index payments_status_idx on public.payments(status);
alter table public.payments enable row level security;
create policy "staff read payments" on public.payments for select to authenticated using (public.is_staff(auth.uid()));
grant select on public.payments to authenticated, anon;
grant all on public.payments to service_role;

-- Extra Kijabe rooms / windows
insert into public.counters(name, service_id)
select r.name, s.id from (values
  ('pharmacy','Pharmacy 3'),('pharmacy','Pharmacy 4'),
  ('cashier','Cashier 3'),
  ('lab','Phlebotomy 2'),('lab','Lab Results Window'),
  ('triage','Triage Room 5'),
  ('consultation','Room 11'),('consultation','Room 12'),
  ('emergency','Casualty Bay 3'),
  ('enquiries','Enquiries Desk 2')
) r(code,name) join public.services s on s.code=r.code
where not exists (select 1 from public.counters c where c.name = r.name and c.service_id = s.id);

-- Fee lookup for a ticket (clinic fee from care path + red surcharge)
create or replace function public.get_fee_for_ticket(p_ticket uuid)
returns json language plpgsql security definer set search_path = public as $$
declare t public.tickets; bill_code text; fee public.service_fees; amt int; lbl text; surcharge int := 0;
begin
  if not public.is_staff(auth.uid()) then raise exception 'Not authorized'; end if;
  select * into t from tickets where id = p_ticket;
  if t.id is null then raise exception 'Ticket not found'; end if;
  -- Prefer the clinical/service step in the care path (not the payment desk itself)
  select c into bill_code from unnest(t.care_path) c
    where c not in ('cashier','insurance','sha','triage','registration','enquiries')
    limit 1;
  if bill_code is null then
    select code into bill_code from services where id = t.service_id;
  end if;
  select * into fee from service_fees
    where service_code = bill_code and visit_type = t.visit_type
    limit 1;
  if fee.id is null then
    select * into fee from service_fees where service_code = bill_code and visit_type = 'default' limit 1;
  end if;
  amt := coalesce(fee.amount_kes, 500);
  lbl := coalesce(fee.label, 'Hospital fee');
  if t.triage_level = 'red' then surcharge := 500; end if;
  if t.triage_level = 'orange' then surcharge := 200; end if;
  return json_build_object(
    'ticket_id', t.id, 'token', t.token, 'service_code', bill_code,
    'amount_kes', amt + surcharge, 'base_kes', amt, 'surcharge_kes', surcharge,
    'label', lbl || case when surcharge > 0 then ' (+ triage surcharge)' else '' end,
    'payment_method', t.payment, 'phone', t.phone, 'triage', t.triage_level,
    'already_paid', exists(select 1 from payments p where p.ticket_id = t.id and p.status = 'paid')
  );
end $$;
revoke all on function public.get_fee_for_ticket(uuid) from public;
grant execute on function public.get_fee_for_ticket(uuid) to authenticated;

-- Start an M-Pesa STK payment row (staff)
create or replace function public.record_payment_push(
  p_ticket uuid, p_amount integer, p_phone text,
  p_merchant_request_id text, p_checkout_request_id text
) returns json language plpgsql security definer set search_path = public as $$
declare p public.payments; phone text;
begin
  if not public.is_staff(auth.uid()) then raise exception 'Not authorized'; end if;
  if p_amount is null or p_amount < 1 then raise exception 'Invalid amount'; end if;
  phone := regexp_replace(coalesce(p_phone,''), '[^0-9]', '', 'g');
  if phone ~ '^0[17]' then phone := '254' || substr(phone, 2); end if;
  if phone !~ '^254[17][0-9]{8}$' then raise exception 'Invalid phone'; end if;
  -- cancel prior pending/pushed for this ticket
  update payments set status='cancelled', updated_at=now()
    where ticket_id = p_ticket and status in ('pending','pushed');
  insert into payments(ticket_id, method, amount_kes, phone, status, merchant_request_id, checkout_request_id, created_by)
    values (p_ticket, 'mpesa', p_amount, phone, 'pushed', p_merchant_request_id, p_checkout_request_id, auth.uid())
    returning * into p;
  insert into ticket_events(ticket_id, action, service_id, staff_id, staff_email)
    select p_ticket, 'payment_pushed', service_id, auth.uid(), auth.jwt()->>'email' from tickets where id = p_ticket;
  return row_to_json(p);
end $$;
revoke all on function public.record_payment_push(uuid,integer,text,text,text) from public;
grant execute on function public.record_payment_push(uuid,integer,text,text,text) to authenticated;

-- Daraja callback (no auth — requires valid checkout_request_id)
create or replace function public.finalize_payment_callback(
  p_checkout_request_id text, p_result_code integer, p_result_desc text,
  p_mpesa_receipt text, p_amount integer
) returns json language plpgsql security definer set search_path = public as $$
declare p public.payments;
begin
  if coalesce(p_checkout_request_id,'') = '' then raise exception 'Missing checkout id'; end if;
  select * into p from payments where checkout_request_id = p_checkout_request_id order by created_at desc limit 1 for update;
  if p.id is null then return json_build_object('ok', false, 'error', 'unknown_checkout'); end if;
  if p.status = 'paid' then return json_build_object('ok', true, 'payment_id', p.id, 'status', 'paid'); end if;
  if p_result_code = 0 then
    update payments set status='paid', result_code=0, result_desc=coalesce(p_result_desc,'Success'),
      mpesa_receipt=nullif(p_mpesa_receipt,''), amount_kes=case when coalesce(p_amount,0) > 0 then p_amount else amount_kes end,
      paid_at=now(), updated_at=now() where id = p.id returning * into p;
    insert into ticket_events(ticket_id, action, service_id)
      select p.ticket_id, 'payment_paid', service_id from tickets where id = p.ticket_id;
  else
    update payments set status='failed', result_code=p_result_code, result_desc=p_result_desc, updated_at=now()
      where id = p.id returning * into p;
    insert into ticket_events(ticket_id, action, service_id)
      select p.ticket_id, 'payment_failed', service_id from tickets where id = p.ticket_id;
  end if;
  return json_build_object('ok', true, 'payment_id', p.id, 'status', p.status, 'receipt', p.mpesa_receipt);
end $$;
revoke all on function public.finalize_payment_callback(text,integer,text,text,integer) from public;
grant execute on function public.finalize_payment_callback(text,integer,text,text,integer) to anon, authenticated, service_role;

-- Cash / insurance / SHA / waiver confirm
create or replace function public.confirm_cash_or_cover(
  p_ticket uuid, p_method text, p_amount integer, p_cover_ref text, p_waiver_reason text
) returns json language plpgsql security definer set search_path = public as $$
declare p public.payments; m text := lower(trim(p_method));
begin
  if not public.is_staff(auth.uid()) then raise exception 'Not authorized'; end if;
  if m not in ('cash','insurance','sha','waiver') then raise exception 'Invalid method'; end if;
  if m = 'waiver' and length(trim(coalesce(p_waiver_reason,''))) < 5 then raise exception 'Waiver reason required'; end if;
  if m <> 'waiver' and (p_amount is null or p_amount < 0) then raise exception 'Invalid amount'; end if;
  update payments set status='cancelled', updated_at=now()
    where ticket_id = p_ticket and status in ('pending','pushed');
  insert into payments(ticket_id, method, amount_kes, status, cover_ref, waiver_reason, paid_at, created_by)
    values (p_ticket, m, coalesce(p_amount,0), 'paid', nullif(p_cover_ref,''), nullif(p_waiver_reason,''), now(), auth.uid())
    returning * into p;
  insert into ticket_events(ticket_id, action, service_id, staff_id, staff_email)
    select p_ticket, 'payment_paid', service_id, auth.uid(), auth.jwt()->>'email' from tickets where id = p_ticket;
  return row_to_json(p);
end $$;
revoke all on function public.confirm_cash_or_cover(uuid,text,integer,text,text) from public;
grant execute on function public.confirm_cash_or_cover(uuid,text,integer,text,text) to authenticated;

create or replace function public.get_payment_status(p_ticket uuid)
returns json language plpgsql security definer set search_path = public as $$
declare p public.payments;
begin
  select * into p from payments where ticket_id = p_ticket order by created_at desc limit 1;
  if p.id is null then return json_build_object('found', false, 'paid', false); end if;
  return json_build_object(
    'found', true, 'paid', p.status = 'paid', 'id', p.id, 'status', p.status,
    'method', p.method, 'amount_kes', p.amount_kes, 'phone', p.phone,
    'checkout_request_id', p.checkout_request_id, 'mpesa_receipt', p.mpesa_receipt,
    'result_desc', p.result_desc, 'paid_at', p.paid_at
  );
end $$;
revoke all on function public.get_payment_status(uuid) from public;
grant execute on function public.get_payment_status(uuid) to anon, authenticated;

-- Wider unique tokens (6 digits, never modulo-truncated)
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
  elsif s.code = 'emergency' then path := array['emergency', pay];
  else path := array[s.code]; end if;
  -- Walking consultation/clinic always starts at triage (already in clinic branch); red prepends triage if missing
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

-- Payment desk must collect payment before complete (unless waiver already on file)
create or replace function public.staff_action(p_ticket uuid, p_action text, p_target_service uuid DEFAULT NULL::uuid)
returns void language plpgsql security definer set search_path = public as $$
declare t public.tickets; svc text; nxt uuid; tgt public.services; pay text; ins text[]; newpath text[]; cat text;
begin
  if not public.is_staff(auth.uid()) then raise exception 'Not authorized'; end if;
  select * into t from tickets where id = p_ticket for update;
  if t.id is null then raise exception 'Ticket not found'; end if;
  select code, category into svc, cat from services where id = t.service_id;
  pay := case t.payment when 'cash' then 'cashier' when 'insurance' then 'insurance' else 'sha' end;
  if p_action = 'recall' then update tickets set called_at=now(), recall_count=recall_count+1, status='called' where id=t.id;
  elsif p_action = 'start' then update tickets set status='serving', started_at=now() where id=t.id;
  elsif p_action = 'complete' then
    if svc in ('cashier','insurance','sha') and not exists (
      select 1 from payments p where p.ticket_id = t.id and p.status = 'paid'
    ) then
      raise exception 'Collect payment before completing this step';
    end if;
    if coalesce(array_length(t.care_path,1),0) > t.path_step + 1 then
      select id into nxt from services where code = t.care_path[t.path_step + 2];
      update tickets set service_id=nxt, path_step=path_step+1, status='waiting', counter_id=null, called_at=null, started_at=null, recall_count=0, queued_at=now() where id=t.id;
      insert into ticket_events(ticket_id, action, service_id, counter_id, staff_id, staff_email)
        values (t.id, 'complete', t.service_id, t.counter_id, auth.uid(), auth.jwt()->>'email');
      p_action := 'auto_route'; p_target_service := nxt;
    elsif svc = 'consultation' and coalesce(array_length(t.care_path,1),0) = 0 then
      select id into nxt from services where code = pay;
      update tickets set service_id=nxt, status='waiting', counter_id=null, called_at=null, started_at=null, recall_count=0, queued_at=now() where id=t.id;
      insert into ticket_events(ticket_id, action, service_id, counter_id, staff_id, staff_email)
        values (t.id, 'complete', t.service_id, t.counter_id, auth.uid(), auth.jwt()->>'email');
      p_action := 'auto_route'; p_target_service := nxt;
    else
      update tickets set status='done', completed_at=now() where id=t.id;
    end if;
  elsif p_action = 'no_show' then update tickets set status='no_show', completed_at=now() where id=t.id;
  elsif p_action in ('requeue','skip') then update tickets set status='waiting', counter_id=null, called_at=null, recall_count=recall_count+1 where id=t.id;
  elsif p_action = 'escalate' then update tickets set priority=2, triage_level='red' where id=t.id;
  elsif p_action = 'transfer' then
    select * into tgt from services where id = p_target_service;
    if tgt.id is null then raise exception 'Target required'; end if;
    ins := case when tgt.code in ('pharmacy','lab','radiology','physio') and svc <> pay then array[pay, tgt.code] else array[tgt.code] end;
    if coalesce(array_length(t.care_path,1),0) = 0 then newpath := array[svc] || ins;
    else newpath := t.care_path[1:t.path_step+1] || ins || coalesce(t.care_path[t.path_step+2:array_length(t.care_path,1)], '{}'); end if;
    select id into nxt from services where code = ins[1];
    update tickets set care_path=newpath, path_step=case when array_length(t.care_path,1) is null then 1 else path_step+1 end,
      service_id=nxt, status='waiting', counter_id=null, called_at=null, started_at=null, recall_count=0, queued_at=now() where id=t.id;
    p_target_service := nxt;
  else raise exception 'Unknown action'; end if;
  insert into ticket_events(ticket_id, action, service_id, counter_id, staff_id, staff_email)
    values (t.id, p_action, coalesce(p_target_service, t.service_id), t.counter_id, auth.uid(),
      case when p_action = 'auto_route' then 'Automation' else auth.jwt()->>'email' end);
end $$;

-- Enrich phone ticket status with payment
create or replace function public.get_ticket_status(p_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare t public.tickets; s public.services; c public.counters; ahead int; fb boolean; pay json;
begin
  select * into t from tickets where id = p_id;
  if t.id is null then return null; end if;
  select * into s from services where id = t.service_id;
  select * into c from counters where id = t.counter_id;
  select count(*) into ahead from tickets x where x.service_id = t.service_id and x.status = 'waiting' and x.id <> t.id
    and (x.priority > t.priority or (x.priority = t.priority and x.queued_at <= t.queued_at));
  select exists(select 1 from feedback where ticket_id = t.id) into fb;
  pay := public.get_payment_status(t.id);
  return json_build_object('id', t.id, 'token', t.token, 'status', t.status, 'service_en', s.name_en, 'service_sw', s.name_sw,
    'counter', c.name, 'ahead', case when t.status='waiting' then ahead else 0 end,
    'est_minutes', case when t.status='waiting' then ahead * s.avg_minutes else 0 end,
    'created_at', t.created_at, 'has_feedback', fb, 'language', t.language, 'triage', t.triage_level, 'step', t.path_step,
    'payment', t.payment, 'payment_status', pay,
    'path', (select json_agg(json_build_object('en', x.name_en, 'sw', x.name_sw) order by ord) from unnest(t.care_path) with ordinality u(c, ord) join services x on x.code = u.c));
end $function$;

-- Realtime for payments (phone tracking)
do $$ begin
  alter publication supabase_realtime add table public.payments;
exception when duplicate_object then null; when undefined_object then null; end $$;
