-- Staff: call a chosen waiting patient; escalate to priority;
-- no-show returns to same-department waiting; only pharmacy/billing/insurance/SHA
-- may release without choosing next department; hospital number on every desk queue;
-- midnight reset keeps waiting / called / serving patients.

alter table public.automation_state
  add column if not exists last_day_closed date;

-- Call a specific waiting ticket to this counter
create or replace function public.call_ticket(p_counter uuid, p_ticket uuid)
returns json language plpgsql security definer set search_path = public as $$
declare c public.counters; t public.tickets;
begin
  if not public.is_staff(auth.uid()) then raise exception 'Not authorized'; end if;
  select * into c from counters where id = p_counter and active for update;
  if c.id is null then raise exception 'Unknown counter'; end if;
  if exists (
    select 1 from tickets
    where counter_id = c.id and status in ('called','serving')
  ) then
    raise exception 'Finish or return the patient at your desk first';
  end if;
  select * into t from tickets where id = p_ticket for update;
  if t.id is null then raise exception 'Ticket not found'; end if;
  if t.service_id <> c.service_id or t.status <> 'waiting' then
    raise exception 'Patient is not waiting at this department';
  end if;
  update tickets
    set status = 'called', counter_id = c.id, called_at = now()
    where id = t.id
    returning * into t;
  insert into ticket_events(ticket_id, action, service_id, counter_id, staff_id, staff_email)
    values (t.id, 'called', t.service_id, c.id, auth.uid(), auth.jwt()->>'email');
  return row_to_json(t);
end $$;

revoke all on function public.call_ticket(uuid, uuid) from public;
grant execute on function public.call_ticket(uuid, uuid) to authenticated;

-- Midnight: close finished / abandoned tickets; keep waiting, called, serving
create or replace function public.close_day()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with r as (
    update tickets
      set status = 'closed', completed_at = coalesce(completed_at, now())
      where status not in ('waiting', 'called', 'serving', 'done', 'closed')
      returning id, service_id
  )
  insert into ticket_events(ticket_id, action, service_id, staff_email)
    select id, 'day_close', service_id, 'Automation' from r;
  get diagnostics n = row_count;
  update automation_state
    set last_day_closed = (now() at time zone 'Africa/Nairobi')::date
    where id = 1;
  return n;
end $$;

revoke all on function public.close_day() from public, anon, authenticated;
grant execute on function public.close_day() to service_role;

create or replace function public.run_queue_automation(p_force boolean default false)
returns json language plpgsql security definer set search_path = public as $$
declare n_recall int := 0; n_noshow int := 0; n_requeue int := 0; n_open int := 0; n_close int := 0;
  n_day int := 0; today date;
begin
  update automation_state set last_run = now() where id = 1 and (p_force or last_run < now() - interval '30 seconds');
  if not found then return json_build_object('skipped', true); end if;

  today := (now() at time zone 'Africa/Nairobi')::date;
  if (select last_day_closed from automation_state where id = 1) is distinct from today then
    n_day := public.close_day();
  end if;

  with r as (update tickets set called_at = now(), recall_count = recall_count + 1
    where status = 'called' and called_at < now() - interval '2 minutes' and recall_count < 2 returning id, service_id, counter_id)
  insert into ticket_events(ticket_id, action, service_id, counter_id, staff_email)
    select id, 'auto_recall', service_id, counter_id, 'Automation' from r;
  get diagnostics n_recall = row_count;

  -- Auto no-show: return to same-department waiting (end of queue), do not abandon
  with r as (update tickets set status = 'waiting', counter_id = null, called_at = null, started_at = null,
      completed_at = null, recall_count = recall_count + 1, queued_at = now()
    where status = 'called' and called_at < now() - interval '2 minutes' and recall_count >= 2
    returning id, service_id, counter_id)
  insert into ticket_events(ticket_id, action, service_id, counter_id, staff_email)
    select id, 'auto_no_show', service_id, counter_id, 'Automation' from r;
  get diagnostics n_noshow = row_count;

  with q as (select s.id, s.surge_threshold, (select count(*) from tickets t where t.service_id = s.id and t.status = 'waiting') w from services s)
  update counters c set active = true from q where c.service_id = q.id and c.overflow and not c.active and q.w >= q.surge_threshold;
  get diagnostics n_open = row_count;
  with q as (select s.id, s.surge_threshold, (select count(*) from tickets t where t.service_id = s.id and t.status = 'waiting') w from services s)
  update counters c set active = false from q where c.service_id = q.id and c.overflow and c.active and q.w < q.surge_threshold / 2
    and not exists (select 1 from tickets t where t.counter_id = c.id and t.status in ('called','serving'));
  get diagnostics n_close = row_count;

  return json_build_object(
    'recalled', n_recall, 'no_show', n_noshow, 'requeued', n_requeue,
    'overflow_opened', n_open, 'overflow_closed', n_close, 'day_closed', n_day
  );
