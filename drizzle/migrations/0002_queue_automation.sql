
alter table public.tickets add column missed_returns int not null default 0;
alter table public.services add column surge_threshold int not null default 25;
alter table public.counters add column overflow boolean not null default false;

create table public.automation_state (id int primary key default 1, last_run timestamptz not null default 'epoch');
grant all on public.automation_state to service_role;
alter table public.automation_state enable row level security;
insert into public.automation_state(id) values (1);

-- The queue robot: runs at most every 30s, triggered by the TV display poll (no background timer cost)
create or replace function public.run_queue_automation(p_force boolean default false)
returns json language plpgsql security definer set search_path = public as $$
declare n_recall int := 0; n_noshow int := 0; n_requeue int := 0; n_open int := 0; n_close int := 0;
begin
  update automation_state set last_run = now() where id = 1 and (p_force or last_run < now() - interval '30 seconds');
  if not found then return json_build_object('skipped', true); end if;

  -- 1. Auto-recall: called but not started after 2 minutes, up to 2 recalls
  with r as (update tickets set called_at = now(), recall_count = recall_count + 1
    where status = 'called' and called_at < now() - interval '2 minutes' and recall_count < 2 returning id, service_id, counter_id)
  insert into ticket_events(ticket_id, action, service_id, counter_id, staff_email)
    select id, 'auto_recall', service_id, counter_id, 'Automation' from r;
  get diagnostics n_recall = row_count;

  -- 2. Auto no-show: still not at the desk 2 minutes after the last recall
  with r as (update tickets set status = 'no_show', completed_at = now()
    where status = 'called' and called_at < now() - interval '2 minutes' and recall_count >= 2 returning id, service_id, counter_id)
  insert into ticket_events(ticket_id, action, service_id, counter_id, staff_email)
    select id, 'auto_no_show', service_id, counter_id, 'Automation' from r;
  get diagnostics n_noshow = row_count;

  -- 3. Missed patients get another chance: back to the front after 15 min, up to 2 times, same day
  with r as (update tickets set status = 'waiting', counter_id = null, called_at = null, completed_at = null,
      recall_count = 0, missed_returns = missed_returns + 1, priority = greatest(priority, 1), queued_at = now()
    where status = 'no_show' and completed_at < now() - interval '15 minutes' and missed_returns < 2
      and created_at > now() - interval '12 hours' returning id, service_id)
  insert into ticket_events(ticket_id, action, service_id, staff_email)
    select id, 'auto_requeue', service_id, 'Automation' from r;
  get diagnostics n_requeue = row_count;

  -- 4. Surge: open overflow desks when a queue exceeds its threshold, close them when it drops below half
  with q as (select s.id, s.surge_threshold, (select count(*) from tickets t where t.service_id = s.id and t.status = 'waiting') w from services s)
  update counters c set active = true from q where c.service_id = q.id and c.overflow and not c.active and q.w >= q.surge_threshold;
  get diagnostics n_open = row_count;
  with q as (select s.id, s.surge_threshold, (select count(*) from tickets t where t.service_id = s.id and t.status = 'waiting') w from services s)
  update counters c set active = false from q where c.service_id = q.id and c.overflow and c.active and q.w < q.surge_threshold / 2
    and not exists (select 1 from tickets t where t.counter_id = c.id and t.status in ('called','serving'));
  get diagnostics n_close = row_count;

  return json_build_object('recalled', n_recall, 'no_show', n_noshow, 'requeued', n_requeue, 'overflow_opened', n_open, 'overflow_closed', n_close);
end $$;
revoke all on function public.run_queue_automation(boolean) from public, anon, authenticated;

-- 5. End-of-day close (run nightly)
create or replace function public.close_day()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with r as (update tickets set status = 'closed', completed_at = now()
    where status in ('waiting','called','serving','no_show') returning id, service_id)
  insert into ticket_events(ticket_id, action, service_id, staff_email) select id, 'day_close', service_id, 'Automation' from r;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.close_day() from public, anon, authenticated;

