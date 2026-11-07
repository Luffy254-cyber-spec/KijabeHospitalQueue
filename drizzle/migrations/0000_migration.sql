
create table public.services (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  prefix text not null,
  name_en text not null,
  name_sw text not null,
  description_en text not null default '',
  description_sw text not null default '',
  kiosk_visible boolean not null default true,
  avg_minutes int not null default 6,
  sort int not null default 0
);
create table public.counters (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  service_id uuid not null references public.services(id) on delete cascade,
  active boolean not null default true
);
create table public.daily_sequences (
  service_id uuid not null references public.services(id) on delete cascade,
  day date not null,
  last_no int not null default 0,
  primary key (service_id, day)
);
create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  token text not null,
  service_id uuid not null references public.services(id),
  visit_type text not null default 'walk_in',
  payment text not null default 'cash',
  priority int not null default 0,
  phone text,
  language text not null default 'en',
  status text not null default 'waiting',
  counter_id uuid references public.counters(id),
  queued_at timestamptz not null default now(),
  called_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  recall_count int not null default 0,
  created_at timestamptz not null default now()
);
create index tickets_queue_idx on public.tickets(service_id, status, priority desc, queued_at);
create table public.ticket_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  action text not null,
  service_id uuid references public.services(id),
  counter_id uuid references public.counters(id),
  staff_id uuid,
  created_at timestamptz not null default now()
);
create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null unique references public.tickets(id) on delete cascade,
  rating int not null,
  wait_rating int,
  courtesy_rating int,
  comment text,
  created_at timestamptz not null default now()
);

grant select on public.services, public.counters to anon;
grant select, insert, update, delete on public.services, public.counters, public.tickets, public.ticket_events, public.feedback, public.daily_sequences to authenticated;
grant all on public.services, public.counters, public.tickets, public.ticket_events, public.feedback, public.daily_sequences to service_role;

alter table public.services enable row level security;
alter table public.counters enable row level security;
alter table public.daily_sequences enable row level security;
alter table public.tickets enable row level security;
alter table public.ticket_events enable row level security;
alter table public.feedback enable row level security;

create policy "public read services" on public.services for select to anon, authenticated using (true);
create policy "staff manage services" on public.services for all to authenticated using (true) with check (true);
create policy "public read counters" on public.counters for select to anon, authenticated using (true);
create policy "staff manage counters" on public.counters for all to authenticated using (true) with check (true);
create policy "staff tickets" on public.tickets for all to authenticated using (true) with check (true);
create policy "staff events" on public.ticket_events for all to authenticated using (true) with check (true);
create policy "staff feedback" on public.feedback for select to authenticated using (true);
create policy "staff seq" on public.daily_sequences for select to authenticated using (true);

alter publication supabase_realtime add table public.tickets;

-- Issue ticket (kiosk, anonymous)
create or replace function public.issue_ticket(p_service_code text, p_phone text, p_visit_type text, p_payment text, p_priority int, p_language text)
returns json language plpgsql security definer set search_path = public as $$
declare s public.services; n int; t public.tickets; ahead int;
begin
  select * into s from services where code = p_service_code;
  if s.id is null then raise exception 'Unknown service'; end if;
  if p_phone is not null and p_phone !~ '^\+?[0-9]{9,13}$' then raise exception 'Invalid phone'; end if;
  if p_visit_type not in ('walk_in','booked') then raise exception 'Invalid visit type'; end if;
  if p_payment not in ('cash','insurance','sha') then raise exception 'Invalid payment'; end if;
  if p_priority not in (0,1,2) then raise exception 'Invalid priority'; end if;
  insert into daily_sequences(service_id, day, last_no) values (s.id, (now() at time zone 'Africa/Nairobi')::date, 1)
    on conflict (service_id, day) do update set last_no = daily_sequences.last_no + 1
    returning last_no into n;
  insert into tickets(token, service_id, visit_type, payment, priority, phone, language)
    values (s.prefix || '-' || lpad(n::text, 3, '0'), s.id, p_visit_type, p_payment, p_priority, nullif(p_phone,''), coalesce(p_language,'en'))
    returning * into t;
  insert into ticket_events(ticket_id, action, service_id) values (t.id, 'issued', s.id);
  select count(*) into ahead from tickets x where x.service_id = s.id and x.status = 'waiting' and x.id <> t.id
    and (x.priority > t.priority or (x.priority = t.priority and x.queued_at <= t.queued_at));
  return json_build_object('id', t.id, 'token', t.token, 'ahead', ahead, 'est_minutes', ahead * s.avg_minutes,
    'service_en', s.name_en, 'service_sw', s.name_sw, 'created_at', t.created_at);
end $$;

create or replace function public.get_ticket_status(p_id uuid)
returns json language plpgsql security definer set search_path = public as $$
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
    'created_at', t.created_at, 'has_feedback', fb, 'language', t.language);
end $$;