end $$;

create or replace function public.staff_action(p_ticket uuid, p_action text, p_target_service uuid DEFAULT NULL::uuid)
returns void language plpgsql security definer set search_path = public as $$
declare t public.tickets; svc text; nxt uuid; tgt public.services; pay text; ins text[]; newpath text[]; cat text;
begin
  if not public.is_staff(auth.uid()) then raise exception 'Not authorized'; end if;
  select * into t from tickets where id = p_ticket for update;
  if t.id is null then raise exception 'Ticket not found'; end if;
  select code, category into svc, cat from services where id = t.service_id;
  pay := case t.payment when 'cash' then 'cashier' when 'card' then 'cashier' when 'insurance' then 'insurance' else 'sha' end;

  if p_action = 'recall' then
    update tickets set called_at=now(), recall_count=recall_count+1, status='called' where id=t.id;

  elsif p_action = 'start' then
    update tickets set status='serving', started_at=now() where id=t.id;

  elsif p_action = 'complete' then
    if svc not in ('pharmacy','cashier','insurance','sha') then
      raise exception 'Select the next department before sending this patient';
    end if;
    if svc in ('cashier','insurance','sha') and not exists (
      select 1 from payments p where p.ticket_id = t.id and p.status = 'paid'
    ) then
      raise exception 'Collect payment before completing this step';
    end if;
    update tickets set status='done', completed_at=now() where id=t.id;

  elsif p_action = 'no_show' then
    update tickets
      set status='waiting', counter_id=null, called_at=null, started_at=null,
          recall_count=recall_count+1, queued_at=now(), completed_at=null
      where id=t.id;

  elsif p_action in ('requeue','skip') then
    update tickets set status='waiting', counter_id=null, called_at=null, started_at=null, recall_count=recall_count+1 where id=t.id;

  elsif p_action = 'escalate' then
    update tickets set priority=2, triage_level='red' where id=t.id;

  elsif p_action = 'escalate_priority' then
    update tickets
      set priority = greatest(priority, 1),
          triage_level = case when coalesce(triage_level,'green') = 'red' then 'red' else 'orange' end
      where id=t.id;

  elsif p_action = 'transfer' then
    select * into tgt from services where id = p_target_service;
    if tgt.id is null then raise exception 'Select the next department'; end if;
    if tgt.id = t.service_id then raise exception 'Choose a different department'; end if;
    ins := case when tgt.code in ('pharmacy','lab','radiology','physio') and svc <> pay
      then array[pay, tgt.code] else array[tgt.code] end;
    if coalesce(array_length(t.care_path,1),0) = 0 then newpath := array[svc] || ins;
    else newpath := t.care_path[1:t.path_step+1] || ins || coalesce(t.care_path[t.path_step+2:array_length(t.care_path,1)], '{}'); end if;
    select id into nxt from services where code = ins[1];
    update tickets set care_path=newpath, path_step=case when array_length(t.care_path,1) is null then 1 else path_step+1 end,
      service_id=nxt, status='waiting', counter_id=null, called_at=null, started_at=null, recall_count=0, queued_at=now() where id=t.id;
    p_target_service := nxt;

  else
    raise exception 'Unknown action';
  end if;

  insert into ticket_events(ticket_id, action, service_id, counter_id, staff_id, staff_email)
    values (t.id, p_action, coalesce(p_target_service, t.service_id), t.counter_id, auth.uid(), auth.jwt()->>'email');
end $$;

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
      t.patient_id,
      p.card_no as hospital_no,
      case when can_see_cover then t.payment_detail else null end as payment_detail,
      case when can_see_cover then t.insurer_id else null end as insurer_id,
      case when can_see_cover then (
        select ip.name from insurance_providers ip where ip.id = t.insurer_id
      ) else null end as insurer_name
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
  ) x), '[]'::json);
end $$;