-- Display board now also wakes the robot and reports surge
create or replace function public.get_display_board()
returns json language plpgsql security definer set search_path = public as $$
begin
  perform run_queue_automation(false);
  return json_build_object(
    'called', coalesce((select json_agg(r) from (
      select t.token, c.name as counter, s.name_en as service_en, s.name_sw as service_sw, t.status, t.called_at, t.recall_count
      from tickets t join services s on s.id = t.service_id left join counters c on c.id = t.counter_id
      where t.status in ('called','serving') and t.called_at > now() - interval '12 hours'
      order by t.called_at desc limit 12) r), '[]'::json),
    'queues', coalesce((select json_agg(q order by q.sort) from (
      select s.code, s.name_en, s.name_sw, s.sort, s.avg_minutes, s.surge_threshold,
        (select count(*) from tickets t where t.service_id = s.id and t.status = 'waiting') as waiting,
        (select count(*) from counters c where c.service_id = s.id and c.active) as open_counters,
        (select array_agg(tok) from (select t.token as tok from tickets t where t.service_id = s.id and t.status='waiting'
           order by t.priority desc, t.queued_at limit 4) z) as next_tokens
      from services s) q), '[]'::json)
  );
end $$;
grant execute on function public.get_display_board() to anon, authenticated;

-- Wait estimate accounts for open desks
create or replace function public.issue_ticket(p_service_code text, p_phone text, p_visit_type text, p_payment text, p_priority int, p_language text)
returns json language plpgsql security definer set search_path = public as $$
declare s public.services; n int; t public.tickets; ahead int; desks int;
begin
  select * into s from services where code = p_service_code;
  if s.id is null then raise exception 'Unknown service'; end if;
  if p_phone is not null and p_phone !~ '^\+254[0-9]{9}$' then raise exception 'Invalid phone'; end if;
  if p_visit_type not in ('walk_in','booked') then raise exception 'Invalid visit type'; end if;
  if p_payment not in ('cash','insurance','sha') then raise exception 'Invalid payment'; end if;
  if p_priority not in (0,1,2) then raise exception 'Invalid priority'; end if;
  insert into daily_sequences(service_id, day, last_no) values (s.id, (now() at time zone 'Africa/Nairobi')::date, 1)
    on conflict (service_id, day) do update set last_no = daily_sequences.last_no + 1
    returning last_no into n;
  insert into tickets(token, service_id, visit_type, payment, priority, phone, language)
    values (s.prefix || '-' || lpad(n::text, greatest(3, length(n::text)), '0'), s.id, p_visit_type, p_payment, p_priority, nullif(p_phone,''), coalesce(p_language,'en'))
    returning * into t;
  insert into ticket_events(ticket_id, action, service_id) values (t.id, 'issued', s.id);
  select count(*) into ahead from tickets x where x.service_id = s.id and x.status = 'waiting' and x.id <> t.id
    and (x.priority > t.priority or (x.priority = t.priority and x.queued_at <= t.queued_at));
  select greatest(count(*),1) into desks from counters where service_id = s.id and active;
  return json_build_object('id', t.id, 'token', t.token, 'ahead', ahead, 'est_minutes', ceil(ahead * s.avg_minutes / desks::numeric),
    'service_en', s.name_en, 'service_sw', s.name_sw, 'created_at', t.created_at);
end $$;

-- Auto send onward: completing a doctor visit routes the ticket to billing by payment type
create or replace function public.staff_action(p_ticket uuid, p_action text, p_target_service uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare t public.tickets; svc text; nxt uuid;
begin
  if auth.uid() is null then raise exception 'Not authorized'; end if;
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
  elsif p_action = 'transfer' then
    if p_target_service is null then raise exception 'Target required'; end if;
    update tickets set service_id=p_target_service, status='waiting', counter_id=null, called_at=null, started_at=null, recall_count=0, queued_at=now() where id=t.id;
  else raise exception 'Unknown action'; end if;
  insert into ticket_events(ticket_id, action, service_id, counter_id, staff_id, staff_email)
    values (t.id, p_action, coalesce(p_target_service, t.service_id), t.counter_id, auth.uid(),
      case when p_action = 'auto_route' then 'Automation' else auth.jwt()->>'email' end);
end $$;

insert into public.counters(name, service_id, active, overflow)
select v.name, s.id, false, true from (values
 ('Registration 3 (overflow)','registration'),('Room 7 (overflow)','consultation'),('Cashier 3 (overflow)','cashier'),
 ('Pharmacy 3 (overflow)','pharmacy'),('Lab Window 2 (overflow)','lab')
) v(name, code) join public.services s on s.code = v.code;
