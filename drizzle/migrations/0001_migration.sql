
alter table public.ticket_events add column staff_email text;
drop policy "staff events" on public.ticket_events;
create policy "staff read events" on public.ticket_events for select to authenticated using (true);
revoke insert, update, delete on public.ticket_events from authenticated;

create or replace function public.call_next(p_counter uuid)
returns json language plpgsql security definer set search_path = public as $$
declare c public.counters; t public.tickets;
begin
  if auth.uid() is null then raise exception 'Not authorized'; end if;
  select * into c from counters where id = p_counter;
  select * into t from tickets where service_id = c.service_id and status = 'waiting'
    order by priority desc, queued_at limit 1 for update skip locked;
  if t.id is null then return null; end if;
  update tickets set status='called', counter_id=c.id, called_at=now() where id=t.id returning * into t;
  insert into ticket_events(ticket_id, action, service_id, counter_id, staff_id, staff_email)
    values (t.id,'called',c.service_id,c.id,auth.uid(), auth.jwt()->>'email');
  return row_to_json(t);
end $$;

create or replace function public.staff_action(p_ticket uuid, p_action text, p_target_service uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare t public.tickets;
begin
  if auth.uid() is null then raise exception 'Not authorized'; end if;
  select * into t from tickets where id = p_ticket for update;
  if t.id is null then raise exception 'Ticket not found'; end if;
  if p_action = 'recall' then update tickets set called_at=now(), recall_count=recall_count+1, status='called' where id=t.id;
  elsif p_action = 'start' then update tickets set status='serving', started_at=now() where id=t.id;
  elsif p_action = 'complete' then update tickets set status='done', completed_at=now() where id=t.id;
  elsif p_action = 'no_show' then update tickets set status='no_show', completed_at=now() where id=t.id;
  elsif p_action = 'requeue' then update tickets set status='waiting', counter_id=null, called_at=null where id=t.id;
  elsif p_action = 'transfer' then
    if p_target_service is null then raise exception 'Target required'; end if;
    update tickets set service_id=p_target_service, status='waiting', counter_id=null, called_at=null, started_at=null, queued_at=now() where id=t.id;
  else raise exception 'Unknown action'; end if;
  insert into ticket_events(ticket_id, action, service_id, counter_id, staff_id, staff_email)
    values (t.id, p_action, coalesce(p_target_service, t.service_id), t.counter_id, auth.uid(), auth.jwt()->>'email');
end $$;
