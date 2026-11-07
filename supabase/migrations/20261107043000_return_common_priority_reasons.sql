-- Priority changes require a stated reason; add return-to-common (normal queue).
drop function if exists public.staff_action(uuid, text, uuid);

create or replace function public.staff_action(
  p_ticket uuid,
  p_action text,
  p_target_service uuid default null,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tickets;
  svc text;
  nxt uuid;
  tgt public.services;
  pay text;
  ins text[];
  newpath text[];
  cat text;
  note text;
  stamped text;
begin
  if not public.is_staff(auth.uid()) then raise exception 'Not authorized'; end if;
  select * into t from tickets where id = p_ticket for update;
  if t.id is null then raise exception 'Ticket not found'; end if;
  select code, category into svc, cat from services where id = t.service_id;
  pay := case t.payment when 'cash' then 'cashier' when 'card' then 'cashier' when 'insurance' then 'insurance' else 'sha' end;
  note := nullif(btrim(coalesce(p_note, '')), '');

  if p_action = 'recall' then
    update tickets set called_at = now(), recall_count = recall_count + 1, status = 'called' where id = t.id;

  elsif p_action = 'start' then
    update tickets set status = 'serving', started_at = now() where id = t.id;

  elsif p_action = 'complete' then
    if svc not in ('pharmacy', 'cashier', 'insurance', 'sha') then
      raise exception 'Select the next department before sending this patient';
    end if;
    if svc in ('cashier', 'insurance', 'sha') and not exists (
      select 1 from payments p where p.ticket_id = t.id and p.status = 'paid'
    ) then
      raise exception 'Collect payment before completing this step';
    end if;
    update tickets set status = 'done', completed_at = now() where id = t.id;

  elsif p_action = 'no_show' then
    update tickets
      set status = 'waiting', counter_id = null, called_at = null, started_at = null,
          recall_count = recall_count + 1, queued_at = now(), completed_at = null
      where id = t.id;

  elsif p_action in ('requeue', 'skip') then
    update tickets
      set status = 'waiting', counter_id = null, called_at = null, started_at = null,
          recall_count = recall_count + 1
      where id = t.id;

  elsif p_action = 'escalate' then
    if note is null then raise exception 'State a reason for emergency escalation'; end if;
    stamped := left(concat_ws(' · ', nullif(t.triage_note, ''), 'Emergency: ' || note), 500);
    update tickets set priority = 2, triage_level = 'red', triage_note = stamped where id = t.id;

  elsif p_action = 'escalate_priority' then
    if note is null then raise exception 'State a reason for priority escalation'; end if;
    stamped := left(concat_ws(' · ', nullif(t.triage_note, ''), 'Priority: ' || note), 500);
    update tickets
      set priority = greatest(priority, 1),
          triage_level = case when coalesce(triage_level, 'green') = 'red' then 'red' else 'orange' end,
          triage_note = stamped
      where id = t.id;

  elsif p_action = 'return_common' then
    if note is null then raise exception 'State a reason for returning to common (normal) queue'; end if;
    if coalesce(t.priority, 0) = 0 and coalesce(t.triage_level, 'green') = 'green' then
      raise exception 'Patient is already in the common (normal) queue';
    end if;
    stamped := left(concat_ws(' · ', nullif(t.triage_note, ''), 'Returned to common: ' || note), 500);
    update tickets set priority = 0, triage_level = 'green', triage_note = stamped where id = t.id;

  elsif p_action = 'transfer' then
    select * into tgt from services where id = p_target_service;
    if tgt.id is null then raise exception 'Select the next department'; end if;
    if tgt.id = t.service_id then raise exception 'Choose a different department'; end if;
    ins := case
      when tgt.code in ('pharmacy', 'lab', 'radiology', 'physio') and svc <> pay
        then array[pay, tgt.code]
      else array[tgt.code]
    end;
    if coalesce(array_length(t.care_path, 1), 0) = 0 then
      newpath := array[svc] || ins;
    else
      newpath := t.care_path[1:t.path_step + 1]
        || ins
        || coalesce(t.care_path[t.path_step + 2:array_length(t.care_path, 1)], '{}');
    end if;
    select id into nxt from services where code = ins[1];
    update tickets
      set care_path = newpath,
          path_step = case when array_length(t.care_path, 1) is null then 1 else path_step + 1 end,
          service_id = nxt,
          status = 'waiting',
          counter_id = null,
          called_at = null,
          started_at = null,
          recall_count = 0,
          queued_at = now()
      where id = t.id;
    p_target_service := nxt;

  else
    raise exception 'Unknown action';
  end if;

  insert into ticket_events(ticket_id, action, service_id, counter_id, staff_id, staff_email)
    values (
      t.id,
      p_action,
      coalesce(p_target_service, t.service_id),
      t.counter_id,
      auth.uid(),
      auth.jwt() ->> 'email'
    );
end;
$$;

grant execute on function public.staff_action(uuid, text, uuid, text) to authenticated, anon, service_role;
