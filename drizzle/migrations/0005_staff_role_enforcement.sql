create or replace function public.is_staff(_uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _uid and role in ('staff','admin'))
$$;
revoke all on function public.is_staff(uuid) from public, anon;
grant execute on function public.is_staff(uuid) to authenticated;

create or replace function public.grant_staff_role(p_email text) returns boolean
language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Not authorized'; end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then return false; end if;
  insert into public.user_roles(user_id, role) values (uid, 'staff') on conflict do nothing;
  return true;
end $$;
revoke all on function public.grant_staff_role(text) from public, anon;
grant execute on function public.grant_staff_role(text) to authenticated;

-- Policies: staff role required
drop policy if exists "staff seq" on public.daily_sequences;
create policy "staff seq" on public.daily_sequences for select to authenticated using (public.is_staff(auth.uid()));
drop policy if exists "staff manage counters" on public.counters;
create policy "admins manage counters" on public.counters for all to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));
drop policy if exists "staff manage services" on public.services;
create policy "admins manage services" on public.services for all to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));
drop policy if exists "staff tickets" on public.tickets;
create policy "staff read tickets" on public.tickets for select to authenticated using (public.is_staff(auth.uid()));
drop policy if exists "staff read settings" on public.automation_settings;
create policy "staff read settings" on public.automation_settings for select to authenticated using (public.is_staff(auth.uid()));
drop policy if exists "staff feedback" on public.feedback;
create policy "staff feedback" on public.feedback for select to authenticated using (public.is_staff(auth.uid()));
drop policy if exists "staff read events" on public.ticket_events;
create policy "staff read events" on public.ticket_events for select to authenticated using (public.is_staff(auth.uid()));

CREATE OR REPLACE FUNCTION public.call_next(p_counter uuid)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare c public.counters; t public.tickets;
begin
  if not public.is_staff(auth.uid()) then raise exception 'Not authorized'; end if;
  select * into c from counters where id = p_counter and active;
  if c.id is null then raise exception 'Counter not open'; end if;
  select * into t from tickets where service_id = c.service_id and status = 'waiting'
    order by priority desc, queued_at limit 1 for update skip locked;
  if t.id is null then return null; end if;
  update tickets set status='called', counter_id=c.id, called_at=now() where id=t.id returning * into t;
  insert into ticket_events(ticket_id, action, service_id, counter_id, staff_id, staff_email)
    values (t.id,'called',c.service_id,c.id,auth.uid(), auth.jwt()->>'email');
  return row_to_json(t);
end $function$;

CREATE OR REPLACE FUNCTION public.staff_action(p_ticket uuid, p_action text, p_target_service uuid DEFAULT NULL::uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare t public.tickets; svc text; nxt uuid;
begin
  if not public.is_staff(auth.uid()) then raise exception 'Not authorized'; end if;
  select * into t from tickets where id = p_ticket for update;
  if t.id is null then raise exception 'Ticket not found'; end if;
  select code into svc from services where id = t.service_id;
  if p_action = 'recall' then update tickets set called_at=now(), recall_count=recall_count+1, status='called' where id=t.id;
  elsif p_action = 'start' then update tickets set status='serving', started_at=now() where id=t.id;
  elsif p_action = 'complete' and svc = 'consultation' then
    select id into nxt from services where code = case when t.payment = 'cash' then 'cashier' else 'insurance' end;
    update tickets set service_id=nxt, status='waiting', counter_id=null, called_at=null, started_at=null, recall_count=0, queued_at=now() where id=t.id;
    insert into ticket_events(ticket_id, action, service_id, counter_id, staff_id, staff_email)
      values (t.id, 'complete', t.service_id, t.counter_id, auth.uid(), auth.jwt()->>'email');
    p_action := 'auto_route'; p_target_service := nxt;
  elsif p_action = 'complete' then update tickets set status='done', completed_at=now() where id=t.id;
  elsif p_action = 'no_show' then update tickets set status='no_show', completed_at=now() where id=t.id;
  elsif p_action = 'requeue' then update tickets set status='waiting', counter_id=null, called_at=null where id=t.id;
  elsif p_action = 'escalate' then update tickets set priority=2 where id=t.id;
  elsif p_action = 'transfer' then
    if p_target_service is null then raise exception 'Target required'; end if;
    update tickets set service_id=p_target_service, status='waiting', counter_id=null, called_at=null, started_at=null, recall_count=0, queued_at=now() where id=t.id;
  else raise exception 'Unknown action'; end if;
  insert into ticket_events(ticket_id, action, service_id, counter_id, staff_id, staff_email)
    values (t.id, p_action, coalesce(p_target_service, t.service_id), t.counter_id, auth.uid(),
      case when p_action = 'auto_route' then 'Automation' else auth.jwt()->>'email' end);
end $function$;

CREATE OR REPLACE FUNCTION public.issue_ticket(p_service_code text, p_phone text, p_visit_type text, p_payment text, p_priority integer, p_language text)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare s public.services; n int; t public.tickets; ahead int; desks int; pr int;
begin
  select * into s from services where code = p_service_code;
  if s.id is null then raise exception 'Unknown service'; end if;
  if p_phone is not null and p_phone !~ '^\+254[0-9]{9}$' then raise exception 'Invalid phone'; end if;
  if p_visit_type not in ('walk_in','booked') then raise exception 'Invalid visit type'; end if;
  if p_payment not in ('cash','insurance','sha') then raise exception 'Invalid payment'; end if;
  if p_priority not in (0,1,2) then raise exception 'Invalid priority'; end if;
  -- Emergency (2) can only be set by staff; self-service requests are capped at priority 1 for triage review.
  pr := case when public.is_staff(auth.uid()) then p_priority else least(p_priority, 1) end;
  insert into daily_sequences(service_id, day, last_no) values (s.id, (now() at time zone 'Africa/Nairobi')::date, 1)
    on conflict (service_id, day) do update set last_no = daily_sequences.last_no + 1
    returning last_no into n;
  insert into tickets(token, service_id, visit_type, payment, priority, phone, language)
    values (s.prefix || '-' || lpad(n::text, greatest(3, length(n::text)), '0'), s.id, p_visit_type, p_payment, pr, nullif(p_phone,''), coalesce(p_language,'en'))
    returning * into t;
  insert into ticket_events(ticket_id, action, service_id) values (t.id, 'issued', s.id);
  select count(*) into ahead from tickets x where x.service_id = s.id and x.status = 'waiting' and x.id <> t.id
    and (x.priority > t.priority or (x.priority = t.priority and x.queued_at <= t.queued_at));
  select greatest(count(*),1) into desks from counters where service_id = s.id and active;
  return json_build_object('id', t.id, 'token', t.token, 'ahead', ahead, 'est_minutes', ceil(ahead * s.avg_minutes / desks::numeric),
    'service_en', s.name_en, 'service_sw', s.name_sw, 'created_at', t.created_at);
end $function$;