create or replace function public.get_display_board()
returns json language sql security definer set search_path = public as $$
  select json_build_object(
    'called', coalesce((select json_agg(r) from (
      select t.token, c.name as counter, s.name_en as service_en, s.name_sw as service_sw, t.status, t.called_at, t.recall_count
      from tickets t join services s on s.id = t.service_id left join counters c on c.id = t.counter_id
      where t.status in ('called','serving') and t.called_at > now() - interval '12 hours'
      order by t.called_at desc limit 12) r), '[]'::json),
    'queues', coalesce((select json_agg(q order by q.sort) from (
      select s.code, s.name_en, s.name_sw, s.sort, s.avg_minutes,
        (select count(*) from tickets t where t.service_id = s.id and t.status = 'waiting') as waiting,
        (select array_agg(tok) from (select t.token as tok from tickets t where t.service_id = s.id and t.status='waiting'
           order by t.priority desc, t.queued_at limit 4) z) as next_tokens
      from services s) q), '[]'::json)
  );
$$;

create or replace function public.submit_feedback(p_ticket uuid, p_rating int, p_wait int, p_courtesy int, p_comment text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_rating < 1 or p_rating > 5 then raise exception 'Invalid rating'; end if;
  if not exists (select 1 from tickets where id = p_ticket and status = 'done') then raise exception 'Visit not complete'; end if;
  insert into feedback(ticket_id, rating, wait_rating, courtesy_rating, comment)
    values (p_ticket, p_rating, p_wait, p_courtesy, left(p_comment, 1000))
    on conflict (ticket_id) do nothing;
end $$;

-- Staff: call next (atomic)
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
  insert into ticket_events(ticket_id, action, service_id, counter_id, staff_id) values (t.id,'called',c.service_id,c.id,auth.uid());
  return row_to_json(t);
end $$;

create or replace function public.staff_action(p_ticket uuid, p_action text, p_target_service uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare t public.tickets;
begin
  if auth.uid() is null then raise exception 'Not authorized'; end if;
  select * into t from tickets where id = p_ticket for update;
  if p_action = 'recall' then update tickets set called_at=now(), recall_count=recall_count+1, status='called' where id=t.id;
  elsif p_action = 'start' then update tickets set status='serving', started_at=now() where id=t.id;
  elsif p_action = 'complete' then update tickets set status='done', completed_at=now() where id=t.id;
  elsif p_action = 'no_show' then update tickets set status='no_show', completed_at=now() where id=t.id;
  elsif p_action = 'requeue' then update tickets set status='waiting', counter_id=null, called_at=null where id=t.id;
  elsif p_action = 'transfer' then
    if p_target_service is null then raise exception 'Target required'; end if;
    update tickets set service_id=p_target_service, status='waiting', counter_id=null, called_at=null, started_at=null, queued_at=now() where id=t.id;
  else raise exception 'Unknown action'; end if;
  insert into ticket_events(ticket_id, action, service_id, counter_id, staff_id)
    values (t.id, p_action, coalesce(p_target_service, t.service_id), t.counter_id, auth.uid());
end $$;

revoke all on function public.call_next(uuid), public.staff_action(uuid,text,uuid) from public, anon;
grant execute on function public.call_next(uuid), public.staff_action(uuid,text,uuid) to authenticated;
grant execute on function public.issue_ticket(text,text,text,text,int,text), public.get_ticket_status(uuid), public.get_display_board(), public.submit_feedback(uuid,int,int,int,text) to anon, authenticated;

insert into public.services(code,prefix,name_en,name_sw,description_en,description_sw,kiosk_visible,avg_minutes,sort) values
 ('registration','REG','Registration','Usajili','New & returning patients, file retrieval','Wagonjwa wapya na wanaorudi',true,4,1),
 ('triage','TRI','Triage','Uchunguzi wa Awali','Vitals & nurse assessment','Vipimo vya awali na muuguzi',false,5,2),
 ('consultation','OPD','Doctor Consultation','Kuonana na Daktari','Outpatient clinic consultation','Kliniki ya wagonjwa wa nje',true,12,3),
 ('cashier','CSH','Cashier / Billing','Malipo','Cash & M-Pesa payments','Malipo ya pesa taslimu na M-Pesa',true,4,4),
 ('insurance','INS','Insurance & SHA','Bima na SHA','Insurance, SHA & corporate approvals','Idhini za bima, SHA na makampuni',true,7,5),
 ('lab','LAB','Laboratory','Maabara','Sample collection & results','Kuchukua sampuli na majibu',true,6,6),
 ('radiology','RAD','Radiology / Imaging','Picha (X-Ray)','X-ray, ultrasound, CT','X-ray, ultrasound, CT',true,10,7),
 ('pharmacy','PHM','Pharmacy','Duka la Dawa','Collect prescribed medicine','Kuchukua dawa',true,5,8),
 ('enquiries','ENQ','Enquiries','Maswali','Information & customer care','Maelezo na huduma kwa wateja',true,3,9);

insert into public.counters(name, service_id)
select v.name, s.id from (values
 ('Registration 1','registration'),('Registration 2','registration'),('Triage Room 1','triage'),('Triage Room 2','triage'),
 ('Room 4','consultation'),('Room 5','consultation'),('Room 6','consultation'),('Cashier 1','cashier'),('Cashier 2','cashier'),
 ('Insurance Desk','insurance'),('Lab Window','lab'),('Radiology Desk','radiology'),('Pharmacy 1','pharmacy'),('Pharmacy 2','pharmacy'),('Help Desk','enquiries')
) v(name, code) join public.services s on s.code = v.code;
